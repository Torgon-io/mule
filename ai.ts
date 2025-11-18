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
      const logData: LLMCallLog = {
        projectId: this.config.projectId,
        workflowId: this.config.workflowId,
        runId: this.config.runId,
        stepId: this.config.stepId,
        timestamp: new Date().toISOString(),
        model: request.model,
        messages: request.messages,
        usage: response.usage,
        duration,
        finishReason: response.finishReason,
        result,
      };

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
      // console.log({ reponse });
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
