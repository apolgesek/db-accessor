/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { DescribeTableCommand, DynamoDBClient, GetItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { AssumeRoleCommand, STSClient } from '@aws-sdk/client-sts';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { APIResponse } from '../../shared/response';
import { DEFAULT_REDACTION, PathPatternRedactor } from './redactor';
import { EntityRequest } from '../../shared/entity-request';

const MS_IN_HOUR = 3_600_000;
const sts = new STSClient({ region: process.env.AWS_REGION });

function base64urlDecode(str: string): string {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');

  while (base64.length % 4) {
    base64 += '=';
  }

  return Buffer.from(base64, 'base64').toString('utf8');
}

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

  async handle(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const claims = event.requestContext?.authorizer?.claims ?? {};
    const username = claims.username.split('db-accessor_')[1];
    const pathParams = event.pathParameters || {};
    const ddbClient = new DynamoDBClient({ region: process.env.AWS_REGION });
    const getItemResponse = await ddbClient.send(
      new GetItemCommand({
        TableName: process.env.GRANTS_TABLE_NAME,
        Key: {
          PK: { S: `USER#${username}` },
          SK: { S: base64urlDecode(pathParams.id as string) },
        },
      }),
    );

    if (!getItemResponse.Item) {
      return APIResponse.error(404);
    }

    const item = unmarshall(getItemResponse.Item) as EntityRequest;
    const adminApproval = item.approvedBy?.find((x) => x.role === 'ADMIN');

    if (!adminApproval || Date.now() > new Date(adminApproval.approvedAt).getTime() + item.duration * MS_IN_HOUR) {
      return APIResponse.error(404);
    }

    const creds = await getMgmtCreds();
    const targetDbClient = new DynamoDBClient({
      region: process.env.AWS_REGION,
      credentials: creds,
    });

    const describeTableResponse = await targetDbClient.send(new DescribeTableCommand({ TableName: item.table }));

    if (!describeTableResponse.Table) {
      return APIResponse.error(400, 'Invalid table');
    }

    const pkName = describeTableResponse.Table.KeySchema?.find((k) => k.KeyType === 'HASH')?.AttributeName ?? '';
    const skName = describeTableResponse.Table.KeySchema?.find((k) => k.KeyType === 'RANGE')?.AttributeName;

    const accessor = new RecordAccessor(targetDbClient);
    const result = await accessor.getRecord({ ...item, pkName, skName });
    await this.ddbClient.send(
      new PutItemCommand({
        TableName: process.env.AUDIT_LOGS_TABLE_NAME,
        Item: {
          UserId: { S: item.userId },
          CreatedAt: { N: new Date().getTime().toString() },
          TableName: { S: item.table },
          TargetPK: { S: item.targetPK },
          TargetSK: { S: item.targetSK || 'N/A' },
        },
      }),
    );

    return APIResponse.success(200, { result: result, request: item });
  }
}

class RecordAccessor {
  constructor(private readonly targetDbClient: DynamoDBClient) {}

  async getRecord(request: EntityRequest & { pkName: string; skName?: string }): Promise<APIGatewayProxyResult> {
    const pk = request.targetPK;
    const sk = request.targetSK;
    const PK_NAME = request.pkName;
    const SK_NAME = request.skName;
    const TABLE_NAME = request.table;

    const key: Record<string, any> = {
      [PK_NAME]: { S: pk },
    };

    if (sk) {
      key[SK_NAME!] = { S: sk };
    }

    const resp = await this.targetDbClient.send(
      new GetItemCommand({
        TableName: TABLE_NAME,
        Key: key,
        ConsistentRead: false,
      }),
    );

    if (!resp.Item) {
      return APIResponse.error(404);
    }

    let item = unmarshall(resp.Item);
    const maskRuleset = await this.findMaskRuleset(TABLE_NAME, item);
    const unredactPaths = request.unredactRequests?.flatMap((r) => r.paths) || [];

    if (maskRuleset) {
      maskRuleset.rules = maskRuleset.rules.filter((r) => !unredactPaths.includes(r.path));
    }

    if (maskRuleset) {
      const redactor = new PathPatternRedactor(
        maskRuleset.rules.map((r) => r.path),
        DEFAULT_REDACTION,
      );

      item = redactor.redact(item);
    }

    return APIResponse.success(200, { item, maskRuleset });
  }

  async findMaskRuleset(TABLE_NAME: string, item: Record<string, any>) {
    return Promise.resolve({
      rulesetId: 1,
      version: 1,
      rules: [
        {
          path: 'personalDetails.email',
        },
        {
          path: 'personalDetails.phone',
        },
        {
          path: 'addresses[].line1',
        },
      ],
    });
  }
}

const handlerInstance = new LambdaHandler(new DynamoDBClient({ region: process.env.AWS_REGION }));
export const lambdaHandler = handlerInstance.handle.bind(handlerInstance);
