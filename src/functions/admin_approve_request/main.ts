import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { APIResponse } from '../../shared/response';
import { getBearerToken } from '../../shared/get-bearer-token';
import { requestSchema } from './request-schema';

const verifier = CognitoJwtVerifier.create({
  userPoolId: process.env.COGNITO_USER_POOL_ID as string,
  tokenUse: 'access',
  clientId: process.env.COGNITO_CLIENT_ID as string,
});

class LambdaHandler {
  async handle(event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> {
    const token = getBearerToken(event);
    if (!token) {
      return APIResponse.error(401, 'Missing token');
    }

    try {
      const claims = await verifier.verify(token);
      const app_roles = claims['app_roles'] as string[] | undefined;

      if (!app_roles?.includes('ADMIN')) {
        return APIResponse.error(401, 'Unauthorized');
      }

      const body = JSON.parse(event.body || '{}');
      const result = requestSchema.validate(body);

      if (result.error) {
        return APIResponse.error(400, 'Invalid request');
      }

      const ddbClient = new DynamoDBClient({ region: process.env.AWS_REGION });

      const getItemCmd = new GetItemCommand({
        TableName: process.env.GRANTS_TABLE_NAME,
        Key: {
          PK: { S: body.PK },
          SK: { S: body.SK },
        },
      });
      const getItemResponse = await ddbClient.send(getItemCmd);

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
                #approvedBy = list_append(#approvedBy, :approvedBy),
            REMOVE #gsi_pending_pk, #gsi_pending_sk
          `,
        ConditionExpression: '#status = :pendingStatus',
        ExpressionAttributeNames: {
          '#status': 'status',
          '#approvedBy': 'approvedBy',
          '#gsi_pending_pk': 'GSI_PENDING_PK',
          '#gsi_pending_sk': 'GSI_PENDING_SK',
        },
        ExpressionAttributeValues: {
          ':pendingStatus': { S: 'PENDING' },
          ':status': { S: 'APPROVED' },
          ':approvedBy': {
            L: [
              {
                M: { username: { S: username }, approvedAt: { S: new Date().toISOString() }, role: { S: 'ADMIN' } },
              },
            ],
          },
        },
      });
      await ddbClient.send(updateItemCmd);

      return APIResponse.success(204);
    } catch (err) {
      console.error('Token verification failed:', err);
      return APIResponse.error(401, 'Invalid token');
    }
  }
}

const handlerInstance = new LambdaHandler();
export const lambdaHandler = handlerInstance.handle.bind(handlerInstance);
