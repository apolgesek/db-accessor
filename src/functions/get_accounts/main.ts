/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { DescribeOrganizationCommand, OrganizationsClient, paginateListAccounts } from '@aws-sdk/client-organizations';
import { AssumeRoleCommand, STSClient } from '@aws-sdk/client-sts';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { getBearerToken } from '../../shared/get-bearer-token';
import { APIResponse } from '../../shared/response';
import { GetParametersByPathCommand, GetParametersByPathCommandOutput, SSMClient } from '@aws-sdk/client-ssm';

const verifier = CognitoJwtVerifier.create({
  userPoolId: process.env.COGNITO_USER_POOL_ID as string,
  tokenUse: 'access',
  clientId: process.env.COGNITO_CLIENT_ID as string,
});
const sts = new STSClient({ region: process.env.AWS_REGION });
const ssm = new SSMClient({ region: 'us-east-1' });

async function getMgmtCreds() {
  const res = await sts.send(
    new AssumeRoleCommand({
      RoleArn: `arn:aws:iam::${process.env.AWS_MANAGEMENT_ACCOUNT}:role/DbAccessorAppRole`,
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
  async handle(event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> {
    const token = getBearerToken(event);
    if (!token) {
      return APIResponse.error(401, 'Missing token');
    }

    try {
      await verifier.verify(token);
      const creds = await getMgmtCreds();
      const orgClient = new OrganizationsClient({ region: process.env.AWS_REGION, credentials: creds });
      const response: any = await this.listAllAccounts(orgClient);

      if (process.env.AWS_ACCOUNTS) {
        const allowedAccounts = process.env.AWS_ACCOUNTS.split(',').map((acc) => acc.trim());
        response.accounts = response.accounts.filter((acct: any) => allowedAccounts.includes(acct.id as string));
      }

      const regions = await this.listRegionsViaSsm();
      response.regions = regions;

      return APIResponse.success(200, response);
    } catch (err) {
      console.error('Token verification failed:', err);
      return APIResponse.error(401, 'Invalid token');
    }
  }

  async listRegionsViaSsm() {
    const path = '/aws/service/global-infrastructure/regions';
    const regions = [];

    let NextToken;
    do {
      const out: GetParametersByPathCommandOutput = await ssm.send(
        new GetParametersByPathCommand({
          Path: path,
          Recursive: true,
          NextToken,
          MaxResults: 10,
        }),
      );

      for (const p of out.Parameters ?? []) {
        const region = p.Name?.split('/').pop();
        if (region) regions.push(region);
      }

      NextToken = out.NextToken;
    } while (NextToken);

    return regions.sort();
  }

  async listAllAccounts(orgClient: OrganizationsClient) {
    const orgInfo = await orgClient.send(new DescribeOrganizationCommand({}));
    const managementId = orgInfo?.Organization?.MasterAccountId;

    const paginator = paginateListAccounts({ client: orgClient }, { MaxResults: 20 });
    const accounts = [];
    for await (const page of paginator) {
      for (const acct of page.Accounts ?? []) {
        accounts.push({
          id: acct.Id,
          name: acct.Name,
          email: acct.Email,
        });
      }
    }

    return { managementId, accounts };
  }
}

const handlerInstance = new LambdaHandler();
export const lambdaHandler = handlerInstance.handle.bind(handlerInstance);
