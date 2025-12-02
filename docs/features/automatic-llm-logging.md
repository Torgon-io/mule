# Automatic LLM Call Logging

**Status:** ✅ Implemented
**Version:** 1.0
**Last Updated:** 2025-11-19

## Overview

Automatic LLM call logging captures metadata and usage statistics for every LLM call made through the Mule workflow engine. This enables tracking token usage, costs, performance, and debugging across workflows, steps, and projects.

## Motivation

When using Mule workflows in production applications, teams need to:
- Track token usage and costs per workflow/step
- Monitor LLM performance and latency
- Debug failed LLM calls with full context
- Analyze usage patterns across projects
- Link LLM calls back to specific workflow runs and steps

## What Gets Logged

Each LLM call (via `ai.generateText()` or `ai.generateObject()`) logs:

### Required Metadata
- `projectId` - Identifier for the project using Mule
- `workflowId` - UUID of the workflow instance
- `runId` - Unique identifier for this workflow execution
- `stepId` - ID of the step making the LLM call
- `timestamp` - ISO 8601 timestamp when call was made

### Token Usage
- `promptTokens` - Tokens in the input prompt
- `completionTokens` - Tokens in the generated response
- `totalTokens` - Total tokens used (prompt + completion)
- `cacheCreationTokens` - Tokens cached (if applicable)
- `cacheReadTokens` - Tokens read from cache (if applicable)

### Cost Tracking
- `promptCostUsd` - Cost for input/prompt tokens in USD
- `completionCostUsd` - Cost for output/completion tokens in USD
- `totalCostUsd` - Total inference cost in USD (prompt + completion)

### Performance
- `duration` - Time in milliseconds from request to response
- `model` - Model identifier used (e.g., "anthropic/claude-3.5-sonnet")

### Error Information (if applicable)
- `error` - Error message if call failed
- `errorType` - Classification of error (e.g., "NoObjectGeneratedError", "ContentFilterError")

## Technical Design

### Architecture

```
Mule Instance (projectId)
  └─> Workflow (workflowId, logger)
      └─> Step Execution (runId, stepId)
          └─> AIService (receives all context)
              └─> generate() / generateObject()
                  └─> Logger.log(metadata)
```

### Context Injection

The logging context flows through the system:

1. **Mule Class** provides `projectId` and `logger` instance
2. **Workflow** tracks `workflowId` and `runId`
3. **Step Execution** provides `stepId`
4. **AIService** receives all context in constructor and uses it for every LLM call

### AIService Integration

Currently, `AIService` is instantiated per step in `main.ts:165`:

```typescript
const output = await step.executor({
  input,
  state: this.state,
  ai: new AIService(this.workflowId, runId, stepId), // Context injected here
});
```

**After implementation:**

```typescript
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
```

### Aggregation Strategy

**Step-Level Aggregation:**
- Each step may make multiple LLM calls
- Logger tracks individual calls with same `stepId`
- Consumers can aggregate by grouping on `stepId`

**Workflow-Level Aggregation:**
- All steps in a workflow run share the same `runId`
- Consumers can aggregate by grouping on `runId`

**Project-Level Aggregation:**
- All workflows in a project share the same `projectId`
- Consumers can aggregate by grouping on `projectId`

## Log Output Format

### Console Output (Default)

Structured JSON logs written to stdout:

```json
{
  "type": "llm_call",
  "projectId": "my-app",
  "workflowId": "550e8400-e29b-41d4-a716-446655440000",
  "runId": "660e8400-e29b-41d4-a716-446655440001",
  "stepId": "analyze-sentiment",
  "timestamp": "2025-11-18T10:30:45.123Z",
  "model": "anthropic/claude-3.5-sonnet",
  "promptTokens": 450,
  "completionTokens": 120,
  "totalTokens": 570,
  "cacheCreationTokens": 0,
  "cacheReadTokens": 0,
  "duration": 1245,
  "error": null
}
```

### Error Logging

When an LLM call fails:

```json
{
  "type": "llm_call",
  "projectId": "my-app",
  "workflowId": "550e8400-e29b-41d4-a716-446655440000",
  "runId": "660e8400-e29b-41d4-a716-446655440001",
  "stepId": "generate-summary",
  "timestamp": "2025-11-18T10:30:45.123Z",
  "model": "anthropic/claude-3.5-sonnet",
  "duration": 234,
  "error": "No object generated",
  "errorType": "NoObjectGeneratedError"
}
```

## Configuration

### Always-On Logging

Logging is enabled by default for all LLM calls. No configuration required.

### Opt-Out

To disable logging:

```typescript
import { Mule } from "@torgon/mule";

const mule = new Mule("my-project", {
  logging: { enabled: false }
});
```

### Custom Logger

See [logger-interface.md](./logger-interface.md) for implementing custom loggers.

## Usage Examples

### Basic Usage

```typescript
import { Mule, createStep } from "@torgon/mule";
import { z } from "zod";

// Create Mule instance with project ID
const mule = new Mule("sentiment-analyzer");

// Create workflow
const workflow = mule.createWorkflow();

// Add step that uses AI
const analyzeStep = createStep({
  id: "analyze",
  inputSchema: z.object({ text: z.string() }),
  outputSchema: z.object({ sentiment: z.string() }),
  executor: async ({ input, ai }) => {
    // This LLM call will be automatically logged
    return await ai.generateObject({
      schema: z.object({ sentiment: z.string() }),
      prompt: `Analyze sentiment: ${input.text}`,
    });
  },
});

workflow.addStep(analyzeStep);

// Run workflow - all LLM calls logged automatically
await workflow.run();

// Console output:
// {"type":"llm_call","projectId":"sentiment-analyzer",...}
```

### Multiple Steps

```typescript
const workflow = mule.createWorkflow()
  .addStep(extractStep)    // LLM calls logged with stepId="extract"
  .addStep(summarizeStep)   // LLM calls logged with stepId="summarize"
  .addStep(translateStep);  // LLM calls logged with stepId="translate"

await workflow.run();

// Each step's LLM calls are logged with unique stepId
// All share same runId for workflow-level aggregation
```

### Parallel Steps

```typescript
workflow.parallel([
  processStep1,  // LLM calls logged with stepId="process1"
  processStep2,  // LLM calls logged with stepId="process2"
  processStep3,  // LLM calls logged with stepId="process3"
]);

// All parallel step LLM calls logged concurrently
// Same runId, different stepIds
```

## Testing Strategy

### Unit Tests
- Mock logger to verify correct metadata passed
- Test opt-out configuration
- Test error logging includes error details
- Verify timing calculation accuracy

### Integration Tests
- Run workflow with real LLM calls
- Capture console output and parse JSON
- Verify all expected fields present
- Test nested workflows (runId hierarchy)

### Performance Tests
- Measure logging overhead (should be <1ms per call)
- Test high-frequency logging (many steps/calls)

## Migration Path

### For Existing Code

Existing code using `createWorkflow()` will continue to work but will log warnings:

```typescript
// Old way (still works, logs warning)
const workflow = createWorkflow();

// New way (recommended)
const mule = new Mule("my-project");
const workflow = mule.createWorkflow();
```

### Backward Compatibility

- `createWorkflow()` function remains exported
- Will use `MULE_PROJECT_ID` env var if available
- Logs warning if no project ID configured
- Logging still occurs with `projectId: "unknown"`

## Cost Tracking

Mule automatically tracks inference costs for all LLM calls by fetching real-time pricing from the OpenRouter API.

### How It Works

1. **Automatic Cost Calculation:** When a step makes an LLM call, the AI service:
   - Fetches pricing data for the model from OpenRouter
   - Calculates `promptCost = promptTokens × promptPrice`
   - Calculates `completionCost = completionTokens × completionPrice`
   - Stores cost data alongside token usage in the database

2. **Pricing Cache:** The pricing service maintains a 24-hour cache to minimize API calls and ensure fast cost calculation without blocking step execution.

3. **Non-Blocking:** Cost calculation happens asynchronously and won't delay workflow execution. If pricing is unavailable, the cost fields remain `null` but the workflow continues.

### Viewing Cost Analytics

Use the stats script to view cost breakdowns:

```bash
deno task stats --project my-project
```

Output includes:
- **Total cost** across all executions
- **Cost per step** average
- **Cost by model** to identify expensive models
- **Cost by workflow** to track which workflows consume the most
- **Cost by date** to monitor spending trends

### Database Schema

Cost data is stored in three columns in the `step_executions` table:
- `prompt_cost_usd` - Cost for input tokens
- `completion_cost_usd` - Cost for output tokens
- `total_cost_usd` - Total inference cost

### Export Cost Data

Export cost data to CSV for analysis:

```bash
deno task export --project my-project --format csv --output costs.csv
```

The CSV includes all cost columns for importing into spreadsheets or BI tools.

## Future Enhancements

### Database Persistence
- Add database logger implementations (PostgreSQL, MongoDB, etc.)
- See [logger-interface.md](./logger-interface.md) for custom logger guide
- Store logs in time-series database for analysis

### Workflow-Level Summary Logs
- Log summary at workflow completion
- Aggregate token usage across all steps
- Total duration, success/failure counts

### Real-Time Streaming
- Stream logs to external services (Datadog, CloudWatch, etc.)
- WebSocket/HTTP endpoint support

### ✅ Cost Calculation (Implemented)
Cost tracking is automatically enabled for all LLM calls:
- Fetches real-time pricing from OpenRouter API
- Calculates separate costs for prompt and completion tokens
- Non-blocking implementation (doesn't delay step execution)
- Cost data is stored in the persistence layer
- Analytics scripts show cost breakdowns by model, workflow, and date

**Pricing Service:**
- Caches pricing data for 24 hours to minimize API calls
- Background refresh to keep pricing current
- Graceful degradation if pricing unavailable (cost fields remain null)
- Supports OpenRouter's pricing model with separate prompt/completion rates

### Sampling
- Configure sampling rate (e.g., log 10% of calls)
- Useful for high-volume production systems

## Related Documentation

- [Mule Configuration](./mule-configuration.md) - Setting up project ID and loggers
- [Logger Interface](./logger-interface.md) - Creating custom logger implementations
