import { AttributeValue, DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { RequestNotification, RequestNotificationEntity } from '../../shared/request-notification';
import { APIResponse } from '../../shared/response';
import { toAppUsername } from '../../shared/username';

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

    const items = await this.listNotifications(tableName, userId);

    return APIResponse.success(200, {
      count: items.length,
      items,
    });
  }

  private async listNotifications(tableName: string, userId: string): Promise<RequestNotification[]> {
    const items: RequestNotification[] = [];
    let lastEvaluatedKey: Record<string, AttributeValue> | undefined;

    do {
      const response = await this.ddbClient.send(
        new QueryCommand({
          TableName: tableName,
          ScanIndexForward: false,
          KeyConditionExpression: '#userId = :userId',
          ExpressionAttributeNames: {
            '#userId': 'UserId',
          },
          ExpressionAttributeValues: {
            ':userId': { S: userId },
          },
          ExclusiveStartKey: lastEvaluatedKey,
        }),
      );

      for (const item of response.Items ?? []) {
        items.push(toRequestNotification(unmarshall(item) as RequestNotificationEntity));
      }

      lastEvaluatedKey = response.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    return items;
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
    read: item.Read,
  };
}

const handlerInstance = new LambdaHandler(new DynamoDBClient({ region: process.env.AWS_REGION }));
export const lambdaHandler = handlerInstance.handle.bind(handlerInstance);
