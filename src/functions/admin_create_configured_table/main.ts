import { ConditionalCheckFailedException, DescribeTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getStsSession } from '../../shared/get-sts-session';
import { APIResponse } from '../../shared/response';
import { toAppUsername } from '../../shared/username';
import { isAdmin } from '../../shared/auth';
import {
  CONFIGURED_TABLES_ALL_PK,
  CONFIGURED_TABLE_SK,
  ConfiguredDynamoDbTable,
  getConfiguredTableAccountPk,
  getConfiguredTableAccountRegionPk,
  getConfiguredTablePk,
  getConfiguredTableSortKey,
} from '../../shared/configured-table';
import { requestSchema } from './request-schema';

class LambdaHandler {
  constructor(private readonly ddbClient: DynamoDBClient) {}

  async handle(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const claims = event.requestContext?.authorizer?.claims ?? {};
    if (!isAdmin(claims)) {
      return APIResponse.error(401, 'Unauthorized');
    }

    const body = JSON.parse(event.body || '{}');
    const result = requestSchema.validate(body);

    if (result.error) {
      return APIResponse.error(400, 'Invalid request');
    }

    const { accountId, region, table } = result.value;
    const creds = await getStsSession(accountId, region);
    const targetDbClient = new DynamoDBClient({ region, credentials: creds });
    const describeTableResponse = await targetDbClient.send(new DescribeTableCommand({ TableName: table }));

    if (!describeTableResponse.Table) {
      return APIResponse.error(400, 'Invalid table');
    }

    const pkName = describeTableResponse.Table.KeySchema?.find((k) => k.KeyType === 'HASH')?.AttributeName;
    const skName = describeTableResponse.Table.KeySchema?.find((k) => k.KeyType === 'RANGE')?.AttributeName;

    if (!pkName) {
      return APIResponse.error(400, 'Invalid table');
    }

    const createdAtTimestamp = Date.now();
    const createdAt = new Date(createdAtTimestamp).toISOString();
    const username = toAppUsername(claims.username);
    const item: ConfiguredDynamoDbTable = {
      pk: getConfiguredTablePk(accountId, region, table),
      sk: CONFIGURED_TABLE_SK,
      entityType: 'CONFIGURED_TABLE',
      accountId,
      region,
      table,
      pkName,
      ...(skName ? { skName } : {}),
      createdAt,
      createdAtTimestamp,
      createdBy: username,
      gsiAllPk: CONFIGURED_TABLES_ALL_PK,
      gsiAllSk: getConfiguredTableSortKey(createdAtTimestamp, accountId, region, table),
      gsiAccountPk: getConfiguredTableAccountPk(accountId),
      gsiAccountSk: getConfiguredTableSortKey(createdAtTimestamp, region, table),
      gsiAccountRegionPk: getConfiguredTableAccountRegionPk(accountId, region),
      gsiAccountRegionSk: getConfiguredTableSortKey(createdAtTimestamp, table),
    };

    const docClient = DynamoDBDocumentClient.from(this.ddbClient);
    try {
      await docClient.send(
        new PutCommand({
          TableName: process.env.CONFIGURED_TABLES_TABLE_NAME,
          Item: item,
          ConditionExpression: 'attribute_not_exists(pk)',
        }),
      );
    } catch (err) {
      if (
        err instanceof ConditionalCheckFailedException ||
        (err as { name?: string }).name === 'ConditionalCheckFailedException'
      ) {
        return APIResponse.error(409, 'Table is already configured');
      }

      throw err;
    }

    return APIResponse.success(201, {
      accountId: item.accountId,
      region: item.region,
      name: item.table,
      pk: item.pkName,
      ...(item.skName ? { sk: item.skName } : {}),
      createdAt: item.createdAt,
      createdBy: item.createdBy,
    });
  }
}

const handlerInstance = new LambdaHandler(new DynamoDBClient({ region: process.env.AWS_REGION }));
export const lambdaHandler = handlerInstance.handle.bind(handlerInstance);
