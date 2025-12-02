# Parallel Steps Visualization Implementation

## Overview
Implemented hierarchical execution tracking for parallel and branch steps in Mule workflows, allowing the UI to properly visualize parallel execution instead of showing all steps sequentially.

## Changes Made

### 1. Data Model Extensions

#### `persistence.ts` - StepExecution Interface
Added hierarchical execution metadata fields:
- `parentStepId?: string` - ID of parent step (for nested workflows)
- `executionGroup?: string` - UUID for parallel/branch execution batches
- `executionType?: "sequential" | "parallel" | "branch"` - Execution mode
- `depth?: number` - Nesting level (0 = top-level, 1+ = nested)

#### `types.ts` - LLMCallLog Interface
Added the same hierarchical fields to track execution context in logs

#### `ai.ts` - AIServiceConfig Interface
Extended config to include execution context that flows to logging:
- `parentStepId`, `executionGroup`, `executionType`, `depth`

### 2. Workflow Execution Context

#### `main.ts` - Workflow Class
- Added `ExecutionContext` interface to track hierarchical execution
- Added private `executionContext` field to `Workflow` class
- Modified `addStep()` to pass `executionType: "sequential"` context
- Modified `parallel()` to:
  - Generate unique `executionGroup` UUID for each parallel batch
  - Pass context with `executionType: "parallel"` to all parallel steps
- Modified `branch()` to:
  - Generate unique `executionGroup` UUID for each branch batch
  - Pass context with `executionType: "branch"` to matching steps
- Updated `runStepExecution()` to:
  - Accept `ExecutionContext` parameter
  - Pass context to `AIService` for regular steps
  - Propagate context to nested workflows with incremented depth

### 3. Database Schema Updates

#### `sqlite-repository.ts`
- Added new columns to `step_executions` table:
  - `parent_step_id TEXT`
  - `execution_group TEXT`
  - `execution_type TEXT`
  - `depth INTEGER`
- Added index on `execution_group` for efficient querying
- Implemented `migrateAddHierarchicalColumns()` for backward compatibility
- Updated `save()`, `getWorkflowRun()`, `getProjectHistory()` to handle new fields
- Updated `rowObjectToStepExecution()` mapper to include new fields

#### `persistence.ts` - RepositoryLogger
Updated `mapToStepExecution()` to include hierarchical metadata when saving logs

### 4. UI Visualization

#### `scripts/studio.html`
- Added `buildStepTree()` function:
  - Groups steps by `executionGroup`
  - Maintains sequential timeline
  - Returns mixed array of individual steps and execution groups

- Added `renderStep()` function:
  - Renders individual step cards
  - Shows depth indicator for nested steps
  - Handles indentation based on depth level

- Updated `loadRunDetails()` to:
  - Call `buildStepTree()` to organize flat step list
  - Render parallel/branch groups with purple-themed containers
  - Display group type badge ("Parallel" or "Branch")
  - Show steps within groups in a 2-column grid layout
  - Maintain sequential steps in linear flow

## How It Works

### Execution Flow

1. **Sequential Steps**: Each step gets `executionType: "sequential"` and no `executionGroup`

2. **Parallel Execution**:
   ```typescript
   workflow.parallel([step1, step2, step3])
   ```
   - Generates UUID for `executionGroup`
   - All steps get same `executionGroup` and `executionType: "parallel"`
   - Steps execute concurrently but share group ID

3. **Branch Execution**:
   ```typescript
   workflow.branch([
     [step1, condition1],
     [step2, condition2]
   ])
   ```
   - Generates UUID for `executionGroup`
   - Matching steps get same `executionGroup` and `executionType: "branch"`

4. **Nested Workflows**:
   - Parent workflow passes context to nested workflow
   - Nested workflow increments `depth` by 1
   - Sets `parentStepId` to parent workflow ID
   - Child steps inherit and propagate context

### Data Flow

```
Workflow.parallel()
  → generates executionGroup UUID
  → runStepExecution(step, input, context)
    → AIService(config with context)
      → LLMCallLog with hierarchical metadata
        → RepositoryLogger.mapToStepExecution()
          → SQLite save with execution_group, execution_type, depth
            → UI queries and groups by execution_group
              → Renders parallel steps visually grouped
```

## UI Appearance

- **Sequential steps**: Standard cards in vertical list
- **Parallel groups**: Purple-bordered container with:
  - Header showing "Parallel Execution Group" with step count
  - 2-column grid of step cards
  - All steps in group share visual container
- **Branch groups**: Similar to parallel but labeled "Branch Execution Group"
- **Nested steps**: Indented based on depth level

## Backward Compatibility

- All new fields are optional (`?` in TypeScript)
- Database migration adds columns as NULL-able
- Existing data without hierarchical metadata continues to work
- UI gracefully handles missing metadata (displays sequentially)
- Migration runs automatically on first DB access after upgrade

## Error Handling & Non-Blocking Persistence

**IMPORTANT**: Persistence failures never block workflow execution.

- All `save()` operations are wrapped in try-catch
- Failures log warnings to console but don't throw errors
- Query operations (`getWorkflowRun`, `getProjectHistory`) return empty arrays on failure
- Index creation after migration is wrapped in try-catch
- Database schema incompatibilities result in warnings, not crashes

This ensures that:
1. Workflows continue executing even if persistence fails
2. Users with older database schemas can still run workflows
3. Migration issues don't prevent workflow execution
4. The system degrades gracefully

## Benefits

1. **Clear Visualization**: Users can see which steps ran in parallel at a glance
2. **Performance Understanding**: Easier to identify parallelization opportunities
3. **Debugging**: Quickly identify which parallel group a step belongs to
4. **Nested Workflow Support**: Depth tracking shows workflow composition
5. **Cost Analysis**: Can aggregate costs per parallel group
6. **Timeline Accuracy**: Reflects actual execution order and concurrency

## Future Enhancements

Potential improvements:
- Gantt chart visualization showing parallel execution timelines
- Aggregate metrics per execution group (total cost, max duration)
- Flame graph view for deeply nested workflows
- Real-time updates as parallel steps complete
- Collapsible/expandable parallel groups in UI
- Parallel execution percentage metric
