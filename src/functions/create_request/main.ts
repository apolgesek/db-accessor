/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { AttributeValue, DynamoDBClient, GetItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getStsSession } from '../../shared/get-sts-session';
import { APIResponse } from '../../shared/response';
import { requestSchema } from './request-schema';
import { EntityRequest } from '../../shared/entity-request';
import { getTimeBucket } from '../../shared/time.util';
import { toAppUsername } from '../../shared/username';
import { CONFIGURED_TABLE_SK, getConfiguredTablePk } from '../../shared/configured-table';

class LambdaHandler {
  constructor(private readonly ddbClient: DynamoDBClient) {}

  async handle(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const body = JSON.parse(event.body || '{}');
    const result = requestSchema.validate(body);

    if (result.error) {
      return APIResponse.error(400, 'Invalid request');
    }

    const configuredTableResponse = await this.ddbClient.send(
      new GetItemCommand({
        TableName: process.env.CONFIGURED_TABLES_TABLE_NAME,
        Key: {
          pk: { S: getConfiguredTablePk(result.value.accountId, result.value.region, result.value.table) },
          sk: { S: CONFIGURED_TABLE_SK },
        },
      }),
    );

    if (!configuredTableResponse.Item) {
      return APIResponse.error(400, 'Table is not configured');
    }

    const PK_NAME = configuredTableResponse.Item.pkName?.S;
    const SK_NAME = configuredTableResponse.Item.skName?.S;

    if (!PK_NAME || (SK_NAME && !result.value.targetSk)) {
      return APIResponse.error(400, 'Invalid request');
    }

    const creds = await getStsSession(result.value.accountId, result.value.region);
    const targetDbClient = new DynamoDBClient({
      region: result.value.region,
      credentials: creds,
    });

    const key: Record<string, AttributeValue> = {
      [PK_NAME]: { S: result.value.targetPk },
    };

    if (SK_NAME) {
      key[SK_NAME] = { S: result.value.targetSk };
    }

    const resp = await targetDbClient.send(
      new GetItemCommand({
        TableName: result.value.table,
        Key: key,
        ConsistentRead: false,
      }),
    );

    if (!resp.Item) {
      return APIResponse.error(404);
    }

    const dateNow = Date.now();
    const yearMonth = getTimeBucket(dateNow);

    const claims = event.requestContext?.authorizer?.claims ?? {};
    const username = toAppUsername(claims.username);
    const requestId = crypto.randomUUID();
    const item: Partial<Record<keyof EntityRequest, AttributeValue>> = {
      pk: { S: `USER#${username}` },
      sk: { S: `REQUEST#${dateNow}#${requestId}` },
      userId: { S: username },
      status: { S: 'PENDING' },
      createdAt: { S: new Date(dateNow).toISOString() },
      accountId: { S: result.value.accountId },
      table: { S: result.value.table },
      region: { S: result.value.region },
      duration: { N: result.value.duration.toString() },
      targetPk: { S: result.value.targetPk },
      approvedBy: { L: [] },
      reason: { S: result.value.reason },
      issueKey: { S: result.value.issueKey },
      gsiAllPk: { S: `REQBUCKET#${yearMonth}` },
      gsiAllSk: { S: `${dateNow}#USER#${username}#${requestId}` },
      gsiPendingPk: { S: 'PENDING' },
      gsiPendingSk: { S: `${dateNow}#USER#${username}#${requestId}` },
    };

    if (SK_NAME) {
      item.targetSk = { S: result.value.targetSk };
    }

    const createNewRequestCommand = new PutItemCommand({
      TableName: process.env.GRANTS_TABLE_NAME,
      Item: item,
    });

    await this.ddbClient.send(createNewRequestCommand);

    return APIResponse.success(201, { id: `REQUEST#${dateNow}` });
  }
}

const handlerInstance = new LambdaHandler(new DynamoDBClient({ region: process.env.AWS_REGION }));
export const lambdaHandler = handlerInstance.handle.bind(handlerInstance);
