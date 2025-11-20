/**
 * AI Service
 * Handles LLM calls via OpenRouter with logging and usage tracking
 */

import { createOpenRouter } from "npm:@openrouter/ai-sdk-provider";
import {
  generateText,
  generateObject,
  NoObjectGeneratedError,
} from "npm:ai@^5.0.93";
import type { Logger, LLMCallLog } from "./types.ts";
import { pricingService } from "./pricing.ts";

type GenerateRequest = {
  model: string;
  messages: Array<{ role: "user" | "system" | "assistant"; content: string }>;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
};

type generateObject = GenerateRequest & {
  schema: any; // Zod schema for structured output
};

export interface AIServiceConfig {
  projectId: string;
  workflowId: string;
  runId: string;
  stepId: string;
  logger: Logger | null;
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

      let promptTokens = response.usage?.promptTokens ?? response.usage?.inputTokens;
      let completionTokens = response.usage?.completionTokens ?? response.usage?.outputTokens;
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

  async generate<T>(request: GenerateRequest) {
    const openrouter = this.getOpenRouter();
    const startTime = Date.now();
    const response = await generateText({
      ...request,
      model: openrouter(request.model),
    });
    const duration = Date.now() - startTime;
    console.log("DEBUG - Response structure:", JSON.stringify({
      usage: response.usage,
      finishReason: response.finishReason,
      hasContent: !!response.content,
      providerMetadata: (response as any).providerMetadata,
      rawResponse: (response as any).rawResponse ? "exists" : "missing",
      id: (response as any).id,
      allKeys: Object.keys(response),
    }, null, 2));
    this.storeRequestMetadata(request, response, duration, "not implemented");
    return response.content;
  }

  async generateObject<T>(request: generateObject) {
    if (!request.schema) {
      throw new Error("Schema required for structured output");
    }

    const openrouter = this.getOpenRouter();
    try {
      const startTime = Date.now();
      const reponse = await generateObject({
        ...request,
        model: openrouter(request.model),
      });
      console.log("DEBUG - generateObject Response structure:", JSON.stringify({
        usage: reponse.usage,
        finishReason: reponse.finishReason,
        hasObject: !!reponse.object,
        providerMetadata: (reponse as any).providerMetadata,
        experimental_providerMetadata: (reponse as any).experimental_providerMetadata,
        allKeys: Object.keys(reponse),
      }, null, 2));
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
  }
}
