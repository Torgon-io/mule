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

/** Max number of consecutive 503+Retry-After retries to avoid infinite loops */
const MAX_503_RETRIES = 5;

/**
 * Parse Retry-After header (RFC 7231): delay-seconds or HTTP-date.
 * Returns wait time in milliseconds, or null if missing/invalid.
 */
export function getRetryAfterWaitMs(
  responseHeaders: Headers | Record<string, string> | undefined
): number | null {
  if (responseHeaders == null) return null;
  let value: string | null;
  if (responseHeaders instanceof Headers) {
    value = responseHeaders.get("retry-after");
  } else {
    const key = Object.keys(responseHeaders).find(
      (k) => k.toLowerCase() === "retry-after"
    );
    value = key ? responseHeaders[key] ?? null : null;
  }
  if (value == null || value === "") return null;
  const trimmed = value.trim();
  // Delay in seconds (1*DIGIT)
  const seconds = parseInt(trimmed, 10);
  if (String(seconds) === trimmed && seconds >= 0) {
    return Math.min(seconds * 1000, 24 * 60 * 60 * 1000); // cap at 24h
  }
  // HTTP-date
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return null;
  const waitMs = date - Date.now();
  return waitMs > 0 ? Math.min(waitMs, 24 * 60 * 60 * 1000) : null;
}

/**
 * Run an async fn and on 503 with Retry-After header, wait and retry.
 * Repeats until success or non-503 or no Retry-After (up to MAX_503_RETRIES).
 */
export async function with503Retry<T>(
  fn: () => Promise<T>,
  is503WithRetryAfter: (error: unknown) => number | null
): Promise<T> {
  let attempts = 0;
  for (;;) {
    try {
      return await fn();
    } catch (error) {
      const waitMs = is503WithRetryAfter(error);
      if (waitMs == null || attempts >= MAX_503_RETRIES) throw error;
      attempts++;
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
}
