import { z } from "npm:zod@^4.1.12";

type Step<TInput, TOutput, TState, TId extends string = string> = {
  id: TId;
  outputSchema: { parse: (data: unknown) => TOutput };
  inputSchema: { parse: (data: unknown) => TInput };
  executor: (data: { input: TInput; state: TState }) => Promise<TOutput>;
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
  state: Record<string, any> = {};
  lastOutput: any = null;
  inputSchema: z.ZodTypeAny;
  private steps: Array<() => Promise<void>> = [];
  runId: string = "";
  readonly workflowId: string;

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

  async run(runId: string = "", initialInput?: TCurrentOutput): Promise<TCurrentOutput> {
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
        const output = await step.run(`${this.runId}->${step.workflowId}`, input);
        return output;
      }
      const output = await step.executor({ input, state: this.state });
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

function createWorkflow<TInputSchema extends z.ZodTypeAny = z.ZodUndefined>(
  state?: Record<string, unknown>,
  inputSchema?: TInputSchema
): Workflow<z.infer<TInputSchema>> {
  const workflowId = crypto.randomUUID();
  const finalState = state || {};
  const finalInputSchema = (inputSchema || z.undefined()) as TInputSchema;
  return new Workflow<z.infer<TInputSchema>>(workflowId, finalState, finalInputSchema);
}

export { createStep, createWorkflow, Workflow };

export default {
  createStep,
  createWorkflow,
};
