/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { APIResponse } from '../../shared/response';
import { requestSchema } from './request-schema';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

class LambdaHandler {
  constructor(private readonly ddbClient: DynamoDBClient) {}

  async handle(event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> {
    const body = JSON.parse(event.body || '{}');
    const result = requestSchema.validate(body);

    if (result.error) {
      return APIResponse.error(400, 'Invalid request');
    }

    const claims = event.requestContext?.authorizer?.claims ?? {};
    const username = claims.username.split('db-accessor_')[1];
    const decodedRequestId = atob(event.pathParameters?.id ?? '');
    const rootRequest = await this.ddbClient.send(
      new GetItemCommand({
        TableName: process.env.GRANTS_TABLE_NAME,
        Key: {
          PK: { S: `USER#${username}` },
          SK: { S: decodedRequestId },
        },
      }),
    );

    if (!rootRequest.Item) {
      return APIResponse.error(404, 'Root request not found');
    }

    const createdAt = new Date().toISOString();
    const unredactRequests = rootRequest.Item.unredactRequests ? unmarshall(rootRequest.Item.unredactRequests) : [];
    const requestId = `UNREDACT#${createdAt}`;
    unredactRequests.push({
      requestId,
      createdAt,
      reason: result.value.reason,
      paths: result.value.paths,
      approvalRequired: false, // for now we are not doing approvals for unredact requests, but keeping the field for future use
      approvedBy: [],
    });

    await this.ddbClient.send(
      new UpdateItemCommand({
        TableName: process.env.GRANTS_TABLE_NAME,
        Key: {
          PK: { S: `USER#${username}` },
          SK: { S: decodedRequestId },
        },
        UpdateExpression: 'SET #unredactRequests = :unredactRequests',
        ExpressionAttributeNames: {
          '#unredactRequests': 'unredactRequests',
        },
        ExpressionAttributeValues: {
          ':unredactRequests': { L: unredactRequests.map((r: any) => ({ M: marshall(r) })) },
        },
      }),
    );

    return APIResponse.success(201, { id: requestId });
  }
}

const handlerInstance = new LambdaHandler(new DynamoDBClient({ region: process.env.AWS_REGION }));
export const lambdaHandler = handlerInstance.handle.bind(handlerInstance);
