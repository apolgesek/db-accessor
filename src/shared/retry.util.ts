const BASE_BACKOFF_SECONDS = 30;
const MAX_BACKOFF_SECONDS = 1_800;
const HOURS_TO_SECONDS = 3_600;
const MAX_SQS_VISIBILITY_TIMEOUT_SECONDS = 12 * HOURS_TO_SECONDS;
const RATE_LIMIT_JITTER_MIN = 0.7;
const RATE_LIMIT_JITTER_RANGE = 0.6;

export class RateLimitError extends Error {
  constructor(message: string, readonly retryAfterSeconds?: number) {
    super(message);
    this.name = 'RateLimitError';
  }
}

export function getRetryDelaySeconds(receiveCount: number): number {
  return Math.min(BASE_BACKOFF_SECONDS * 2 ** Math.max(receiveCount - 1, 0), MAX_BACKOFF_SECONDS);
}

export function getRateLimitRetryDelaySeconds(
  receiveCount: number,
  retryAfterSeconds?: number,
  random: number = Math.random(),
): number {
  const exponentialDelaySeconds = getRetryDelaySeconds(receiveCount);
  const jitteredDelaySeconds = Math.ceil(
    exponentialDelaySeconds * (RATE_LIMIT_JITTER_MIN + random * RATE_LIMIT_JITTER_RANGE),
  );

  const requestedDelaySeconds = Math.max(retryAfterSeconds ?? 0, jitteredDelaySeconds);

  return Math.min(Math.max(requestedDelaySeconds, BASE_BACKOFF_SECONDS), MAX_SQS_VISIBILITY_TIMEOUT_SECONDS);
}

export function parseRetryAfterSeconds(retryAfter: string | null): number | undefined {
  if (!retryAfter) return undefined;

  const seconds = Number.parseInt(retryAfter, 10);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}
