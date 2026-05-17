import { AttributeValue, DynamoDBClient, QueryCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { RequestNotification } from '../../shared/request-notification';
import { APIResponse } from '../../shared/response';
import { toAppUsername } from '../../shared/username';

const MAX_NOTIFICATION_IDS = 50;
const NOTIFICATION_HISTORY_MONTHS = 6;
const USER_NOTIFICATION_INDEX_NAME = 'gsiUserNotification';

class LambdaHandler {
  constructor(private readonly ddbClient: DynamoDBClient) {}

  async handle(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const table = process.env.NOTIFICATIONS_TABLE_NAME;
    if (!table) {
      return APIResponse.error(500, 'Missing notifications table configuration');
    }

    const userId = getUserId(event);
    if (!userId) {
      return APIResponse.error(401, 'Invalid token');
    }

    const ids = parseNotificationIds(event);
    if (!ids) {
      return APIResponse.error(400, 'Expected ids to be a non-empty string array');
    }

    const readAt = new Date().toISOString();
    const items = await Promise.all(ids.map((id) => this.markNotificationRead(table, userId, id, readAt)));
    const unreadCount = await this.countUnreadNotifications(table, userId, getNotificationHistoryBoundary());

    return APIResponse.success(200, {
      count: items.filter(Boolean).length,
      unreadCount,
      items: items.filter((item): item is RequestNotification => Boolean(item)),
    });
  }

  private async markNotificationRead(
    table: string,
    userId: string,
    id: string,
    readAt: string,
  ): Promise<RequestNotification | undefined> {
    const notificationKey = await this.findNotificationKey(table, userId, id);
    if (!notificationKey) return undefined;

    const response = await this.ddbClient.send(
      new UpdateItemCommand({
        TableName: table,
        Key: notificationKey,
        UpdateExpression: 'SET #readAt = if_not_exists(#readAt, :readAt)',
        ExpressionAttributeNames: {
          '#readAt': 'readAt',
        },
        ExpressionAttributeValues: {
          ':readAt': { S: readAt },
        },
        ReturnValues: 'ALL_NEW',
      }),
    );

    return response.Attributes ? (unmarshall(response.Attributes) as RequestNotification) : undefined;
  }

  private async findNotificationKey(
    table: string,
    userId: string,
    id: string,
  ): Promise<Record<string, AttributeValue> | undefined> {
    const response = await this.ddbClient.send(
      new QueryCommand({
        TableName: table,
        IndexName: USER_NOTIFICATION_INDEX_NAME,
        KeyConditionExpression: '#userId = :userId AND #id = :id',
        ExpressionAttributeNames: {
          '#userId': 'userId',
          '#id': 'id',
        },
        ExpressionAttributeValues: {
          ':userId': { S: userId },
          ':id': { S: id },
        },
        Limit: 1,
      }),
    );

    const item = response.Items?.[0];
    if (!item?.userId || !item.createdAt) return undefined;

    return {
      userId: item.userId,
      createdAt: item.createdAt,
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
            '#createdAt': 'createdAt',
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

function getUserId(event: APIGatewayProxyEvent): string {
  const claims = event.requestContext?.authorizer?.claims ?? {};
  const username = claims.username;

  return typeof username === 'string' ? toAppUsername(username) : '';
}

function parseNotificationIds(event: APIGatewayProxyEvent): string[] | undefined {
  if (!event.body) return undefined;

  try {
    const body = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
    const parsed = JSON.parse(body) as { notificationIds?: unknown; ids?: unknown };
    const ids = parsed.notificationIds ?? parsed.ids;

    if (!Array.isArray(ids)) return undefined;

    const uniqueIds = Array.from(new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0)));

    return uniqueIds.length > 0 ? uniqueIds.slice(0, MAX_NOTIFICATION_IDS) : undefined;
  } catch {
    return undefined;
  }
}

function getNotificationHistoryBoundary(): string {
  const boundary = new Date();
  boundary.setUTCMonth(boundary.getUTCMonth() - NOTIFICATION_HISTORY_MONTHS);

  return boundary.toISOString();
}

const handlerInstance = new LambdaHandler(new DynamoDBClient({ region: process.env.AWS_REGION }));
export const lambdaHandler = handlerInstance.handle.bind(handlerInstance);
