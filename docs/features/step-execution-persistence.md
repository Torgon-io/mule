# Step Execution Persistence

**Status**: Planned

## Problem Statement

When teams use Mule workflows with AI steps across multiple projects, they need visibility into:
- Which steps were executed in each workflow run
- What LLM outputs were generated
- Token usage and performance metrics
- Historical execution data for debugging and analytics

Currently, the `ConsoleLogger` outputs this data to stdout, which is ephemeral and not queryable. Teams need a persistent, queryable storage solution that works across all their projects.

## Solution Overview

Implement a **persistence layer** using the repository pattern that:
1. Stores step execution data (including LLM calls) to a database
2. Defaults to local SQLite at `~/.mule/executions.db` (shared across all projects)
3. Provides a query API for retrieving execution history
4. Uses an abstract interface to support future remote backends (Postgres, HTTP API, etc.)
5. Is **enabled by default** with zero configuration required

## Key Design Principles

- **Zero-config by default**: Persistence works out of the box
- **Single table**: One `step_executions` table stores everything (each step = one LLM call)
- **Shared database**: All projects on a machine write to the same SQLite file
- **Repository pattern**: Abstract interface allows swapping backends without code changes
- **Future-proof**: Designed for eventual migration to remote/centralized storage

## Architecture

### Repository Pattern

```typescript
// Abstract interface - any backend can implement this
interface StepExecutionRepository {
  save(execution: StepExecution): Promise<void>;
  getWorkflowRun(projectId: string, workflowId: string, runId: string): Promise<StepExecution[]>;
  getProjectHistory(projectId: string, limit?: number): Promise<StepExecution[]>;
}

// MVP: SQLite implementation
class SQLiteRepository implements StepExecutionRepository {
  // Stores to ~/.mule/executions.db
}

// Future: Remote implementations
class PostgresRepository implements StepExecutionRepository { ... }
class HTTPRepository implements StepExecutionRepository { ... }
```

### Adapter for Existing Logger Interface

The existing `Logger` interface expects `log(data: LLMCallLog): Promise<void>`. We create an adapter that bridges the repository pattern:

```typescript
class RepositoryLogger implements Logger {
  constructor(private repository: StepExecutionRepository) {}

  async log(data: LLMCallLog): Promise<void> {
    const execution = this.mapToStepExecution(data);
    await this.repository.save(execution);
  }
}
```

This allows the new persistence system to work seamlessly with the existing workflow execution flow.

## Data Model

### StepExecution Type

```typescript
interface StepExecution {
  // Context identifiers
  projectId: string;
  workflowId: string;
  runId: string;
  stepId: string;

  // Timing information
  timestamp: string;      // ISO 8601 format
  durationMs?: number;

  // LLM data
  model?: string;
  prompt?: string;        // JSON-serialized message array
  result?: string;        // LLM output (text or JSON)

  // Token usage metrics
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  finishReason?: string;

  // Execution status
  status: "success" | "error";
  error?: string;         // Error message if status = "error"
}
```

### Persistence Configuration

```typescript
type PersistenceConfig =
  | { type: "sqlite"; path?: string }           // Default: ~/.mule/executions.db
  | { type: "postgres"; connectionString: string }  // Future
  | { type: "http"; endpoint: string; apiKey?: string }  // Future
  | false;  // Disable persistence

interface MuleOptions {
  projectId: string;
  persistence?: PersistenceConfig;  // Optional, defaults to SQLite
  logging?: LoggingOptions;         // Existing option
}
```

## SQLite Implementation (MVP)

### Database Schema

```sql
CREATE TABLE step_executions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Context
  project_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  step_id TEXT NOT NULL,

  -- Timing
  timestamp TEXT NOT NULL,
  duration_ms INTEGER,

  -- LLM data
  model TEXT,
  prompt TEXT,              -- JSON string of messages array
  result TEXT,              -- LLM output (can be large)

  -- Usage metrics
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  finish_reason TEXT,

  -- Status
  status TEXT NOT NULL,     -- 'success' or 'error'
  error TEXT
);

-- Indexes for common query patterns
CREATE INDEX idx_project ON step_executions(project_id);
CREATE INDEX idx_workflow_run ON step_executions(workflow_id, run_id);
CREATE INDEX idx_timestamp ON step_executions(timestamp DESC);
```

### File Location

- **Default path**: `~/.mule/executions.db`
- **Custom path**: Via `persistence.path` config option
- **Directory creation**: Auto-creates `~/.mule/` if it doesn't exist
- **Shared**: All projects on the same machine use the same database file

### SQLiteRepository Class

```typescript
export class SQLiteRepository implements StepExecutionRepository {
  private db: Database;

  constructor(dbPath: string = "~/.mule/executions.db") {
    // Expand ~ to home directory
    // Create ~/.mule/ directory if needed
    // Open SQLite connection
    // Create table if not exists
  }

  async save(execution: StepExecution): Promise<void> {
    // INSERT INTO step_executions
  }

  async getWorkflowRun(
    projectId: string,
    workflowId: string,
    runId: string
  ): Promise<StepExecution[]> {
    // SELECT * WHERE project_id = ? AND workflow_id = ? AND run_id = ?
    // ORDER BY timestamp ASC
  }

  async getProjectHistory(
    projectId: string,
    limit: number = 100
  ): Promise<StepExecution[]> {
    // SELECT * WHERE project_id = ?
    // ORDER BY timestamp DESC
    // LIMIT ?
  }

  close(): void {
    // Close SQLite connection
  }
}
```

## Configuration

### Default Behavior (Zero Config)

```typescript
// Persistence automatically enabled with defaults
const mule = new Mule({
  projectId: "my-ai-project"
});

// Behind the scenes:
// - Creates ~/.mule/executions.db
// - All step executions are persisted
// - Shared across all projects
```

### Custom SQLite Path

```typescript
const mule = new Mule({
  projectId: "my-ai-project",
  persistence: {
    type: "sqlite",
    path: "./custom/path/my-workflow-data.db"
  }
});
```

### Disable Persistence

```typescript
const mule = new Mule({
  projectId: "my-ai-project",
  persistence: false  // No persistence, back to console-only logging
});
```

## Integration with Mule Class

### Persistence Factory

```typescript
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
      // Future: return new PostgresRepository(config.connectionString);
      throw new Error("PostgreSQL persistence not yet implemented");
    case "http":
      // Future: return new HTTPRepository(config.endpoint, config.apiKey);
      throw new Error("HTTP persistence not yet implemented");
  }
}
```

### Updated Mule Constructor

```typescript
export class Mule {
  private repository: StepExecutionRepository | null;
  public logger: Logger;

  constructor(private options: MuleOptions) {
    // Create persistence repository
    this.repository = createPersistenceRepository(options.persistence);

    // Wrap repository in Logger adapter
    if (this.repository) {
      this.logger = new RepositoryLogger(this.repository);
    } else {
      // Fallback to console logger if persistence disabled
      this.logger = options.logging?.logger ?? new ConsoleLogger();
    }
  }

  // Expose repository for querying
  getRepository(): StepExecutionRepository | null {
    return this.repository;
  }
}
```

## Usage Examples

### Basic Usage (Default Persistence)

```typescript
import { Mule } from "@torgon/mule";

const mule = new Mule({
  projectId: "customer-support-bot"
});

const workflow = mule.createWorkflow({
  initialState: {},
  inputSchema: z.object({ query: z.string() })
});

workflow.addStep(/* AI step */);
await workflow.run({ query: "How do I reset my password?" });

// Data automatically saved to ~/.mule/executions.db
```

### Querying Execution History

```typescript
const mule = new Mule({ projectId: "customer-support-bot" });

// Get repository for querying
const repo = mule.getRepository();

if (repo) {
  // Get all steps from a specific workflow run
  const steps = await repo.getWorkflowRun(
    "customer-support-bot",
    "answer-query-workflow",
    "run-abc-123"
  );

  console.log(`Workflow executed ${steps.length} steps`);
  steps.forEach(step => {
    console.log(`Step ${step.stepId}:`);
    console.log(`  Model: ${step.model}`);
    console.log(`  Tokens: ${step.totalTokens}`);
    console.log(`  Duration: ${step.durationMs}ms`);
    console.log(`  Result: ${step.result?.substring(0, 100)}...`);
  });

  // Get recent execution history for the project
  const recent = await repo.getProjectHistory("customer-support-bot", 50);
  console.log(`Recent executions: ${recent.length}`);
}
```

### Custom Database Path

```typescript
const mule = new Mule({
  projectId: "data-pipeline",
  persistence: {
    type: "sqlite",
    path: "./data/workflow-executions.db"
  }
});
```

### Multi-Project Analytics

Since all projects share `~/.mule/executions.db`, you can analyze across projects:

```typescript
import { SQLiteRepository } from "@torgon/mule/sqlite-repository";

const repo = new SQLiteRepository(); // Uses default ~/.mule/executions.db

// Custom query: Total tokens used across all projects today
const db = repo.db;  // Expose underlying SQLite connection
const result = db.query(`
  SELECT
    project_id,
    SUM(total_tokens) as total_tokens,
    COUNT(*) as num_steps
  FROM step_executions
  WHERE DATE(timestamp) = DATE('now')
  GROUP BY project_id
`);

console.log("Token usage by project today:", result);
```

## Query API

### StepExecutionRepository Methods

```typescript
interface StepExecutionRepository {
  // Save a step execution
  save(execution: StepExecution): Promise<void>;

  // Get all steps from a specific workflow run
  getWorkflowRun(
    projectId: string,
    workflowId: string,
    runId: string
  ): Promise<StepExecution[]>;

  // Get recent execution history for a project
  getProjectHistory(
    projectId: string,
    limit?: number  // Default: 100
  ): Promise<StepExecution[]>;
}
```

### Direct SQLite Access (Advanced)

For custom queries, expose the underlying SQLite database:

```typescript
class SQLiteRepository {
  public db: Database;  // Expose for advanced queries
}

// Usage
const repo = mule.getRepository() as SQLiteRepository;
const customResults = repo.db.query(`
  SELECT * FROM step_executions
  WHERE model = 'gpt-4'
  AND total_tokens > 1000
`);
```

## Testing Strategy

### Unit Tests

```typescript
// Test SQLiteRepository in isolation
Deno.test("SQLiteRepository - save and retrieve execution", async () => {
  const repo = new SQLiteRepository(":memory:");  // In-memory for tests

  const execution: StepExecution = {
    projectId: "test-project",
    workflowId: "test-workflow",
    runId: "run-1",
    stepId: "step-1",
    timestamp: new Date().toISOString(),
    status: "success",
    model: "gpt-4",
    totalTokens: 150
  };

  await repo.save(execution);

  const results = await repo.getWorkflowRun("test-project", "test-workflow", "run-1");
  assertEquals(results.length, 1);
  assertEquals(results[0].stepId, "step-1");
});
```

### Integration Tests

```typescript
// Test full workflow with persistence
Deno.test("Workflow - persists step executions to SQLite", async () => {
  const mule = new Mule({
    projectId: "test-project",
    persistence: {
      type: "sqlite",
      path: ":memory:"  // In-memory database for testing
    }
  });

  const workflow = mule.createWorkflow({ /* ... */ });
  workflow.addStep(/* AI step */);
  await workflow.run();

  const repo = mule.getRepository();
  const executions = await repo!.getProjectHistory("test-project");

  assert(executions.length > 0);
  assertEquals(executions[0].projectId, "test-project");
});
```

## File Structure

```
mule/
├── main.ts                     # Modified: Add persistence factory
├── types.ts                    # Modified: Export new types
├── ai.ts                       # No changes
├── persistence.ts              # NEW: Interfaces + RepositoryLogger
├── sqlite-repository.ts        # NEW: SQLite implementation
├── main_test.ts                # Modified: Add integration tests
├── deno.json
└── docs/
    └── features/
        ├── automatic-llm-logging.md
        ├── logger-interface.md
        ├── mule-configuration.md
        └── step-execution-persistence.md  # This document
```

## Future Enhancements

### 1. PostgreSQL Backend

```typescript
const mule = new Mule({
  projectId: "production-app",
  persistence: {
    type: "postgres",
    connectionString: process.env.DATABASE_URL!
  }
});

class PostgresRepository implements StepExecutionRepository {
  // Same interface, different backend
  // Use Deno's postgres client
}
```

### 2. HTTP API Backend (Centralized Service)

For teams that want a centralized analytics service:

```typescript
const mule = new Mule({
  projectId: "mobile-app",
  persistence: {
    type: "http",
    endpoint: "https://mule-analytics.company.com/api/executions",
    apiKey: process.env.MULE_API_KEY
  }
});

class HTTPRepository implements StepExecutionRepository {
  async save(execution: StepExecution): Promise<void> {
    await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(execution)
    });
  }
}
```

### 3. Batching & Performance Optimization

```typescript
class BatchingSQLiteRepository extends SQLiteRepository {
  private batch: StepExecution[] = [];

  async save(execution: StepExecution): Promise<void> {
    this.batch.push(execution);

    // Flush every 10 executions or every 5 seconds
    if (this.batch.length >= 10) {
      await this.flush();
    }
  }

  private async flush(): Promise<void> {
    // Bulk INSERT for better performance
  }
}
```

### 4. Aggregated Analytics

```typescript
interface StepExecutionRepository {
  // ... existing methods

  // New analytics methods
  getWorkflowSummary(workflowId: string): Promise<WorkflowSummary>;
  getTokenUsageByProject(projectId: string, dateRange: DateRange): Promise<TokenUsage>;
  getAverageDuration(projectId: string, stepId: string): Promise<number>;
}
```

### 5. Data Retention Policies

```typescript
class SQLiteRepository {
  async cleanup(options: {
    olderThanDays?: number;
    keepMinimum?: number;
  }): Promise<number> {
    // Delete old executions based on retention policy
  }
}
```

### 6. Export Functionality

```typescript
class SQLiteRepository {
  exportToJSON(projectId: string, outputPath: string): Promise<void>;
  exportToCSV(projectId: string, outputPath: string): Promise<void>;
}
```

## Implementation Checklist

### Phase 1: Core Interfaces & Types (~15 min)

- [ ] Create `persistence.ts` file
- [ ] Define `StepExecution` interface
- [ ] Define `StepExecutionRepository` interface
- [ ] Define `PersistenceConfig` type union
- [ ] Create `RepositoryLogger` adapter class
- [ ] Add helper function to map `LLMCallLog` → `StepExecution`

### Phase 2: SQLite Implementation (~45 min)

- [ ] Create `sqlite-repository.ts` file
- [ ] Implement `SQLiteRepository` class
- [ ] Add database initialization (create table if not exists)
- [ ] Implement path expansion for `~/.mule/` directory
- [ ] Auto-create `~/.mule/` directory if it doesn't exist
- [ ] Implement `save()` method with INSERT statement
- [ ] Implement `getWorkflowRun()` query method
- [ ] Implement `getProjectHistory()` query method
- [ ] Add `close()` method for cleanup
- [ ] Add proper error handling for DB operations

### Phase 3: Integration with Mule (~15 min)

- [ ] Update `main.ts` to import persistence types
- [ ] Add `persistence?: PersistenceConfig` to `MuleOptions` interface
- [ ] Create `createPersistenceRepository()` factory function
- [ ] Update `Mule` constructor to instantiate repository
- [ ] Wrap repository in `RepositoryLogger` adapter
- [ ] Add `getRepository()` method to Mule class
- [ ] Handle fallback to `ConsoleLogger` when persistence disabled

### Phase 4: Type Exports (~5 min)

- [ ] Update `types.ts` to export `StepExecution`
- [ ] Export `StepExecutionRepository` interface
- [ ] Export `PersistenceConfig` type
- [ ] Ensure all types are properly exported from main module

### Phase 5: Testing (~30 min)

- [ ] Add unit test for `SQLiteRepository.save()` (in-memory DB)
- [ ] Add unit test for `SQLiteRepository.getWorkflowRun()`
- [ ] Add unit test for `SQLiteRepository.getProjectHistory()`
- [ ] Add integration test: workflow with SQLite persistence
- [ ] Add test: verify default persistence is enabled
- [ ] Add test: verify persistence can be disabled
- [ ] Add test: verify custom path works
- [ ] Test database file creation at `~/.mule/`
- [ ] Test with real AI workflow execution

### Phase 6: Documentation (~15 min)

- [ ] Verify this feature document is complete
- [ ] Update README.md with persistence examples
- [ ] Add JSDoc comments to public API methods
- [ ] Document the `StepExecution` data model
- [ ] Add example queries to README

### Phase 7: Manual Verification (~10 min)

- [ ] Run a real workflow with default persistence
- [ ] Verify `~/.mule/executions.db` is created
- [ ] Open database and verify table schema
- [ ] Query data and verify all fields are populated
- [ ] Run workflow from different project, verify same DB used
- [ ] Test with custom database path
- [ ] Test with persistence disabled

## Success Criteria

- [ ] Zero-config persistence works by default
- [ ] All step executions are saved with complete LLM data
- [ ] Database shared across all projects on the machine
- [ ] Query API returns correct execution history
- [ ] Tests pass with 100% success rate
- [ ] No breaking changes to existing workflows
- [ ] Performance overhead < 10ms per step execution
- [ ] Documentation is clear and includes examples

## Estimated Time

- **Total implementation**: 1.5 - 2 hours
- **Core implementation**: ~1.5 hours
- **Testing & verification**: ~30 minutes

## Dependencies

- Deno's built-in SQLite module (`@db/sqlite`)
- Existing `Logger` interface from `types.ts`
- Existing `LLMCallLog` type from `types.ts`
- Existing `MuleOptions` interface from `main.ts`

## Migration Notes

### For Users

No migration needed! Persistence is:
- **Opt-in by default**: Automatically enabled with sensible defaults
- **Non-breaking**: Existing workflows continue to work unchanged
- **Can be disabled**: Set `persistence: false` to opt out

### For Existing Projects

```typescript
// Before (still works)
const mule = new Mule({ projectId: "my-project" });

// After (same behavior, but now persisted to ~/.mule/executions.db)
const mule = new Mule({ projectId: "my-project" });

// Explicitly disable if needed
const mule = new Mule({
  projectId: "my-project",
  persistence: false
});
```

## Notes

- Each step execution is assumed to contain exactly one LLM call (per user requirement)
- The `prompt` field stores the entire messages array as a JSON string
- The `result` field stores the full LLM output (can be large text or JSON)
- Database uses `TEXT` columns for flexibility (SQLite handles this efficiently)
- Indexes optimize common query patterns (by project, by workflow/run, by time)
- Repository pattern allows easy swapping of backends without changing workflow code
