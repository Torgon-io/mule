# Mule Configuration

**Status:** 🟡 Planned
**Version:** 1.0
**Last Updated:** 2025-11-18

## Overview

The `Mule` class provides project-level configuration for workflows, primarily managing project identification and logging behavior. It serves as the main entry point for creating workflows with automatic LLM call logging.

## Motivation

### Problems Solved

1. **Project Identification**: Every workflow needs to know which project it belongs to for logging and tracking
2. **Configuration Centralization**: Logger setup and other project-wide settings should be configured once
3. **Explicit Context**: Makes it clear that workflows belong to a project
4. **Testability**: Easier to mock and test with explicit configuration objects

### Why Not Environment Variables?

While we support `MULE_PROJECT_ID` as a fallback, the Mule instance approach is preferred:

- **Explicit**: Clear where projectId comes from
- **Flexible**: Different workflows can use different IDs if needed
- **Testable**: No environment variable pollution in tests
- **Multi-Project**: Same process can run workflows for multiple projects

## API Design

### Basic Constructor

```typescript
class Mule {
  constructor(projectId: string, options?: MuleOptions)
  createWorkflow<TInputSchema>(
    state?: Record<string, unknown>,
    inputSchema?: TInputSchema
  ): Workflow<z.infer<TInputSchema>>
}
```

### Configuration Options

```typescript
interface MuleOptions {
  logging?: {
    enabled?: boolean;        // Default: true
    logger?: Logger;          // Default: new ConsoleLogger()
  };
}
```

## Usage Examples

### Basic Setup

```typescript
import { Mule } from "@torgon/mule";

// Create Mule instance for your project
const mule = new Mule("sentiment-analyzer");

// Create workflows from the instance
const workflow = mule.createWorkflow();

// Add steps and run
workflow.addStep(analyzeStep);
await workflow.run();
```

### With Initial State

```typescript
const mule = new Mule("data-processor");

const workflow = mule.createWorkflow({
  apiKey: process.env.API_KEY,
  retryCount: 3,
});

workflow.addStep(fetchStep).addStep(processStep);
await workflow.run();
```

### With Input Schema

```typescript
import { z } from "zod";

const mule = new Mule("user-onboarding");

const inputSchema = z.object({
  userId: z.string(),
  email: z.string().email(),
});

const workflow = mule.createWorkflow({}, inputSchema);

await workflow.run(undefined, {
  userId: "user_123",
  email: "user@example.com",
});
```

### Disabling Logging

```typescript
const mule = new Mule("my-project", {
  logging: { enabled: false }
});

const workflow = mule.createWorkflow();
// No LLM calls will be logged
```

### Custom Logger

```typescript
import { Mule, Logger } from "@torgon/mule";

// Implement custom logger (see logger-interface.md)
class DatabaseLogger implements Logger {
  async log(data: LLMCallLog): Promise<void> {
    await db.insert('llm_calls', data);
  }
}

const mule = new Mule("production-app", {
  logging: {
    logger: new DatabaseLogger()
  }
});

const workflow = mule.createWorkflow();
// LLM calls logged to database
```

### Multiple Projects in Same Process

```typescript
// Different Mule instances for different projects
const projectA = new Mule("project-a");
const projectB = new Mule("project-b");

const workflowA = projectA.createWorkflow();
const workflowB = projectB.createWorkflow();

// Logs will have different projectIds
await workflowA.run();
await workflowB.run();
```

## Environment Variable Fallback

### MULE_PROJECT_ID

If you don't provide a projectId to the Mule constructor, it will attempt to read from the `MULE_PROJECT_ID` environment variable:

```typescript
// .env
MULE_PROJECT_ID=my-project

// Code
const mule = new Mule(); // Uses "my-project" from env

// Or explicitly
const mule = new Mule(process.env.MULE_PROJECT_ID!);
```

### MULE_STEP_RETRIES

When a step fails, Mule can automatically retry it before calling the step’s `onError` or failing the workflow. The number of retries is controlled by the `MULE_STEP_RETRIES` environment variable:

- **Default:** `1` (one retry after the first failure, i.e. at most 2 attempts total).
- **Set via env:** Any non-negative integer (e.g. `0` to disable retries, `3` for up to 3 retries).

Invalid or negative values fall back to the default of 1.

```bash
# Default: 1 retry (2 attempts total)
# MULE_STEP_RETRIES not set

# Disable retries (single attempt only)
MULE_STEP_RETRIES=0

# Allow 3 retries (4 attempts total)
MULE_STEP_RETRIES=3
```

Retries apply to each step execution (including steps inside `parallel` and `branch`). After all attempts fail, the existing error handling runs: nested workflows rethrow, steps with `onError` call it, and others throw with a step id message.

### MULE_STEP_CONCURRENCY

When a workflow runs steps in parallel (via `parallel()` or `branch()`), you can cap how many of those steps run at the same time using the `MULE_STEP_CONCURRENCY` environment variable:

- **Default:** No limit when unset. All steps in a parallel or branch batch run concurrently.
- **Set via env:** A positive integer. At most that many steps run simultaneously within each parallel or branch batch. Remaining steps start as slots free up.

Invalid, missing, or zero values are treated as “no limit”.

```bash
# No limit (default): all parallel/branch steps run at once
# MULE_STEP_CONCURRENCY not set

# Run at most 3 steps at a time in parallel/branch batches
MULE_STEP_CONCURRENCY=3
```

The limit applies per batch: each `parallel([...])` or `branch([...])` run at most `MULE_STEP_CONCURRENCY` steps at a time. Nested workflows use the same limit for their own parallel and branch batches. Use this to avoid overloading external APIs or staying within rate or resource limits.

### Precedence

1. Constructor parameter (highest priority)
2. `MULE_PROJECT_ID` environment variable
3. No projectId - logs with `projectId: "unknown"` and shows warning

## Implementation Details

### Internal Structure

```typescript
export class Mule {
  private projectId: string;
  private logger: Logger;
  private loggingEnabled: boolean;

  constructor(projectId?: string, options?: MuleOptions) {
    this.projectId = projectId
      || Deno.env.get("MULE_PROJECT_ID")
      || "unknown";

    if (this.projectId === "unknown") {
      console.warn("[Mule] No projectId provided. Set MULE_PROJECT_ID or pass to constructor.");
    }

    this.loggingEnabled = options?.logging?.enabled ?? true;
    this.logger = options?.logging?.logger ?? new ConsoleLogger();
  }

  createWorkflow<TInputSchema extends z.ZodTypeAny = z.ZodUndefined>(
    state?: Record<string, unknown>,
    inputSchema?: TInputSchema
  ): Workflow<z.infer<TInputSchema>> {
    const workflowId = crypto.randomUUID();
    const workflow = new Workflow<z.infer<TInputSchema>>(
      workflowId,
      state || {},
      inputSchema || z.undefined() as TInputSchema
    );

    // Inject configuration
    workflow.projectId = this.projectId;
    workflow.logger = this.loggingEnabled ? this.logger : null;

    return workflow;
  }
}
```

### Workflow Updates

The `Workflow` class needs to store and use the injected configuration:

```typescript
class Workflow<TCurrentOutput = undefined> {
  // Existing fields
  state: Record<string, any> = {};
  lastOutput: any = null;
  runId: string = "";
  readonly workflowId: string;

  // New fields
  projectId: string = "unknown";
  logger: Logger | null = null;

  // Use in AIService creation
  private async runStepExecution(step: Step<any, any, any> | Workflow<any>, input: any) {
    if (step instanceof Workflow) {
      // Nested workflow inherits parent config
      step.projectId = this.projectId;
      step.logger = this.logger;
      return await step.run(`${this.runId}->${step.workflowId}`, input);
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
  }
}
```

## Migration Guide

### From Standalone createWorkflow()

**Before:**
```typescript
import { createWorkflow, createStep } from "@torgon/mule";

const workflow = createWorkflow();
workflow.addStep(step1).addStep(step2);
await workflow.run();
```

**After:**
```typescript
import { Mule, createStep } from "@torgon/mule";

const mule = new Mule("my-project");
const workflow = mule.createWorkflow();
workflow.addStep(step1).addStep(step2);
await workflow.run();
```

### Backward Compatibility Strategy

The standalone `createWorkflow()` function will be preserved for backward compatibility:

```typescript
export function createWorkflow<TInputSchema extends z.ZodTypeAny = z.ZodUndefined>(
  state?: Record<string, unknown>,
  inputSchema?: TInputSchema
): Workflow<z.infer<TInputSchema>> {
  console.warn(
    "[Mule] Using createWorkflow() without Mule instance is deprecated. " +
    "Use: const mule = new Mule('projectId'); const workflow = mule.createWorkflow();"
  );

  // Use default Mule instance
  const defaultMule = new Mule();
  return defaultMule.createWorkflow(state, inputSchema);
}
```

### Migration Steps

1. **Add Mule instance** at the top of your application:
   ```typescript
   const mule = new Mule("your-project-id");
   ```

2. **Replace createWorkflow() calls** with `mule.createWorkflow()`:
   ```typescript
   // Old
   const workflow = createWorkflow();

   // New
   const workflow = mule.createWorkflow();
   ```

3. **Pass Mule instance** to functions that create workflows:
   ```typescript
   function buildWorkflow(mule: Mule) {
     return mule.createWorkflow().addStep(...);
   }
   ```

4. **Optional**: Set `MULE_PROJECT_ID` env var to avoid passing projectId everywhere

## Testing

### Unit Tests

```typescript
import { assertEquals } from "jsr:@std/assert";
import { Mule } from "./mule.ts";

Deno.test("Mule - creates workflow with projectId", () => {
  const mule = new Mule("test-project");
  const workflow = mule.createWorkflow();

  assertEquals(workflow.projectId, "test-project");
});

Deno.test("Mule - respects logging disabled option", () => {
  const mule = new Mule("test", { logging: { enabled: false } });
  const workflow = mule.createWorkflow();

  assertEquals(workflow.logger, null);
});

Deno.test("Mule - uses MULE_PROJECT_ID env var", () => {
  Deno.env.set("MULE_PROJECT_ID", "env-project");
  const mule = new Mule();
  const workflow = mule.createWorkflow();

  assertEquals(workflow.projectId, "env-project");
  Deno.env.delete("MULE_PROJECT_ID");
});
```

### Integration Tests

```typescript
Deno.test("Mule - logs include correct projectId", async () => {
  const logs: any[] = [];
  const mockLogger = {
    log: (data: any) => logs.push(data)
  };

  const mule = new Mule("integration-test", {
    logging: { logger: mockLogger }
  });

  const step = createStep({
    id: "test-step",
    inputSchema: z.string(),
    outputSchema: z.string(),
    executor: async ({ input, ai }) => {
      return await ai.generateText({ prompt: input });
    }
  });

  const workflow = mule.createWorkflow();
  workflow.addStep(step);
  await workflow.run(undefined, "test input");

  assertEquals(logs[0].projectId, "integration-test");
  assertEquals(logs[0].stepId, "test-step");
});
```

## Best Practices

### 1. One Mule Instance per Application

Create a single Mule instance at your application's entry point:

```typescript
// app.ts
export const mule = new Mule("my-app");

// workflows/processing.ts
import { mule } from "../app.ts";
export const processingWorkflow = mule.createWorkflow();

// workflows/analysis.ts
import { mule } from "../app.ts";
export const analysisWorkflow = mule.createWorkflow();
```

### 2. Use Dependency Injection for Testing

```typescript
// workflows.ts
export function createProcessingWorkflow(mule: Mule) {
  return mule.createWorkflow().addStep(...);
}

// app.ts
const mule = new Mule("production");
const workflow = createProcessingWorkflow(mule);

// workflows.test.ts
const testMule = new Mule("test", { logging: { enabled: false } });
const workflow = createProcessingWorkflow(testMule);
```

### 3. Configure Once, Use Everywhere

```typescript
// config.ts
const muleOptions = {
  logging: {
    enabled: Deno.env.get("ENV") !== "development",
    logger: new DatabaseLogger(),
  }
};

export const mule = new Mule(
  Deno.env.get("PROJECT_ID")!,
  muleOptions
);

// Any file
import { mule } from "./config.ts";
const workflow = mule.createWorkflow();
```

## Related Documentation

- [Automatic LLM Logging](./automatic-llm-logging.md) - What gets logged and how
- [Logger Interface](./logger-interface.md) - Creating custom logger implementations
