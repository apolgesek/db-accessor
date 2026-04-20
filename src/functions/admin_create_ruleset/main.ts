import { DescribeTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommandInput, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { createHash } from 'crypto';
import { getStsSession } from '../../shared/get-sts-session';
import { APIResponse } from '../../shared/response';
import { requestSchema } from './request-schema';

class LambdaHandler {
  constructor(private readonly ddbClient: DynamoDBClient) {}

  async handle(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const claims = event.requestContext?.authorizer?.claims ?? {};
    const groups = claims['cognito:groups'] as string[] | undefined;

    if (!groups?.includes('ADMIN')) {
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

    if (SK_NAME && result.value.operator === 'EQUALS') {
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
          result.value.operator === 'BEGINS_WITH'
            ? '#pk = :pk AND begins_with(#sk, :sk)'
            : `#pk = :pk AND #sk ${result.value.operator} :sk`;
      } else {
        params.KeyConditionExpression = '#pk = :pk';
      }

      const resp = await targetDbClient.send(new QueryCommand(params));

      if (!resp.Items || resp.Items.length === 0) {
        return APIResponse.error(404);
      }
    }

    const { region, accountId, table, targetPK, targetSK, ruleset, operator } = result.value;

    const docClient = DynamoDBDocumentClient.from(this.ddbClient);
    const dateNow = Date.now();
    const yearMonth = new Date(dateNow).toISOString().slice(0, 7);
    const pkSource = `${accountId}#${region}#${yearMonth}`;
    const pkHash = createHash('sha256').update(pkSource).digest().subarray(0, 12).toString('base64url');

    const item: Record<string, any> = {
      PK: pkHash,
      SK: dateNow.toString(),
      createdAt: new Date(dateNow).toISOString(),
      accountId,
      region,
      targetPK,
      ruleset,
      GSI_TABLE_PK: `${accountId}#${region}#${table}`,
      GSI_TABLE_SK: dateNow.toString(),
    };

    if (targetSK) {
      item['targetSK'] = targetSK;
      item['operator'] = operator;
    }

    await docClient.send(
      new PutCommand({
        TableName: process.env.RULESET_TABLE_NAME,
        Item: item,
      }),
    );

    return APIResponse.success(201, { id: pkHash });
  }
}

const handlerInstance = new LambdaHandler(new DynamoDBClient({ region: process.env.AWS_REGION }));
export const lambdaHandler = handlerInstance.handle.bind(handlerInstance);
