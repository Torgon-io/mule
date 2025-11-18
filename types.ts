/**
 * Shared types to avoid circular dependencies
 */

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
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  duration?: number;
  finishReason?: string;
  [key: string]: any;
}

/**
 * Configuration options for Mule
 */
export interface MuleOptions {
  logging?: {
    enabled?: boolean;
    logger?: Logger;
  };
}
