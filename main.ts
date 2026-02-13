import { z } from "zod";
import { AIService } from "./ai.ts";
import type { Logger, LLMCallLog, MuleOptions, ModelMessage } from "./types.ts";
import {
  RepositoryLogger,
  type PersistenceConfig,
  type StepExecutionRepository,
} from "./persistence.ts";
import { SQLiteRepository } from "./sqlite-repository.ts";

// Re-export types for convenience
export type { Logger, LLMCallLog, MuleOptions, ModelMessage };
export type {
  PersistenceConfig,
  StepExecutionRepository,
} from "./persistence.ts";
export type { StepExecution } from "./persistence.ts";

/**
 * Console logger implementation
 */
export class ConsoleLogger implements Logger {
  async log(data: LLMCallLog): Promise<void> {
    console.log("[Mule LLM Call]", JSON.stringify(data, null, 2));
  }
}

type Step<TInput, TOutput, TState, TId extends string = string> = {
  id: TId;
  outputSchema: { parse: (data: unknown) => TOutput };
  inputSchema: { parse: (data: unknown) => TInput };
  stateSchema?: { parse: (data: unknown) => TState };
  executor: (data: {
    input: TInput;
    state: TState;
    setState: (newState: Partial<TState>) => void;
    ai: AIService;
  }) => Promise<TOutput>;
  onError?: (
    error: Error,
    data: { input: TInput; state: TState }
  ) => Promise<void>;
};

function createStep<
  TId extends string,
  TInputSchema extends z.ZodTypeAny,
  TOutputSchema extends z.ZodTypeAny,
  TStateSchema extends z.ZodTypeAny = z.ZodObject<Record<string, never>>
>(config: {
  id: TId;
  inputSchema: TInputSchema;
  outputSchema: TOutputSchema;
  stateSchema?: TStateSchema;
  executor: (data: {
    input: z.infer<TInputSchema>;
    state: z.infer<TStateSchema>;
    setState: (newState: Partial<z.infer<TStateSchema>>) => void;
    ai: AIService;
  }) => Promise<z.infer<TOutputSchema>>;
  onError?: (
    error: Error,
    data: { input: z.infer<TInputSchema>; state: z.infer<TStateSchema> }
  ) => Promise<void>;
}): Step<z.infer<TInputSchema>, z.infer<TOutputSchema>, z.infer<TStateSchema>, TId> {
  return {
    id: config.id,
    inputSchema: config.inputSchema,
    outputSchema: config.outputSchema,
    stateSchema: config.stateSchema,
    executor: config.executor,
    onError: config.onError,
  };
}

/**
 * Execution context for tracking hierarchical step execution
 */
interface ExecutionContext {
  parentStepId?: string;
  executionGroup?: string;
  executionType?: "sequential" | "parallel" | "branch";
  depth: number;
}

class Workflow<
  TCurrentOutput = undefined,
  TState = Record<string, unknown>,
  TInitialInput = TCurrentOutput  // ← CORRECTED: Default to TCurrentOutput
> {
  id: string = "";
  state: TState;
  lastOutput: any = null;
  inputSchema: z.ZodTypeAny;
  private steps: Array<() => Promise<void>> = [];
  runId: string = "";
  readonly workflowId: string;
  projectId: string = "unknown";
  logger: Logger | null = null;

  // Execution context for hierarchical tracking
  private executionContext: ExecutionContext = { depth: 0 };

  constructor(
    workflowId: string,
    state: TState,
    inputSchema: z.ZodTypeAny = z.any()
  ) {
    this.workflowId = workflowId;
    this.state = state;
    this.lastOutput = null;
    this.inputSchema = inputSchema;
  }

  onError(
    _error: Error,
    _data: { input: TCurrentOutput; state: TState }
  ): Promise<void> {
    // Default no-op error handler for the workflow itself
    return Promise.resolve();
  }

  /**
   * Add a step to the workflow.
   *
   * Steps can declare their state requirements via `stateSchema`. The workflow's state
   * must satisfy the step's requirements (the step's state type should be a subset of
   * the workflow's state type).
   *
   * When adding a step, its state requirements are accumulated into the workflow's
   * state type, ensuring subsequent steps can access properties set by earlier steps.
   *
   * Nested workflows inherit the parent's state and can modify it, but don't affect
   * the parent's state type (they use `any` for state to allow flexible composition).
   */
  addStep<TOutput, TStepState extends Record<string, unknown> = Record<string, never>>(
    step: Step<TCurrentOutput, TOutput, TStepState> | Workflow<TOutput, any, any>
  ): Workflow<TOutput, TState & TStepState, TInitialInput> {
    //                                       ^^^^^^^^^^^^^ CORRECTED: Keep TInitialInput unchanged
    this.steps.push(async () => {
      this.lastOutput = await this.runStepExecution(step as any, this.lastOutput, {
        ...this.executionContext,
        executionType: "sequential",
      });
    });
    return this as any as Workflow<TOutput, TState & TStepState, TInitialInput>;
  }

  async run(
    paramsOrRunId?: string | {
      runId?: string;
      initialInput?: TInitialInput;  // ← CORRECTED: Uses TInitialInput (stays constant)
      initialState?: Record<string, unknown>;
    },
    initialInput?: TInitialInput,  // ← CORRECTED: Uses TInitialInput
    initialState?: Record<string, unknown>
  ): Promise<TCurrentOutput> {
    // IMPORTANT: Reset state at the start of each run to prevent pollution from previous runs.
    // Workflow instances are often reused (especially when exported as singletons or used as
    // nested workflows), so we must ensure clean state for each execution.
    const defaultState = {} as TState;

    // Handle both old signature (positional params) and new signature (named params)
    if (typeof paramsOrRunId === 'string' || paramsOrRunId === undefined) {
      // Old signature: run(runId?, initialInput?, initialState?)
      this.runId = paramsOrRunId || crypto.randomUUID();
      this.lastOutput = initialInput !== undefined ? initialInput : null;
      // Reset to default state, then merge initialState if provided
      this.state = initialState !== undefined
        ? { ...defaultState, ...initialState }
        : defaultState;
    } else {
      // New signature: run({ runId?, initialInput?, initialState? })
      this.runId = paramsOrRunId.runId || crypto.randomUUID();
      this.lastOutput = paramsOrRunId.initialInput !== undefined ? paramsOrRunId.initialInput : null;
      // Reset to default state, then merge initialState if provided
      this.state = paramsOrRunId.initialState !== undefined
        ? { ...defaultState, ...paramsOrRunId.initialState }
        : defaultState;
    }

    for (const stepFn of this.steps) {
      await stepFn();
    }
    return this.lastOutput;
  }

  getOutput(): TCurrentOutput {
    return this.lastOutput;
  }

  getState(): TState {
    return this.state;
  }

  parallel<TSteps extends readonly Step<TCurrentOutput, any, any, any>[]>(
    steps: [...TSteps]
  ): Workflow<any, TState, TInitialInput> {  // ← CORRECTED: Preserve TInitialInput
    this.steps.push(async () => {
      // Generate a unique execution group for this parallel batch
      const executionGroup = crypto.randomUUID();

      const results = await Promise.all(
        steps.map((step) =>
          this.runStepExecution(step, this.lastOutput, {
            ...this.executionContext,
            executionGroup,
            executionType: "parallel",
          })
        )
      );
      this.lastOutput = Object.fromEntries(
        steps.map((s, i) => {
          const key = s instanceof Workflow ? s.workflowId : s.id;
          return [key, results[i]];
        })
      );
    });
    return this as any as Workflow<any, TState, TInitialInput>;
  }

  branch(
    conditionalSteps: [
      step: Step<TCurrentOutput, any, any>,
      condition: (output: TCurrentOutput) => boolean
    ][]
  ): Workflow<any, TState, TInitialInput> {  // ← CORRECTED: Preserve TInitialInput
    this.steps.push(async () => {
      const stepsToRun = conditionalSteps
        .filter(([_, condition]) => condition(this.lastOutput))
        .map(([step]) => step);

      if (stepsToRun.length === 0) {
        this.lastOutput = {};
        return;
      }

      // Generate a unique execution group for this branch batch
      const executionGroup = crypto.randomUUID();

      const results = await Promise.all(
        stepsToRun.map((step) =>
          this.runStepExecution(step, this.lastOutput, {
            ...this.executionContext,
            executionGroup,
            executionType: "branch",
          })
        )
      );
      this.lastOutput = Object.fromEntries(
        stepsToRun.map((s, i) => [s.id, results[i]])
      );
    });
    return this as any as Workflow<any, TState, TInitialInput>;
  }

  private async runStepExecution(
    step: Step<any, any, any> | Workflow<any, any, any>,
    input: any,
    context: ExecutionContext
  ) {
    console.log(
      `[Workflow ${this.runId}] Executing step: ${
        step instanceof Workflow ? `Workflow(${step.workflowId})` : step.id
      }`
    );
    try {
      if (step instanceof Workflow) {
        step.state = this.state;
        // Nested workflow inherits parent config and execution context
        step.projectId = this.projectId;
        step.logger = this.logger;
        step.executionContext = {
          ...context,
          parentStepId: step.workflowId,
          depth: context.depth + 1,
        };
        const output = await step.run({
          runId: `${this.runId}->${step.workflowId}`,
          initialInput: input
        });
        // Sync state back from nested workflow to parent
        this.state = step.state as TState;
        return output;
      }
      // Create setState function that merges partial state updates
      const setState = (newState: Partial<TState>) => {
        this.state = { ...this.state, ...newState };
      };

      const output = await step.executor({
        input,
        state: this.state,
        setState,
        ai: new AIService({
          projectId: this.projectId,
          workflowId: this.workflowId,
          runId: this.runId,
          stepId: step.id,
          logger: this.logger,

          // Pass execution context to AIService
          parentStepId: context.parentStepId,
          executionGroup: context.executionGroup,
          executionType: context.executionType,
          depth: context.depth,
        }),
      });
      return output;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      if (step instanceof Workflow) {
        // For nested workflows, re-throw the error to propagate it up
        throw err;
      } else if (step.onError) {
        await step.onError(err, { input, state: this.state });
        // Return undefined when error is handled - workflow continues but with no output
        return undefined;
      } else {
        throw new Error(
          `Step '${this.runId}:${step.id}' failed: ${err.message}`
        );
      }
    }
  }
}

/**
 * Create persistence repository based on configuration
 */
function createPersistenceRepository(
  config: PersistenceConfig | undefined
): StepExecutionRepository | null {
  // Default: SQLite at ~/.mule/executions.db
  if (config === undefined) {
    return new SQLiteRepository();
  }

  // Explicitly disabled
  if (config === false) {
    return null;
  }

  // Explicit configuration
  switch (config.type) {
    case "sqlite":
      return new SQLiteRepository(config.path);
    case "postgres":
      throw new Error("PostgreSQL persistence not yet implemented");
    case "http":
      throw new Error("HTTP persistence not yet implemented");
  }
}

/**
 * Main Mule class for project-level configuration
 */
class Mule {
  private projectId: string;
  private logger: Logger;
  private loggingEnabled: boolean;
  private repository: StepExecutionRepository | null;

  constructor(projectId?: string, options?: MuleOptions) {
    this.projectId = projectId || Deno.env.get("MULE_PROJECT_ID") || "unknown";

    if (this.projectId === "unknown") {
      console.warn(
        "[Mule] No projectId provided. Set MULE_PROJECT_ID or pass to constructor."
      );
    }

    // Create persistence repository
    this.repository = createPersistenceRepository(options?.persistence);

    // Set up logger
    this.loggingEnabled = options?.logging?.enabled ?? true;

    // If persistence is enabled, use RepositoryLogger
    if (this.repository && this.loggingEnabled) {
      this.logger = new RepositoryLogger(this.repository);
    } else if (this.loggingEnabled) {
      // Fall back to custom logger or console logger
      this.logger = options?.logging?.logger ?? new ConsoleLogger();
    } else {
      // Logging disabled, use no-op logger
      this.logger = options?.logging?.logger ?? new ConsoleLogger();
    }
  }

  /**
   * Get the persistence repository for querying execution history
   */
  getRepository(): StepExecutionRepository | null {
    return this.repository;
  }

  createWorkflow<
    TInputSchema extends z.ZodTypeAny = z.ZodAny,
    TState = Record<string, unknown>
  >(params?: {
    state?: TState;
    inputSchema?: TInputSchema;
    id?: string;
  }): Workflow<
    z.infer<TInputSchema>,  // TCurrentOutput
    TState,                 // TState
    z.infer<TInputSchema>   // TInitialInput ← CORRECTED: Explicitly set
  > {
    const workflowId = params?.id || crypto.randomUUID();
    const workflow = new Workflow<
      z.infer<TInputSchema>,
      TState,
      z.infer<TInputSchema>  // ← CORRECTED: Pass TInitialInput
    >(
      workflowId,
      params?.state || ({} as TState),
      params?.inputSchema || (z.any() as any)
    );

    // Inject configuration
    workflow.projectId = this.projectId;
    workflow.logger = this.loggingEnabled ? this.logger : null;

    return workflow;
  }
}

function createWorkflow<
  TInputSchema extends z.ZodTypeAny = z.ZodAny,
  TState = Record<string, unknown>
>(params?: {
  state?: TState;
  inputSchema?: TInputSchema;
  id?: string;
}): Workflow<
  z.infer<TInputSchema>,
  TState,
  z.infer<TInputSchema>  // ← CORRECTED: Explicitly set TInitialInput
> {
  console.warn(
    "[Mule] Using createWorkflow() without Mule instance is deprecated. " +
      "Use: const mule = new Mule('projectId'); const workflow = mule.createWorkflow();"
  );

  // Use default Mule instance
  const defaultMule = new Mule();
  return defaultMule.createWorkflow<TInputSchema, TState>(params);
}

export {
  createStep,
  createWorkflow,
  Workflow,
  Mule,
  SQLiteRepository,
  RepositoryLogger,
};

export default {
  createStep,
  createWorkflow,
  Mule,
};