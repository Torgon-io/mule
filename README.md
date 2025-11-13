# Mule (@torgon/mule)

A minimal, type-safe workflow engine for Deno with support for sequential and parallel step execution.

## Features

- Type-safe workflow execution with full TypeScript support
- Sequential step execution with automatic output chaining
- Parallel step execution for concurrent operations
- Schema validation using Zod
- State management across workflow steps
- Fluent API for building workflows

## Installation

```bash
deno add @torgon/mule
```

## Quick Start

```typescript
import { Workflow, createStep } from "@torgon/mule";
import { z } from "jsr:@zod/zod";

// Create a simple step
const step1 = createStep({
  id: "greeting",
  inputSchema: z.undefined(),
  outputSchema: z.string(),
  executor: async () => {
    return "Hello, World!";
  },
});

// Create a step that uses the previous output
const step2 = createStep({
  id: "length",
  inputSchema: z.string(),
  outputSchema: z.number(),
  executor: async ({ input }) => {
    return input.length;
  },
});

// Execute the workflow
const workflow = new Workflow();
const result = await workflow
  .addStep(step1)
  .addStep(step2)
  .run();

console.log(result.lastOutput); // 13
```

## API

### `Workflow<TCurrentOutput>`

The main workflow class that manages step execution.

#### Constructor

```typescript
new Workflow(initialState?: Record<string, any>)
```

Creates a new workflow instance with optional initial state.

#### Methods

##### `addStep<TOutput>(step: Step<TCurrentOutput, TOutput, any>): Workflow<TOutput>`

Adds a sequential step to the workflow. The step receives the output from the previous step as input.

##### `parallel<TSteps>(steps: TSteps[]): Workflow<...>`

Executes multiple steps in parallel. Each step receives the same input (output from the previous step). Returns an object with results keyed by step ID.

##### `async run(): Promise<Workflow>`

Executes the workflow and returns the workflow instance with results.

### `createStep<TInput, TOutput, TState, TId>(config: Step): Step`

Creates a typed workflow step.

#### Step Configuration

```typescript
{
  id: string;              // Unique identifier for the step
  inputSchema: ZodSchema;  // Zod schema for input validation
  outputSchema: ZodSchema; // Zod schema for output validation
  executor: async (data: {
    input: TInput;
    state: TState
  }) => TOutput;           // Async function that executes the step
}
```

## Examples

### Sequential Steps

```typescript
const workflow = new Workflow();
await workflow
  .addStep(step1)
  .addStep(step2)
  .addStep(step3)
  .run();
```

### Parallel Steps

```typescript
const parallelStep1 = createStep({
  id: "task1",
  inputSchema: z.string(),
  outputSchema: z.number(),
  executor: async ({ input }) => input.length,
});

const parallelStep2 = createStep({
  id: "task2",
  inputSchema: z.string(),
  outputSchema: z.boolean(),
  executor: async ({ input }) => input.includes("test"),
});

const workflow = new Workflow();
const result = await workflow
  .addStep(initialStep)
  .parallel([parallelStep1, parallelStep2])
  .run();

// result.lastOutput will be: { task1: 13, task2: true }
```

### State Management

```typescript
const step1 = createStep({
  id: "setState",
  inputSchema: z.undefined(),
  outputSchema: z.string(),
  executor: async ({ state }) => {
    state.counter = 1;
    state.user = "Alice";
    return "initialized";
  },
});

const step2 = createStep({
  id: "useState",
  inputSchema: z.string(),
  outputSchema: z.string(),
  executor: async ({ state }) => {
    return `Hello, ${state.user}! Counter: ${state.counter}`;
  },
});

const workflow = new Workflow();
const result = await workflow
  .addStep(step1)
  .addStep(step2)
  .run();

console.log(result.state); // { counter: 1, user: "Alice" }
console.log(result.lastOutput); // "Hello, Alice! Counter: 1"
```

## License

MIT
