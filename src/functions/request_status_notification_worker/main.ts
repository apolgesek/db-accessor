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
import { RequestNotification } from '../../shared/request-notification';
import { getRequestIdFromSk, RequestStatusEvent } from '../../shared/request-status-event';

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
          id: { S: notification.id },
          userId: { S: notification.userId },
          type: { S: 'REQUEST_STATUS_CHANGED' },
          status: { S: notification.status },
          requestId: { S: notification.requestId },
          requestPk: { S: notification.requestPk },
          requestSk: { S: notification.requestSk },
          accountId: { S: notification.accountId },
          region: { S: notification.region },
          table: { S: notification.table },
          targetPk: { S: notification.targetPk },
          targetSk: { S: notification.targetSk ?? '' },
          reason: { S: notification.reason },
          comment: { S: notification.comment ?? '' },
          decidedAt: { S: notification.decidedAt },
          actorUsername: { S: notification.actorUsername },
        },
      }),
    );
  }

  async listConnectionIds(userId: string): Promise<string[]> {
    if (!this.connectionsTableName) throw new Error('WEBSOCKET_CONNECTIONS_TABLE_NAME is not configured');

    const response = await this.ddbClient.send(
      new QueryCommand({
        TableName: this.connectionsTableName,
        IndexName: 'gsiUserId',
        KeyConditionExpression: '#userId = :userId',
        ExpressionAttributeNames: {
          '#userId': 'userId',
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
          connectionId: { S: connectionId },
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
    const requestId = getRequestIdFromSk(event.request.sk);
    const notification: RequestNotification = {
      type: 'REQUEST_STATUS_CHANGED',
      id: `${event.decidedAt}#${requestId}`,
      userId: event.request.userId,
      status: event.status,
      requestId,
      requestPk: event.request.pk,
      requestSk: event.request.sk,
      accountId: event.request.accountId,
      region: event.request.region,
      table: event.request.table,
      targetPk: event.request.targetPk,
      targetSk: event.request.targetSk,
      reason: event.request.reason,
      comment: event.request.comment,
      decidedAt: event.decidedAt,
      actorUsername: event.actor.username,
    };

    await this.store.save(notification);

    const connectionIds = await this.store.listConnectionIds(event.request.userId);
    await Promise.all(connectionIds.map((connectionId) => this.sendToConnection(connectionId, notification)));
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
    response.Items?.map((item) => item.connectionId?.S).filter((connectionId): connectionId is string =>
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
