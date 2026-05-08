import {
  DeleteItemCommand,
  DynamoDBClient,
  PutItemCommand,
  QueryCommand,
  QueryCommandOutput,
} from '@aws-sdk/client-dynamodb';
import {
  ApiGatewayManagementApiClient,
  GoneException,
  PostToConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi';
import { SQSBatchResponse, SQSEvent, SQSRecord } from 'aws-lambda';
import { getRequestIdFromSk, RequestStatusEvent } from '../../shared/request-status-event';

type RequestNotification = {
  id: string;
  userId: string;
  status: 'APPROVED' | 'REJECTED';
  requestId: string;
  requestPK: string;
  requestSK: string;
  accountId: string;
  region: string;
  table: string;
  targetPK: string;
  targetSK?: string;
  reason: string;
  comment?: string | null;
  decidedAt: string;
  actorUsername: string;
};

class DynamoDbNotificationStore {
  constructor(
    private readonly ddbClient: DynamoDBClient,
    private readonly notificationsTableName = process.env.NOTIFICATIONS_TABLE_NAME,
    private readonly connectionsTableName = process.env.WEBSOCKET_CONNECTIONS_TABLE_NAME,
  ) {}

  async save(notification: RequestNotification): Promise<void> {
    if (!this.notificationsTableName) throw new Error('NOTIFICATIONS_TABLE_NAME is not configured');

    await this.ddbClient.send(
      new PutItemCommand({
        TableName: this.notificationsTableName,
        Item: {
          UserId: { S: notification.userId },
          CreatedAt: { S: notification.decidedAt },
          NotificationId: { S: notification.id },
          Type: { S: 'REQUEST_STATUS_CHANGED' },
          Status: { S: notification.status },
          RequestId: { S: notification.requestId },
          RequestPK: { S: notification.requestPK },
          RequestSK: { S: notification.requestSK },
          AccountId: { S: notification.accountId },
          Region: { S: notification.region },
          TableName: { S: notification.table },
          TargetPK: { S: notification.targetPK },
          TargetSK: { S: notification.targetSK ?? '' },
          Reason: { S: notification.reason },
          Comment: { S: notification.comment ?? '' },
          ActorUsername: { S: notification.actorUsername },
          Read: { BOOL: false },
        },
      }),
    );
  }

  async listConnectionIds(userId: string): Promise<string[]> {
    if (!this.connectionsTableName) throw new Error('WEBSOCKET_CONNECTIONS_TABLE_NAME is not configured');

    const response = await this.ddbClient.send(
      new QueryCommand({
        TableName: this.connectionsTableName,
        IndexName: 'GSI_USER_ID',
        KeyConditionExpression: '#userId = :userId',
        ExpressionAttributeNames: {
          '#userId': 'UserId',
        },
        ExpressionAttributeValues: {
          ':userId': { S: userId },
        },
      }),
    );

    return readConnectionIds(response);
  }

  async deleteConnection(connectionId: string): Promise<void> {
    if (!this.connectionsTableName) throw new Error('WEBSOCKET_CONNECTIONS_TABLE_NAME is not configured');

    await this.ddbClient.send(
      new DeleteItemCommand({
        TableName: this.connectionsTableName,
        Key: {
          ConnectionId: { S: connectionId },
        },
      }),
    );
  }
}

class WebSocketNotifier {
  constructor(private readonly client: ApiGatewayManagementApiClient) {}

  async send(connectionId: string, notification: RequestNotification): Promise<void> {
    await this.client.send(
      new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: Buffer.from(
          JSON.stringify({
            type: 'REQUEST_STATUS_CHANGED',
            notification,
          }),
        ),
      }),
    );
  }
}

class LambdaHandler {
  constructor(
    private readonly store: DynamoDbNotificationStore,
    private readonly websocketNotifier: WebSocketNotifier,
  ) {}

  async handle(event: SQSEvent): Promise<SQSBatchResponse> {
    const batchItemFailures: SQSBatchResponse['batchItemFailures'] = [];

    for (const record of event.Records) {
      try {
        await this.processRecord(record);
      } catch (error) {
        console.warn('Failed to process request status notification event', {
          messageId: record.messageId,
          error: error instanceof Error ? error.message : String(error),
        });
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    }

    return { batchItemFailures };
  }

  private async processRecord(record: SQSRecord): Promise<void> {
    const event = parseRequestStatusEvent(record.body);
    const requestId = getRequestIdFromSk(event.request.SK);
    const notification: RequestNotification = {
      id: `${event.decidedAt}#${requestId}`,
      userId: event.request.userId,
      status: event.status,
      requestId,
      requestPK: event.request.PK,
      requestSK: event.request.SK,
      accountId: event.request.accountId,
      region: event.request.region,
      table: event.request.table,
      targetPK: event.request.targetPK,
      targetSK: event.request.targetSK,
      reason: event.request.reason,
      comment: event.request.comment,
      decidedAt: event.decidedAt,
      actorUsername: event.actor.username,
    };

    await this.store.save(notification);

    // WebSocket pushes are disabled for now. Notifications are still persisted above.
    // const connectionIds = await this.store.listConnectionIds(event.request.userId);
    // await Promise.all(connectionIds.map((connectionId) => this.sendToConnection(connectionId, notification)));
  }

  private async sendToConnection(connectionId: string, notification: RequestNotification): Promise<void> {
    try {
      await this.websocketNotifier.send(connectionId, notification);
    } catch (error) {
      if (error instanceof GoneException) {
        await this.store.deleteConnection(connectionId);
        return;
      }

      throw error;
    }
  }
}

function parseRequestStatusEvent(body: string): RequestStatusEvent {
  const parsed = JSON.parse(body) as RequestStatusEvent;

  if (
    parsed.version !== 1 ||
    (parsed.eventType !== 'RequestApproved' && parsed.eventType !== 'RequestRejected') ||
    (parsed.status !== 'APPROVED' && parsed.status !== 'REJECTED')
  ) {
    throw new Error('Unsupported request status event');
  }

  return parsed;
}

function readConnectionIds(response: QueryCommandOutput): string[] {
  return (
    response.Items?.map((item) => item.ConnectionId?.S).filter((connectionId): connectionId is string =>
      Boolean(connectionId),
    ) ?? []
  );
}

const handlerInstance = new LambdaHandler(
  new DynamoDbNotificationStore(new DynamoDBClient({ region: process.env.AWS_REGION })),
  new WebSocketNotifier(
    new ApiGatewayManagementApiClient({
      region: process.env.AWS_REGION,
      endpoint: process.env.WEBSOCKET_ENDPOINT,
    }),
  ),
);
export const lambdaHandler = handlerInstance.handle.bind(handlerInstance);
