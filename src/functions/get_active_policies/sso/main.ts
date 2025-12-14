/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { APIResponse } from '../../../shared/response';
import {
  ListPermissionSetsCommand,
  DescribePermissionSetCommand,
  SSOAdminClient,
  ListTagsForResourceCommand,
} from '@aws-sdk/client-sso-admin';
import { AssumeRoleCommand, STSClient } from '@aws-sdk/client-sts';

const ROLE_ARN_IN_MGMT = process.env.IDENTITY_CENTER_ROLE_ARN!;
const INSTANCE_ARN = process.env.INSTANCE_ARN!;

const sts = new STSClient({ region: process.env.AWS_REGION });

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
    const creds = await getMgmtCreds();
    const ssoAdmin = new SSOAdminClient({ region: process.env.AWS_REGION, credentials: creds });

    const matched: { arn: string; name: string; creationDate?: Date }[] = [];
    let nextToken: string | undefined;

    do {
      const listResp = await ssoAdmin.send(
        new ListPermissionSetsCommand({
          InstanceArn: INSTANCE_ARN,
          NextToken: nextToken,
        }),
      );

      const permissionSetArns = listResp.PermissionSets ?? [];

      // Describe all perm sets from this page in parallel
      const described = await Promise.all(
        permissionSetArns.map(async (arn) => {
          const desc = await ssoAdmin.send(
            new DescribePermissionSetCommand({
              InstanceArn: INSTANCE_ARN,
              PermissionSetArn: arn,
            }),
          );

          const ps = desc.PermissionSet;
          if (ps?.Name && ps.Name.startsWith('SSO')) {
            return { arn, name: ps.Name, creationDate: ps.CreatedDate };
          }

          return;
        }),
      );

      for (const item of described) {
        if (item) matched.push(item);
      }

      nextToken = listResp.NextToken;
    } while (nextToken);

    const listPolicyTagsPromises = matched.map((policy) =>
      ssoAdmin.send(new ListTagsForResourceCommand({ InstanceArn: INSTANCE_ARN, ResourceArn: policy.arn })),
    );
    const listPolicyTagsResults = await Promise.all(listPolicyTagsPromises);

    const response = matched.map((policy) => {
      const expiresAt = listPolicyTagsResults
        ?.find((_, i) => matched[i].arn === policy.arn)
        ?.Tags?.find((tag) => tag?.Key === 'ExpiresAt')?.Value;
      const userName = listPolicyTagsResults
        ?.find((_, i) => matched[i].arn === policy.arn)
        ?.Tags?.find((tag) => tag?.Key === 'UserName')?.Value;

      return {
        policyName: policy.name,
        userName: userName,
        arn: policy.arn,
        creationDate: policy.creationDate,
        expiresAt: expiresAt ? Number(expiresAt) : null,
      };
    });

    return APIResponse.success(response);
  }
}

const handlerInstance = new LambdaHandler();
export const lambdaHandler = handlerInstance.handle.bind(handlerInstance);
