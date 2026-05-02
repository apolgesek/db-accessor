import { fetchWithTimeout } from './fetch.util';

describe('fetch utilities', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  test('aborts fetch after the configured timeout', async () => {
    jest.useFakeTimers();
    jest.spyOn(global, 'fetch').mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          (init?.signal as AbortSignal).addEventListener('abort', () => reject(new Error('Aborted')));
        }) as Promise<Response>,
    );

    const promise = fetchWithTimeout('https://example.com', { method: 'POST' }, 3_000, async (response) => response);
    await Promise.resolve();
    jest.advanceTimersByTime(3_000);

    await expect(promise).rejects.toThrow('Aborted');
  });

  test('keeps the timeout active while the response body is consumed', async () => {
    jest.useFakeTimers();
    jest.spyOn(global, 'fetch').mockImplementation((_url, init) =>
      Promise.resolve({
        text: jest.fn(
          () =>
            new Promise((_resolve, reject) => {
              (init?.signal as AbortSignal).addEventListener('abort', () => reject(new Error('Aborted')));
            }),
        ),
      } as unknown as Response),
    );

    const promise = fetchWithTimeout('https://example.com', { method: 'POST' }, 3_000, async (response) =>
      response.text(),
    );
    await Promise.resolve();
    jest.advanceTimersByTime(3_000);

    await expect(promise).rejects.toThrow('Aborted');
  });
});
