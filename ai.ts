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
  timeoutMs?: number; // Timeout in milliseconds (default: 5 minutes)
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

  /**
   * Log detailed error information from AI SDK errors.
   * AI SDK errors often contain nested details that are lost with just .message
   */
  private logDetailedError(error: unknown): void {
    if (!error || typeof error !== "object") {
      console.error(`[OpenRouter] Error (non-object):`, error);
      return;
    }

    const err = error as Record<string, unknown>;
    console.error(`[OpenRouter] Error message:`, err.message);
    console.error(`[OpenRouter] Error name:`, err.name);

    // Common AI SDK error properties
    if ("statusCode" in err) console.error(`[OpenRouter] Status code:`, err.statusCode);
    if ("cause" in err) console.error(`[OpenRouter] Cause:`, err.cause);
    if ("data" in err) console.error(`[OpenRouter] Data:`, JSON.stringify(err.data, null, 2));
    if ("responseBody" in err) console.error(`[OpenRouter] Response body:`, err.responseBody);
    if ("url" in err) console.error(`[OpenRouter] URL:`, err.url);

    // OpenRouter specific
    if ("error" in err && typeof err.error === "object" && err.error !== null) {
      const providerError = err.error as Record<string, unknown>;
      console.error(`[OpenRouter] Provider error:`, JSON.stringify(providerError, null, 2));
    }

    // Log full error object for debugging (might be verbose but helpful)
    try {
      const errorKeys = Object.keys(err);
      console.error(`[OpenRouter] Error keys:`, errorKeys);
      // Try to serialize the full error
      const serialized = JSON.stringify(err, (_key, value) => {
        if (value instanceof Error) {
          return { name: value.name, message: value.message, stack: value.stack };
        }
        return value;
      }, 2);
      console.error(`[OpenRouter] Full error object:`, serialized);
    } catch {
      console.error(`[OpenRouter] Could not serialize full error`);
    }
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

  async generateText(request: GenerateRequest): Promise<string> {
    // Default timeout: 10 minutes (600000ms) - large reports may need this
    const timeoutMs = request.timeoutMs ?? 600000;

    return with503Retry(
      async () => {
        const openrouter = this.getOpenRouter();
        const startTime = Date.now();

        console.log(
          `[OpenRouter] Starting generateText request`,
          `Model: ${request.model}`,
          `Timeout: ${timeoutMs / 1000}s`
        );

        // Create AbortController for timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
          controller.abort();
        }, timeoutMs);

        try {
          const response = await generateText({
            model: openrouter(request.model),
            messages: request.messages,
            system: request.systemPrompt, // AI SDK uses 'system' not 'systemPrompt'
            temperature: request.temperature,
            maxTokens: request.maxTokens,
            abortSignal: controller.signal,
          });
          const duration = Date.now() - startTime;
          this.storeRequestMetadata(request, response, duration, response.text);
          return response.text;
        } catch (error) {
          const duration = Date.now() - startTime;
          // Check if this was a timeout abort
          if (controller.signal.aborted) {
            console.error(
              `[OpenRouter] Request timed out after ${duration}ms (limit: ${timeoutMs}ms)`,
              `Model: ${request.model}`
            );
            throw new Error(
              `LLM request timed out after ${Math.round(duration / 1000)}s. ` +
                `The request may be too large or the model is overloaded.`
            );
          }
          // Log detailed error information
          console.error(`[OpenRouter] generateText failed after ${duration}ms`);
          console.error(`[OpenRouter] Model: ${request.model}`);
          this.logDetailedError(error);
          throw error;
        } finally {
          clearTimeout(timeoutId);
        }
      },
      (err) => AIService.get503RetryWaitMs(err)
    );
  }

  async generateObject<T>(request: GenerateObjectRequest): Promise<T> {
    if (!request.schema) {
      throw new Error("Schema required for structured output");
    }

    // Default timeout: 10 minutes (600000ms) - large reports may need this
    const timeoutMs = request.timeoutMs ?? 600000;

    return with503Retry(
      async () => {
        const openrouter = this.getOpenRouter();
        const startTime = Date.now();

        console.log(
          `[OpenRouter] Starting generateObject request`,
          `Model: ${request.model}`,
          `Timeout: ${timeoutMs / 1000}s`,
          `SystemPrompt length: ${request.systemPrompt?.length ?? 0}`,
          `Messages: ${request.messages.length}`
        );

        // Create AbortController for timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
          controller.abort();
        }, timeoutMs);

        try {
          const response = await generateObject({
            model: openrouter(request.model),
            messages: request.messages,
            schema: request.schema,
            system: request.systemPrompt, // AI SDK uses 'system' not 'systemPrompt'
            temperature: request.temperature,
            maxTokens: request.maxTokens,
            abortSignal: controller.signal,
          });
          const duration = Date.now() - startTime;
          this.storeRequestMetadata(request, response, duration, response.object);

          return response.object as T;
        } catch (error) {
          const duration = Date.now() - startTime;

          // Check if this was a timeout abort
          if (controller.signal.aborted) {
            console.error(
              `[OpenRouter] Request timed out after ${duration}ms (limit: ${timeoutMs}ms)`,
              `Model: ${request.model}`
            );
            throw new Error(
              `LLM request timed out after ${Math.round(duration / 1000)}s. ` +
                `The request may be too large or the model is overloaded.`
            );
          }

          if (NoObjectGeneratedError.isInstance(error)) {
            console.error("NoObjectGeneratedError:");
            console.error("Cause:", (error as any).cause);
            console.error("Text:", (error as any).text);
            console.error("Response:", (error as any).response);
            console.error("Usage:", (error as any).usage);
            console.error("Finish Reason:", (error as any).finishReason);
          }
          console.error(`[OpenRouter] generateObject failed after ${duration}ms`);
          console.error(`[OpenRouter] Model: ${request.model}`);
          this.logDetailedError(error);
          throw error;
        } finally {
          clearTimeout(timeoutId);
        }
      },
      (err) => AIService.get503RetryWaitMs(err)
    );
  }
}
