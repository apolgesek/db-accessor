import { AttributeValue, DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { RequestNotification, RequestNotificationEntity } from '../../shared/request-notification';
import { APIResponse } from '../../shared/response';
import { toAppUsername } from '../../shared/username';
import { decodePaginationCursor, encodePaginationCursor } from '../../shared/pagination';

const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGE_LIMIT = 50;
const NOTIFICATION_HISTORY_MONTHS = 6;

class LambdaHandler {
  constructor(private readonly ddbClient: DynamoDBClient) {}

  async handle(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const tableName = process.env.NOTIFICATIONS_TABLE_NAME;
    if (!tableName) {
      return APIResponse.error(500, 'Missing notifications table configuration');
    }

    const userId = getUserId(event);
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

    const { items, nextCursor } = await this.listNotifications(tableName, userId, createdAfter, {
      limit,
      exclusiveStartKey,
    });
    const unreadCount = await this.countUnreadNotifications(tableName, userId, createdAfter);

    return APIResponse.success(200, {
      count: items.length,
      unreadCount,
      items,
      nextCursor,
    });
  }

  private async listNotifications(
    tableName: string,
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
          TableName: tableName,
          ScanIndexForward: false,
          KeyConditionExpression: '#userId = :userId AND #createdAt >= :createdAfter',
          ExpressionAttributeNames: {
            '#userId': 'UserId',
            '#createdAt': 'CreatedAt',
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
        items.push(toRequestNotification(unmarshall(item) as RequestNotificationEntity));
      }

      lastEvaluatedKey = response.LastEvaluatedKey;
    } while (lastEvaluatedKey && items.length < page.limit);

    return {
      items,
      nextCursor: lastEvaluatedKey ? encodePaginationCursor(lastEvaluatedKey) : undefined,
    };
  }

  private async countUnreadNotifications(tableName: string, userId: string, createdAfter: string): Promise<number> {
    let count = 0;
    let lastEvaluatedKey: Record<string, AttributeValue> | undefined;

    do {
      const response = await this.ddbClient.send(
        new QueryCommand({
          TableName: tableName,
          Select: 'COUNT',
          KeyConditionExpression: '#userId = :userId AND #createdAt >= :createdAfter',
          FilterExpression: 'attribute_not_exists(#readAt)',
          ExpressionAttributeNames: {
            '#userId': 'UserId',
            '#createdAt': 'CreatedAt',
            '#readAt': 'ReadAt',
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

function getUserId(event: APIGatewayProxyEvent): string {
  const claims = event.requestContext?.authorizer?.claims ?? {};
  const username = claims.username;

  return typeof username === 'string' ? toAppUsername(username) : '';
}

function toRequestNotification(item: RequestNotificationEntity): RequestNotification {
  return {
    id: item.NotificationId,
    userId: item.UserId,
    status: item.Status,
    requestId: item.RequestId,
    requestPK: item.RequestPK,
    requestSK: item.RequestSK,
    accountId: item.AccountId,
    region: item.Region,
    table: item.TableName,
    targetPK: item.TargetPK,
    targetSK: item.TargetSK || undefined,
    reason: item.Reason,
    comment: item.Comment || undefined,
    decidedAt: item.CreatedAt,
    actorUsername: item.ActorUsername,
    readAt: item.ReadAt,
  };
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
