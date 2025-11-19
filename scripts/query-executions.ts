#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-ffi --allow-net --unstable-ffi
/**
 * Query execution history from the Mule persistence database
 *
 * Usage:
 *   deno task query                          # Show all projects
 *   deno task query --project my-project     # Show project history
 *   deno task query --workflow workflow-id --run run-id  # Show specific run
 */

import { SQLiteRepository } from "../sqlite-repository.ts";
import { parseArgs } from "https://deno.land/std@0.208.0/cli/parse_args.ts";

const args = parseArgs(Deno.args, {
  string: ["project", "workflow", "run", "db"],
  default: {
    db: "~/.mule/executions.db",
  },
});

const repo = new SQLiteRepository(args.db);

try {
  if (args.workflow && args.run) {
    // Show specific workflow run
    const projectId = args.project || "unknown";
    console.log(`\n📊 Workflow Run: ${args.workflow} (${args.run})\n`);

    const steps = await repo.getWorkflowRun(projectId, args.workflow, args.run);

    if (steps.length === 0) {
      console.log("No steps found for this workflow run.");
    } else {
      for (const step of steps) {
        console.log(`Step: ${step.stepId}`);
        console.log(`  Status: ${step.status}`);
        console.log(`  Timestamp: ${step.timestamp}`);
        if (step.model) console.log(`  Model: ${step.model}`);
        if (step.durationMs) console.log(`  Duration: ${step.durationMs}ms`);
        if (step.totalTokens) console.log(`  Tokens: ${step.totalTokens} (${step.promptTokens} + ${step.completionTokens})`);
        if (step.error) console.log(`  Error: ${step.error}`);
        if (step.result) {
          const preview = step.result.substring(0, 100);
          console.log(`  Result: ${preview}${step.result.length > 100 ? "..." : ""}`);
        }
        console.log();
      }

      // Summary
      const totalTokens = steps.reduce((sum, s) => sum + (s.totalTokens || 0), 0);
      const totalDuration = steps.reduce((sum, s) => sum + (s.durationMs || 0), 0);
      const errors = steps.filter(s => s.status === "error").length;

      console.log(`Summary: ${steps.length} steps, ${totalTokens} tokens, ${totalDuration}ms total`);
      if (errors > 0) console.log(`⚠️  ${errors} step(s) failed`);
    }
  } else if (args.project) {
    // Show project history
    const limit = args.limit ? parseInt(args.limit) : 50;
    console.log(`\n📁 Project: ${args.project} (last ${limit} executions)\n`);

    const history = await repo.getProjectHistory(args.project, limit);

    if (history.length === 0) {
      console.log("No executions found for this project.");
    } else {
      const grouped = new Map<string, typeof history>();

      for (const step of history) {
        const key = `${step.workflowId}/${step.runId}`;
        if (!grouped.has(key)) {
          grouped.set(key, []);
        }
        grouped.get(key)!.push(step);
      }

      console.log(`Found ${grouped.size} workflow run(s):\n`);

      for (const [key, steps] of grouped) {
        const [workflowId, runId] = key.split("/");
        const firstStep = steps[0];
        const totalTokens = steps.reduce((sum, s) => sum + (s.totalTokens || 0), 0);
        const errors = steps.filter(s => s.status === "error").length;

        console.log(`${workflowId} (${runId})`);
        console.log(`  Steps: ${steps.length}, Tokens: ${totalTokens}, Time: ${firstStep.timestamp}`);
        if (errors > 0) console.log(`  ⚠️  ${errors} error(s)`);
        console.log();
      }
    }
  } else {
    // Show all projects
    console.log("\n🗄️  Mule Execution Database\n");
    console.log(`Database: ${args.db}\n`);

    // Get all steps by querying directly from the database
    const allSteps = repo.db.prepare(
      `SELECT
        project_id, workflow_id, run_id, step_id,
        timestamp, duration_ms,
        model, prompt, result,
        prompt_tokens, completion_tokens, total_tokens, finish_reason,
        status, error
      FROM step_executions
      ORDER BY timestamp DESC
      LIMIT 10000`
    ).all() as unknown[];

    if (allSteps.length === 0) {
      console.log("Database is empty. No executions recorded yet.");
    } else {
      const projectStats = new Map<string, {
        steps: number,
        tokens: number,
        workflows: Set<string>,
        lastSeen: string
      }>();

      for (const rawRow of allSteps) {
        const row = rawRow as Record<string, unknown>;
        const step = {
          projectId: row.project_id as string,
          workflowId: row.workflow_id as string,
          timestamp: row.timestamp as string,
          totalTokens: (row.total_tokens as number | null) ?? 0
        };
        if (!projectStats.has(step.projectId)) {
          projectStats.set(step.projectId, {
            steps: 0,
            tokens: 0,
            workflows: new Set(),
            lastSeen: step.timestamp
          });
        }

        const stats = projectStats.get(step.projectId)!;
        stats.steps++;
        stats.tokens += step.totalTokens;
        stats.workflows.add(step.workflowId);

        // Update last seen if this is more recent
        if (step.timestamp > stats.lastSeen) {
          stats.lastSeen = step.timestamp;
        }
      }

      console.log("Projects:\n");

      for (const [projectId, stats] of projectStats) {
        console.log(`📦 ${projectId}`);
        console.log(`   Workflows: ${stats.workflows.size}`);
        console.log(`   Steps: ${stats.steps}`);
        console.log(`   Total Tokens: ${stats.tokens}`);
        console.log(`   Last Activity: ${stats.lastSeen}`);
        console.log();
      }

      console.log("\nUsage:");
      console.log(`  deno task query --project ${Array.from(projectStats.keys())[0]}`);
    }
  }
} catch (error) {
  console.error("Error:", error.message);
  Deno.exit(1);
} finally {
  repo.close();
}
