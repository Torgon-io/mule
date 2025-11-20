import { SQLiteRepository } from "../sqlite-repository.ts";

const repo = new SQLiteRepository();
const PORT = 8080;

// Helper to parse JSON safely
function tryParseJSON(str: string | undefined): unknown {
  if (!str) return null;
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
}

// API Handlers
async function handleProjects(): Promise<Response> {
  const projects = repo.db.prepare(`
    SELECT DISTINCT project_id
    FROM step_executions
    ORDER BY project_id
  `).all<{ project_id: string }>();

  return new Response(JSON.stringify(projects.map((p) => p.project_id)), {
    headers: { "Content-Type": "application/json" },
  });
}

async function handleRuns(projectId: string): Promise<Response> {
  const runs = repo.db.prepare(`
    SELECT
      project_id,
      workflow_id,
      run_id,
      MIN(timestamp) as start_time,
      COUNT(*) as step_count,
      SUM(COALESCE(total_tokens, 0)) as total_tokens,
      SUM(COALESCE(duration_ms, 0)) as total_duration_ms,
      SUM(COALESCE(total_cost_usd, 0)) as total_cost_usd,
      SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as error_count
    FROM step_executions
    WHERE project_id = ?
    GROUP BY project_id, workflow_id, run_id
    ORDER BY start_time DESC
    LIMIT 100
  `).all(projectId);

  return new Response(JSON.stringify(runs), {
    headers: { "Content-Type": "application/json" },
  });
}

async function handleRunDetails(
  projectId: string,
  workflowId: string,
  runId: string,
): Promise<Response> {
  const executions = await repo.getWorkflowRun(projectId, workflowId, runId);

  // Parse JSON fields for better display
  const enriched = executions.map((exec) => ({
    ...exec,
    promptParsed: tryParseJSON(exec.prompt),
    resultParsed: tryParseJSON(exec.result),
  }));

  return new Response(JSON.stringify(enriched), {
    headers: { "Content-Type": "application/json" },
  });
}

// Read HTML file
async function serveHTML(): Promise<Response> {
  try {
    const html = await Deno.readTextFile("./scripts/studio.html");
    return new Response(html, {
      headers: { "Content-Type": "text/html" },
    });
  } catch (error) {
    return new Response(`Error loading studio.html: ${error}`, {
      status: 500,
    });
  }
}

// Router
async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);

  // CORS headers
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // API routes
    if (url.pathname === "/api/projects") {
      const response = await handleProjects();
      Object.entries(corsHeaders).forEach(([k, v]) =>
        response.headers.set(k, v)
      );
      return response;
    }

    if (url.pathname === "/api/runs") {
      const projectId = url.searchParams.get("projectId");
      if (!projectId) {
        return new Response("Missing projectId parameter", { status: 400 });
      }
      const response = await handleRuns(projectId);
      Object.entries(corsHeaders).forEach(([k, v]) =>
        response.headers.set(k, v)
      );
      return response;
    }

    if (url.pathname.startsWith("/api/run/")) {
      // Format: /api/run/:projectId/:workflowId/:runId
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts.length !== 5) {
        return new Response(
          "Invalid format. Use: /api/run/:projectId/:workflowId/:runId",
          { status: 400 },
        );
      }
      const [, , projectId, workflowId, runId] = parts;
      const response = await handleRunDetails(projectId, workflowId, runId);
      Object.entries(corsHeaders).forEach(([k, v]) =>
        response.headers.set(k, v)
      );
      return response;
    }

    // Serve HTML for root
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return await serveHTML();
    }

    return new Response("Not Found", { status: 404 });
  } catch (error) {
    console.error("Request error:", error);
    return new Response(`Server error: ${error}`, { status: 500 });
  }
}

// Start server
console.log(`🚀 Mule Workflow Studio running at http://localhost:${PORT}`);
console.log(`📊 Database: ~/.mule/executions.db`);
console.log(`\n✨ Open http://localhost:${PORT} in your browser\n`);

Deno.serve({ port: PORT }, handleRequest);
