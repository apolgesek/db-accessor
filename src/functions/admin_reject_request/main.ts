import { AttributeValue, DynamoDBClient, GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { APIResponse } from '../../shared/response';
import { requestSchema } from './request-schema';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { EntityRequest } from '../../shared/entity-request';
import { toAppUsername } from '../../shared/username';
import {
  RequestStatusEventPublisher,
  SnsRequestStatusEventPublisher,
} from '../../shared/request-status-event-publisher';
import { SNSClient } from '@aws-sdk/client-sns';

class LambdaHandler {
  constructor(
    private readonly ddbClient: DynamoDBClient,
    private readonly eventPublisher: RequestStatusEventPublisher,
  ) {}

  async handle(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const claims = event.requestContext?.authorizer?.claims ?? {};
    const rawGroups = claims?.['cognito:groups'];
    const groups: string[] = Array.isArray(rawGroups)
      ? rawGroups
      : typeof rawGroups === 'string'
      ? rawGroups.split(',')
      : [];

    if (!groups.includes('ADMIN')) {
      return APIResponse.error(401, 'Unauthorized');
    }

    const body = JSON.parse(event.body || '{}');
    const result = requestSchema.validate(body);

    if (result.error) {
      return APIResponse.error(400, 'Invalid request');
    }

    const getItemCmd = new GetItemCommand({
      TableName: process.env.GRANTS_TABLE_NAME,
      Key: {
        pk: { S: body.pk },
        sk: { S: body.sk },
      },
    });
    const getItemResponse = await this.ddbClient.send(getItemCmd);

    if (!getItemResponse.Item) {
      return APIResponse.error(404, 'Record not found');
    }
    const existingItem = unmarshall(getItemResponse.Item) as EntityRequest;
    const username = toAppUsername(claims.username);
    const rejectedAt = new Date().toISOString();
    const updateItemCmd = new UpdateItemCommand({
      TableName: process.env.GRANTS_TABLE_NAME,
      Key: {
        pk: { S: body.pk },
        sk: { S: body.sk },
      },
      UpdateExpression: `
            SET #status = :status,
                #comment = :comment,
                #rejectedBy = :rejectedBy
            REMOVE #gsiPendingPk, #gsiPendingSk
          `,
      ConditionExpression: '#status = :pendingStatus',
      ExpressionAttributeNames: {
        '#status': 'status',
        '#rejectedBy': 'rejectedBy',
        '#gsiPendingPk': 'gsiPendingPk',
        '#gsiPendingSk': 'gsiPendingSk',
        '#comment': 'comment',
      },
      ExpressionAttributeValues: {
        ':pendingStatus': { S: 'PENDING' },
        ':status': { S: 'REJECTED' },
        ':comment': { S: body.comment || '' },
        ':rejectedBy': {
          M: { username: { S: username }, rejectedAt: { S: rejectedAt }, role: { S: 'ADMIN' } },
        },
      },
    });
    await this.ddbClient.send(updateItemCmd);
    await this.eventPublisher.publish({
      version: 1,
      eventType: 'RequestRejected',
      status: 'REJECTED',
      decidedAt: rejectedAt,
      actor: {
        role: 'ADMIN',
        username,
      },
      request: {
        pk: existingItem.pk,
        sk: existingItem.sk,
        accountId: existingItem.accountId,
        region: existingItem.region,
        table: existingItem.table,
        targetPk: existingItem.targetPk,
        targetSk: existingItem.targetSk,
        reason: existingItem.reason,
        userId: existingItem.userId,
        issueKey: existingItem.issueKey,
        comment: body.comment || '',
      },
      stage: process.env.STAGE,
    });
    const updatedItemResponse = await this.ddbClient.send(getItemCmd);
    const updatedItem = unmarshall(updatedItemResponse.Item as Record<string, AttributeValue>);

    return APIResponse.success(200, updatedItem);
  }
}

const handlerInstance = new LambdaHandler(
  new DynamoDBClient({ region: process.env.AWS_REGION }),
  new SnsRequestStatusEventPublisher(new SNSClient({ region: process.env.AWS_REGION })),
);
export const lambdaHandler = handlerInstance.handle.bind(handlerInstance);
