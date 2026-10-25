import {
  ConditionalCheckFailedException,
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import { SessionClaims, SessionRecord } from './session-policy';
import { createSessionStoreClient, DynamoDbSessionStore, SessionUnavailableError } from './session-store';

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

const claims: SessionClaims = { sessionId: 'lineage-1', ownerSub: 'sub-1', clientId: 'web-client', userId: 'user-1' };

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

  test('extends only an active, bound session whose deadline is earlier, in one conditional write', async () => {
    send.mockResolvedValue({
      Attributes: {
        sessionId: { S: 'lineage-1' },
        ownerSub: { S: 'sub-1' },
        clientId: { S: 'web-client' },
        userId: { S: 'user-1' },
        createdAt: { N: '1800000000000' },
        idleExpiresAt: { N: '1800000960000' },
        revision: { N: '2' },
        ttl: { N: '1800130500' },
      },
    });

    await expect(store.extend(claims, 1_800_000_060_000, 1_800_000_960_000)).resolves.toEqual({
      ...record,
      idleExpiresAt: 1_800_000_960_000,
      revision: 2,
    });

    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0][0];
    expect(command).toBeInstanceOf(UpdateItemCommand);
    expect(command.input).toEqual({
      TableName: 'sessions',
      Key: { sessionId: { S: 'lineage-1' } },
      UpdateExpression: 'SET idleExpiresAt = :idleExpiresAt ADD revision :one',
      ConditionExpression:
        'ownerSub = :ownerSub AND clientId = :clientId AND attribute_not_exists(invalidatedAt) ' +
        'AND idleExpiresAt > :now AND idleExpiresAt < :idleExpiresAt',
      ExpressionAttributeValues: {
        ':idleExpiresAt': { N: '1800000960000' },
        ':one': { N: '1' },
        ':ownerSub': { S: 'sub-1' },
        ':clientId': { S: 'web-client' },
        ':now': { N: '1800000060000' },
      },
      ReturnValues: 'ALL_NEW',
    });
  });

  test.each([
    [
      'a refused extension',
      () => send.mockRejectedValue(new ConditionalCheckFailedException({ message: 'refused', $metadata: {} })),
    ],
    ['a write that returns no row', () => send.mockResolvedValue({})],
  ])('reports %s as nothing extended', async (_, respond) => {
    respond();

    await expect(store.extend(claims, 1_800_000_060_000, 1_800_000_960_000)).resolves.toBeUndefined();
  });

  test('sends each timestamped write with a single SDK attempt', async () => {
    await expect(createSessionStoreClient().config.maxAttempts()).resolves.toBe(1);
  });

  test.each([
    ['create', () => store.create(record)],
    ['get', () => store.get('lineage-1')],
    ['extend', () => store.extend(claims, 1_800_000_060_000, 1_800_000_960_000)],
  ])('turns any other %s failure into SessionUnavailableError', async (_, call) => {
    send.mockRejectedValue(Object.assign(new Error('throttled'), { name: 'ProvisionedThroughputExceededException' }));

    await expect(call()).rejects.toBeInstanceOf(SessionUnavailableError);
  });
});
