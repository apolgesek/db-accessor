import { LambdaClient } from '@aws-sdk/client-lambda';
import { PiiDetectorClient, PiiDetectorInvocationError } from './pii-detector-client';

describe('PiiDetectorClient', () => {
  test('chunks requests at the detector item limit and correlates every response', async () => {
    const send = jest.fn(async (command) => {
      const request = JSON.parse(Buffer.from(command.input.Payload).toString('utf8'));
      return {
        Payload: Buffer.from(
          JSON.stringify({
            version: 1,
            results: request.items.map((item: { id: string; path: string }) => ({
              id: item.id,
              path: item.path,
              status: 'NOT_DETECTED',
              detections: [],
            })),
          }),
        ),
      };
    });
    const client = { send } as unknown as LambdaClient;
    const items = Array.from({ length: 1_001 }, (_, index) => ({
      id: String(index),
      path: 'field',
      value: 'not-pii',
    }));

    const results = await new PiiDetectorClient(client, 'pii-detector').detect(items);

    expect(send).toHaveBeenCalledTimes(2);
    expect(results).toHaveLength(1_001);
    expect(results.map((result) => result.id)).toEqual(items.map((item) => item.id));
  });

  test('rejects detector responses that cannot be correlated', async () => {
    const client = {
      send: jest.fn(async () => ({ Payload: Buffer.from(JSON.stringify({ version: 1, results: [] })) })),
    } as unknown as LambdaClient;

    await expect(
      new PiiDetectorClient(client, 'pii-detector').detect([{ id: '1', path: 'email', value: 'a@b.com' }]),
    ).rejects.toBeInstanceOf(PiiDetectorInvocationError);
  });
});
