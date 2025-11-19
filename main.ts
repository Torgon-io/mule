import { z } from "npm:zod@^4.1.12";
import { AIService } from "./ai.ts";
import type { Logger, LLMCallLog, MuleOptions } from "./types.ts";
import {
  RepositoryLogger,
  type PersistenceConfig,
  type StepExecutionRepository,
} from "./persistence.ts";
import { SQLiteRepository } from "./sqlite-repository.ts";

// Re-export types for convenience
export type { Logger, LLMCallLog, MuleOptions };
export type { PersistenceConfig, StepExecutionRepository } from "./persistence.ts";
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
  executor: (data: {
    input: TInput;
    state: TState;
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
  TState = any
>(config: {
  id: TId;
  inputSchema: TInputSchema;
  outputSchema: TOutputSchema;
  executor: (data: {
    input: z.infer<TInputSchema>;
    state: TState;
    ai: AIService;
  }) => Promise<z.infer<TOutputSchema>>;
  onError?: (
    error: Error,
    data: { input: z.infer<TInputSchema>; state: TState }
  ) => Promise<void>;
}): Step<z.infer<TInputSchema>, z.infer<TOutputSchema>, TState, TId> {
  return {
    id: config.id,
    inputSchema: config.inputSchema,
    outputSchema: config.outputSchema,
    executor: config.executor,
    onError: config.onError,
  };
}

class Workflow<TCurrentOutput = undefined> {
  id: string = "";
  state: Record<string, any> = {};
  lastOutput: any = null;
  inputSchema: z.ZodTypeAny;
  private steps: Array<() => Promise<void>> = [];
  runId: string = "";
  readonly workflowId: string;
  projectId: string = "unknown";
  logger: Logger | null = null;

  constructor(
    workflowId: string,
    state: Record<string, any> = {},
    inputSchema: z.ZodTypeAny = z.undefined()
  ) {
    this.workflowId = workflowId;
    this.state = state;
    this.lastOutput = null;
    this.inputSchema = inputSchema;
  }

  onError(
    _error: Error,
    _data: { input: TCurrentOutput; state: Record<string, any> }
  ): Promise<void> {
    // Default no-op error handler for the workflow itself
    return Promise.resolve();
  }

  addStep<TOutput>(
    step: Step<TCurrentOutput, TOutput, any> | Workflow<TCurrentOutput>
  ): Workflow<TOutput> {
    this.steps.push(async () => {
      this.lastOutput = await this.runStepExecution(step, this.lastOutput);
    });
    return this as any as Workflow<TOutput>;
  }

  async run(
    runId: string = "",
    initialInput?: TCurrentOutput
  ): Promise<TCurrentOutput> {
    this.runId = runId || crypto.randomUUID();
    if (initialInput !== undefined) {
      this.lastOutput = initialInput;
    }
    for (const stepFn of this.steps) {
      await stepFn();
    }
    return this.lastOutput;
  }

  getOutput(): TCurrentOutput {
    return this.lastOutput;
  }

  getState(): Record<string, unknown> {
    return this.state;
  }

  parallel<TSteps extends readonly Step<TCurrentOutput, any, any, any>[]>(
    steps: [...TSteps]
  ): Workflow<any> {
    this.steps.push(async () => {
      const results = await Promise.all(
        steps.map((step) => this.runStepExecution(step, this.lastOutput))
      );
      this.lastOutput = Object.fromEntries(
        steps.map((s, i) => {
          const key = s instanceof Workflow ? s.workflowId : s.id;
          return [key, results[i]];
        })
      );
    });
    return this as any;
  }

  branch(
    conditionalSteps: [
      step: Step<TCurrentOutput, any, any>,
      condition: (output: TCurrentOutput) => boolean
    ][]
  ): Workflow<any> {
    this.steps.push(async () => {
      const stepsToRun = conditionalSteps
        .filter(([_, condition]) => condition(this.lastOutput))
        .map(([step]) => step);

      if (stepsToRun.length === 0) {
        this.lastOutput = {};
        return;
      }

      const results = await Promise.all(
        stepsToRun.map((step) => this.runStepExecution(step, this.lastOutput))
      );
      this.lastOutput = Object.fromEntries(
        stepsToRun.map((s, i) => [s.id, results[i]])
      );
    });
    return this;
  }

  private async runStepExecution(
    step: Step<any, any, any> | Workflow<any>,
    input: any
  ) {
    try {
      if (step instanceof Workflow) {
        step.state = this.state;
        // Nested workflow inherits parent config
        step.projectId = this.projectId;
        step.logger = this.logger;
        const output = await step.run(
          `${this.runId}->${step.workflowId}`,
          input
        );
        return output;
      }
      const output = await step.executor({
        input,
        state: this.state,
        ai: new AIService({
          projectId: this.projectId,
          workflowId: this.workflowId,
          runId: this.runId,
          stepId: step.id,
          logger: this.logger,
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

  createWorkflow<TInputSchema extends z.ZodTypeAny = z.ZodUndefined>(params?: {
    state?: Record<string, unknown>;
    inputSchema?: TInputSchema;
    id?: string;
  }): Workflow<z.infer<TInputSchema>> {
    const workflowId = params?.id || crypto.randomUUID();
    const workflow = new Workflow<z.infer<TInputSchema>>(
      workflowId,
      params?.state || {},
      params?.inputSchema || (z.undefined() as any)
    );

    // Inject configuration
    workflow.projectId = this.projectId;
    workflow.logger = this.loggingEnabled ? this.logger : null;

    return workflow;
  }
}

function createWorkflow<TInputSchema extends z.ZodTypeAny = z.ZodUndefined>(
  state?: Record<string, unknown>,
  inputSchema?: TInputSchema,
  id?: string
): Workflow<z.infer<TInputSchema>> {
  console.warn(
    "[Mule] Using createWorkflow() without Mule instance is deprecated. " +
      "Use: const mule = new Mule('projectId'); const workflow = mule.createWorkflow();"
  );

  // Use default Mule instance
  const defaultMule = new Mule();
  return defaultMule.createWorkflow({ state, inputSchema, id });
}

export { createStep, createWorkflow, Workflow, Mule, SQLiteRepository, RepositoryLogger };

export default {
  createStep,
  createWorkflow,
  Mule,
};
