/**
 * SQLite implementation of StepExecutionRepository
 */

import { Database } from "jsr:@db/sqlite@0.12";
import type { StepExecution, StepExecutionRepository } from "./persistence.ts";

/**
 * SQLite-based repository for step execution persistence
 * Stores data in ~/.mule/executions.db by default
 */
export class SQLiteRepository implements StepExecutionRepository {
  public db: Database;

  constructor(dbPath: string = "~/.mule/executions.db") {
    // Expand ~ to home directory
    const expandedPath = this.expandPath(dbPath);

    // Create directory if needed
    if (expandedPath !== ":memory:") {
      this.ensureDirectoryExists(expandedPath);
    }

    // Open SQLite connection
    this.db = new Database(expandedPath);

    // Enable WAL mode for better concurrency
    this.db.exec("PRAGMA journal_mode=WAL;");

    // Create table and indexes if they don't exist
    this.initializeDatabase();
  }

  /**
   * Expand ~ to home directory path
   */
  private expandPath(path: string): string {
    if (path === ":memory:") {
      return path;
    }

    if (path.startsWith("~/")) {
      const homeDir = Deno.env.get("HOME") || Deno.env.get("USERPROFILE");
      if (!homeDir) {
        throw new Error("Could not determine home directory");
      }
      return path.replace("~", homeDir);
    }

    return path;
  }

  /**
   * Ensure parent directory exists
   */
  private ensureDirectoryExists(filePath: string): void {
    const pathParts = filePath.split("/");
    const dirPath = pathParts.slice(0, -1).join("/");

    try {
      Deno.mkdirSync(dirPath, { recursive: true });
    } catch (error) {
      // Ignore if directory already exists
      if (!(error instanceof Deno.errors.AlreadyExists)) {
        throw error;
      }
    }
  }

  /**
   * Initialize database schema
   */
  private initializeDatabase(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS step_executions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,

        -- Context
        project_id TEXT NOT NULL,
        workflow_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        step_id TEXT NOT NULL,

        -- Hierarchical execution metadata
        parent_step_id TEXT,
        execution_group TEXT,
        execution_type TEXT,
        depth INTEGER,

        -- Timing
        timestamp TEXT NOT NULL,
        duration_ms INTEGER,

        -- LLM data
        model TEXT,
        prompt TEXT,
        result TEXT,

        -- Usage metrics
        prompt_tokens INTEGER,
        completion_tokens INTEGER,
        total_tokens INTEGER,
        finish_reason TEXT,

        -- Cost metrics (USD)
        prompt_cost_usd REAL,
        completion_cost_usd REAL,
        total_cost_usd REAL,

        -- Status
        status TEXT NOT NULL,
        error TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_project ON step_executions(project_id);
      CREATE INDEX IF NOT EXISTS idx_workflow_run ON step_executions(workflow_id, run_id);
      CREATE INDEX IF NOT EXISTS idx_timestamp ON step_executions(timestamp DESC);
    `);

    // Migrate existing databases first
    this.migrateAddCostColumns();
    this.migrateAddHierarchicalColumns();

    // Create index on execution_group after migration ensures column exists
    try {
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_execution_group ON step_executions(execution_group);`);
    } catch {
      // Index creation failed, likely column doesn't exist yet
    }

    // Create cache table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS llm_response_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        step_execution_id INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(project_id, request_hash),
        FOREIGN KEY (step_execution_id) REFERENCES step_executions(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_cache_lookup ON llm_response_cache(project_id, request_hash);
      CREATE INDEX IF NOT EXISTS idx_cache_project ON llm_response_cache(project_id);
    `);
  }

  /**
   * Add cost columns to existing databases
   */
  private migrateAddCostColumns(): void {
    try {
      this.db.exec(`
        ALTER TABLE step_executions ADD COLUMN prompt_cost_usd REAL;
        ALTER TABLE step_executions ADD COLUMN completion_cost_usd REAL;
        ALTER TABLE step_executions ADD COLUMN total_cost_usd REAL;
      `);
    } catch {
      // Columns already exist, ignore error
    }
  }

  /**
   * Add hierarchical execution columns to existing databases
   */
  private migrateAddHierarchicalColumns(): void {
    try {
      this.db.exec(`
        ALTER TABLE step_executions ADD COLUMN parent_step_id TEXT;
        ALTER TABLE step_executions ADD COLUMN execution_group TEXT;
        ALTER TABLE step_executions ADD COLUMN execution_type TEXT;
        ALTER TABLE step_executions ADD COLUMN depth INTEGER;
      `);
    } catch {
      // Columns already exist, ignore error
    }
  }

  /**
   * Save a step execution to the database
   * Returns the ID of the inserted row, or undefined if the insert failed
   */
  async save(execution: StepExecution): Promise<number | undefined> {
    try {
      this.db.prepare(
        `INSERT INTO step_executions (
          project_id, workflow_id, run_id, step_id,
          parent_step_id, execution_group, execution_type, depth,
          timestamp, duration_ms,
          model, prompt, result,
          prompt_tokens, completion_tokens, total_tokens, finish_reason,
          prompt_cost_usd, completion_cost_usd, total_cost_usd,
          status, error
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        execution.projectId,
        execution.workflowId,
        execution.runId,
        execution.stepId,
        execution.parentStepId ?? null,
        execution.executionGroup ?? null,
        execution.executionType ?? null,
        execution.depth ?? null,
        execution.timestamp,
        execution.durationMs ?? null,
        execution.model ?? null,
        execution.prompt ?? null,
        execution.result ?? null,
        execution.promptTokens ?? null,
        execution.completionTokens ?? null,
        execution.totalTokens ?? null,
        execution.finishReason ?? null,
        execution.promptCostUsd ?? null,
        execution.completionCostUsd ?? null,
        execution.totalCostUsd ?? null,
        execution.status,
        execution.error ?? null
      );
      return this.db.lastInsertRowId;
    } catch (error) {
      // Log warning but don't throw - persistence failures shouldn't block workflow execution
      console.warn(
        `[Mule] Failed to persist step execution for ${execution.stepId}:`,
        error instanceof Error ? error.message : String(error)
      );
      return undefined;
    }
  }

  /**
   * Get all steps from a specific workflow run
   */
  async getWorkflowRun(
    projectId: string,
    workflowId: string,
    runId: string
  ): Promise<StepExecution[]> {
    try {
      const rows = this.db.prepare(
        `SELECT
          project_id, workflow_id, run_id, step_id,
          parent_step_id, execution_group, execution_type, depth,
          timestamp, duration_ms,
          model, prompt, result,
          prompt_tokens, completion_tokens, total_tokens, finish_reason,
          prompt_cost_usd, completion_cost_usd, total_cost_usd,
          status, error
        FROM step_executions
        WHERE project_id = ? AND workflow_id = ? AND run_id = ?
        ORDER BY timestamp ASC`
      ).all(projectId, workflowId, runId) as unknown[];

      return rows.map((row: unknown) => this.rowObjectToStepExecution(row as Record<string, unknown>));
    } catch (error) {
      console.warn(
        `[Mule] Failed to query workflow run (${projectId}/${workflowId}/${runId}):`,
        error instanceof Error ? error.message : String(error)
      );
      return [];
    }
  }

  /**
   * Get recent execution history for a project
   */
  async getProjectHistory(
    projectId: string,
    limit: number = 100
  ): Promise<StepExecution[]> {
    try {
      const rows = this.db.prepare(
        `SELECT
          project_id, workflow_id, run_id, step_id,
          parent_step_id, execution_group, execution_type, depth,
          timestamp, duration_ms,
          model, prompt, result,
          prompt_tokens, completion_tokens, total_tokens, finish_reason,
          prompt_cost_usd, completion_cost_usd, total_cost_usd,
          status, error
        FROM step_executions
        WHERE project_id = ?
        ORDER BY timestamp DESC
        LIMIT ?`
      ).all(projectId, limit) as unknown[];

      return rows.map((row: unknown) => this.rowObjectToStepExecution(row as Record<string, unknown>));
    } catch (error) {
      console.warn(
        `[Mule] Failed to query project history (${projectId}):`,
        error instanceof Error ? error.message : String(error)
      );
      return [];
    }
  }

  /**
   * Get cached LLM response by project ID and request hash
   */
  async getCachedResponse(
    projectId: string,
    requestHash: string
  ): Promise<StepExecution | null> {
    try {
      const cacheRow = this.db.prepare(
        `SELECT step_execution_id FROM llm_response_cache
         WHERE project_id = ? AND request_hash = ?`
      ).get(projectId, requestHash) as { step_execution_id: number } | undefined;

      if (!cacheRow) {
        return null;
      }

      // Fetch the actual execution data
      const executionRow = this.db.prepare(
        `SELECT
          project_id, workflow_id, run_id, step_id,
          parent_step_id, execution_group, execution_type, depth,
          timestamp, duration_ms,
          model, prompt, result,
          prompt_tokens, completion_tokens, total_tokens, finish_reason,
          prompt_cost_usd, completion_cost_usd, total_cost_usd,
          status, error
        FROM step_executions
        WHERE id = ?`
      ).get(cacheRow.step_execution_id) as Record<string, unknown> | undefined;

      if (!executionRow) {
        return null;
      }

      return this.rowObjectToStepExecution(executionRow);
    } catch (error) {
      console.warn(
        `[Mule] Failed to get cached response for ${projectId}/${requestHash}:`,
        error instanceof Error ? error.message : String(error)
      );
      return null;
    }
  }

  /**
   * Store LLM response in cache
   */
  async setCachedResponse(
    projectId: string,
    requestHash: string,
    stepExecutionId: number
  ): Promise<void> {
    try {
      this.db.prepare(
        `INSERT OR IGNORE INTO llm_response_cache (project_id, request_hash, step_execution_id, created_at)
         VALUES (?, ?, ?, ?)`
      ).run(projectId, requestHash, stepExecutionId, new Date().toISOString());
    } catch (error) {
      console.warn(
        `[Mule] Failed to cache response for ${projectId}/${requestHash}:`,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  /**
   * Clear cache for a specific project
   */
  async clearCacheByProjectId(projectId: string): Promise<void> {
    try {
      this.db.prepare(`DELETE FROM llm_response_cache WHERE project_id = ?`).run(projectId);
    } catch (error) {
      console.warn(
        `[Mule] Failed to clear cache for project ${projectId}:`,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  /**
   * Clear all cache entries
   */
  async clearAllCache(): Promise<void> {
    try {
      this.db.prepare(`DELETE FROM llm_response_cache`).run();
    } catch (error) {
      console.warn(
        `[Mule] Failed to clear all cache:`,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
  }

  /**
   * Convert database row object to StepExecution
   */
  private rowObjectToStepExecution(row: Record<string, unknown>): StepExecution {
    return {
      projectId: row.project_id as string,
      workflowId: row.workflow_id as string,
      runId: row.run_id as string,
      stepId: row.step_id as string,
      parentStepId: (row.parent_step_id as string | null) ?? undefined,
      executionGroup: (row.execution_group as string | null) ?? undefined,
      executionType: (row.execution_type as "sequential" | "parallel" | "branch" | null) ?? undefined,
      depth: (row.depth as number | null) ?? undefined,
      timestamp: row.timestamp as string,
      durationMs: (row.duration_ms as number | null) ?? undefined,
      model: (row.model as string | null) ?? undefined,
      prompt: (row.prompt as string | null) ?? undefined,
      result: (row.result as string | null) ?? undefined,
      promptTokens: (row.prompt_tokens as number | null) ?? undefined,
      completionTokens: (row.completion_tokens as number | null) ?? undefined,
      totalTokens: (row.total_tokens as number | null) ?? undefined,
      finishReason: (row.finish_reason as string | null) ?? undefined,
      promptCostUsd: (row.prompt_cost_usd as number | null) ?? undefined,
      completionCostUsd: (row.completion_cost_usd as number | null) ?? undefined,
      totalCostUsd: (row.total_cost_usd as number | null) ?? undefined,
      status: row.status as "success" | "error",
      error: (row.error as string | null) ?? undefined,
    };
  }
}
