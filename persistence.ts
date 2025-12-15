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

  // Hierarchical execution metadata
  parentStepId?: string; // ID of parent step (for nested workflows)
  executionGroup?: string; // UUID for parallel/branch execution batches
  executionType?: "sequential" | "parallel" | "branch"; // How this step was executed
  depth?: number; // Nesting level (0 = top-level, 1+ = nested)

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

  // Cost metrics (USD)
  promptCostUsd?: number;
  completionCostUsd?: number;
  totalCostUsd?: number;

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
   * Returns the ID of the inserted row, or undefined if the insert failed
   */
  save(execution: StepExecution): Promise<number | undefined>;

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
   * Get cached LLM response by project ID and request hash
   */
  getCachedResponse(
    projectId: string,
    requestHash: string
  ): Promise<StepExecution | null>;

  /**
   * Store LLM response in cache
   */
  setCachedResponse(
    projectId: string,
    requestHash: string,
    stepExecutionId: number
  ): Promise<void>;

  /**
   * Clear cache for a specific project
   */
  clearCacheByProjectId(projectId: string): Promise<void>;

  /**
   * Clear all cache entries
   */
  clearAllCache(): Promise<void>;

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

  async log(data: LLMCallLog): Promise<number | undefined> {
    const execution = this.mapToStepExecution(data);
    return await this.repository.save(execution);
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

      // Hierarchical execution metadata
      parentStepId: data.parentStepId,
      executionGroup: data.executionGroup,
      executionType: data.executionType,
      depth: data.depth,

      durationMs: data.duration,
      model: data.model,
      prompt: data.messages ? JSON.stringify(data.messages) : undefined,
      result: data.result,
      promptTokens: data.usage?.promptTokens,
      completionTokens: data.usage?.completionTokens,
      totalTokens: data.usage?.totalTokens,
      finishReason: data.finishReason,
      promptCostUsd: data.cost?.promptCost,
      completionCostUsd: data.cost?.completionCost,
      totalCostUsd: data.cost?.totalCost,
      status: data.error ? "error" : "success",
      error: data.error,
    };
  }
}
