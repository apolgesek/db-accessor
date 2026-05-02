/* eslint-disable @typescript-eslint/no-non-null-assertion */
import {
  AttributeValue,
  DescribeTableCommand,
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
} from '@aws-sdk/client-dynamodb';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getStsSession } from '../../shared/get-sts-session';
import { APIResponse } from '../../shared/response';
import { requestSchema } from './request-schema';
import { EntityRequest } from '../../shared/entity-request';
import { getTimeBucket } from '../../shared/time.util';

class LambdaHandler {
  constructor(private readonly ddbClient: DynamoDBClient) {}

  async handle(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const body = JSON.parse(event.body || '{}');
    const result = requestSchema.validate(body);

    if (result.error) {
      return APIResponse.error(400, 'Invalid request');
    }

    const creds = await getStsSession(result.value.accountId, result.value.region);
    const targetDbClient = new DynamoDBClient({
      region: result.value.region,
      credentials: creds,
    });

    const describeTableResponse = await targetDbClient.send(
      new DescribeTableCommand({ TableName: result.value.table }),
    );

    if (!describeTableResponse.Table) {
      return APIResponse.error(400, 'Invalid table');
    }

    const PK_NAME = describeTableResponse.Table.KeySchema?.find((k) => k.KeyType === 'HASH')?.AttributeName as string;
    const SK_NAME = describeTableResponse.Table.KeySchema?.find((k) => k.KeyType === 'RANGE')?.AttributeName as string;

    const key: Record<string, AttributeValue> = {
      [PK_NAME]: { S: result.value.targetPK },
    };

    if (SK_NAME) {
      key[SK_NAME] = { S: result.value.targetSK };
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
    const username = claims.username.split('db-accessor_')[1];
    const requestId = crypto.randomUUID();
    const item: Partial<Record<keyof EntityRequest, AttributeValue>> = {
      PK: { S: `USER#${username}` },
      SK: { S: `REQUEST#${dateNow}#${requestId}` },
      userId: { S: username },
      status: { S: 'PENDING' },
      createdAt: { S: new Date(dateNow).toISOString() },
      accountId: { S: result.value.accountId },
      table: { S: result.value.table },
      region: { S: result.value.region },
      duration: { N: result.value.duration.toString() },
      targetPK: { S: result.value.targetPK },
      approvedBy: { L: [] },
      reason: { S: result.value.reason },
      issueKey: { S: result.value.issueKey },
      GSI_ALL_PK: { S: `REQBUCKET#${yearMonth}` },
      GSI_ALL_SK: { S: `${dateNow}#USER#${username}#${requestId}` },
      GSI_PENDING_PK: { S: 'PENDING' },
      GSI_PENDING_SK: { S: `${dateNow}#USER#${username}#${requestId}` },
    };

    if (SK_NAME) {
      item.targetSK = { S: result.value.targetSK };
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
