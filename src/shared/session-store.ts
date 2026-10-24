import { DynamoDBClient, GetItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { SessionRecord } from './session-policy';

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
}
