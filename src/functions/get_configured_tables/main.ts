import { AttributeValue, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  CONFIGURED_TABLES_ALL_PK,
  ConfiguredDynamoDbTable,
  getConfiguredTableAccountPk,
  getConfiguredTableAccountRegionPk,
} from '../../shared/configured-table';
import { APIResponse } from '../../shared/response';
import { requestSchema } from './request-schema';

class LambdaHandler {
  constructor(private readonly ddbClient: DynamoDBClient) {}

  async handle(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const queryParams = event.queryStringParameters || {};
    const result = requestSchema.validate(queryParams);

    if (result.error) {
      return APIResponse.error(400, 'Invalid request');
    }

    const { accountId, region } = result.value;
    const docClient = DynamoDBDocumentClient.from(this.ddbClient);
    const indexName = accountId && region ? 'gsiAccountRegion' : accountId ? 'gsiAccount' : 'gsiAll';
    const pkName = accountId && region ? 'gsiAccountRegionPk' : accountId ? 'gsiAccountPk' : 'gsiAllPk';
    const pkValue =
      accountId && region
        ? getConfiguredTableAccountRegionPk(accountId, region)
        : accountId
        ? getConfiguredTableAccountPk(accountId)
        : CONFIGURED_TABLES_ALL_PK;

    const items: ConfiguredDynamoDbTable[] = [];
    let exclusiveStartKey: Record<string, AttributeValue> | undefined;

    do {
      const res = await docClient.send(
        new QueryCommand({
          TableName: process.env.CONFIGURED_TABLES_TABLE_NAME,
          IndexName: indexName,
          ScanIndexForward: false,
          KeyConditionExpression: '#pk = :pk',
          ExpressionAttributeNames: {
            '#pk': pkName,
          },
          ExpressionAttributeValues: {
            ':pk': pkValue,
          },
          ExclusiveStartKey: exclusiveStartKey,
        }),
      );

      items.push(...((res.Items ?? []) as ConfiguredDynamoDbTable[]));
      exclusiveStartKey = res.LastEvaluatedKey as Record<string, AttributeValue> | undefined;
    } while (exclusiveStartKey);

    return APIResponse.success(
      200,
      items.map((item) => ({
        accountId: item.accountId,
        region: item.region,
        name: item.table,
        pk: item.pkName,
        ...(item.skName ? { sk: item.skName } : {}),
        createdAt: item.createdAt,
        createdBy: item.createdBy,
      })),
    );
  }
}

const handlerInstance = new LambdaHandler(new DynamoDBClient({ region: process.env.AWS_REGION }));
export const lambdaHandler = handlerInstance.handle.bind(handlerInstance);
