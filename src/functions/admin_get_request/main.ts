import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { APIResponse } from '../../shared/response';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { monthsBetween } from './months-between.util';
import { getBearerToken } from '../../shared/get-bearer-token';
import { requestSchema } from './request-schema';

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
      const app_roles = claims['app_roles'] as string[] | undefined;

      if (!app_roles?.includes('ADMIN')) {
        return APIResponse.error(401, 'Unauthorized');
      }

      const queryParams = event.queryStringParameters || {};
      const result = requestSchema.validate(queryParams);

      if (result.error) {
        return APIResponse.error(400, 'Invalid request');
      }

      const items =
        queryParams.status === 'PENDING' ? await this.getPendingRequests() : await this.getAllRequests(queryParams);

      return APIResponse.success(200, {
        count: items.length,
        items,
      });
    } catch (err) {
      console.error('Token verification failed:', err);
      return APIResponse.error(401, 'Invalid token');
    }
  }

  private async getAllRequests(queryParams: any): Promise<any[]> {
    const items = [];
    let lastEvaluatedKey: Record<string, any> | undefined;

    const months = monthsBetween(new Date(queryParams.startDate), new Date(queryParams.endDate));

    for (const timeRange of months) {
      const rangeItems = [];

      do {
        const cmd = new QueryCommand({
          TableName: process.env.GRANTS_TABLE_NAME,
          ScanIndexForward: false,
          IndexName: 'GSI_ALL',
          KeyConditionExpression: '#pk = :pk',
          ExpressionAttributeNames: {
            '#pk': 'GSI_ALL_PK',
          },
          ExpressionAttributeValues: {
            ':pk': { S: `REQBUCKET#${timeRange}` },
          },
          ExclusiveStartKey: lastEvaluatedKey,
        });

        const res = await this.ddbClient.send(cmd);

        for (const it of res.Items ?? []) {
          rangeItems.push(unmarshall(it));
        }

        lastEvaluatedKey = res.LastEvaluatedKey;
      } while (lastEvaluatedKey);

      items.unshift(...rangeItems);
    }

    return items;
  }

  private async getPendingRequests(): Promise<any[]> {
    const items = [];
    let lastEvaluatedKey: Record<string, any> | undefined;

    do {
      const cmd = new QueryCommand({
        TableName: process.env.GRANTS_TABLE_NAME,
        ScanIndexForward: false,
        IndexName: 'GSI_PENDING',
        KeyConditionExpression: '#pk = :pk',
        ExpressionAttributeNames: {
          '#pk': 'GSI_PENDING_PK',
        },
        ExpressionAttributeValues: {
          ':pk': { S: 'PENDING' },
        },
        ExclusiveStartKey: lastEvaluatedKey,
      });

      const res = await this.ddbClient.send(cmd);

      for (const it of res.Items ?? []) {
        items.push(unmarshall(it));
      }

      lastEvaluatedKey = res.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    return items;
  }
}

const handlerInstance = new LambdaHandler(new DynamoDBClient({ region: process.env.AWS_REGION }));
export const lambdaHandler = handlerInstance.handle.bind(handlerInstance);
