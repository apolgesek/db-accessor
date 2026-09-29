import { DetectPiiRequest } from '../../shared/pii-detection';
import { LambdaHandler, lambdaHandler } from './main';
import { InvalidDetectPiiRequestError } from './request-validator';

const validRequest = (): DetectPiiRequest => ({
  version: 1,
  items: [{ id: 'one', path: 'profile.email', value: 'private@example.com' }],
});

describe('PII detector Lambda handler', () => {
  test('exported entrypoint returns a Promise resolving to the response for the Lambda runtime', async () => {
    const info = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      const response = lambdaHandler({ version: 1, items: [] });

      expect(response).toBeInstanceOf(Promise);
      await expect(response).resolves.toEqual({ version: 1, results: [] });
    } finally {
      info.mockRestore();
    }
  });

  test.each([
    undefined,
    null,
    {},
    { version: 2, items: [] },
    { version: 1, items: 'invalid' },
    { version: 1, items: [{ id: 'one', path: 'email' }] },
    { version: 1, items: [{ id: 'one', path: 'email', value: true }] },
    { version: 1, items: [{ id: 'one', path: 'email', value: Number.POSITIVE_INFINITY }] },
    { version: 1, items: [{ id: 'one', path: 'email', value: Number.NaN }] },
    { version: 1, items: [{ id: '', path: 'email', value: 'x' }] },
    { version: 1, items: [{ id: 'one', path: 'email', value: 'x', extra: true }] },
    { version: 1, items: [], extra: true },
  ])('rejects malformed envelope %#', async (event) => {
    await expect(new LambdaHandler().handle(event)).rejects.toThrow(InvalidDetectPiiRequestError);
  });

  test('rejects duplicate IDs', async () => {
    const event = validRequest();
    event.items.push({ id: 'one', path: 'profile.phone', value: '+44 20 7946 0018' });
    await expect(new LambdaHandler().handle(event)).rejects.toThrow(InvalidDetectPiiRequestError);
  });

  test.each([
    { id: 'x'.repeat(129), path: 'email', value: 'x' },
    { id: 'one', path: 'x'.repeat(513), value: 'x' },
    { id: 'one', path: 'email', value: 'ą'.repeat(8193) },
  ])('rejects an oversized item %#', async (item) => {
    await expect(new LambdaHandler().handle({ version: 1, items: [item] })).rejects.toThrow(
      InvalidDetectPiiRequestError,
    );
  });

  test('rejects more than 1,000 items', async () => {
    const items = Array.from({ length: 1_001 }, (_, index) => ({ id: String(index), path: 'value', value: 'x' }));
    await expect(new LambdaHandler().handle({ version: 1, items })).rejects.toThrow(InvalidDetectPiiRequestError);
  });

  test('accepts documented limits', async () => {
    const item = { id: 'x'.repeat(128), path: 'x'.repeat(512), value: 'x'.repeat(16 * 1024) };
    expect((await new LambdaHandler().handle({ version: 1, items: [item] })).results).toHaveLength(1);
  });

  test('logs counts and timing without logging values', async () => {
    const info = jest.fn();
    const now = jest.fn().mockReturnValueOnce(100).mockReturnValueOnce(107);
    const handler = new LambdaHandler(undefined, { info }, now);
    const event = validRequest();
    event.items.push({ id: 'two', path: 'broken..path', value: 'do-not-log-this' });
    event.items.push({ id: 'three', path: 'profile.note', value: 'ordinary' });

    await handler.handle(event);

    expect(info).toHaveBeenCalledWith('PII detection completed', {
      inputCount: 3,
      detectedCount: 1,
      unsupportedCount: 1,
      durationMs: 7,
    });
    expect(JSON.stringify(info.mock.calls)).not.toContain('do-not-log-this');
    expect(JSON.stringify(info.mock.calls)).not.toContain('private@example.com');
  });
});
