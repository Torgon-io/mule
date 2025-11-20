#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-ffi --allow-net --unstable-ffi
/**
 * Quick test to see what the AI response structure looks like
 */

import { createWorkflow, createStep } from "./main.ts";
import { z } from "npm:zod@^3.24.1";

const inputSchema = z.object({ query: z.string() });

const testStep = createStep({
  id: "test",
  inputSchema,
  outputSchema: z.string(),
  executor: async ({ input, ai }) => {
    console.log("\n=== Testing AI Response Structure ===\n");
    const response = await ai.generate({
      model: "anthropic/claude-3.5-sonnet",
      messages: [{ role: "user", content: "Say hello in one word" }],
    });
    return response;
  },
});

const workflow = createWorkflow()
  .addStep(testStep);

await workflow.run({ query: "test" });

console.log("\n=== Test Complete ===\n");
console.log("Check the DEBUG output above to see the response structure.");
console.log("Then check the database to see what was stored:");
console.log("sqlite3 ~/.mule/executions.db \"SELECT prompt_tokens, completion_tokens, total_tokens, total_cost_usd FROM step_executions ORDER BY timestamp DESC LIMIT 1\"");
