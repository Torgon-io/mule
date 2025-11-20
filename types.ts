/**
 * Shared types to avoid circular dependencies
 */

import type { PersistenceConfig, StepExecution, StepExecutionRepository } from "./persistence.ts";

// Re-export persistence types
export type { PersistenceConfig, StepExecution, StepExecutionRepository };

/**
 * Logger interface for custom logging implementations
 */
export interface Logger {
  log(data: LLMCallLog): Promise<void>;
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
  model?: string;
  messages?: Array<{ role: string; content: string }>;
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
}
