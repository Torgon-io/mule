#!/usr/bin/env -S deno run --allow-net
import { pricingService } from "./pricing.ts";

console.log("Testing pricing service...\n");

// Test fetching pricing
console.log("Fetching pricing data from OpenRouter...");
const pricing = await pricingService.getPricing("google/gemini-2.5-flash");

if (pricing) {
  console.log("\n✅ Pricing found for google/gemini-2.5-flash:");
  console.log(`  Prompt: $${pricing.prompt} per token`);
  console.log(`  Completion: $${pricing.completion} per token`);

  // Test cost calculation
  const cost = pricingService.calculateCost({
    promptTokens: 1000,
    completionTokens: 500,
  }, pricing);

  console.log("\n📊 Example cost for 1000 prompt + 500 completion tokens:");
  console.log(`  Prompt cost: $${cost.promptCost.toFixed(8)}`);
  console.log(`  Completion cost: $${cost.completionCost.toFixed(8)}`);
  console.log(`  Total cost: $${cost.totalCost.toFixed(8)}`);
} else {
  console.log("\n❌ No pricing found for google/gemini-2.5-flash");
  console.log("This could mean:");
  console.log("  1. The model doesn't exist in OpenRouter's API");
  console.log("  2. The API is temporarily unavailable");
  console.log("  3. There's a network issue");
}

console.log("\n🔍 Checking cache...");
const cache = pricingService.getCacheSnapshot();
console.log(`  Cache contains ${cache.size} models`);

if (cache.size > 0) {
  console.log("\n  First 5 models in cache:");
  let count = 0;
  for (const [modelId, pricing] of cache) {
    console.log(`    ${modelId}: prompt=$${pricing.prompt}, completion=$${pricing.completion}`);
    count++;
    if (count >= 5) break;
  }
}
