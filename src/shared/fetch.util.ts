export type RequestTimeoutOptions = {
  requestTimeoutMs?: number;
};

export async function fetchWithTimeout<T>(
  input: Parameters<typeof fetch>[0],
  init: RequestInit,
  timeoutMs: number,
  handleResponse: (response: Response) => Promise<T>,
): Promise<T> {
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), timeoutMs);

  try {
    const response = await fetch(input, { ...init, signal: abortController.signal });
    return await handleResponse(response);
  } finally {
    clearTimeout(timeout);
  }
}
