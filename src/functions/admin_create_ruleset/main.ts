import { DescribeTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  QueryCommandInput,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getStsSession } from '../../shared/get-sts-session';
import { APIResponse } from '../../shared/response';
import {
  ACTIVE_RULESET_SK,
  getRulesetAccountRegionPk,
  getRulesetAccountRegionSk,
  getRulesetAccountRegionTablePk,
  getRulesetAccountRegionTableSk,
  getRulesetHistoryPk,
  getRulesetHistorySk,
  getRulesetScopeKey,
  getRulesetSnapshotPk,
} from '../../shared/ruleset';
import { requestSchema } from './request-schema';

class LambdaHandler {
  constructor(private readonly ddbClient: DynamoDBClient) {}

  async handle(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const claims = event.requestContext?.authorizer?.claims ?? {};
    const rawGroups = claims['cognito:groups'];
    const groups: string[] = Array.isArray(rawGroups)
      ? rawGroups
      : typeof rawGroups === 'string'
      ? rawGroups.split(',')
      : [];

    if (!groups.includes('ADMIN')) {
      return APIResponse.error(401, 'Unauthorized');
    }

    const body = JSON.parse(event.body || '{}');
    const result = requestSchema.validate(body);

    if (result.error) {
      return APIResponse.error(400, 'Invalid request');
    }

    const creds = await getStsSession(result.value.accountId, result.value.region);
    const targetDbClient = DynamoDBDocumentClient.from(
      new DynamoDBClient({
        region: result.value.region,
        credentials: creds,
      }),
    );

    const describeTableResponse = await targetDbClient.send(
      new DescribeTableCommand({ TableName: result.value.table }),
    );

    if (!describeTableResponse.Table) {
      return APIResponse.error(400, 'Invalid table');
    }

    const PK_NAME = describeTableResponse.Table.KeySchema?.find((k) => k.KeyType === 'HASH')?.AttributeName as string;
    const SK_NAME = describeTableResponse.Table.KeySchema?.find((k) => k.KeyType === 'RANGE')?.AttributeName as string;

    const key: Record<string, string> = {
      [PK_NAME]: result.value.targetPK,
    };

    if (SK_NAME) {
      key[SK_NAME] = result.value.targetSK;
    }

    if (result.value.pkOperator !== 'BEGINS_WITH') {
      if (SK_NAME && result.value.skOperator === 'EQUALS') {
        const resp = await targetDbClient.send(
          new GetCommand({
            TableName: result.value.table,
            Key: key,
            ConsistentRead: false,
          }),
        );

        if (!resp.Item) {
          return APIResponse.error(404);
        }
      } else {
        const params: QueryCommandInput = {
          TableName: result.value.table,
          ExpressionAttributeNames: { '#pk': PK_NAME },
          ExpressionAttributeValues: {
            ':pk': result.value.targetPK,
          },
          ConsistentRead: false,
        };

        if (
          SK_NAME &&
          result.value.targetSK != null &&
          params.ExpressionAttributeNames &&
          params.ExpressionAttributeValues
        ) {
          params.ExpressionAttributeNames['#sk'] = SK_NAME;
          params.ExpressionAttributeValues[':sk'] = result.value.targetSK;
          params.KeyConditionExpression =
            result.value.skOperator === 'BEGINS_WITH'
              ? '#pk = :pk AND begins_with(#sk, :sk)'
              : `#pk = :pk AND #sk ${result.value.skOperator} :sk`;
        } else {
          params.KeyConditionExpression = '#pk = :pk';
        }

        const resp = await targetDbClient.send(new QueryCommand(params));

        if (!resp.Items || resp.Items.length === 0) {
          return APIResponse.error(404);
        }
      }
    }

    const { region, accountId, table, targetPK, targetSK, ruleset, pkOperator, skOperator } = result.value;

    const docClient = DynamoDBDocumentClient.from(this.ddbClient);
    const dateNow = Date.now();
    const createdAt = new Date(dateNow).toISOString();
    const scopeKey = getRulesetScopeKey(targetPK, targetSK, pkOperator, skOperator);

    const historyItem: Record<string, unknown> = {
      PK: getRulesetHistoryPk(accountId),
      SK: getRulesetHistorySk(dateNow, region, table, scopeKey),
      entityType: 'RULESET_HISTORY',
      createdAt,
      createdAtTimestamp: dateNow,
      accountId,
      region,
      table,
      targetPK,
      ruleset,
      scopeKey,
      GSI_ACCOUNT_REGION_PK: getRulesetAccountRegionPk(accountId, region),
      GSI_ACCOUNT_REGION_SK: getRulesetAccountRegionSk(dateNow, table, scopeKey),
      GSI_ACCOUNT_REGION_TABLE_PK: getRulesetAccountRegionTablePk(accountId, region, table),
      GSI_ACCOUNT_REGION_TABLE_SK: getRulesetAccountRegionTableSk(dateNow, scopeKey),
    };

    if (pkOperator) {
      historyItem['pkOperator'] = pkOperator;
    }

    if (targetSK) {
      historyItem['targetSK'] = targetSK;
      historyItem['skOperator'] = skOperator;
    }

    await docClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: process.env.RULESET_TABLE_NAME,
              Item: historyItem,
            },
          },
          {
            Update: {
              TableName: process.env.RULESET_TABLE_NAME,
              Key: {
                PK: getRulesetSnapshotPk(accountId, region, table),
                SK: ACTIVE_RULESET_SK,
              },
              UpdateExpression: `SET
                #entityType = if_not_exists(#entityType, :entityType),
                #accountId = if_not_exists(#accountId, :accountId),
                #region = if_not_exists(#region, :region),
                #table = if_not_exists(#table, :table),
                #updatedAt = :updatedAt,
                #activeRulesets = if_not_exists(#activeRulesets, :emptyActiveRulesets),
                #activeRulesets.#scopeKey = :scope`,
              ExpressionAttributeNames: {
                '#entityType': 'entityType',
                '#accountId': 'accountId',
                '#region': 'region',
                '#table': 'table',
                '#updatedAt': 'updatedAt',
                '#activeRulesets': 'activeRulesets',
                '#scopeKey': scopeKey,
              },
              ExpressionAttributeValues: {
                ':entityType': 'ACTIVE_RULESET',
                ':accountId': accountId,
                ':region': region,
                ':table': table,
                ':updatedAt': createdAt,
                ':emptyActiveRulesets': {},
                ':scope': {
                  targetPK,
                  ...(pkOperator ? { pkOperator } : {}),
                  ...(targetSK ? { targetSK, skOperator } : {}),
                  ruleset,
                  updatedAt: createdAt,
                },
              },
            },
          },
        ],
      }),
    );

    return APIResponse.success(201, { id: scopeKey });
  }
}

const handlerInstance = new LambdaHandler(new DynamoDBClient({ region: process.env.AWS_REGION }));
export const lambdaHandler = handlerInstance.handle.bind(handlerInstance);
