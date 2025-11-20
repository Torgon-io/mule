/**
 * Test for pricing service
 */

import { assertEquals, assertExists } from "@std/assert";
import { pricingService } from "./pricing.ts";

Deno.test("PricingService - getCost calculates correct cost", async () => {
  // Mock pricing data
  const mockPricing = {
    prompt: 0.000003, // $3 per million tokens
    completion: 0.000015, // $15 per million tokens
  };

  const usage = {
    promptTokens: 1000,
    completionTokens: 500,
  };

  const cost = pricingService.calculateCost(usage, mockPricing);

  // Use approximate comparison for floating point values
  assertEquals(Math.round(cost.promptCost * 1000000) / 1000000, 0.003); // 1000 * 0.000003
  assertEquals(Math.round(cost.completionCost * 1000000) / 1000000, 0.0075); // 500 * 0.000015
  assertEquals(Math.round(cost.totalCost * 1000000) / 1000000, 0.0105); // sum
});

Deno.test("PricingService - handles zero tokens", () => {
  const mockPricing = {
    prompt: 0.000003,
    completion: 0.000015,
  };

  const usage = {
    promptTokens: 0,
    completionTokens: 0,
  };

  const cost = pricingService.calculateCost(usage, mockPricing);

  assertEquals(cost.promptCost, 0);
  assertEquals(cost.completionCost, 0);
  assertEquals(cost.totalCost, 0);
});

Deno.test("PricingService - cache is empty initially", () => {
  const cache = pricingService.getCacheSnapshot();
  assertExists(cache);
  assertEquals(cache instanceof Map, true);
});
