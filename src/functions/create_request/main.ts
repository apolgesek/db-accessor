import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';

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
      return { statusCode: 401, body: 'Missing token' };
    }

    try {
      const claims = await verifier.verify(token);
      console.log('Token is valid. Claims:', claims);

      const authorizationHeader = event.headers.Authorization || event.headers.authorization;
      if (!authorizationHeader || !authorizationHeader.startsWith('Bearer ')) {
        return {
          statusCode: 401,
          body: JSON.stringify({ message: 'Unauthorized' }),
        };
      }

      // const ddbClient = new DynamoDBClient({ region: process.env.AWS_REGION });
      // const dateNow = Date.now();
      // // Implementation for creating a request goes here
      // const createNewRequestCommand = new PutItemCommand({
      //   TableName: process.env.GRANTS_TABLE_NAME,
      //   Item: {
      //     PK: { S: `USER#apolgesek-test` },
      //     SK: { S: `REQUEST#${dateNow}` },
      //     userId: { S: 'apolgesek-test' },
      //     status: { S: 'PENDING' },
      //     createdAt: { S: new Date(dateNow).toISOString() },
      //     accountId: { S: '058264309711' },
      //     table: { S: 'dummy' },
      //     region: { S: 'eu-central-1' },
      //     duration: { N: '12' },
      //     targetPK: { S: 'CUST#10001' },
      //     targetSK: { S: 'PROFILE#10001' },
      //     approvedBy: { L: [] },
      //     reason: { S: 'Need access for testing' },
      //     rejectionReason: { S: '' },
      //     firstAccessedAt: { S: '' },
      //   },
      // });

      // await ddbClient.send(createNewRequestCommand);

      return {
        statusCode: 201,
        body: JSON.stringify({ message: 'Request created successfully' }),
      };
    } catch (err) {
      console.error('Token verification failed:', err);
      return { statusCode: 401, body: 'Invalid token' };
    }
  }
}

const handlerInstance = new LambdaHandler();
export const lambdaHandler = handlerInstance.handle.bind(handlerInstance);
