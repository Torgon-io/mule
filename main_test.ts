import { assertEquals } from "@std/assert";
import { Workflow, createStep, createWorkflow } from "./main.ts";
import { z } from "jsr:@zod/zod";

Deno.test("Workflow - single step execution", async () => {
  const step1 = createStep({
    id: "step1",
    inputSchema: z.undefined(),
    outputSchema: z.string(),
    executor: async () => {
      return "Hello, World!";
    },
  });

  const workflow = new Workflow();
  const result = await workflow.addStep(step1).run();

  assertEquals(result, "Hello, World!");
});

Deno.test("Workflow - sequential steps", async () => {
  const step1 = createStep({
    id: "step1",
    inputSchema: z.undefined(),
    outputSchema: z.string(),
    executor: async () => {
      return "test";
    },
  });

  const step2 = createStep({
    id: "step2",
    inputSchema: z.string(),
    outputSchema: z.number(),
    executor: async ({ input }: { input: string; state: any }) => {
      return input.length;
    },
  });

  const workflow = new Workflow();
  const result = await workflow.addStep(step1).addStep(step2).run();

  assertEquals(result, 4);
});

Deno.test("Workflow - parallel execution", async () => {
  const step1 = createStep({
    id: "step1",
    inputSchema: z.undefined(),
    outputSchema: z.string(),
    executor: async () => {
      return "Hello";
    },
  });

  const step2 = createStep({
    id: "step2",
    inputSchema: z.string(),
    outputSchema: z.number(),
    executor: async ({ input }: { input: string; state: any }) => {
      return input.length;
    },
  });

  const step3 = createStep({
    id: "step3",
    inputSchema: z.string(),
    outputSchema: z.number(),
    executor: async ({ input }: { input: string; state: any }) => {
      return input.length * 2;
    },
  });

  const workflow = new Workflow();
  const result = await workflow.addStep(step1).parallel([step2, step3]).run();

  assertEquals(result, { step2: 5, step3: 10 });
});

Deno.test("Workflow - state management", async () => {
  const step1 = createStep({
    id: "step1",
    inputSchema: z.undefined(),
    outputSchema: z.string(),
    executor: async ({ state }: { input: undefined; state: any }) => {
      state.counter = 1;
      return "test";
    },
  });

  const step2 = createStep({
    id: "step2",
    inputSchema: z.string(),
    outputSchema: z.number(),
    executor: async ({ state }: { input: string; state: any }) => {
      return state.counter + 10;
    },
  });

  const workflow = new Workflow();
  const result = await workflow.addStep(step1).addStep(step2).run();

  assertEquals(result, 11);
  assertEquals(workflow.getState().counter, 1);
});

Deno.test("Workflow - branch with single condition true", async () => {
  const initialStep = createStep({
    id: "initial",
    inputSchema: z.undefined(),
    outputSchema: z.number(),
    executor: async () => {
      return 10;
    },
  });

  const branchStep1 = createStep({
    id: "branchStep1",
    inputSchema: z.number(),
    outputSchema: z.string(),
    executor: async ({ input }: { input: number; state: any }) => {
      return `Value is ${input}`;
    },
  });

  const branchStep2 = createStep({
    id: "branchStep2",
    inputSchema: z.number(),
    outputSchema: z.string(),
    executor: async ({ input }: { input: number; state: any }) => {
      return `Negative value: ${input}`;
    },
  });

  const workflow = new Workflow();
  const result = await workflow
    .addStep(initialStep)
    .branch([
      [branchStep1, (output: number) => output > 5],
      [branchStep2, (output: number) => output < 5],
    ])
    .run();

  assertEquals(result, { branchStep1: "Value is 10" });
});

Deno.test("Workflow - branch with multiple conditions true", async () => {
  const initialStep = createStep({
    id: "initial",
    inputSchema: z.undefined(),
    outputSchema: z.number(),
    executor: async () => {
      return 10;
    },
  });

  const branchStep1 = createStep({
    id: "branchStep1",
    inputSchema: z.number(),
    outputSchema: z.string(),
    executor: async ({ input }: { input: number; state: any }) => {
      return `Positive: ${input}`;
    },
  });

  const branchStep2 = createStep({
    id: "branchStep2",
    inputSchema: z.number(),
    outputSchema: z.string(),
    executor: async ({ input }: { input: number; state: any }) => {
      return `Even: ${input}`;
    },
  });

  const workflow = new Workflow();
  const result = await workflow
    .addStep(initialStep)
    .branch([
      [branchStep1, (output: number) => output > 0],
      [branchStep2, (output: number) => output % 2 === 0],
    ])
    .run();

  assertEquals(result, {
    branchStep1: "Positive: 10",
    branchStep2: "Even: 10",
  });
});

Deno.test("Workflow - branch with no conditions true", async () => {
  const initialStep = createStep({
    id: "initial",
    inputSchema: z.undefined(),
    outputSchema: z.number(),
    executor: async () => {
      return 5;
    },
  });

  const branchStep1 = createStep({
    id: "branchStep1",
    inputSchema: z.number(),
    outputSchema: z.string(),
    executor: async ({ input }: { input: number; state: any }) => {
      return `Large: ${input}`;
    },
  });

  const branchStep2 = createStep({
    id: "branchStep2",
    inputSchema: z.number(),
    outputSchema: z.string(),
    executor: async ({ input }: { input: number; state: any }) => {
      return `Small: ${input}`;
    },
  });

  const workflow = new Workflow();
  const result = await workflow
    .addStep(initialStep)
    .branch([
      [branchStep1, (output: number) => output > 10],
      [branchStep2, (output: number) => output < 3],
    ])
    .run();

  assertEquals(result, {});
});

Deno.test("Workflow - initialization with inputSchema", () => {
  const userInputSchema = z.object({
    name: z.string(),
    age: z.number(),
  });

  const workflow = createWorkflow({}, userInputSchema);

  assertEquals(workflow.inputSchema, userInputSchema);
});

Deno.test("Workflow - first step with workflow inputSchema", async () => {
  const userInputSchema = z.object({
    name: z.string(),
    count: z.number(),
  });

  type UserInput = z.infer<typeof userInputSchema>;

  const step1 = createStep({
    id: "step1",
    inputSchema: userInputSchema,
    outputSchema: z.string(),
    executor: async ({ input }: { input: UserInput; state: Record<string, unknown> }) => {
      return `${input.name} - ${input.count}`;
    },
  });

  const workflow = createWorkflow<UserInput>({}, userInputSchema);
  workflow.lastOutput = { name: "Test User", count: 42 };

  const result = await workflow.addStep(step1).run();

  assertEquals(result, "Test User - 42");
});

Deno.test("Workflow - inputSchema with initial state and typed input", async () => {
  const inputSchema = z.object({
    userId: z.string(),
    initialValue: z.number(),
  });

  type WorkflowInput = z.infer<typeof inputSchema>;

  const step1 = createStep({
    id: "step1",
    inputSchema: inputSchema,
    outputSchema: z.number(),
    executor: async ({ input, state }: { input: WorkflowInput; state: Record<string, unknown> }) => {
      state.userId = input.userId;
      return input.initialValue * 2;
    },
  });

  const step2 = createStep({
    id: "step2",
    inputSchema: z.number(),
    outputSchema: z.object({
      userId: z.string(),
      finalValue: z.number(),
    }),
    executor: async ({ input, state }: { input: number; state: Record<string, unknown> }) => {
      return {
        userId: state.userId as string,
        finalValue: input + 10,
      };
    },
  });

  const workflow = createWorkflow<WorkflowInput>({ extraData: "test" }, inputSchema);
  workflow.lastOutput = { userId: "user123", initialValue: 5 };

  const result = await workflow.addStep(step1).addStep(step2).run();

  assertEquals(result, { userId: "user123", finalValue: 20 });
  assertEquals(workflow.getState().userId, "user123");
  assertEquals(workflow.getState().extraData, "test");
});

// Error Handling Tests

Deno.test("onError - sequential step throws error without handler", async () => {
  const failingStep = createStep({
    id: "failingStep",
    inputSchema: z.undefined(),
    outputSchema: z.string(),
    executor: async () => {
      throw new Error("Something went wrong");
    },
  });

  const workflow = new Workflow();

  let errorThrown = false;
  try {
    await workflow.addStep(failingStep).run("test-workflow");
  } catch (error) {
    errorThrown = true;
    assertEquals((error as Error).message, "Step 'test-workflow:failingStep' failed: Something went wrong");
  }

  assertEquals(errorThrown, true);
});

Deno.test("onError - sequential step with error handler prevents crash", async () => {
  let errorHandlerCalled = false;
  let capturedError: Error | null = null;

  const failingStep = createStep({
    id: "failingStep",
    inputSchema: z.undefined(),
    outputSchema: z.string(),
    executor: async () => {
      throw new Error("Test error");
    },
    onError: async (error: Error) => {
      errorHandlerCalled = true;
      capturedError = error;
    },
  });

  const workflow = new Workflow();
  const result = await workflow.addStep(failingStep).run();

  assertEquals(errorHandlerCalled, true);
  assertEquals(capturedError !== null, true);
  assertEquals(capturedError!.message, "Test error");
  assertEquals(result, undefined);
});

Deno.test("onError - error handler receives correct input and state", async () => {
  let capturedInput: string | null = null;
  let capturedState: Record<string, unknown> | null = null;

  const step1 = createStep({
    id: "step1",
    inputSchema: z.undefined(),
    outputSchema: z.string(),
    executor: async ({ state }) => {
      state.testValue = 42;
      return "test input";
    },
  });

  const failingStep = createStep({
    id: "failingStep",
    inputSchema: z.string(),
    outputSchema: z.number(),
    executor: async () => {
      throw new Error("Test error");
    },
    onError: async (_error: Error, { input, state }: { input: string; state: Record<string, unknown> }) => {
      capturedInput = input;
      capturedState = state;
    },
  });

  const workflow = new Workflow();
  await workflow.addStep(step1).addStep(failingStep).run();

  assertEquals(capturedInput, "test input");
  assertEquals(capturedState !== null, true);
  assertEquals(capturedState!.testValue, 42);
});

Deno.test("onError - workflow continues after error with next step", async () => {
  const failingStep = createStep({
    id: "failingStep",
    inputSchema: z.undefined(),
    outputSchema: z.string(),
    executor: async () => {
      throw new Error("Test error");
    },
    onError: async () => {
      // Handle error silently
    },
  });

  const successStep = createStep({
    id: "successStep",
    inputSchema: z.any(),
    outputSchema: z.string(),
    executor: async () => {
      return "success";
    },
  });

  const workflow = new Workflow();
  const result = await workflow
    .addStep(failingStep)
    .addStep(successStep)
    .run();

  assertEquals(result, "success");
});

Deno.test("onError - parallel execution with one failing step", async () => {
  let errorHandlerCalled = false;

  const initialStep = createStep({
    id: "initial",
    inputSchema: z.undefined(),
    outputSchema: z.string(),
    executor: async () => "test",
  });

  const successStep = createStep({
    id: "successStep",
    inputSchema: z.string(),
    outputSchema: z.number(),
    executor: async ({ input }) => input.length,
  });

  const failingStep = createStep({
    id: "failingStep",
    inputSchema: z.string(),
    outputSchema: z.number(),
    executor: async () => {
      throw new Error("Parallel step failed");
    },
    onError: async () => {
      errorHandlerCalled = true;
    },
  });

  const workflow = new Workflow();
  const result = await workflow
    .addStep(initialStep)
    .parallel([successStep, failingStep])
    .run();

  assertEquals(errorHandlerCalled, true);
  assertEquals(result.successStep, 4);
  assertEquals(result.failingStep, undefined);
});

Deno.test("onError - parallel execution with multiple failing steps", async () => {
  let error1Called = false;
  let error2Called = false;

  const initialStep = createStep({
    id: "initial",
    inputSchema: z.undefined(),
    outputSchema: z.string(),
    executor: async () => "test",
  });

  const failingStep1 = createStep({
    id: "failingStep1",
    inputSchema: z.string(),
    outputSchema: z.number(),
    executor: async () => {
      throw new Error("Error 1");
    },
    onError: async () => {
      error1Called = true;
    },
  });

  const failingStep2 = createStep({
    id: "failingStep2",
    inputSchema: z.string(),
    outputSchema: z.number(),
    executor: async () => {
      throw new Error("Error 2");
    },
    onError: async () => {
      error2Called = true;
    },
  });

  const workflow = new Workflow();
  const result = await workflow
    .addStep(initialStep)
    .parallel([failingStep1, failingStep2])
    .run();

  assertEquals(error1Called, true);
  assertEquals(error2Called, true);
  assertEquals(result.failingStep1, undefined);
  assertEquals(result.failingStep2, undefined);
});

Deno.test("onError - parallel execution without error handler crashes", async () => {
  const initialStep = createStep({
    id: "initial",
    inputSchema: z.undefined(),
    outputSchema: z.string(),
    executor: async () => "test",
  });

  const failingStep = createStep({
    id: "failingStep",
    inputSchema: z.string(),
    outputSchema: z.number(),
    executor: async () => {
      throw new Error("Unhandled error");
    },
  });

  const workflow = new Workflow();

  let errorThrown = false;
  try {
    await workflow
      .addStep(initialStep)
      .parallel([failingStep])
      .run("test-workflow");
  } catch (error) {
    errorThrown = true;
    assertEquals((error as Error).message, "Step 'test-workflow:failingStep' failed: Unhandled error");
  }

  assertEquals(errorThrown, true);
});

Deno.test("onError - branch execution with failing step", async () => {
  let errorHandlerCalled = false;

  const initialStep = createStep({
    id: "initial",
    inputSchema: z.undefined(),
    outputSchema: z.number(),
    executor: async () => 10,
  });

  const failingBranchStep = createStep({
    id: "failingBranch",
    inputSchema: z.number(),
    outputSchema: z.string(),
    executor: async () => {
      throw new Error("Branch error");
    },
    onError: async () => {
      errorHandlerCalled = true;
    },
  });

  const workflow = new Workflow();
  const result = await workflow
    .addStep(initialStep)
    .branch([[failingBranchStep, (output: number) => output > 5]])
    .run();

  assertEquals(errorHandlerCalled, true);
  assertEquals(result.failingBranch, undefined);
});

Deno.test("onError - error handler can access and modify state", async () => {
  const failingStep = createStep({
    id: "failingStep",
    inputSchema: z.undefined(),
    outputSchema: z.string(),
    executor: async ({ state }) => {
      state.attemptCount = 1;
      throw new Error("Test error");
    },
    onError: async (_error: Error, { state }: { input: undefined; state: Record<string, unknown> }) => {
      state.errorLogged = true;
      state.attemptCount = (state.attemptCount as number) + 1;
    },
  });

  const workflow = new Workflow();
  await workflow.addStep(failingStep).run();

  assertEquals(workflow.getState().attemptCount, 2);
  assertEquals(workflow.getState().errorLogged, true);
});

// Workflow as Step Tests

Deno.test("Workflow as Step - nested workflow receives input from parent", async () => {
  const innerStep = createStep({
    id: "innerStep",
    inputSchema: z.string(),
    outputSchema: z.number(),
    executor: async ({ input }) => {
      return input.length;
    },
  });

  const innerWorkflow = createWorkflow<string>();
  innerWorkflow.addStep(innerStep);

  const outerStep = createStep({
    id: "outerStep",
    inputSchema: z.undefined(),
    outputSchema: z.string(),
    executor: async () => {
      return "hello";
    },
  });

  const outerWorkflow = createWorkflow();
  const result = await outerWorkflow
    .addStep(outerStep)
    .addStep(innerWorkflow as any)
    .run();

  assertEquals(result, 5);
});

Deno.test("Workflow as Step - nested workflow returns output to parent", async () => {
  const innerStep1 = createStep({
    id: "innerStep1",
    inputSchema: z.number(),
    outputSchema: z.number(),
    executor: async ({ input }) => {
      return input * 2;
    },
  });

  const innerStep2 = createStep({
    id: "innerStep2",
    inputSchema: z.number(),
    outputSchema: z.string(),
    executor: async ({ input }) => {
      return `Result: ${input}`;
    },
  });

  const innerWorkflow = createWorkflow<number>();
  innerWorkflow.addStep(innerStep1).addStep(innerStep2);

  const outerStep1 = createStep({
    id: "outerStep1",
    inputSchema: z.undefined(),
    outputSchema: z.number(),
    executor: async () => {
      return 5;
    },
  });

  const outerStep2 = createStep({
    id: "outerStep2",
    inputSchema: z.string(),
    outputSchema: z.string(),
    executor: async ({ input }) => {
      return input.toUpperCase();
    },
  });

  const outerWorkflow = createWorkflow();
  const result = await outerWorkflow
    .addStep(outerStep1)
    .addStep<string>(innerWorkflow as any)
    .addStep(outerStep2)
    .run();

  assertEquals(result, "RESULT: 10");
});

Deno.test("Workflow as Step - state is shared between parent and nested workflow", async () => {
  const innerStep = createStep({
    id: "innerStep",
    inputSchema: z.string(),
    outputSchema: z.string(),
    executor: async ({ input, state }) => {
      state.innerValue = "set by inner";
      state.sharedCounter = (state.sharedCounter || 0) + 1;
      return input.toUpperCase();
    },
  });

  const innerWorkflow = createWorkflow<string>();
  innerWorkflow.addStep(innerStep);

  const outerStep1 = createStep({
    id: "outerStep1",
    inputSchema: z.undefined(),
    outputSchema: z.string(),
    executor: async ({ state }) => {
      state.outerValue = "set by outer";
      state.sharedCounter = 5;
      return "test";
    },
  });

  const outerStep2 = createStep({
    id: "outerStep2",
    inputSchema: z.string(),
    outputSchema: z.object({
      output: z.string(),
      outerValue: z.string(),
      innerValue: z.string(),
      counter: z.number(),
    }),
    executor: async ({ input, state }) => {
      return {
        output: input,
        outerValue: state.outerValue,
        innerValue: state.innerValue,
        counter: state.sharedCounter,
      };
    },
  });

  const outerWorkflow = createWorkflow();
  const result = await outerWorkflow
    .addStep(outerStep1)
    .addStep<string>(innerWorkflow as any)
    .addStep(outerStep2)
    .run();

  assertEquals(result.output, "TEST");
  assertEquals(result.outerValue, "set by outer");
  assertEquals(result.innerValue, "set by inner");
  assertEquals(result.counter, 6);
  assertEquals(outerWorkflow.getState().sharedCounter, 6);
});

Deno.test("Workflow as Step - multiple nested workflows in sequence", async () => {
  const workflow1 = createWorkflow<number>();
  workflow1.addStep(createStep({
    id: "w1step",
    inputSchema: z.number(),
    outputSchema: z.number(),
    executor: async ({ input }) => input + 10,
  }));

  const workflow2 = createWorkflow<number>();
  workflow2.addStep(createStep({
    id: "w2step",
    inputSchema: z.number(),
    outputSchema: z.number(),
    executor: async ({ input }) => input * 2,
  }));

  const workflow3 = createWorkflow<number>();
  workflow3.addStep(createStep({
    id: "w3step",
    inputSchema: z.number(),
    outputSchema: z.string(),
    executor: async ({ input }) => `Final: ${input}`,
  }));

  const parentWorkflow = createWorkflow();
  const initialStep = createStep({
    id: "initial",
    inputSchema: z.undefined(),
    outputSchema: z.number(),
    executor: async () => 5,
  });

  const result = await parentWorkflow
    .addStep(initialStep)
    .addStep(workflow1 as any)
    .addStep(workflow2 as any)
    .addStep(workflow3 as any)
    .run();

  // 5 -> +10 = 15 -> *2 = 30 -> "Final: 30"
  assertEquals(result, "Final: 30");
});

Deno.test("Workflow as Step - nested workflow in parallel execution", async () => {
  const innerWorkflow1 = createWorkflow<string>();
  innerWorkflow1.addStep(createStep({
    id: "inner1",
    inputSchema: z.string(),
    outputSchema: z.number(),
    executor: async ({ input }) => input.length,
  }));

  const innerWorkflow2 = createWorkflow<string>();
  innerWorkflow2.addStep(createStep({
    id: "inner2",
    inputSchema: z.string(),
    outputSchema: z.string(),
    executor: async ({ input }) => input.toUpperCase(),
  }));

  const regularStep = createStep({
    id: "regularStep",
    inputSchema: z.string(),
    outputSchema: z.boolean(),
    executor: async ({ input }) => input.includes("test"),
  });

  const outerWorkflow = createWorkflow();
  const initialStep = createStep({
    id: "initial",
    inputSchema: z.undefined(),
    outputSchema: z.string(),
    executor: async () => "test string",
  });

  const result = await outerWorkflow
    .addStep(initialStep)
    .parallel([innerWorkflow1 as any, innerWorkflow2 as any, regularStep])
    .run();

  // When workflows are used in parallel, they're keyed by their workflowId
  assertEquals(result[innerWorkflow1.workflowId], 11);
  assertEquals(result[innerWorkflow2.workflowId], "TEST STRING");
  assertEquals(result.regularStep, true);
});

Deno.test("Workflow as Step - hierarchical workflow keys in error messages", async () => {
  const innerStep = createStep({
    id: "innerFailingStep",
    inputSchema: z.string(),
    outputSchema: z.string(),
    executor: async () => {
      throw new Error("Inner error");
    },
  });

  const innerWorkflow = createWorkflow<string>();
  innerWorkflow.addStep(innerStep);

  const outerStep = createStep({
    id: "outerStep",
    inputSchema: z.undefined(),
    outputSchema: z.string(),
    executor: async () => "test",
  });

  const outerWorkflow = createWorkflow();

  let errorThrown = false;
  let errorMessage = "";
  try {
    await outerWorkflow
      .addStep(outerStep)
      .addStep(innerWorkflow as any)
      .run("parent-workflow");
  } catch (error) {
    errorThrown = true;
    errorMessage = (error as Error).message;
  }

  assertEquals(errorThrown, true);
  // Error should contain hierarchical key structure
  assertEquals(errorMessage.includes("parent-workflow->"), true);
  assertEquals(errorMessage.includes("innerFailingStep"), true);
});

Deno.test("Workflow as Step - nested workflow with error handler", async () => {
  let innerErrorHandled = false;

  const innerStep = createStep({
    id: "innerStep",
    inputSchema: z.string(),
    outputSchema: z.string(),
    executor: async () => {
      throw new Error("Inner step failed");
    },
    onError: async () => {
      innerErrorHandled = true;
    },
  });

  const innerWorkflow = createWorkflow<string>();
  innerWorkflow.addStep(innerStep);

  const outerStep = createStep({
    id: "outerStep",
    inputSchema: z.undefined(),
    outputSchema: z.string(),
    executor: async () => "test",
  });

  const finalStep = createStep({
    id: "finalStep",
    inputSchema: z.any(),
    outputSchema: z.string(),
    executor: async () => "completed",
  });

  const outerWorkflow = createWorkflow();
  const result = await outerWorkflow
    .addStep(outerStep)
    .addStep(innerWorkflow as any)
    .addStep(finalStep)
    .run();

  assertEquals(innerErrorHandled, true);
  assertEquals(result, "completed");
});

Deno.test("Workflow as Step - deeply nested workflows", async () => {
  // Level 3 (deepest)
  const level3Workflow = createWorkflow<number>();
  level3Workflow.addStep(createStep({
    id: "level3",
    inputSchema: z.number(),
    outputSchema: z.number(),
    executor: async ({ input }) => input + 1,
  }));

  // Level 2
  const level2Workflow = createWorkflow<number>();
  level2Workflow
    .addStep(createStep({
      id: "level2",
      inputSchema: z.number(),
      outputSchema: z.number(),
      executor: async ({ input }) => input * 2,
    }))
    .addStep(level3Workflow as any);

  // Level 1 (parent)
  const level1Workflow = createWorkflow();
  const result = await level1Workflow
    .addStep(createStep({
      id: "level1",
      inputSchema: z.undefined(),
      outputSchema: z.number(),
      executor: async () => 5,
    }))
    .addStep(level2Workflow as any)
    .run();

  // 5 -> *2 = 10 -> +1 = 11
  assertEquals(result, 11);
});
