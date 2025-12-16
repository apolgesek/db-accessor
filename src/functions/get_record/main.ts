/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { APIResponse } from '../../shared/response';
import { AssumeRoleCommand, STSClient } from '@aws-sdk/client-sts';
import { DynamoDBClient, GetItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';

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
    const ddb = new DynamoDBClient({
      region: process.env.AWS_REGION,
      credentials: creds,
    });
    const dynamoDbClient = new DynamoDBClient({ region: process.env.AWS_REGION });

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

    const resp = await ddb.send(
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

    await dynamoDbClient.send(new PutItemCommand(params));

    const item = unmarshall(resp.Item);
    return APIResponse.success(item);
  }
}

const handlerInstance = new LambdaHandler();
export const lambdaHandler = handlerInstance.handle.bind(handlerInstance);
