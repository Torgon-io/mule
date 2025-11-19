#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-ffi --allow-net --unstable-ffi
/**
 * Clean up old execution records from the database
 *
 * Usage:
 *   deno task cleanup --days 30           # Delete records older than 30 days
 *   deno task cleanup --project my-project --days 7  # Project-specific cleanup
 */

import { SQLiteRepository } from "../sqlite-repository.ts";
import { parseArgs } from "https://deno.land/std@0.208.0/cli/parse_args.ts";

const args = parseArgs(Deno.args, {
  string: ["project", "db"],
  number: ["days"],
  boolean: ["dry-run"],
  default: {
    db: "~/.mule/executions.db",
    "dry-run": false,
  },
});

if (!args.days) {
  console.error("Error: --days is required");
  console.log("\nUsage:");
  console.log("  deno task cleanup --days 30");
  console.log("  deno task cleanup --project my-project --days 7");
  console.log("  deno task cleanup --days 30 --dry-run  # Preview only");
  Deno.exit(1);
}

const repo = new SQLiteRepository(args.db);

try {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - args.days);
  const cutoffISO = cutoffDate.toISOString();

  console.log(`\n🗑️  Cleanup Execution Records\n`);
  console.log(`Database: ${args.db}`);
  console.log(`Cutoff Date: ${cutoffISO} (${args.days} days ago)`);
  if (args.project) console.log(`Project: ${args.project}`);
  if (args["dry-run"]) console.log(`Mode: DRY RUN (no changes will be made)`);
  console.log();

  // Build SQL query
  let sql = `SELECT COUNT(*) as count FROM step_executions WHERE timestamp < ?`;
  const params: (string | number)[] = [cutoffISO];

  if (args.project) {
    sql += ` AND project_id = ?`;
    params.push(args.project);
  }

  // Count records to delete
  const countResult = repo.db.prepare(sql).get(...params) as { count: number } | undefined;
  const count = countResult?.count || 0;

  if (count === 0) {
    console.log("No records found to delete.");
    repo.close();
    Deno.exit(0);
  }

  console.log(`Found ${count} record(s) to delete.`);

  if (args["dry-run"]) {
    console.log("\n✓ Dry run complete. No records were deleted.");
  } else {
    // Confirm deletion
    console.log("\n⚠️  This action cannot be undone!");
    const confirmation = prompt("Type 'yes' to confirm deletion: ");

    if (confirmation?.toLowerCase() !== "yes") {
      console.log("Deletion cancelled.");
      repo.close();
      Deno.exit(0);
    }

    // Perform deletion
    let deleteSql = `DELETE FROM step_executions WHERE timestamp < ?`;
    const deleteParams: (string | number)[] = [cutoffISO];

    if (args.project) {
      deleteSql += ` AND project_id = ?`;
      deleteParams.push(args.project);
    }

    repo.db.prepare(deleteSql).run(...deleteParams);

    console.log(`\n✅ Deleted ${count} record(s).`);
  }
} catch (error) {
  console.error("Error:", error.message);
  Deno.exit(1);
} finally {
  repo.close();
}
