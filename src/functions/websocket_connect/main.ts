import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { toAppUsername } from '../../shared/username';

class LambdaHandler {
  constructor(private readonly ddbClient: DynamoDBClient) {}

  async handle(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const connectionId = event.requestContext.connectionId;
    const userId = getuserId(event);

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
          connectionId: { S: connectionId },
          userId: { S: userId },
          ConnectedAt: { S: new Date().toISOString() },
          ttl: { N: Math.floor(Date.now() / 1000 + 86_400).toString() },
        },
      }),
    );

    return { statusCode: 200, body: 'Connected' };
  }
}

function getuserId(event: APIGatewayProxyEvent): string {
  const authorizer = event.requestContext.authorizer as
    | { principalId?: string; username?: string; claims?: { username?: string } }
    | undefined;
  const rawuserId = authorizer?.claims?.username ?? authorizer?.username ?? authorizer?.principalId;

  return rawuserId ? toAppUsername(rawuserId) : '';
}

const handlerInstance = new LambdaHandler(new DynamoDBClient({ region: process.env.AWS_REGION }));
export const lambdaHandler = handlerInstance.handle.bind(handlerInstance);
