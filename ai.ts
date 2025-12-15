/**
 * AI Service
 * Handles LLM calls via OpenRouter with logging and usage tracking
 */

import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import {
  generateText,
  generateObject,
  NoObjectGeneratedError,
  type ModelMessage,
} from "ai";
import type { Logger, LLMCallLog } from "./types.ts";
import type { StepExecutionRepository } from "./persistence.ts";
import { pricingService } from "./pricing.ts";

type GenerateRequest = {
  model?: string;
  messages: ModelMessage[];
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
};

type GenerateObjectRequest = GenerateRequest & {
  schema: any; // Zod schema for structured output
};

export interface AIServiceConfig {
  projectId: string;
  workflowId: string;
  runId: string;
  stepId: string;
  logger: Logger | null;
  defaultModel?: string;
  cacheRepository?: StepExecutionRepository | null;

  // Hierarchical execution metadata
  parentStepId?: string;
  executionGroup?: string;
  executionType?: "sequential" | "parallel" | "branch";
  depth?: number;
}

export class AIService {
  private openrouter?: ReturnType<typeof createOpenRouter>;
  private config: AIServiceConfig;

  constructor(config?: AIServiceConfig) {
    this.config = config || {
      projectId: "unknown",
      workflowId: "unknown",
      runId: "unknown",
      stepId: "unknown",
      logger: null,
    };
  }

  private getOpenRouter() {
    if (!this.openrouter) {
      const apiKey = Deno.env.get("OPENROUTER_API_KEY");
      if (!apiKey) {
        throw new Error("OPENROUTER_API_KEY environment variable is not set");
      }
      this.openrouter = createOpenRouter({
        apiKey,
      });
    }
    return this.openrouter;
  }

  private async generateCacheKey(request: GenerateRequest, model: string): Promise<string> {
    const cacheInput = {
      model,
      messages: request.messages,
      systemPrompt: request.systemPrompt || null,
      temperature: request.temperature || null,
      maxTokens: request.maxTokens || null,
    };
    const encoder = new TextEncoder();
    const data = encoder.encode(JSON.stringify(cacheInput));
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  private async storeRequestMetadata(
    request: GenerateRequest,
    response: any,
    duration: number,
    result: unknown,
    cacheKey?: string
  ): Promise<number | undefined> {
    // If logger is configured, use it
    if (this.config.logger) {
      // Extract token counts - AI SDK v5 can return them with different field names
      // Standard format: response.usage.{promptTokens, completionTokens}
      // Alternative format: response.usage.{inputTokens, outputTokens}
      // OpenRouter provider format: response.providerMetadata.openrouter.usage.{promptTokens, completionTokens}

      let promptTokens =
        response.usage?.promptTokens ?? response.usage?.inputTokens;
      let completionTokens =
        response.usage?.completionTokens ?? response.usage?.outputTokens;
      let totalTokens = response.usage?.totalTokens;

      // Check OpenRouter provider metadata as fallback
      const openrouterUsage = response.providerMetadata?.openrouter?.usage;
      if (openrouterUsage && (!promptTokens || !completionTokens)) {
        promptTokens = promptTokens ?? openrouterUsage.promptTokens;
        completionTokens = completionTokens ?? openrouterUsage.completionTokens;
        totalTokens = totalTokens ?? openrouterUsage.totalTokens;
      }

      // Normalize the usage object to use consistent field names
      const normalizedUsage = {
        promptTokens,
        completionTokens,
        totalTokens,
      };

      const logData: LLMCallLog = {
        projectId: this.config.projectId,
        workflowId: this.config.workflowId,
        runId: this.config.runId,
        stepId: this.config.stepId,
        timestamp: new Date().toISOString(),

        // Hierarchical execution metadata
        parentStepId: this.config.parentStepId,
        executionGroup: this.config.executionGroup,
        executionType: this.config.executionType,
        depth: this.config.depth,

        model: request.model,
        messages: request.messages,
        usage: normalizedUsage,
        duration,
        finishReason: response.finishReason,
        result: typeof result === "string" ? result : JSON.stringify(result),
      };

      // Calculate cost asynchronously (non-blocking)
      // If pricing is not available, cost will be undefined
      if (promptTokens || completionTokens) {
        try {
          // request.model is guaranteed to be defined here because we pass it from the generate methods
          const cost = await pricingService.getCost(request.model!, {
            promptTokens: promptTokens ?? 0,
            completionTokens: completionTokens ?? 0,
          });

          if (cost) {
            logData.cost = cost;
          }
        } catch (error) {
          // Silently fail - cost tracking is optional
          console.warn(`Failed to calculate cost for ${request.model}:`, error);
        }
      } else if (totalTokens) {
        // Some models don't provide prompt/completion breakdown
        console.warn(
          `Model ${request.model} doesn't provide prompt/completion token breakdown. ` +
            `Cost tracking requires separate prompt and completion token counts. ` +
            `Total tokens: ${totalTokens}`
        );
      }

      const executionId = await this.config.logger.log(logData);

      // Cache the response if cache is enabled and we have a cache key
      if (cacheKey && this.config.cacheRepository && executionId !== undefined) {
        await this.config.cacheRepository.setCachedResponse(
          this.config.projectId,
          cacheKey,
          executionId
        );
      }

      return executionId;
    }
    return undefined;
  }

  async generateText(request: GenerateRequest) {
    const model = request.model ?? this.config.defaultModel;
    if (!model) {
      throw new Error(
        "No model specified. Either provide a model in the request or set a defaultModel in MuleOptions."
      );
    }

    // Generate cache key if caching is enabled
    let cacheKey: string | undefined;
    if (this.config.cacheRepository) {
      cacheKey = await this.generateCacheKey(request, model);
      const cachedExecution = await this.config.cacheRepository.getCachedResponse(
        this.config.projectId,
        cacheKey
      );

      if (cachedExecution?.result) {
        console.log(`[Mule] 💾 Cache hit for step ${this.config.stepId} (model: ${model})`);
        return cachedExecution.result;
      }
    }

    const openrouter = this.getOpenRouter();
    const startTime = Date.now();
    const response = await generateText({
      ...request,
      model: openrouter(model),
    });
    const duration = Date.now() - startTime;
    console.log(`[Mule] 🤖 LLM call completed for step ${this.config.stepId} (model: ${model}, duration: ${duration}ms)`);
    await this.storeRequestMetadata({ ...request, model }, response, duration, response.text, cacheKey);
    return response.text;
  }

  async generateObject<T>(request: GenerateObjectRequest) {
    if (!request.schema) {
      throw new Error("Schema required for structured output");
    }

    const model = request.model ?? this.config.defaultModel;
    if (!model) {
      throw new Error(
        "No model specified. Either provide a model in the request or set a defaultModel in MuleOptions."
      );
    }

    // Generate cache key if caching is enabled
    let cacheKey: string | undefined;
    if (this.config.cacheRepository) {
      cacheKey = await this.generateCacheKey(request, model);
      const cachedExecution = await this.config.cacheRepository.getCachedResponse(
        this.config.projectId,
        cacheKey
      );

      if (cachedExecution?.result) {
        console.log(`[Mule] 💾 Cache hit for step ${this.config.stepId} (model: ${model})`);
        return JSON.parse(cachedExecution.result) as T;
      }
    }

    const openrouter = this.getOpenRouter();
    try {
      const startTime = Date.now();
      const reponse = await generateObject({
        ...request,
        model: openrouter(model),
      });
      const duration = Date.now() - startTime;
      console.log(`[Mule] 🤖 LLM call completed for step ${this.config.stepId} (model: ${model}, duration: ${duration}ms)`);
      await this.storeRequestMetadata({ ...request, model }, reponse, duration, reponse.object, cacheKey);

      return reponse.object as T;
    } catch (error) {
      if (NoObjectGeneratedError.isInstance(error)) {
        console.error("NoObjectGeneratedError:");
        console.error("Cause:", error.cause);
        console.error("Text:", error.text);
        console.error("Response:", error.response);
        console.error("Usage:", error.usage);
        console.error("Finish Reason:", error.finishReason);
      }
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(`[OpenRouter] Error:`, errorMessage);
      console.error(`[OpenRouter] Error details:`, error);
      throw error;
    }
  }
}
