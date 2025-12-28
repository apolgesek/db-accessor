import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { APIResponse } from '../../shared/response';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { getBearerToken } from '../../shared/get-bearer-token';

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

      const ddbClient = new DynamoDBClient({ region: process.env.AWS_REGION });
      const username = claims.username.split('db-accessor_')[1];
      const pk = `USER#${username}`;

      const items = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let lastEvaluatedKey: Record<string, any> | undefined;

      do {
        const cmd = new QueryCommand({
          TableName: process.env.GRANTS_TABLE_NAME,
          KeyConditionExpression: '#pk = :pk',
          ExpressionAttributeNames: {
            '#pk': 'PK',
          },
          ExpressionAttributeValues: {
            ':pk': { S: pk },
          },
          ExclusiveStartKey: lastEvaluatedKey,
        });

        const res = await ddbClient.send(cmd);

        for (const it of res.Items ?? []) {
          items.push(unmarshall(it));
        }

        lastEvaluatedKey = res.LastEvaluatedKey;
      } while (lastEvaluatedKey);

      return APIResponse.success(200, {
        userId: username,
        count: items.length,
        items,
      });
    } catch (err) {
      console.error('Token verification failed:', err);
      return APIResponse.error(401, 'Invalid token');
    }
  }
}

const handlerInstance = new LambdaHandler();
export const lambdaHandler = handlerInstance.handle.bind(handlerInstance);
