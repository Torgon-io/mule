# Mule Persistence Scripts

Utility scripts for querying and managing execution history stored in the Mule persistence database.

## Available Scripts

### 1. Query Executions (`deno task query`)

Query and view execution history from the database.

**Usage:**

```bash
# Show all projects in the database
deno task query

# Show recent executions for a specific project
deno task query -- --project my-project

# Show a specific workflow run
deno task query -- --project my-project --workflow workflow-id --run run-id

# Use a custom database path
deno task query -- --db ./custom/path.db
```

**Examples:**

```bash
# View all projects
deno task query

# View last 50 executions for "customer-support-bot"
deno task query -- --project customer-support-bot

# View details of a specific run
deno task query -- --workflow answer-query --run abc-123
```

### 2. Export Executions (`deno task export`)

Export execution history to JSON or CSV format.

**Usage:**

```bash
# Export to JSON
deno task export -- --project my-project --format json

# Export to CSV
deno task export -- --project my-project --format csv

# Export to custom filename
deno task export -- --project my-project --format csv --output data.csv
```

**Examples:**

```bash
# Export all executions for a project to JSON
deno task export -- --project my-ai-app --format json

# Export to CSV with custom filename
deno task export -- --project my-ai-app --format csv --output ./exports/history.csv
```

### 3. Statistics (`deno task stats`)

View analytics and statistics about execution history.

**Usage:**

```bash
# Show statistics for all projects
deno task stats

# Show statistics for a specific project
deno task stats -- --project my-project
```

**Output includes:**
- Total steps, success rate, error rate
- Token usage (total and average per step)
- Duration statistics
- Model usage breakdown
- Top workflows by activity
- Activity by date

**Examples:**

```bash
# Overall statistics
deno task stats

# Project-specific statistics
deno task stats -- --project customer-support-bot
```

### 4. Cleanup (`deno task cleanup`)

Delete old execution records from the database.

**Usage:**

```bash
# Delete records older than 30 days (all projects)
deno task cleanup -- --days 30

# Delete records for specific project
deno task cleanup -- --project my-project --days 7

# Preview what would be deleted (dry run)
deno task cleanup -- --days 30 --dry-run
```

**Examples:**

```bash
# Preview deletion (no changes made)
deno task cleanup -- --days 30 --dry-run

# Delete old records with confirmation
deno task cleanup -- --days 30

# Clean up specific project
deno task cleanup -- --project test-project --days 7
```

## Database Location

By default, all scripts use the database at `~/.mule/executions.db`. You can specify a custom database path with the `--db` flag:

```bash
deno task query -- --db /path/to/custom.db
```

## Permissions

These scripts require the following Deno permissions:
- `--allow-read` - Read database file
- `--allow-write` - Write to database (for cleanup) or export files
- `--allow-env` - Access environment variables (for home directory expansion)
- `--allow-ffi` - Use SQLite FFI bindings
- `--allow-net` - Download SQLite library if needed
- `--unstable-ffi` - Enable unstable FFI features

All permissions are pre-configured in the deno tasks.

## Examples Workflow

```bash
# 1. Check what projects exist
deno task query

# 2. View recent executions for a project
deno task query -- --project my-ai-app

# 3. Get detailed statistics
deno task stats -- --project my-ai-app

# 4. Export data for analysis
deno task export -- --project my-ai-app --format csv

# 5. Clean up old records
deno task cleanup -- --days 90 --dry-run  # Preview first
deno task cleanup -- --days 90            # Then confirm
```

## Integration with Mule

These scripts work with any Mule project that has persistence enabled:

```typescript
import { Mule } from "@torgon/mule";

// Persistence is enabled by default
const mule = new Mule("my-project");

// Or explicitly configure
const mule = new Mule("my-project", {
  persistence: {
    type: "sqlite",
    path: "~/.mule/executions.db"  // Default
  }
});

// All workflow executions are automatically persisted
const workflow = mule.createWorkflow();
await workflow.run();

// Now query with scripts:
// deno task query -- --project my-project
```
