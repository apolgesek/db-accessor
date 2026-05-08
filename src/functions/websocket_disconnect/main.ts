import { DeleteItemCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

class LambdaHandler {
  constructor(private readonly ddbClient: DynamoDBClient) {}

  async handle(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const connectionId = event.requestContext.connectionId;

    if (!connectionId) {
      return { statusCode: 400, body: 'Missing connectionId' };
    }

    await this.ddbClient.send(
      new DeleteItemCommand({
        TableName: process.env.WEBSOCKET_CONNECTIONS_TABLE_NAME,
        Key: {
          ConnectionId: { S: connectionId },
        },
      }),
    );

    return { statusCode: 200, body: 'Disconnected' };
  }
}

const handlerInstance = new LambdaHandler(new DynamoDBClient({ region: process.env.AWS_REGION }));
export const lambdaHandler = handlerInstance.handle.bind(handlerInstance);
