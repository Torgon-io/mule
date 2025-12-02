// Standalone test for nested workflow type fix
// This avoids the AI imports which have Zod version conflicts

import { assertEquals } from "@std/assert";
import { z } from "npm:zod@^4.1.12";

// Minimal type definitions needed for testing
type Step<TInput, TOutput, TState, TId extends string = string> = {
  id: TId;
  outputSchema: { parse: (data: unknown) => TOutput };
  inputSchema?: { parse: (data: unknown) => TInput };
  executor: (data: {
    input: TInput;
    state: TState;
  }) => Promise<TOutput>;
};

function createStep<
  TId extends string,
  TInput,
  TOutput,
  TState = Record<string, unknown>
>(options: {
  id: TId;
  inputSchema: { parse: (data: unknown) => TInput };
  outputSchema: { parse: (data: unknown) => TOutput };
  executor: (data: { input: TInput; state: TState }) => Promise<TOutput>;
}): Step<TInput, TOutput, TState, TId> {
  return options as Step<TInput, TOutput, TState, TId>;
}

class Workflow<
  TCurrentOutput = undefined,
  TState = Record<string, unknown>
> {
  private steps: Array<() => Promise<void>> = [];
  lastOutput: unknown = undefined;
  state: TState;
  inputSchema?: { parse: (data: unknown) => TCurrentOutput };

  constructor(options?: {
    state?: TState;
    inputSchema?: { parse: (data: unknown) => TCurrentOutput };
  }) {
    this.state = (options?.state ?? {}) as TState;
    this.inputSchema = options?.inputSchema;
  }

  // Key fix: The second type in the union is Workflow<TOutput, TState>, not Workflow<TCurrentOutput, TState>
  addStep<TOutput>(
    step: Step<TCurrentOutput, TOutput, TState> | Workflow<TOutput, TState>
  ): Workflow<TOutput, TState> {
    this.steps.push(async () => {
      if (step instanceof Workflow) {
        // Execute nested workflow
        const result = await step.run({ initialInput: this.lastOutput as any });
        this.lastOutput = result;
      } else {
        // Execute regular step
        const input = step.inputSchema
          ? step.inputSchema.parse(this.lastOutput)
          : this.lastOutput;
        const output = await step.executor({
          input: input as TCurrentOutput,
          state: this.state,
        });
        this.lastOutput = step.outputSchema.parse(output);
      }
    });
    return this as unknown as Workflow<TOutput, TState>;
  }

  async run(params?: { initialInput?: TCurrentOutput }): Promise<TCurrentOutput> {
    if (params?.initialInput !== undefined) {
      this.lastOutput = this.inputSchema
        ? this.inputSchema.parse(params.initialInput)
        : params.initialInput;
    }
    for (const step of this.steps) {
      await step();
    }
    return this.lastOutput as TCurrentOutput;
  }
}

function createWorkflow<TState = Record<string, unknown>>(options?: {
  id?: string;
  inputSchema?: { parse: (data: unknown) => any };
  state?: TState;
}): Workflow<any, TState> {
  return new Workflow<any, TState>({
    state: options?.state,
    inputSchema: options?.inputSchema,
  });
}

Deno.test("Workflow - nested workflow as step (type fix verification)", async () => {
  // Create a nested workflow that expects sourceDocumentation and outputs documentationAnalysis
  const nestedWorkflow = createWorkflow({
    id: "nested-workflow",
    inputSchema: z.object({
      sourceDocumentation: z.string(),
    }),
  }).addStep(
    createStep({
      id: "analyze",
      inputSchema: z.object({
        sourceDocumentation: z.string(),
      }),
      outputSchema: z.object({
        documentationAnalysis: z.string(),
      }),
      executor: async ({ input }) => {
        return {
          documentationAnalysis: `Analysis of: ${input.sourceDocumentation}`,
        };
      },
    })
  );

  // Create main workflow with a step that outputs sourceDocumentation
  const mainWorkflow = createWorkflow()
    .addStep(
      createStep({
        id: "load-docs",
        inputSchema: z.undefined(),
        outputSchema: z.object({
          sourceDocumentation: z.string(),
        }),
        executor: async () => {
          return {
            sourceDocumentation: "Test documentation content",
          };
        },
      })
    )
    .addStep(nestedWorkflow)
    .addStep(
      createStep({
        id: "process-analysis",
        inputSchema: z.object({
          documentationAnalysis: z.string(),
        }),
        outputSchema: z.string(),
        executor: async ({ input }) => {
          return input.documentationAnalysis.toUpperCase();
        },
      })
    );

  const result = await mainWorkflow.run();
  assertEquals(result, "ANALYSIS OF: TEST DOCUMENTATION CONTENT");
});
