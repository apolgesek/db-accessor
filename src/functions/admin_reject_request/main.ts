import { AttributeValue, DynamoDBClient, GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { APIResponse } from '../../shared/response';
import { requestSchema } from './request-schema';
import { unmarshall } from '@aws-sdk/util-dynamodb';

class LambdaHandler {
  constructor(private readonly ddbClient: DynamoDBClient) {}

  async handle(event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> {
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
        PK: { S: body.PK },
        SK: { S: body.SK },
      },
    });
    const getItemResponse = await this.ddbClient.send(getItemCmd);

    if (!getItemResponse.Item) {
      return APIResponse.error(404, 'Record not found');
    }

    const username = claims.username.split('db-accessor_')[1];
    const updateItemCmd = new UpdateItemCommand({
      TableName: process.env.GRANTS_TABLE_NAME,
      Key: {
        PK: { S: body.PK },
        SK: { S: body.SK },
      },
      UpdateExpression: `
            SET #status = :status,
                #comment = :comment,
                #rejectedBy = :rejectedBy
            REMOVE #gsi_pending_pk, #gsi_pending_sk
          `,
      ConditionExpression: '#status = :pendingStatus',
      ExpressionAttributeNames: {
        '#status': 'status',
        '#rejectedBy': 'rejectedBy',
        '#gsi_pending_pk': 'GSI_PENDING_PK',
        '#gsi_pending_sk': 'GSI_PENDING_SK',
        '#comment': 'comment',
      },
      ExpressionAttributeValues: {
        ':pendingStatus': { S: 'PENDING' },
        ':status': { S: 'REJECTED' },
        ':comment': { S: body.comment || '' },
        ':rejectedBy': {
          M: { username: { S: username }, rejectedAt: { S: new Date().toISOString() }, role: { S: 'ADMIN' } },
        },
      },
    });
    await this.ddbClient.send(updateItemCmd);
    const updatedItemResponse = await this.ddbClient.send(getItemCmd);
    const updatedItem = unmarshall(updatedItemResponse.Item as Record<string, AttributeValue>);

    return APIResponse.success(200, updatedItem);
  }
}

const handlerInstance = new LambdaHandler(new DynamoDBClient({ region: process.env.AWS_REGION }));
export const lambdaHandler = handlerInstance.handle.bind(handlerInstance);
