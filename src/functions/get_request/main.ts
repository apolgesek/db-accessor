import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { APIResponse } from '../../shared/response';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { getBearerToken } from '../../shared/get-bearer-token';

const MS_IN_HOUR = 3_600_000;

const verifier = CognitoJwtVerifier.create({
  userPoolId: process.env.COGNITO_USER_POOL_ID as string,
  tokenUse: 'access',
  clientId: process.env.COGNITO_CLIENT_ID as string,
});

class LambdaHandler {
  constructor(private readonly ddbClient: DynamoDBClient) {}

  async handle(event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> {
    const token = getBearerToken(event);
    if (!token) {
      return APIResponse.error(401, 'Missing token');
    }

    try {
      const claims = await verifier.verify(token);

      const username = claims.username.split('db-accessor_')[1];
      const pk = `USER#${username}`;

      let items = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let lastEvaluatedKey: Record<string, any> | undefined;

      do {
        const cmd = new QueryCommand({
          TableName: process.env.GRANTS_TABLE_NAME,
          ScanIndexForward: false,
          KeyConditionExpression: '#pk = :pk',
          ExpressionAttributeNames: {
            '#pk': 'PK',
          },
          ExpressionAttributeValues: {
            ':pk': { S: pk },
          },
          ExclusiveStartKey: lastEvaluatedKey,
        });

        const res = await this.ddbClient.send(cmd);

        for (const it of res.Items ?? []) {
          items.push(unmarshall(it));
        }

        lastEvaluatedKey = res.LastEvaluatedKey;
      } while (lastEvaluatedKey);

      const now = Date.now();
      items = items.map((item) => ({
        ...item,
        isAvailable: this.setIsAvailable(item, now),
      }));

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

  private setIsAvailable(item: any, now: number): boolean {
    const adminApproval = item.approvedBy.find((x: any) => x.role === 'ADMIN');
    return (
      item.status === 'APPROVED' && new Date(adminApproval.approvedAt).getTime() + item.duration * MS_IN_HOUR >= now
    );
  }
}

const handlerInstance = new LambdaHandler(new DynamoDBClient({ region: process.env.AWS_REGION }));
export const lambdaHandler = handlerInstance.handle.bind(handlerInstance);
