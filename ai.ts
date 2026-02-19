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
import { pricingService } from "./pricing.ts";
import {
  getRetryAfterWaitMs,
  with503Retry,
} from "./lib.ts";

type GenerateRequest = {
  model: string;
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

  /**
   * If error is 503 with Retry-After header, return wait time in ms; else null.
   */
  private static get503RetryWaitMs(error: unknown): number | null {
    if (
      error &&
      typeof error === "object" &&
      (error as { statusCode?: number }).statusCode === 503
    ) {
      const err = error as {
        responseHeaders?: Headers | Record<string, string>;
      };
      return getRetryAfterWaitMs(err.responseHeaders);
    }
    return null;
  }

  private async storeRequestMetadata(
    request: GenerateRequest,
    response: any,
    duration: number,
    result: unknown
  ) {
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
          const cost = await pricingService.getCost(request.model, {
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

      await this.config.logger.log(logData);
    }
  }

  async generateText(request: GenerateRequest) {
    return with503Retry(
      async () => {
        const openrouter = this.getOpenRouter();
        const startTime = Date.now();
        const response = await generateText({
          ...request,
          model: openrouter(request.model),
        });
        const duration = Date.now() - startTime;
        this.storeRequestMetadata(request, response, duration, response.text);
        return response.text;
      },
      (err) => AIService.get503RetryWaitMs(err)
    );
  }

  async generateObject<T>(request: GenerateObjectRequest): Promise<T> {
    if (!request.schema) {
      throw new Error("Schema required for structured output");
    }

    return with503Retry(
      async () => {
        const openrouter = this.getOpenRouter();
        try {
          const startTime = Date.now();
          const reponse = await generateObject({
            ...request,
            model: openrouter(request.model),
          });
          const duration = Date.now() - startTime;
          this.storeRequestMetadata(request, reponse, duration, reponse.object);

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
      },
      (err) => AIService.get503RetryWaitMs(err)
    );
  }
}
