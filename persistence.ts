/**
 * Persistence layer for step execution data
 */

import type { Logger, LLMCallLog } from "./types.ts";

/**
 * Step execution data structure for persistence
 */
export interface StepExecution {
  // Context identifiers
  projectId: string;
  workflowId: string;
  runId: string;
  stepId: string;

  // Timing information
  timestamp: string; // ISO 8601 format
  durationMs?: number;

  // LLM data
  model?: string;
  prompt?: string; // JSON-serialized message array
  result?: string; // LLM output (text or JSON)

  // Token usage metrics
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  finishReason?: string;

  // Execution status
  status: "success" | "error";
  error?: string; // Error message if status = "error"
}

/**
 * Persistence configuration options
 */
export type PersistenceConfig =
  | { type: "sqlite"; path?: string } // Default: ~/.mule/executions.db
  | { type: "postgres"; connectionString: string } // Future
  | { type: "http"; endpoint: string; apiKey?: string } // Future
  | false; // Disable persistence

/**
 * Repository interface for step execution persistence
 */
export interface StepExecutionRepository {
  /**
   * Save a step execution
   */
  save(execution: StepExecution): Promise<void>;

  /**
   * Get all steps from a specific workflow run
   */
  getWorkflowRun(
    projectId: string,
    workflowId: string,
    runId: string
  ): Promise<StepExecution[]>;

  /**
   * Get recent execution history for a project
   */
  getProjectHistory(
    projectId: string,
    limit?: number
  ): Promise<StepExecution[]>;

  /**
   * Close the repository connection
   */
  close(): void;
}

/**
 * Adapter that bridges the Logger interface to the repository pattern
 */
export class RepositoryLogger implements Logger {
  constructor(private repository: StepExecutionRepository) {}

  async log(data: LLMCallLog): Promise<void> {
    const execution = this.mapToStepExecution(data);
    await this.repository.save(execution);
  }

  /**
   * Maps LLMCallLog to StepExecution format
   */
  private mapToStepExecution(data: LLMCallLog): StepExecution {
    return {
      projectId: data.projectId,
      workflowId: data.workflowId,
      runId: data.runId,
      stepId: data.stepId,
      timestamp: data.timestamp,
      durationMs: data.duration,
      model: data.model,
      prompt: data.messages ? JSON.stringify(data.messages) : undefined,
      result: data.result,
      promptTokens: data.usage?.promptTokens,
      completionTokens: data.usage?.completionTokens,
      totalTokens: data.usage?.totalTokens,
      finishReason: data.finishReason,
      status: data.error ? "error" : "success",
      error: data.error,
    };
  }
}
