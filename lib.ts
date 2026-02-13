const DEFAULT_STEP_RETRIES = 1;

export function getStepRetries(): number {
  const raw = Deno.env.get("MULE_STEP_RETRIES");
  if (raw === undefined || raw === "") return DEFAULT_STEP_RETRIES;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n) || n < 0) return DEFAULT_STEP_RETRIES;
  return n;
}

/**
 * Returns the max number of steps to run simultaneously when set via
 * MULE_STEP_CONCURRENCY. Returns undefined when unset (no limit).
 */
export function getMaxParallelSteps(): number | undefined {
  const raw = Deno.env.get("MULE_STEP_CONCURRENCY");
  if (raw === undefined || raw === "") return undefined;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n) || n < 1) return undefined;
  return n;
}

/**
 * Run tasks with an optional concurrency limit. When limit is undefined,
 * runs all tasks at once (Promise.all). Otherwise runs at most `limit` at a time.
 */
export async function runWithConcurrencyLimit<T>(
  tasks: (() => Promise<T>)[],
  limit: number | undefined
): Promise<T[]> {
  if (limit === undefined || limit < 1 || tasks.length <= limit) {
    return Promise.all(tasks.map((t) => t()));
  }
  const results: T[] = new Array(tasks.length);
  let index = 0;
  async function runNext(): Promise<void> {
    const i = index++;
    if (i >= tasks.length) return;
    results[i] = await tasks[i]();
    await runNext();
  }
  const workers = Array.from({ length: limit }, () => runNext());
  await Promise.all(workers);
  return results;
}
