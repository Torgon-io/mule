import { z } from "zod";
import { AIService } from "./ai.ts";
import type { Logger, LLMCallLog, MuleOptions, ModelMessage } from "./types.ts";
import {
  RepositoryLogger,
  type PersistenceConfig,
  type StepExecutionRepository,
} from "./persistence.ts";
import { SQLiteRepository } from "./sqlite-repository.ts";
import {
  getMaxParallelSteps,
  getStepRetries,
  runWithConcurrencyLimit,
} from "./lib.ts";

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

/**
 * Runtime context for a single workflow execution.
 * This ensures concurrent executions don't interfere with each other.
 */
interface RuntimeContext<TState> {
  state: TState;
  lastOutput: any;
  runId: string;
}

/**
 * Step definition stored for later execution
 */
type StepDefinition<TState> =
  | { type: "sequential"; step: Step<any, any, any> | Workflow<any, any, any> }
  | { type: "parallel"; steps: Step<any, any, any>[] }
  | { type: "branch"; conditionalSteps: [Step<any, any, any>, (output: any) => boolean][] };

class Workflow<
  TCurrentOutput = undefined,
  TState = Record<string, unknown>,
  TInitialInput = TCurrentOutput  // ← CORRECTED: Default to TCurrentOutput
> {
  id: string = "";
  state: TState;
  lastOutput: any = null;
  inputSchema: z.ZodTypeAny;
  private stepDefinitions: Array<StepDefinition<TState>> = [];
  runId: string = "";
  readonly workflowId: string;
  projectId: string = "unknown";
  logger: Logger | null = null;

  // Store the initial state from constructor to reset to on each run
  private readonly constructorState: TState;

  // Execution context for hierarchical tracking
  private executionContext: ExecutionContext = { depth: 0 };

  constructor(
    workflowId: string,
    state: TState,
    inputSchema: z.ZodTypeAny = z.any()
  ) {
    this.workflowId = workflowId;
    this.constructorState = { ...state };
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
    this.stepDefinitions.push({ type: "sequential", step: step as any });
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
    // IMPORTANT: Create execution-local runtime context to prevent race conditions.
    // Workflow instances are often reused (especially when exported as singletons),
    // so we must ensure each execution has isolated state that won't be affected
    // by concurrent executions.
    const defaultState = { ...this.constructorState };

    // Create runtime context local to this execution
    const runtime: RuntimeContext<TState> = {
      state: defaultState,
      lastOutput: null,
      runId: "",
    };

    // Handle both old signature (positional params) and new signature (named params)
    if (typeof paramsOrRunId === 'string' || paramsOrRunId === undefined) {
      // Old signature: run(runId?, initialInput?, initialState?)
      runtime.runId = paramsOrRunId || crypto.randomUUID();
      runtime.lastOutput = initialInput !== undefined ? initialInput : null;
      // Reset to constructor state, then merge initialState if provided
      runtime.state = initialState !== undefined
        ? { ...defaultState, ...initialState } as TState
        : defaultState;
    } else {
      // New signature: run({ runId?, initialInput?, initialState? })
      runtime.runId = paramsOrRunId.runId || crypto.randomUUID();
      runtime.lastOutput = paramsOrRunId.initialInput !== undefined ? paramsOrRunId.initialInput : null;
      // Reset to constructor state, then merge initialState if provided
      runtime.state = paramsOrRunId.initialState !== undefined
        ? { ...defaultState, ...paramsOrRunId.initialState } as TState
        : defaultState;
    }

    // Execute all step definitions with the runtime context
    for (const stepDef of this.stepDefinitions) {
      await this.executeStepDefinition(stepDef, runtime);
    }

    // Update instance properties for backward compatibility (getState, getOutput)
    this.state = runtime.state;
    this.lastOutput = runtime.lastOutput;
    this.runId = runtime.runId;

    return runtime.lastOutput;
  }

  /**
   * Execute a step definition with the given runtime context.
   * This keeps state isolated per execution to prevent race conditions.
   */
  private async executeStepDefinition(
    stepDef: StepDefinition<TState>,
    runtime: RuntimeContext<TState>
  ): Promise<void> {
    switch (stepDef.type) {
      case "sequential": {
        runtime.lastOutput = await this.runStepExecution(
          stepDef.step,
          runtime.lastOutput,
          { ...this.executionContext, executionType: "sequential" },
          runtime
        );
        break;
      }
      case "parallel": {
        const executionGroup = crypto.randomUUID();
        const maxParallel = getMaxParallelSteps();
        const taskFns = stepDef.steps.map((step) => () =>
          this.runStepExecution(
            step,
            runtime.lastOutput,
            { ...this.executionContext, executionGroup, executionType: "parallel" },
            runtime
          )
        );
        const results = await runWithConcurrencyLimit(taskFns, maxParallel);
        runtime.lastOutput = Object.fromEntries(
          stepDef.steps.map((s, i) => {
            const key = s instanceof Workflow ? s.workflowId : s.id;
            return [key, results[i]];
          })
        );
        break;
      }
      case "branch": {
        const stepsToRun = stepDef.conditionalSteps
          .filter(([_, condition]) => condition(runtime.lastOutput))
          .map(([step]) => step);

        if (stepsToRun.length === 0) {
          runtime.lastOutput = {};
          break;
        }

        const executionGroup = crypto.randomUUID();
        const maxParallel = getMaxParallelSteps();
        const taskFns = stepsToRun.map((step) => () =>
          this.runStepExecution(
            step,
            runtime.lastOutput,
            { ...this.executionContext, executionGroup, executionType: "branch" },
            runtime
          )
        );
        const results = await runWithConcurrencyLimit(taskFns, maxParallel);
        runtime.lastOutput = Object.fromEntries(
          stepsToRun.map((s, i) => [s.id, results[i]])
        );
        break;
      }
    }
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
    this.stepDefinitions.push({ type: "parallel", steps: steps as any });
    return this as any as Workflow<any, TState, TInitialInput>;
  }

  branch(
    conditionalSteps: [
      step: Step<TCurrentOutput, any, any>,
      condition: (output: TCurrentOutput) => boolean
    ][]
  ): Workflow<any, TState, TInitialInput> {  // ← CORRECTED: Preserve TInitialInput
    this.stepDefinitions.push({ type: "branch", conditionalSteps: conditionalSteps as any });
    return this as any as Workflow<any, TState, TInitialInput>;
  }

  private async runStepExecution(
    step: Step<any, any, any> | Workflow<any, any, any>,
    input: any,
    context: ExecutionContext,
    runtime: RuntimeContext<TState>
  ) {
    const maxRetries = getStepRetries();
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      console.log(
        `[Workflow ${runtime.runId}] Executing step: ${
          step instanceof Workflow ? `Workflow(${step.workflowId})` : step.id
        }${attempt > 0 ? ` (retry ${attempt}/${maxRetries})` : ""}`
      );
      try {
        if (step instanceof Workflow) {
          // Nested workflow inherits parent config and execution context
          step.projectId = this.projectId;
          step.logger = this.logger;
          step.executionContext = {
            ...context,
            parentStepId: step.workflowId,
            depth: context.depth + 1,
          };
          const output = await step.run({
            runId: `${runtime.runId}->${step.workflowId}`,
            initialInput: input,
            initialState: runtime.state as Record<string, unknown>
          });
          // Sync state back from nested workflow to parent runtime context
          runtime.state = step.state as TState;
          return output;
        }
        // Create setState function that merges partial state updates into runtime context
        const setState = (newState: Partial<TState>) => {
          runtime.state = { ...runtime.state, ...newState };
        };

        const output = await step.executor({
          input,
          state: runtime.state,
          setState,
          ai: new AIService({
            projectId: this.projectId,
            workflowId: this.workflowId,
            runId: runtime.runId,
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
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < maxRetries) continue;
        break;
      }
    }

    const err = lastError!;
    if (step instanceof Workflow) {
      throw err;
    } else if (step.onError) {
      await step.onError(err, { input, state: runtime.state });
      return undefined;
    } else {
      throw new Error(
        `Step '${runtime.runId}:${step.id}' failed: ${err.message}`
      );
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