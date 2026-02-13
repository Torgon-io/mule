const DEFAULT_STEP_RETRIES = 1;

export function getStepRetries(): number {
  const raw = Deno.env.get("MULE_STEP_RETRIES");
  if (raw === undefined || raw === "") return DEFAULT_STEP_RETRIES;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n) || n < 0) return DEFAULT_STEP_RETRIES;
  return n;
}
