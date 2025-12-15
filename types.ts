/**
 * Shared types to avoid circular dependencies
 */

import type { PersistenceConfig, StepExecution, StepExecutionRepository } from "./persistence.ts";
import type { ModelMessage } from "ai";

// Re-export persistence types
export type { PersistenceConfig, StepExecution, StepExecutionRepository };

// Re-export AI types for convenience
export type { ModelMessage };

/**
 * Logger interface for custom logging implementations
 */
export interface Logger {
  log(data: LLMCallLog): Promise<number | undefined>;
}

/**
 * LLM call log data structure
 */
export interface LLMCallLog {
  projectId: string;
  workflowId: string;
  runId: string;
  stepId: string;
  timestamp: string;

  // Hierarchical execution metadata
  parentStepId?: string;
  executionGroup?: string;
  executionType?: "sequential" | "parallel" | "branch";
  depth?: number;

  model?: string;
  messages?: ModelMessage[];
  result?: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  cost?: {
    promptCost: number;      // Cost for input/prompt tokens (USD)
    completionCost: number;  // Cost for output/completion tokens (USD)
    totalCost: number;       // Total cost (USD)
  };
  duration?: number;
  finishReason?: string;
  error?: string;
  [key: string]: any;
}

/**
 * Configuration options for Mule
 */
export interface MuleOptions {
  persistence?: PersistenceConfig;
  logging?: {
    enabled?: boolean;
    logger?: Logger;
  };
  defaultModel?: string;
  cache?: {
    enabled?: boolean;
  };
}
