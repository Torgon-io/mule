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

    // Migrate existing databases by adding cost columns if they don't exist
    this.migrateAddCostColumns();
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
   * Save a step execution to the database
   */
  async save(execution: StepExecution): Promise<void> {
    this.db.prepare(
      `INSERT INTO step_executions (
        project_id, workflow_id, run_id, step_id,
        timestamp, duration_ms,
        model, prompt, result,
        prompt_tokens, completion_tokens, total_tokens, finish_reason,
        prompt_cost_usd, completion_cost_usd, total_cost_usd,
        status, error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      execution.projectId,
      execution.workflowId,
      execution.runId,
      execution.stepId,
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
  }

  /**
   * Get all steps from a specific workflow run
   */
  async getWorkflowRun(
    projectId: string,
    workflowId: string,
    runId: string
  ): Promise<StepExecution[]> {
    const rows = this.db.prepare(
      `SELECT
        project_id, workflow_id, run_id, step_id,
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
  }

  /**
   * Get recent execution history for a project
   */
  async getProjectHistory(
    projectId: string,
    limit: number = 100
  ): Promise<StepExecution[]> {
    const rows = this.db.prepare(
      `SELECT
        project_id, workflow_id, run_id, step_id,
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
