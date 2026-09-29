import { LambdaClient } from '@aws-sdk/client-lambda';
import { LambdaHandler } from '../pii_detector/main';
import { PiiDetectorClient, PiiDetectorInvocationError } from './pii-detector-client';

const validResult = () => ({
  id: '1',
  path: 'email',
  status: 'DETECTED',
  detections: [
    {
      entityType: 'EMAIL_ADDRESS',
      confidence: 0.99,
      evidence: [{ source: 'VALUE_VALIDATOR', ruleId: 'email', confidence: 0.99 }],
    },
  ],
});

describe('PiiDetectorClient', () => {
  test('chunks requests at the detector item limit and correlates every response', async () => {
    const handler = new LambdaHandler(undefined, { info: jest.fn() });
    const send = jest.fn(async (command) => {
      const request = JSON.parse(Buffer.from(command.input.Payload).toString('utf8'));
      return {
        Payload: Buffer.from(JSON.stringify(await handler.handle(request))),
      };
    });
    const client = { send } as unknown as LambdaClient;
    const items = Array.from({ length: 1_001 }, (_, index) => ({
      id: String(index),
      path: 'email',
      value: 'private@example.com',
    }));

    const results = await new PiiDetectorClient(client, 'pii-detector').detect(items);

    expect(send).toHaveBeenCalledTimes(2);
    expect(results).toHaveLength(1_001);
    expect(results.map((result) => result.id)).toEqual(items.map((item) => item.id));
    expect(results.every((result) => result.status === 'DETECTED')).toBe(true);
    expect(JSON.stringify(results)).not.toContain('private@example.com');
  });

  test.each([
    null,
    false,
    1,
    'invalid',
    [],
    {},
    { version: 2, results: [validResult()] },
    { version: '1', results: [validResult()] },
    { version: 1, results: null },
    { version: 1, results: [] },
    { version: 1, results: [null] },
    { version: 1, results: [{}] },
    { version: 1, results: [{ ...validResult(), id: 'wrong-id' }] },
    { version: 1, results: [{ ...validResult(), path: 'wrong-path' }] },
  ])('rejects invalid response envelopes or mismatched results %#', async (payload) => {
    const client = {
      send: jest.fn(async () => ({ Payload: Buffer.from(JSON.stringify(payload)) })),
    } as unknown as LambdaClient;

    await expect(
      new PiiDetectorClient(client, 'pii-detector').detect([{ id: '1', path: 'email', value: 'a@b.com' }]),
    ).rejects.toBeInstanceOf(PiiDetectorInvocationError);
  });

  test.each([
    {},
    { FunctionError: 'Unhandled', Payload: Buffer.from('{"errorMessage":"private-value"}') },
    { Payload: Buffer.from('') },
    { Payload: Buffer.from('invalid-json-private-value') },
  ])(
    'rejects missing, errored or unparseable invocation response %# without exposing its payload',
    async (response) => {
      const client = { send: jest.fn(async () => response) } as unknown as LambdaClient;

      await expect(
        new PiiDetectorClient(client, 'pii-detector').detect([{ id: '1', path: 'email', value: 'private-value' }]),
      ).rejects.toEqual(new PiiDetectorInvocationError());
    },
  );

  test('accepts negative and unsupported-path responses', async () => {
    const handler = new LambdaHandler(undefined, { info: jest.fn() });
    const client = {
      send: jest.fn(async (command) => ({
        Payload: Buffer.from(
          JSON.stringify(await handler.handle(JSON.parse(Buffer.from(command.input.Payload).toString('utf8')))),
        ),
      })),
    } as unknown as LambdaClient;

    const results = await new PiiDetectorClient(client, 'pii-detector').detect([
      { id: '1', path: 'field', value: 'not-pii' },
      { id: '2', path: '', value: 'not-pii' },
    ]);

    expect(results.map((result) => result.status)).toEqual(['NOT_DETECTED', 'UNSUPPORTED_PATH']);
  });
});
