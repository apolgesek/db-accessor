import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { toAppUsername } from '../../shared/username';

class LambdaHandler {
  constructor(private readonly ddbClient: DynamoDBClient) {}

  async handle(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const connectionId = event.requestContext.connectionId;
    const userId = getUserId(event);

    if (!connectionId) {
      return { statusCode: 400, body: 'Missing connectionId' };
    }

    if (!userId) {
      return { statusCode: 400, body: 'Missing userId' };
    }

    await this.ddbClient.send(
      new PutItemCommand({
        TableName: process.env.WEBSOCKET_CONNECTIONS_TABLE_NAME,
        Item: {
          ConnectionId: { S: connectionId },
          UserId: { S: userId },
          ConnectedAt: { S: new Date().toISOString() },
          Ttl: { N: Math.floor(Date.now() / 1000 + 86_400).toString() },
        },
      }),
    );

    return { statusCode: 200, body: 'Connected' };
  }
}

function getUserId(event: APIGatewayProxyEvent): string {
  const authorizer = event.requestContext.authorizer as
    | { principalId?: string; claims?: { username?: string } }
    | undefined;
  const rawUserId = authorizer?.claims?.username ?? authorizer?.principalId ?? event.queryStringParameters?.userId;

  return rawUserId ? toAppUsername(rawUserId) : '';
}

const handlerInstance = new LambdaHandler(new DynamoDBClient({ region: process.env.AWS_REGION }));
export const lambdaHandler = handlerInstance.handle.bind(handlerInstance);
