/**
 * OpenRouter Pricing Service
 *
 * Fetches and caches model pricing data from OpenRouter API.
 * Provides non-blocking cost calculation for LLM inference.
 */

interface ModelPricing {
  prompt: number;      // Cost per token for input/prompt
  completion: number;  // Cost per token for output/completion
  request?: number;    // Per-request cost
  image?: number;
  discount?: number;
}

interface OpenRouterModel {
  id: string;
  name?: string;
  pricing: ModelPricing;
  context_length?: number;
  architecture?: {
    modality?: string;
    tokenizer?: string;
    instruct_type?: string | null;
  };
}

interface OpenRouterModelsResponse {
  data: OpenRouterModel[];
}

interface CostBreakdown {
  promptCost: number;
  completionCost: number;
  totalCost: number;
}

class PricingService {
  private cache: Map<string, ModelPricing> = new Map();
  private lastFetch: number = 0;
  private readonly CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
  private readonly API_URL = "https://openrouter.ai/api/v1/models";
  private fetchPromise: Promise<void> | null = null;

  /**
   * Get pricing for a specific model.
   * Returns cached data if available, otherwise fetches in background.
   */
  async getPricing(modelId: string): Promise<ModelPricing | null> {
    // Check cache first
    if (this.cache.has(modelId) && !this.isCacheExpired()) {
      return this.cache.get(modelId)!;
    }

    // Trigger background fetch if needed
    if (this.isCacheExpired() && !this.fetchPromise) {
      this.fetchPromise = this.fetchPricing().finally(() => {
        this.fetchPromise = null;
      });
    }

    // Wait for fetch to complete
    if (this.fetchPromise) {
      await this.fetchPromise;
    }

    return this.cache.get(modelId) || null;
  }

  /**
   * Calculate cost from token usage and model pricing.
   */
  calculateCost(
    usage: {
      promptTokens?: number;
      completionTokens?: number;
    },
    pricing: ModelPricing,
  ): CostBreakdown {
    const promptTokens = usage.promptTokens || 0;
    const completionTokens = usage.completionTokens || 0;

    const promptCost = promptTokens * pricing.prompt;
    const completionCost = completionTokens * pricing.completion;

    return {
      promptCost,
      completionCost,
      totalCost: promptCost + completionCost,
    };
  }

  /**
   * Get cost for a specific model and usage.
   * Non-blocking: returns null if pricing not available.
   */
  async getCost(
    modelId: string,
    usage: {
      promptTokens?: number;
      completionTokens?: number;
    },
  ): Promise<CostBreakdown | null> {
    const pricing = await this.getPricing(modelId);
    if (!pricing) {
      return null;
    }
    return this.calculateCost(usage, pricing);
  }

  /**
   * Prefetch pricing data to warm up the cache.
   * Non-blocking: can be called at startup.
   */
  async warmup(): Promise<void> {
    if (!this.fetchPromise && this.isCacheExpired()) {
      this.fetchPromise = this.fetchPricing().finally(() => {
        this.fetchPromise = null;
      });
    }
    await this.fetchPromise;
  }

  private isCacheExpired(): boolean {
    return Date.now() - this.lastFetch > this.CACHE_TTL_MS;
  }

  private async fetchPricing(): Promise<void> {
    try {
      const response = await fetch(this.API_URL);

      if (!response.ok) {
        console.error(
          `Failed to fetch OpenRouter pricing: ${response.status} ${response.statusText}`,
        );
        return;
      }

      const data: OpenRouterModelsResponse = await response.json();

      // Update cache with all models
      for (const model of data.data) {
        if (model.pricing) {
          this.cache.set(model.id, model.pricing);
        }
      }

      this.lastFetch = Date.now();
    } catch (error) {
      console.error("Error fetching OpenRouter pricing:", error);
    }
  }

  /**
   * Clear the cache and force refetch on next request.
   */
  clearCache(): void {
    this.cache.clear();
    this.lastFetch = 0;
  }

  /**
   * Get all cached pricing data (for debugging/inspection).
   */
  getCacheSnapshot(): Map<string, ModelPricing> {
    return new Map(this.cache);
  }
}

// Export singleton instance
export const pricingService = new PricingService();

// Export types
export type { CostBreakdown, ModelPricing };
