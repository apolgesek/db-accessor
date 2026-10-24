import {
  ConditionalCheckFailedException,
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
} from '@aws-sdk/client-dynamodb';
import { SessionRecord } from './session-policy';
import { DynamoDbSessionStore, SessionUnavailableError } from './session-store';

const record: SessionRecord = {
  sessionId: 'lineage-1',
  ownerSub: 'sub-1',
  clientId: 'web-client',
  userId: 'user-1',
  createdAt: 1_800_000_000_000,
  idleExpiresAt: 1_800_000_900_000,
  revision: 1,
  ttl: 1_800_130_500,
};

describe('DynamoDB session store', () => {
  let send: jest.Mock;
  let store: DynamoDbSessionStore;

  beforeEach(() => {
    send = jest.fn();
    store = new DynamoDbSessionStore({ send } as unknown as DynamoDBClient, 'sessions');
  });

  test('creates a row only when its session ID has none', async () => {
    send.mockResolvedValue({});

    await expect(store.create(record)).resolves.toBe(true);

    const command = send.mock.calls[0][0];
    expect(command).toBeInstanceOf(PutItemCommand);
    expect(command.input).toMatchObject({
      TableName: 'sessions',
      ConditionExpression: 'attribute_not_exists(sessionId)',
      Item: { sessionId: { S: 'lineage-1' }, idleExpiresAt: { N: '1800000900000' }, ttl: { N: '1800130500' } },
    });
  });

  test('reports an existing row as not created', async () => {
    send.mockRejectedValue(new ConditionalCheckFailedException({ message: 'exists', $metadata: {} }));

    await expect(store.create(record)).resolves.toBe(false);
  });

  test('reads with strong consistency', async () => {
    send.mockResolvedValue({
      Item: {
        sessionId: { S: 'lineage-1' },
        ownerSub: { S: 'sub-1' },
        clientId: { S: 'web-client' },
        userId: { S: 'user-1' },
        createdAt: { N: '1800000000000' },
        idleExpiresAt: { N: '1800000900000' },
        revision: { N: '1' },
        ttl: { N: '1800130500' },
      },
    });

    await expect(store.get('lineage-1')).resolves.toEqual(record);

    const command = send.mock.calls[0][0];
    expect(command).toBeInstanceOf(GetItemCommand);
    expect(command.input).toEqual({
      TableName: 'sessions',
      Key: { sessionId: { S: 'lineage-1' } },
      ConsistentRead: true,
    });
  });

  test('returns nothing for a lineage without a row', async () => {
    send.mockResolvedValue({});

    await expect(store.get('lineage-1')).resolves.toBeUndefined();
  });

  test.each([
    ['create', () => store.create(record)],
    ['get', () => store.get('lineage-1')],
  ])('turns any other %s failure into SessionUnavailableError', async (_, call) => {
    send.mockRejectedValue(Object.assign(new Error('throttled'), { name: 'ProvisionedThroughputExceededException' }));

    await expect(call()).rejects.toBeInstanceOf(SessionUnavailableError);
  });
});
