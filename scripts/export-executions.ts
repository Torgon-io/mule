#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-ffi --allow-net --unstable-ffi
/**
 * Export execution history to JSON or CSV
 *
 * Usage:
 *   deno task export --project my-project --format json
 *   deno task export --project my-project --format csv --output data.csv
 */

import { SQLiteRepository } from "../sqlite-repository.ts";
import { parseArgs } from "https://deno.land/std@0.208.0/cli/parse_args.ts";

const args = parseArgs(Deno.args, {
  string: ["project", "format", "output", "db"],
  default: {
    format: "json",
    db: "~/.mule/executions.db",
  },
});

if (!args.project) {
  console.error("Error: --project is required");
  console.log("\nUsage:");
  console.log("  deno task export --project my-project --format json");
  console.log("  deno task export --project my-project --format csv --output data.csv");
  Deno.exit(1);
}

const repo = new SQLiteRepository(args.db);

try {
  console.log(`Exporting executions for project: ${args.project}`);

  const history = await repo.getProjectHistory(args.project, 10000);

  if (history.length === 0) {
    console.log("No executions found for this project.");
    Deno.exit(0);
  }

  let output: string;
  let defaultFilename: string;

  if (args.format === "csv") {
    // Generate CSV
    const headers = [
      "project_id", "workflow_id", "run_id", "step_id",
      "timestamp", "duration_ms", "status",
      "model", "prompt_tokens", "completion_tokens", "total_tokens",
      "prompt_cost_usd", "completion_cost_usd", "total_cost_usd",
      "finish_reason", "error"
    ];

    const rows = history.map(step => [
      step.projectId,
      step.workflowId,
      step.runId,
      step.stepId,
      step.timestamp,
      step.durationMs || "",
      step.status,
      step.model || "",
      step.promptTokens || "",
      step.completionTokens || "",
      step.totalTokens || "",
      step.promptCostUsd || "",
      step.completionCostUsd || "",
      step.totalCostUsd || "",
      step.finishReason || "",
      step.error || ""
    ]);

    output = [
      headers.join(","),
      ...rows.map(row => row.map(cell =>
        typeof cell === "string" && cell.includes(",")
          ? `"${cell.replace(/"/g, '""')}"`
          : cell
      ).join(","))
    ].join("\n");

    defaultFilename = `${args.project}-executions.csv`;
  } else {
    // Generate JSON
    output = JSON.stringify(history, null, 2);
    defaultFilename = `${args.project}-executions.json`;
  }

  const filename = args.output || defaultFilename;
  await Deno.writeTextFile(filename, output);

  console.log(`✅ Exported ${history.length} execution(s) to ${filename}`);
} catch (error) {
  console.error("Error:", error.message);
  Deno.exit(1);
} finally {
  repo.close();
}
