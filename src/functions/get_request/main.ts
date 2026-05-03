import { AttributeValue, DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { APIResponse } from '../../shared/response';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { ApprovedBy, EntityRequest } from '../../shared/entity-request';
import { toAppUsername } from '../../shared/username';

const MS_IN_HOUR = 3_600_000;

class LambdaHandler {
  constructor(private readonly ddbClient: DynamoDBClient) {}

  async handle(event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> {
    try {
      const claims = event.requestContext?.authorizer?.claims ?? {};
      const username = toAppUsername(claims.username);
      const pk = `USER#${username}`;

      let items: EntityRequest[] = [];
      let lastEvaluatedKey: Record<string, AttributeValue> | undefined;

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
          items.push(unmarshall(it) as EntityRequest);
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

  private setIsAvailable(item: EntityRequest, now: number): boolean {
    const adminApproval = item.approvedBy?.find((x: ApprovedBy) => x.role === 'ADMIN');
    if (!adminApproval) return false;
    return (
      item.status === 'APPROVED' && new Date(adminApproval.approvedAt).getTime() + item.duration * MS_IN_HOUR >= now
    );
  }
}

const handlerInstance = new LambdaHandler(new DynamoDBClient({ region: process.env.AWS_REGION }));
export const lambdaHandler = handlerInstance.handle.bind(handlerInstance);
