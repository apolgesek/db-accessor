import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { requestSchema } from './request-schema';
import { APIResponse } from '../../shared/response';

const verifier = CognitoJwtVerifier.create({
  userPoolId: process.env.COGNITO_USER_POOL_ID as string,
  tokenUse: 'access',
  clientId: process.env.COGNITO_CLIENT_ID as string,
});

function getBearerToken(event: APIGatewayProxyEvent): string | null {
  const h = event.headers || {};
  const auth = h.Authorization || h.authorization;
  if (!auth) return null;
  const m = auth.match(/^Bearer\s+(.+)$/i);

  return m ? m[1] : null;
}

class LambdaHandler {
  async handle(event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> {
    const token = getBearerToken(event);
    if (!token) {
      return APIResponse.error(401, 'Missing token');
    }

    try {
      const claims = await verifier.verify(token);

      const authorizationHeader = event.headers.Authorization || event.headers.authorization;
      if (!authorizationHeader || !authorizationHeader.startsWith('Bearer ')) {
        return APIResponse.error(401, 'Unauthorized');
      }

      const body = JSON.parse(event.body || '{}');
      const result = requestSchema.validate(body);

      if (result.error) {
        return APIResponse.error(400, 'Invalid request');
      }

      const ddbClient = new DynamoDBClient({ region: process.env.AWS_REGION });
      const dateNow = Date.now();

      const username = claims.username.split('db-accessor_')[1];
      const createNewRequestCommand = new PutItemCommand({
        TableName: process.env.GRANTS_TABLE_NAME,
        Item: {
          PK: { S: `USER#${username}` },
          SK: { S: `REQUEST#${dateNow}` },
          userId: { S: username },
          status: { S: 'PENDING' },
          createdAt: { S: new Date(dateNow).toISOString() },
          accountId: { S: result.value.accountId },
          table: { S: result.value.table },
          region: { S: result.value.region },
          duration: { N: result.value.duration.toString() },
          targetPK: { S: result.value.targetPK },
          targetSK: { S: result.value.targetSK },
          approvedBy: { L: [] },
          reason: { S: result.value.reason },
        },
      });

      await ddbClient.send(createNewRequestCommand);

      return APIResponse.success(201, { id: `REQUEST#${dateNow}` });
    } catch (err) {
      console.error('Token verification failed:', err);
      return APIResponse.error(401, 'Invalid token');
    }
  }
}

const handlerInstance = new LambdaHandler();
export const lambdaHandler = handlerInstance.handle.bind(handlerInstance);
