# Logger Interface

**Status:** 🟡 Planned
**Version:** 1.0
**Last Updated:** 2025-11-18

## Overview

The Logger interface provides an extensible way to handle LLM call logging in Mule. While the default `ConsoleLogger` writes structured JSON to stdout, the interface allows custom implementations for databases, external services, or any logging destination.

## Motivation

Different applications have different logging needs:
- **Development**: Console logging for debugging
- **Production**: Database persistence for analysis
- **Enterprise**: Integration with existing logging systems (Datadog, Splunk, etc.)
- **Compliance**: Audit logs with retention policies
- **Cost Tracking**: Real-time streaming to billing systems

The Logger interface enables all these scenarios without changing core Mule code.

## Interface Definition

### Logger Interface

```typescript
interface Logger {
  log(data: LLMCallLog): Promise<void>;
}
```

### LLMCallLog Type

```typescript
interface LLMCallLog {
  // Context
  projectId: string;
  workflowId: string;
  runId: string;
  stepId: string;
  timestamp: string; // ISO 8601 format

  // Model Information
  model: string;

  // Token Usage
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;

  // Performance
  duration: number; // milliseconds

  // Error Information (if applicable)
  error?: string;
  errorType?: string;
}
```

## Default Implementation: ConsoleLogger

### Implementation

```typescript
export class ConsoleLogger implements Logger {
  async log(data: LLMCallLog): Promise<void> {
    const logEntry = {
      type: "llm_call",
      ...data,
    };
    console.log(JSON.stringify(logEntry));
  }
}
```

### Output Format

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
  "duration": 1245
}
```

### Usage

```typescript
import { Mule, ConsoleLogger } from "@torgon/mule";

// Explicitly use ConsoleLogger (this is the default)
const mule = new Mule("my-project", {
  logging: {
    logger: new ConsoleLogger()
  }
});
```

## Custom Logger Examples

### Database Logger (PostgreSQL)

```typescript
import { Logger, LLMCallLog } from "@torgon/mule";
import { Pool } from "postgres";

export class PostgresLogger implements Logger {
  private pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
  }

  async log(data: LLMCallLog): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO llm_calls (
          project_id, workflow_id, run_id, step_id,
          timestamp, model,
          prompt_tokens, completion_tokens, total_tokens,
          cache_creation_tokens, cache_read_tokens,
          duration, error, error_type
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          data.projectId,
          data.workflowId,
          data.runId,
          data.stepId,
          data.timestamp,
          data.model,
          data.promptTokens || 0,
          data.completionTokens || 0,
          data.totalTokens || 0,
          data.cacheCreationTokens || 0,
          data.cacheReadTokens || 0,
          data.duration,
          data.error || null,
          data.errorType || null,
        ]
      );
    } catch (error) {
      console.error("[PostgresLogger] Failed to log:", error);
      // Don't throw - logging failures shouldn't break workflows
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
```

**Schema:**

```sql
CREATE TABLE llm_calls (
  id SERIAL PRIMARY KEY,
  project_id VARCHAR(255) NOT NULL,
  workflow_id UUID NOT NULL,
  run_id VARCHAR(255) NOT NULL,
  step_id VARCHAR(255) NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  model VARCHAR(255) NOT NULL,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  cache_creation_tokens INTEGER,
  cache_read_tokens INTEGER,
  duration INTEGER NOT NULL,
  error TEXT,
  error_type VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_llm_calls_project_id ON llm_calls(project_id);
CREATE INDEX idx_llm_calls_workflow_id ON llm_calls(workflow_id);
CREATE INDEX idx_llm_calls_run_id ON llm_calls(run_id);
CREATE INDEX idx_llm_calls_timestamp ON llm_calls(timestamp);
```

**Usage:**

```typescript
import { Mule } from "@torgon/mule";
import { PostgresLogger } from "./loggers/postgres.ts";

const logger = new PostgresLogger(Deno.env.get("DATABASE_URL")!);
const mule = new Mule("production-app", {
  logging: { logger }
});

// Use workflows...

// Cleanup on shutdown
await logger.close();
```

### Supabase Logger

```typescript
import { Logger, LLMCallLog } from "@torgon/mule";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

export class SupabaseLogger implements Logger {
  private client: SupabaseClient;

  constructor(url: string, key: string) {
    this.client = createClient(url, key);
  }

  async log(data: LLMCallLog): Promise<void> {
    try {
      const { error } = await this.client
        .from("llm_calls")
        .insert({
          project_id: data.projectId,
          workflow_id: data.workflowId,
          run_id: data.runId,
          step_id: data.stepId,
          timestamp: data.timestamp,
          model: data.model,
          prompt_tokens: data.promptTokens || 0,
          completion_tokens: data.completionTokens || 0,
          total_tokens: data.totalTokens || 0,
          cache_creation_tokens: data.cacheCreationTokens || 0,
          cache_read_tokens: data.cacheReadTokens || 0,
          duration: data.duration,
          error: data.error || null,
          error_type: data.errorType || null,
        });

      if (error) {
        console.error("[SupabaseLogger] Failed to log:", error);
      }
    } catch (error) {
      console.error("[SupabaseLogger] Exception:", error);
    }
  }
}
```

**Usage:**

```typescript
import { Mule } from "@torgon/mule";
import { SupabaseLogger } from "./loggers/supabase.ts";

const logger = new SupabaseLogger(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_KEY")!
);

const mule = new Mule("my-app", {
  logging: { logger }
});
```

### File Logger (JSONL)

```typescript
import { Logger, LLMCallLog } from "@torgon/mule";

export class FileLogger implements Logger {
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async log(data: LLMCallLog): Promise<void> {
    try {
      const line = JSON.stringify({ type: "llm_call", ...data }) + "\n";
      await Deno.writeTextFile(this.filePath, line, { append: true });
    } catch (error) {
      console.error("[FileLogger] Failed to write:", error);
    }
  }
}
```

**Usage:**

```typescript
import { Mule } from "@torgon/mule";
import { FileLogger } from "./loggers/file.ts";

const logger = new FileLogger("./logs/llm-calls.jsonl");
const mule = new Mule("my-app", {
  logging: { logger }
});
```

### Multi-Logger (Log to Multiple Destinations)

```typescript
import { Logger, LLMCallLog } from "@torgon/mule";

export class MultiLogger implements Logger {
  private loggers: Logger[];

  constructor(...loggers: Logger[]) {
    this.loggers = loggers;
  }

  async log(data: LLMCallLog): Promise<void> {
    // Log to all destinations in parallel
    await Promise.all(
      this.loggers.map(logger => logger.log(data))
    );
  }
}
```

**Usage:**

```typescript
import { Mule, ConsoleLogger } from "@torgon/mule";
import { PostgresLogger } from "./loggers/postgres.ts";
import { FileLogger } from "./loggers/file.ts";
import { MultiLogger } from "./loggers/multi.ts";

const logger = new MultiLogger(
  new ConsoleLogger(),           // Development visibility
  new PostgresLogger(dbUrl),     // Production analytics
  new FileLogger("./audit.jsonl") // Compliance audit trail
);

const mule = new Mule("my-app", {
  logging: { logger }
});
```

### Batching Logger (Performance Optimization)

```typescript
import { Logger, LLMCallLog } from "@torgon/mule";

export class BatchingLogger implements Logger {
  private batch: LLMCallLog[] = [];
  private batchSize: number;
  private flushInterval: number;
  private timer?: number;
  private targetLogger: Logger;

  constructor(
    targetLogger: Logger,
    batchSize: number = 10,
    flushIntervalMs: number = 5000
  ) {
    this.targetLogger = targetLogger;
    this.batchSize = batchSize;
    this.flushInterval = flushIntervalMs;
    this.startTimer();
  }

  async log(data: LLMCallLog): Promise<void> {
    this.batch.push(data);

    if (this.batch.length >= this.batchSize) {
      await this.flush();
    }
  }

  private async flush(): Promise<void> {
    if (this.batch.length === 0) return;

    const toFlush = [...this.batch];
    this.batch = [];

    // Log all in parallel
    await Promise.all(
      toFlush.map(log => this.targetLogger.log(log))
    );
  }

  private startTimer(): void {
    this.timer = setInterval(() => {
      this.flush();
    }, this.flushInterval);
  }

  async close(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
    }
    await this.flush(); // Flush remaining logs
  }
}
```

**Usage:**

```typescript
import { Mule } from "@torgon/mule";
import { PostgresLogger } from "./loggers/postgres.ts";
import { BatchingLogger } from "./loggers/batching.ts";

const dbLogger = new PostgresLogger(dbUrl);
const logger = new BatchingLogger(
  dbLogger,
  50,    // Batch size: 50 logs
  10000  // Flush interval: 10 seconds
);

const mule = new Mule("high-volume-app", {
  logging: { logger }
});

// Cleanup on shutdown
await logger.close();
```

### Filtered Logger (Selective Logging)

```typescript
import { Logger, LLMCallLog } from "@torgon/mule";

export class FilteredLogger implements Logger {
  private targetLogger: Logger;
  private filter: (data: LLMCallLog) => boolean;

  constructor(
    targetLogger: Logger,
    filter: (data: LLMCallLog) => boolean
  ) {
    this.targetLogger = targetLogger;
    this.filter = filter;
  }

  async log(data: LLMCallLog): Promise<void> {
    if (this.filter(data)) {
      await this.targetLogger.log(data);
    }
  }
}
```

**Usage:**

```typescript
import { Mule, ConsoleLogger } from "@torgon/mule";
import { FilteredLogger } from "./loggers/filtered.ts";

// Only log errors
const errorOnlyLogger = new FilteredLogger(
  new ConsoleLogger(),
  (data) => data.error !== undefined
);

// Only log expensive calls (>10k tokens)
const expensiveCallsLogger = new FilteredLogger(
  new ConsoleLogger(),
  (data) => (data.totalTokens || 0) > 10000
);

// Only log specific workflows
const filteredLogger = new FilteredLogger(
  new ConsoleLogger(),
  (data) => data.projectId === "critical-app"
);

const mule = new Mule("my-app", {
  logging: { logger: errorOnlyLogger }
});
```

## AIService Integration

The AIService class receives the logger in its constructor and calls it after each LLM operation:

```typescript
export class AIService {
  private projectId: string;
  private workflowId: string;
  private runId: string;
  private stepId: string;
  private logger: Logger | null;

  constructor(config: {
    projectId: string;
    workflowId: string;
    runId: string;
    stepId: string;
    logger: Logger | null;
  }) {
    this.projectId = config.projectId;
    this.workflowId = config.workflowId;
    this.runId = config.runId;
    this.stepId = config.stepId;
    this.logger = config.logger;
  }

  async generate(options: GenerateOptions): Promise<string> {
    const startTime = Date.now();
    const timestamp = new Date().toISOString();

    try {
      const result = await generateText({
        model: this.model,
        messages: options.messages || [{ role: "user", content: options.prompt }],
      });

      const duration = Date.now() - startTime;

      await this.logCall({
        timestamp,
        model: this.model.modelId,
        promptTokens: result.usage?.promptTokens,
        completionTokens: result.usage?.completionTokens,
        totalTokens: result.usage?.totalTokens,
        cacheCreationTokens: result.experimental_providerMetadata?.openrouter?.usage?.cacheCreationTokens,
        cacheReadTokens: result.experimental_providerMetadata?.openrouter?.usage?.cacheReadTokens,
        duration,
      });

      return result.text;
    } catch (error) {
      const duration = Date.now() - startTime;
      const err = error instanceof Error ? error : new Error(String(error));

      await this.logCall({
        timestamp,
        model: this.model.modelId,
        duration,
        error: err.message,
        errorType: err.constructor.name,
      });

      throw error;
    }
  }

  private async logCall(data: Partial<LLMCallLog>): Promise<void> {
    if (!this.logger) return;

    await this.logger.log({
      projectId: this.projectId,
      workflowId: this.workflowId,
      runId: this.runId,
      stepId: this.stepId,
      timestamp: data.timestamp!,
      model: data.model!,
      duration: data.duration!,
      ...data,
    } as LLMCallLog);
  }
}
```

## Best Practices

### 1. Don't Throw Errors from Loggers

Logging failures should never break workflows:

```typescript
async log(data: LLMCallLog): Promise<void> {
  try {
    // Your logging logic
  } catch (error) {
    console.error("[Logger] Failed to log:", error);
    // Don't throw - just log the error
  }
}
```

### 2. Handle Async Operations Properly

Always return a Promise and await async operations:

```typescript
async log(data: LLMCallLog): Promise<void> {
  // Good - awaits the operation
  await database.insert(data);

  // Bad - fire and forget
  database.insert(data); // Missing await
}
```

### 3. Use Connection Pooling

For database loggers, reuse connections:

```typescript
export class PostgresLogger implements Logger {
  private static pool: Pool;

  constructor(connectionString: string) {
    if (!PostgresLogger.pool) {
      PostgresLogger.pool = new Pool({ connectionString });
    }
  }

  async log(data: LLMCallLog): Promise<void> {
    await PostgresLogger.pool.query(/* ... */);
  }
}
```

### 4. Consider Batching for High Volume

If you're logging many calls, batch them:

```typescript
const logger = new BatchingLogger(
  new DatabaseLogger(),
  100,   // Batch size
  5000   // Flush interval (ms)
);
```

### 5. Add Indexes for Common Queries

When creating database schemas, index frequently queried fields:

```sql
CREATE INDEX idx_llm_calls_project_timestamp
  ON llm_calls(project_id, timestamp DESC);

CREATE INDEX idx_llm_calls_workflow_run
  ON llm_calls(workflow_id, run_id);
```

### 6. Monitor Logger Performance

Log slow logging operations:

```typescript
async log(data: LLMCallLog): Promise<void> {
  const start = Date.now();

  try {
    await this.targetLogger.log(data);

    const duration = Date.now() - start;
    if (duration > 1000) {
      console.warn(`[Logger] Slow log operation: ${duration}ms`);
    }
  } catch (error) {
    console.error("[Logger] Failed:", error);
  }
}
```

## Testing Logger Implementations

### Mock Logger for Tests

```typescript
export class MockLogger implements Logger {
  public logs: LLMCallLog[] = [];

  async log(data: LLMCallLog): Promise<void> {
    this.logs.push(data);
  }

  clear(): void {
    this.logs = [];
  }

  getLogsForStep(stepId: string): LLMCallLog[] {
    return this.logs.filter(log => log.stepId === stepId);
  }

  getTotalTokens(): number {
    return this.logs.reduce((sum, log) => sum + (log.totalTokens || 0), 0);
  }
}
```

**Usage in Tests:**

```typescript
import { assertEquals } from "jsr:@std/assert";
import { Mule } from "@torgon/mule";
import { MockLogger } from "./loggers/mock.ts";

Deno.test("Workflow logs all LLM calls", async () => {
  const mockLogger = new MockLogger();
  const mule = new Mule("test", {
    logging: { logger: mockLogger }
  });

  const workflow = mule.createWorkflow();
  workflow.addStep(step1).addStep(step2);
  await workflow.run();

  assertEquals(mockLogger.logs.length, 2);
  assertEquals(mockLogger.logs[0].stepId, "step1");
  assertEquals(mockLogger.logs[1].stepId, "step2");
});
```

## Related Documentation

- [Automatic LLM Logging](./automatic-llm-logging.md) - Overview of logging system
- [Mule Configuration](./mule-configuration.md) - Configuring Mule with custom loggers
