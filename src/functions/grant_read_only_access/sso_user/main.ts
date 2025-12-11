/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { Response } from '../../../shared/response';
import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';
import {
  CreateAccountAssignmentCommand,
  CreatePermissionSetCommand,
  ListInstancesCommand,
  PutInlinePolicyToPermissionSetCommand,
  SSOAdminClient,
} from '@aws-sdk/client-sso-admin';
import { GetUserIdCommand, IdentitystoreClient } from '@aws-sdk/client-identitystore';

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

    if (!userName || !tableName || !partitionKey || !duration) {
      return Response.error(400, 'Missing required fields');
    }

    if (!duration.toString().match(/^[1-9][0-9]{0,1}$/)) {
      return Response.error(400, 'Invalid duration format');
    }

    const creds = await getMgmtCreds();
    console.log('Obtained management account credentials: ', creds.accessKeyId);

    const ssoAdmin = new SSOAdminClient({ region: IDENTITY_CENTER_REGION, credentials: creds });
    const identityStore = new IdentitystoreClient({ region: IDENTITY_CENTER_REGION, credentials: creds });

    // 1) Discover IAM Identity Center instance + identity store
    const instRes = await ssoAdmin.send(new ListInstancesCommand({}));
    const inst = instRes.Instances?.[0];
    if (!inst?.InstanceArn || !inst.IdentityStoreId) {
      throw new Error('No IAM Identity Center instance found in this region.');
    }
    const instanceArn = inst.InstanceArn;
    const identityStoreId = inst.IdentityStoreId;

    const userIdRes = await identityStore.send(
      new GetUserIdCommand({
        IdentityStoreId: identityStoreId,
        AlternateIdentifier: {
          UniqueAttribute: {
            // valid paths include: "userName" and "emails.value"
            AttributePath: 'userName',
            AttributeValue: userName,
          },
        },
      }),
    );

    const principalId = userIdRes.UserId;
    if (!principalId) throw new Error('User not found in Identity Store.');
    console.log(`Found user ${userName} with principalId ${principalId}`);

    // 3) Create a permission set (or reuse an existing PermissionSetArn)
    const psRes = await ssoAdmin.send(
      new CreatePermissionSetCommand({
        InstanceArn: instanceArn,
        Name: 'InlinePolicyExample',
        Description: 'Example permission set with inline policy',
        SessionDuration: 'PT1H',
      }),
    );

    const permissionSetArn = psRes.PermissionSet?.PermissionSetArn;
    if (!permissionSetArn) throw new Error('Failed to create permission set.');
    console.log(`Created permission set with ARN: ${permissionSetArn}`);

    const durationHours = duration ? Math.min(Math.max(Number(duration), 1), 24) : 1;
    const currentDate = new Date();
    const expirationDate = new Date(currentDate.getTime() + durationHours * 3_600 * 1_000);

    // 4) Attach inline policy to the permission set
    const inlinePolicy = JSON.stringify({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Action: 'dynamodb:ListTables',
          Resource: '*',
        },
        {
          Effect: 'Allow',
          Action: 'dynamodb:DescribeTable',
          Resource: `arn:aws:dynamodb:${process.env.AWS_REGION}:${awsAccountId}:table/${tableName}`,
        },
        {
          Effect: 'Allow',
          Action: ['dynamodb:GetItem', 'dynamodb:Query'],
          Resource: `arn:aws:dynamodb:${process.env.AWS_REGION}:${awsAccountId}:table/${tableName}`,
          Condition: {
            'ForAllValues:StringEquals': {
              'dynamodb:LeadingKeys': [`${partitionKey}`],
            },
            DateGreaterThan: { 'aws:CurrentTime': currentDate.toISOString() },
            DateLessThan: { 'aws:CurrentTime': expirationDate.toISOString() },
          },
        },
      ],
    });

    await ssoAdmin.send(
      new PutInlinePolicyToPermissionSetCommand({
        InstanceArn: instanceArn,
        PermissionSetArn: permissionSetArn,
        InlinePolicy: inlinePolicy,
      }),
    );

    // 5) Assign permission set to this USER for a specific AWS account
    const assignRes = await ssoAdmin.send(
      new CreateAccountAssignmentCommand({
        InstanceArn: instanceArn,
        PermissionSetArn: permissionSetArn,
        PrincipalType: 'USER',
        PrincipalId: principalId,
        TargetType: 'AWS_ACCOUNT',
        TargetId: awsAccountId,
      }),
    );

    const requestId = assignRes.AccountAssignmentCreationStatus?.RequestId;
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

    return Response.success(
      `Readonly access granted for user ${userName}, table ${tableName}, item pK: ${partitionKey}, duration: ${durationHours} hour(s)`,
    );
  }
}

const handlerInstance = new LambdaHandler();
export const lambdaHandler = handlerInstance.handle.bind(handlerInstance);
