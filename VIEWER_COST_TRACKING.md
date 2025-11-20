# Web Viewer Cost Tracking Updates

## Overview

The Mule Web Viewer has been updated to display inference cost tracking across all views, providing visual insights into LLM spending at the run and step levels.

## Changes Made

### 1. Server-Side Updates ([viewer-server.ts](scripts/viewer-server.ts))

**Updated `handleRuns()` API endpoint:**
- Added `SUM(COALESCE(total_cost_usd, 0)) as total_cost_usd` to the runs aggregation query
- Total cost per run is now included in the `/api/runs` response

**Data Flow:**
```
Database → SQLiteRepository → API Endpoint → JSON Response → Web UI
```

### 2. UI Updates ([viewer.html](scripts/viewer.html))

#### New Formatting Function
```javascript
function formatCost(cost) {
  if (!cost || cost === 0) return '—';
  if (cost < 0.0001) return `$${cost.toFixed(8)}`;
  if (cost < 0.01) return `$${cost.toFixed(6)}`;
  return `$${cost.toFixed(4)}`;
}
```

Provides adaptive precision based on cost magnitude:
- Very small costs (< $0.0001): 8 decimal places
- Small costs (< $0.01): 6 decimal places
- Standard costs: 4 decimal places

#### Runs List View

**Before:**
- 3 columns: steps, tokens, duration

**After:**
- 4 columns in 2x2 grid: steps, tokens, duration, **cost**
- Cost displayed with green highlighting when > 0
- Format: `$0.0042` (adaptive precision)

#### Run Details View

**New Cost Stat Card:**
- Added 4th stat card showing total cost for the run
- Gradient background: green (#43e97b) to cyan (#38f9d7)
- Shows average cost per step as secondary metric
- Format example:
  ```
  Total Cost
  $0.0156
  $0.0039/step avg
  ```

**Step Cards Metrics Grid:**

**Before:**
- 4 columns: Prompt Tokens, Completion, Total Tokens, Duration

**After:**
- 5 columns: Prompt Tokens (+ cost), Completion (+ cost), Total Tokens, **Total Cost**, Duration
- Prompt tokens show cost breakdown underneath
- Completion tokens show cost breakdown underneath
- Total cost displayed in green
- Example:
  ```
  Prompt Tokens    Completion    Total Tokens    Total Cost    Duration
  1,234            456           1,690           $0.0052       1.2s
  $0.0037          $0.0015
  ```

#### Header Update

**Updated subtitle:**
```
View workflow runs, step executions, LLM token usage, and inference costs
```

### 3. Task Configuration ([deno.json](deno.json))

Added new task for easy viewer startup:
```bash
deno task viewer
```

### 4. Documentation ([scripts/README.md](scripts/README.md))

Updated to reflect cost tracking features:
- Added cost analysis to stats output description
- Updated web viewer features list to include cost tracking
- Simplified Quick Start to use `deno task viewer`
- Added cost metrics to usage tips

## Visual Highlights

### Color Coding
- **Cost values**: Green text (`text-green-600`) to distinguish from other metrics
- **Cost stat card**: Green-to-cyan gradient for visual consistency
- **Cost > 0**: Enhanced visibility with color highlighting

### Layout Adjustments
- Runs list grid: Changed from 3 columns to 2x2 grid for better balance
- Step metrics: Expanded from 4 to 5 columns to accommodate cost data
- Stat cards: Expanded from 3 to 4 cards in run details view

## Usage Examples

### Viewing Run Costs

1. Start the viewer:
   ```bash
   deno task viewer
   ```

2. Open http://localhost:8080

3. Select a project from the dropdown

4. Browse runs in the left panel - costs shown in the bottom-right of each run card

5. Click a run to see:
   - **Total Cost** card showing aggregate cost for the run
   - Individual step costs with prompt/completion breakdown
   - Average cost per step

### Identifying Expensive Steps

- Scan the "Total Cost" column in step cards
- Steps with higher costs are immediately visible
- Compare prompt vs completion costs to identify expensive generation

### Cost Analysis Workflow

1. **Project Level**: Browse runs to find expensive workflows
2. **Run Level**: Click runs with high costs to see breakdown
3. **Step Level**: Identify which steps consume the most budget
4. **Token Level**: Review prompt vs completion cost distribution

## Data Requirements

**For cost data to appear:**
1. Steps must have been executed after cost tracking implementation
2. OpenRouter pricing API must have been accessible during execution
3. Model pricing data must exist in OpenRouter's API

**Graceful Degradation:**
- If cost data is unavailable: Shows "—" instead of $0.00
- Older executions without cost data: Still display normally, just without cost metrics
- Failed pricing lookups: Cost remains null, doesn't break UI

## API Response Examples

### `/api/runs` Response
```json
[
  {
    "project_id": "my-project",
    "workflow_id": "answer-questions",
    "run_id": "abc-123",
    "start_time": "2025-11-19T10:30:00.000Z",
    "step_count": 4,
    "total_tokens": 5420,
    "total_duration_ms": 3240,
    "total_cost_usd": 0.0156,
    "error_count": 0
  }
]
```

### Step Execution Data
```json
{
  "stepId": "analyze",
  "promptTokens": 1234,
  "completionTokens": 456,
  "totalTokens": 1690,
  "promptCostUsd": 0.0037,
  "completionCostUsd": 0.0015,
  "totalCostUsd": 0.0052,
  "durationMs": 1200
}
```

## Browser Compatibility

All features use standard JavaScript APIs:
- No build step required
- Works in all modern browsers (Chrome, Firefox, Safari, Edge)
- Tailwind CSS loaded via CDN
- No framework dependencies

## Performance Considerations

- Cost calculations happen on the client side (formatting only)
- No additional database queries required
- Cost data included in existing API responses
- Minimal overhead: ~50 bytes per execution record

## Future Enhancements

Potential additions to the viewer:
- **Cost filtering**: Filter runs by cost threshold
- **Cost charts**: Visualize cost trends over time
- **Cost comparisons**: Compare costs across models
- **Budget alerts**: Highlight runs exceeding cost thresholds
- **Cost projections**: Estimate monthly costs based on usage

## Testing

To verify cost tracking in the viewer:

1. Run a workflow with LLM steps:
   ```bash
   deno task example
   ```

2. Start the viewer:
   ```bash
   deno task viewer
   ```

3. Navigate to the project and verify:
   - Run list shows costs in 4th column
   - Run details show cost stat card
   - Individual steps show cost breakdowns
   - Costs display with proper formatting

## Files Modified

- [scripts/viewer-server.ts](scripts/viewer-server.ts) - Added cost to runs query
- [scripts/viewer.html](scripts/viewer.html) - Added cost displays throughout UI
- [deno.json](deno.json) - Added `viewer` task
- [scripts/README.md](scripts/README.md) - Updated documentation

## Conclusion

The web viewer now provides comprehensive cost visibility across all levels of workflow execution, enabling teams to:
- Monitor LLM spending in real-time
- Identify expensive workflows and steps
- Optimize prompt engineering for cost efficiency
- Track cost trends over time
- Make informed decisions about model selection

All cost tracking features are production-ready and require no additional configuration.
