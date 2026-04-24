import { AttributeValue, DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { APIResponse } from '../../shared/response';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { monthsBetween } from './months-between.util';
import { requestSchema } from './request-schema';

class LambdaHandler {
  constructor(private readonly ddbClient: DynamoDBClient) {}

  async handle(event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> {
    const claims = event.requestContext?.authorizer?.claims ?? {};
    const rawGroups = claims?.['cognito:groups'];
    const groups: string[] = Array.isArray(rawGroups)
      ? rawGroups
      : typeof rawGroups === 'string'
      ? rawGroups.split(',')
      : [];

    if (!groups.includes('ADMIN')) {
      return APIResponse.error(401, 'Unauthorized');
    }

    const queryParams = event.queryStringParameters || {};
    const result = requestSchema.validate(queryParams);

    if (result.error) {
      return APIResponse.error(400, 'Invalid request');
    }

    const items =
      queryParams.status === 'PENDING' ? await this.getPendingRequests() : await this.getAllRequests(result.value);

    return APIResponse.success(200, {
      count: items.length,
      items,
    });
  }

  private async getAllRequests(params: { startDate: string; endDate: string }): Promise<Record<string, unknown>[]> {
    const items: Record<string, unknown>[] = [];
    let lastEvaluatedKey: Record<string, AttributeValue> | undefined;

    const months = monthsBetween(new Date(params.startDate), new Date(params.endDate));

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

  private async getPendingRequests(): Promise<Record<string, unknown>[]> {
    const items: Record<string, unknown>[] = [];
    let lastEvaluatedKey: Record<string, AttributeValue> | undefined;

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
