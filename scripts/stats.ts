#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-ffi --allow-net --unstable-ffi
/**
 * Show statistics and analytics for execution history
 *
 * Usage:
 *   deno task stats --project my-project
 *   deno task stats  # All projects
 */

import { SQLiteRepository } from "../sqlite-repository.ts";
import { parseArgs } from "https://deno.land/std@0.208.0/cli/parse_args.ts";

const args = parseArgs(Deno.args, {
  string: ["project", "db"],
  default: {
    db: "~/.mule/executions.db",
  },
});

const repo = new SQLiteRepository(args.db);

try {
  const projectId = args.project || "";
  const history = await repo.getProjectHistory(projectId, 10000);

  if (history.length === 0) {
    console.log("No executions found.");
    Deno.exit(0);
  }

  // Calculate statistics
  const stats = {
    totalSteps: history.length,
    totalTokens: 0,
    totalDuration: 0,
    successCount: 0,
    errorCount: 0,
    models: new Map<string, number>(),
    workflows: new Map<string, { steps: number, tokens: number }>(),
    dates: new Map<string, number>(),
  };

  for (const step of history) {
    stats.totalTokens += step.totalTokens || 0;
    stats.totalDuration += step.durationMs || 0;

    if (step.status === "success") stats.successCount++;
    if (step.status === "error") stats.errorCount++;

    // Model usage
    if (step.model) {
      stats.models.set(step.model, (stats.models.get(step.model) || 0) + 1);
    }

    // Workflow stats
    if (!stats.workflows.has(step.workflowId)) {
      stats.workflows.set(step.workflowId, { steps: 0, tokens: 0 });
    }
    const workflowStats = stats.workflows.get(step.workflowId)!;
    workflowStats.steps++;
    workflowStats.tokens += step.totalTokens || 0;

    // Date distribution
    const date = step.timestamp.split("T")[0];
    stats.dates.set(date, (stats.dates.get(date) || 0) + 1);
  }

  // Display statistics
  console.log("\n📊 Execution Statistics\n");

  if (args.project) {
    console.log(`Project: ${args.project}\n`);
  } else {
    console.log("All Projects\n");
  }

  console.log("Overview:");
  console.log(`  Total Steps: ${stats.totalSteps}`);
  console.log(`  Success: ${stats.successCount} (${((stats.successCount / stats.totalSteps) * 100).toFixed(1)}%)`);
  console.log(`  Errors: ${stats.errorCount} (${((stats.errorCount / stats.totalSteps) * 100).toFixed(1)}%)`);
  console.log(`  Total Tokens: ${stats.totalTokens.toLocaleString()}`);
  console.log(`  Avg Tokens/Step: ${Math.round(stats.totalTokens / stats.totalSteps)}`);
  console.log(`  Total Duration: ${(stats.totalDuration / 1000).toFixed(2)}s`);
  console.log(`  Avg Duration/Step: ${Math.round(stats.totalDuration / stats.totalSteps)}ms`);

  if (stats.models.size > 0) {
    console.log("\nModel Usage:");
    const sortedModels = Array.from(stats.models.entries())
      .sort((a, b) => b[1] - a[1]);
    for (const [model, count] of sortedModels) {
      const percentage = ((count / stats.totalSteps) * 100).toFixed(1);
      console.log(`  ${model}: ${count} (${percentage}%)`);
    }
  }

  if (stats.workflows.size > 0) {
    console.log("\nTop Workflows:");
    const sortedWorkflows = Array.from(stats.workflows.entries())
      .sort((a, b) => b[1].steps - a[1].steps)
      .slice(0, 10);

    for (const [workflow, data] of sortedWorkflows) {
      console.log(`  ${workflow}:`);
      console.log(`    Steps: ${data.steps}, Tokens: ${data.tokens.toLocaleString()}`);
    }
  }

  if (stats.dates.size > 0) {
    console.log("\nActivity by Date:");
    const sortedDates = Array.from(stats.dates.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .slice(0, 10);

    for (const [date, count] of sortedDates) {
      const bar = "█".repeat(Math.ceil(count / 5));
      console.log(`  ${date}: ${bar} ${count}`);
    }
  }

  console.log();
} catch (error) {
  console.error("Error:", error.message);
  Deno.exit(1);
} finally {
  repo.close();
}
