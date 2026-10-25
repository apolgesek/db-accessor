import { DynamoDBClient, GetItemCommand, PutItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { SessionClaims, SessionRecord } from './session-policy';

// Thrown when the sessions table cannot be read or written; callers map it to 503 SESSION_UNAVAILABLE.
export class SessionUnavailableError extends Error {
  constructor() {
    super('Session store unavailable');
    this.name = 'SessionUnavailableError';
  }
}

export interface SessionStore {
  // Writes the record only if no row exists for its session ID; returns false when one does.
  create(record: SessionRecord): Promise<boolean>;
  // Strongly consistent read.
  get(sessionId: string): Promise<SessionRecord | undefined>;
  // Moves the idle deadline to `idleExpiresAt` and increments the revision, only while the row is bound to these
  // claims, not invalidated, active at `now`, and its deadline is earlier. Returns the updated row, or undefined
  // when the condition fails.
  extend(claims: SessionClaims, now: number, idleExpiresAt: number): Promise<SessionRecord | undefined>;
}

// The client must use `maxAttempts: 1`: an SDK retry would replay a write computed with an old `now`.
export function createSessionStoreClient(): DynamoDBClient {
  return new DynamoDBClient({ region: process.env.AWS_REGION, maxAttempts: 1 });
}

export class DynamoDbSessionStore implements SessionStore {
  constructor(
    private readonly ddbClient: DynamoDBClient,
    private readonly tableName: string,
  ) {}

  async create(record: SessionRecord): Promise<boolean> {
    try {
      await this.ddbClient.send(
        new PutItemCommand({
          TableName: this.tableName,
          Item: marshall(record, { removeUndefinedValues: true }),
          ConditionExpression: 'attribute_not_exists(sessionId)',
        }),
      );
      return true;
    } catch (err) {
      if ((err as { name?: string }).name === 'ConditionalCheckFailedException') return false;
      throw new SessionUnavailableError();
    }
  }

  async get(sessionId: string): Promise<SessionRecord | undefined> {
    try {
      const { Item } = await this.ddbClient.send(
        new GetItemCommand({ TableName: this.tableName, Key: { sessionId: { S: sessionId } }, ConsistentRead: true }),
      );
      return Item ? (unmarshall(Item) as SessionRecord) : undefined;
    } catch {
      throw new SessionUnavailableError();
    }
  }

  async extend(claims: SessionClaims, now: number, idleExpiresAt: number): Promise<SessionRecord | undefined> {
    try {
      const { Attributes } = await this.ddbClient.send(
        new UpdateItemCommand({
          TableName: this.tableName,
          Key: { sessionId: { S: claims.sessionId } },
          UpdateExpression: 'SET idleExpiresAt = :idleExpiresAt ADD revision :one',
          ConditionExpression:
            'ownerSub = :ownerSub AND clientId = :clientId AND attribute_not_exists(invalidatedAt) ' +
            'AND idleExpiresAt > :now AND idleExpiresAt < :idleExpiresAt',
          ExpressionAttributeValues: marshall({
            ':idleExpiresAt': idleExpiresAt,
            ':one': 1,
            ':ownerSub': claims.ownerSub,
            ':clientId': claims.clientId,
            ':now': now,
          }),
          ReturnValues: 'ALL_NEW',
        }),
      );
      return Attributes ? (unmarshall(Attributes) as SessionRecord) : undefined;
    } catch (err) {
      if ((err as { name?: string }).name === 'ConditionalCheckFailedException') return undefined;
      throw new SessionUnavailableError();
    }
  }
}
