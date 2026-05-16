import { AttributeValue, DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { RequestNotification } from '../../shared/request-notification';
import { APIResponse } from '../../shared/response';
import { toAppUsername } from '../../shared/username';
import { decodePaginationCursor, encodePaginationCursor } from '../../shared/pagination';

const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGE_LIMIT = 50;
const NOTIFICATION_HISTORY_MONTHS = 6;

class LambdaHandler {
  constructor(private readonly ddbClient: DynamoDBClient) {}

  async handle(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const table = process.env.NOTIFICATIONS_TABLE_NAME;
    if (!table) {
      return APIResponse.error(500, 'Missing notifications table configuration');
    }

    const userId = getuserId(event);
    if (!userId) {
      return APIResponse.error(401, 'Invalid token');
    }

    const createdAfter = getNotificationHistoryBoundary();
    const limit = getLimit(event.queryStringParameters?.limit);
    const cursor = event.queryStringParameters?.cursor;
    const exclusiveStartKey = cursor ? decodePaginationCursor(cursor) : undefined;
    if (cursor && !exclusiveStartKey) {
      return APIResponse.error(400, 'Invalid notifications cursor');
    }

    const { items, nextCursor } = await this.listNotifications(table, userId, createdAfter, {
      limit,
      exclusiveStartKey,
    });
    const unreadCount = await this.countUnreadNotifications(table, userId, createdAfter);

    return APIResponse.success(200, {
      count: items.length,
      unreadCount,
      items,
      nextCursor,
    });
  }

  private async listNotifications(
    table: string,
    userId: string,
    createdAfter: string,
    page: {
      limit: number;
      exclusiveStartKey?: Record<string, AttributeValue>;
    },
  ): Promise<{ items: RequestNotification[]; nextCursor?: string }> {
    const items: RequestNotification[] = [];
    let lastEvaluatedKey = page.exclusiveStartKey;

    do {
      const remainingItems = page.limit - items.length;
      const response = await this.ddbClient.send(
        new QueryCommand({
          TableName: table,
          ScanIndexForward: false,
          KeyConditionExpression: '#userId = :userId AND #createdAt >= :createdAfter',
          ExpressionAttributeNames: {
            '#userId': 'userId',
            '#createdAt': 'decidedAt',
          },
          ExpressionAttributeValues: {
            ':userId': { S: userId },
            ':createdAfter': { S: createdAfter },
          },
          ExclusiveStartKey: lastEvaluatedKey,
          Limit: remainingItems,
        }),
      );

      for (const item of response.Items ?? []) {
        items.push(unmarshall(item) as RequestNotification);
      }

      lastEvaluatedKey = response.LastEvaluatedKey;
    } while (lastEvaluatedKey && items.length < page.limit);

    return {
      items,
      nextCursor: lastEvaluatedKey ? encodePaginationCursor(lastEvaluatedKey) : undefined,
    };
  }

  private async countUnreadNotifications(table: string, userId: string, createdAfter: string): Promise<number> {
    let count = 0;
    let lastEvaluatedKey: Record<string, AttributeValue> | undefined;

    do {
      const response = await this.ddbClient.send(
        new QueryCommand({
          TableName: table,
          Select: 'COUNT',
          KeyConditionExpression: '#userId = :userId AND #createdAt >= :createdAfter',
          FilterExpression: 'attribute_not_exists(#readAt)',
          ExpressionAttributeNames: {
            '#userId': 'userId',
            '#createdAt': 'decidedAt',
            '#readAt': 'readAt',
          },
          ExpressionAttributeValues: {
            ':userId': { S: userId },
            ':createdAfter': { S: createdAfter },
          },
          ExclusiveStartKey: lastEvaluatedKey,
        }),
      );

      count += response.Count ?? 0;
      lastEvaluatedKey = response.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    return count;
  }
}

function getuserId(event: APIGatewayProxyEvent): string {
  const claims = event.requestContext?.authorizer?.claims ?? {};
  const username = claims.username;

  return typeof username === 'string' ? toAppUsername(username) : '';
}

function getLimit(value?: string): number {
  if (!value) return DEFAULT_PAGE_LIMIT;

  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1) return DEFAULT_PAGE_LIMIT;

  return Math.min(limit, MAX_PAGE_LIMIT);
}

function getNotificationHistoryBoundary(): string {
  const boundary = new Date();
  boundary.setUTCMonth(boundary.getUTCMonth() - NOTIFICATION_HISTORY_MONTHS);

  return boundary.toISOString();
}

const handlerInstance = new LambdaHandler(new DynamoDBClient({ region: process.env.AWS_REGION }));
export const lambdaHandler = handlerInstance.handle.bind(handlerInstance);
