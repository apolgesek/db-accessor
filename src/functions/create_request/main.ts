/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { DescribeTableCommand, DynamoDBClient, GetItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { AssumeRoleCommand, STSClient } from '@aws-sdk/client-sts';
import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { APIResponse } from '../../shared/response';
import { requestSchema } from './request-schema';

const sts = new STSClient({ region: process.env.AWS_REGION });

async function getMgmtCreds() {
  const res = await sts.send(
    new AssumeRoleCommand({
      // todo: fetch from lambda execution role policy and pass in request
      RoleArn: 'arn:aws:iam::058264309711:role/DbAccessorAppRole',
      RoleSessionName: `GetDbRecordSession_${Date.now()}`,
      DurationSeconds: 900,
    }),
  );
  if (!res.Credentials) throw new Error('AssumeRole returned no credentials');
  return {
    accessKeyId: res.Credentials.AccessKeyId!,
    secretAccessKey: res.Credentials.SecretAccessKey!,
    sessionToken: res.Credentials.SessionToken!,
  };
}

class LambdaHandler {
  constructor(private readonly ddbClient: DynamoDBClient) {}

  async handle(event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> {
    const body = JSON.parse(event.body || '{}');
    const result = requestSchema.validate(body);

    if (result.error) {
      return APIResponse.error(400, 'Invalid request');
    }

    const creds = await getMgmtCreds();
    const targetDbClient = new DynamoDBClient({
      region: process.env.AWS_REGION,
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

    const key: Record<string, any> = {
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
    const yearMonth = new Date(dateNow).toISOString().slice(0, 7);

    const claims = event.requestContext?.authorizer?.claims ?? {};
    const username = claims.username.split('db-accessor_')[1];
    const requestId = crypto.randomUUID();
    const createNewRequestCommand = new PutItemCommand({
      TableName: process.env.GRANTS_TABLE_NAME,
      Item: {
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
        targetSK: { S: result.value.targetSK },
        approvedBy: { L: [] },
        reason: { S: result.value.reason },
        GSI_ALL_PK: { S: `REQBUCKET#${yearMonth}` },
        GSI_ALL_SK: { S: `${dateNow}#USER#${username}#${requestId}` },
        GSI_PENDING_PK: { S: 'PENDING' },
        GSI_PENDING_SK: { S: `${dateNow}#USER#${username}#${requestId}` },
      },
    });

    await this.ddbClient.send(createNewRequestCommand);

    return APIResponse.success(201, { id: `REQUEST#${dateNow}` });
  }
}

const handlerInstance = new LambdaHandler(new DynamoDBClient({ region: process.env.AWS_REGION }));
export const lambdaHandler = handlerInstance.handle.bind(handlerInstance);
