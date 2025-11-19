#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-ffi --allow-net --unstable-ffi
/**
 * Example script showing how to use the persistence scripts
 * Creates sample data and demonstrates querying
 */

import { SQLiteRepository } from "../sqlite-repository.ts";

console.log("Creating sample execution data...\n");

const repo = new SQLiteRepository(":memory:");

// Add sample executions
const sampleData = [
  {
    projectId: "customer-support-bot",
    workflowId: "answer-query",
    runId: "run-001",
    stepId: "classify",
    timestamp: new Date("2024-01-15T10:00:00Z").toISOString(),
    status: "success" as const,
    model: "gpt-4",
    promptTokens: 100,
    completionTokens: 50,
    totalTokens: 150,
    durationMs: 1200,
    result: "Category: Technical Support"
  },
  {
    projectId: "customer-support-bot",
    workflowId: "answer-query",
    runId: "run-001",
    stepId: "generate-response",
    timestamp: new Date("2024-01-15T10:00:02Z").toISOString(),
    status: "success" as const,
    model: "gpt-4-turbo",
    promptTokens: 200,
    completionTokens: 150,
    totalTokens: 350,
    durationMs: 2500,
    result: "Here's how to reset your password..."
  },
  {
    projectId: "data-pipeline",
    workflowId: "process-records",
    runId: "run-002",
    stepId: "validate",
    timestamp: new Date("2024-01-15T11:30:00Z").toISOString(),
    status: "success" as const,
    model: "gpt-3.5-turbo",
    promptTokens: 50,
    completionTokens: 20,
    totalTokens: 70,
    durationMs: 800,
    result: "Validation passed"
  },
  {
    projectId: "data-pipeline",
    workflowId: "process-records",
    runId: "run-003",
    stepId: "validate",
    timestamp: new Date("2024-01-15T12:00:00Z").toISOString(),
    status: "error" as const,
    model: "gpt-3.5-turbo",
    promptTokens: 50,
    completionTokens: 0,
    totalTokens: 50,
    durationMs: 500,
    error: "Invalid input format"
  }
];

for (const data of sampleData) {
  await repo.save(data);
}

console.log(`✅ Created ${sampleData.length} sample executions\n`);

// Query examples
console.log("📊 Example Queries:\n");

console.log("1. Project History (customer-support-bot):");
const history = await repo.getProjectHistory("customer-support-bot", 10);
console.log(`   Found ${history.length} executions`);
for (const step of history) {
  console.log(`   - ${step.workflowId}/${step.stepId}: ${step.totalTokens} tokens`);
}

console.log("\n2. Specific Workflow Run:");
const run = await repo.getWorkflowRun("customer-support-bot", "answer-query", "run-001");
console.log(`   Found ${run.length} steps in run-001`);
const totalTokens = run.reduce((sum, s) => sum + (s.totalTokens || 0), 0);
console.log(`   Total tokens: ${totalTokens}`);

console.log("\n3. All Projects:");
const allRows = repo.db.prepare(`SELECT DISTINCT project_id FROM step_executions`).all() as Array<{ project_id: string }>;
const projects = allRows.map(r => r.project_id);
console.log(`   Projects: ${projects.join(", ")}`);

console.log("\n4. Error Detection:");
const errorRows = repo.db.prepare(`SELECT * FROM step_executions WHERE status = 'error'`).all() as unknown[];
console.log(`   Found ${errorRows.length} error(s)`);
if (errorRows.length > 0) {
  const err = errorRows[0] as Record<string, unknown>;
  console.log(`   - ${err.project_id}/${err.workflow_id}: ${err.error}`);
}

console.log("\n💡 Try these commands with real data:");
console.log("   deno task query");
console.log("   deno task stats");
console.log("   deno task export -- --project my-project --format json");

repo.close();
