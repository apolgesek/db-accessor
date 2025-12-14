/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { ListInstancesCommand, SSOAdminClient } from '@aws-sdk/client-sso-admin';
import { AssumeRoleCommand, STSClient } from '@aws-sdk/client-sts';
import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { APIResponse } from '../../../shared/response';
import { SSOUserManager } from '../../../shared/sso_user_manager';
import { createPolicy } from '../dynamodb_policy';
import { validate } from '../request_validator';

const IDENTITY_CENTER_REGION = process.env.IDENTITY_CENTER_REGION ?? 'eu-central-1';
const ROLE_ARN_IN_MGMT = process.env.IDENTITY_CENTER_ROLE_ARN!;

const sts = new STSClient({ region: IDENTITY_CENTER_REGION });

async function getMgmtCreds() {
  const res = await sts.send(
    new AssumeRoleCommand({
      RoleArn: ROLE_ARN_IN_MGMT,
      RoleSessionName: 'identity-center-automation',
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
    const awsAccountId = context.invokedFunctionArn.split(':')[4];
    const body = event.body ? JSON.parse(event.body) : {};
    const userName: string = body.userName;
    const tableName: string = body.tableName;
    const partitionKey: string = body.partitionKey;
    const duration: string | number = body.duration;

    const result = validate(event);
    if (result && result?.statusCode >= 400) {
      return result;
    }

    const creds = await getMgmtCreds();
    const ssoAdmin = new SSOAdminClient({ region: IDENTITY_CENTER_REGION, credentials: creds });

    const instRes = await ssoAdmin.send(new ListInstancesCommand({}));
    const inst = instRes.Instances?.[0];
    if (!inst?.InstanceArn || !inst.IdentityStoreId) {
      throw new Error('No IAM Identity Center instance found in this region.');
    }
    const instanceArn = inst.InstanceArn;
    const identityStoreId = inst.IdentityStoreId;

    const ssoUserManager = new SSOUserManager(creds);
    const userId = await ssoUserManager.getUser(userName, { identityStoreId });
    if (!userId) return APIResponse.error(404, `Identity Center user ${userName} not found`);

    const durationHours = duration ? Math.min(Math.max(Number(duration), 1), 24) : 1;
    const currentDate = new Date();
    const expirationDate = new Date(currentDate.getTime() + durationHours * 3_600 * 1_000);

    const inlinePolicy = createPolicy({
      awsAccountId,
      tableName,
      partitionKey,
      currentDate,
      expirationDate,
    });

    const requestId = await ssoUserManager.assignPolicy(userId, inlinePolicy, {
      instanceArn,
      awsAccountId,
      identityStoreId,
      userName,
      tableName,
      partitionKey,
      expirationDate,
    });

    if (!requestId) throw new Error('Missing RequestId from CreateAccountAssignment.');

    const dynamoDbClient = new DynamoDBClient({ region: process.env.AWS_REGION });
    const params = {
      TableName: process.env.AUDIT_LOGS_TABLE_NAME,
      Item: {
        UserId: { S: 'iam_user' },
        CreatedAt: { N: currentDate.getTime().toString() },
      },
    };

    await dynamoDbClient.send(new PutItemCommand(params));

    return APIResponse.success(
      `Readonly access granted for user ${userName}, table ${tableName}, item pK: ${partitionKey}, duration: ${durationHours} hour(s)`,
    );
  }
}

const handlerInstance = new LambdaHandler();
export const lambdaHandler = handlerInstance.handle.bind(handlerInstance);
