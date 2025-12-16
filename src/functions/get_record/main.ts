/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { DynamoDBClient, GetItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { AssumeRoleCommand, STSClient } from '@aws-sdk/client-sts';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { APIResponse } from '../../shared/response';
import { Creds } from '../../types/creds';
import { redact } from './apply-mask';

const TARGET_ROLE_ARN = process.env.TARGET_ROLE_ARN!;

const sts = new STSClient({ region: process.env.AWS_REGION });

async function getMgmtCreds() {
  const res = await sts.send(
    new AssumeRoleCommand({
      RoleArn: TARGET_ROLE_ARN,
      RoleSessionName: `GetDbRecordSession_${Date.now()}`,
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
  async handle(event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> {
    const creds = await getMgmtCreds();
    const ra = new RecordAccessor(creds);

    return ra.getRecord(event, context);
  }
}

class RecordAccessor {
  private targetDbClient: DynamoDBClient;
  private readonly localDbClient = new DynamoDBClient({ region: process.env.AWS_REGION });

  constructor(creds: Creds) {
    this.targetDbClient = new DynamoDBClient({
      region: process.env.AWS_REGION,
      credentials: creds,
    });
  }

  async getRecord(event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> {
    const pk = 'CUST#10001';
    const sk = 'PROFILE#10001';
    const PK_NAME = 'PK';
    const SK_NAME = 'SK';
    const TABLE_NAME = 'dummy';

    const key: Record<string, any> = {
      [PK_NAME]: { S: pk },
    };

    if (sk) {
      key[SK_NAME] = { S: sk };
    }

    const resp = await this.targetDbClient.send(
      new GetItemCommand({
        TableName: TABLE_NAME,
        Key: key,
        ConsistentRead: false,
      }),
    );

    if (!resp.Item) {
      return APIResponse.error(404, 'Not found');
    }

    const params = {
      TableName: process.env.AUDIT_LOGS_TABLE_NAME,
      Item: {
        UserId: { S: 'iam_user' },
        CreatedAt: { N: new Date().getTime().toString() },
      },
    };

    await this.localDbClient.send(new PutItemCommand(params));

    let item = unmarshall(resp.Item);
    const maskRuleset = await this.findMaskRuleset(TABLE_NAME, item);
    if (maskRuleset) {
      item = redact(
        item,
        maskRuleset.rules.map((r) => r.path),
      );
    }

    return APIResponse.success(item);
  }

  async findMaskRuleset(TABLE_NAME: string, item: Record<string, any>) {
    return Promise.resolve({
      rulesetId: 1,
      version: 1,
      rules: [
        {
          path: 'personalData.email',
        },
        {
          path: 'personalData.phone',
        },
        {
          path: 'addresses[*].street',
        },
      ],
    });
  }
}

const handlerInstance = new LambdaHandler();
export const lambdaHandler = handlerInstance.handle.bind(handlerInstance);
