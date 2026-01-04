/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { OrganizationsClient, paginateListAccounts } from '@aws-sdk/client-organizations';
import { AssumeRoleCommand, STSClient } from '@aws-sdk/client-sts';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { getBearerToken } from '../../shared/get-bearer-token';
import { APIResponse } from '../../shared/response';
import {
  GetParametersByPathCommand,
  GetParametersByPathCommandOutput,
  GetParametersCommand,
  SSMClient,
} from '@aws-sdk/client-ssm';

const verifier = CognitoJwtVerifier.create({
  userPoolId: process.env.COGNITO_USER_POOL_ID as string,
  tokenUse: 'access',
  clientId: process.env.COGNITO_CLIENT_ID as string,
});
const sts = new STSClient({ region: process.env.AWS_REGION });
const ssm = new SSMClient({ region: process.env.AWS_REGION });

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
      const [accounts, regions] = await Promise.all([this.listAllAccounts(orgClient), this.listRegionsViaSsm()]);

      return APIResponse.success(200, { accounts, regions });
    } catch (err) {
      console.error('Token verification failed:', err);
      return APIResponse.error(401, 'Invalid token');
    }
  }

  async listRegionsViaSsm() {
    const path = '/aws/service/global-infrastructure/regions';
    const codes: string[] = [];

    let NextToken: string | undefined;
    do {
      const out: GetParametersByPathCommandOutput = await ssm.send(
        new GetParametersByPathCommand({
          Path: path,
          Recursive: false,
          NextToken,
          MaxResults: 10,
        }),
      );

      for (const p of out.Parameters ?? []) {
        const code = p.Name?.split('/').pop();
        if (code) codes.push(code);
      }

      NextToken = out.NextToken;
    } while (NextToken);

    const names = codes.map((code) => `${path}/${code}/longName`);
    const regionLongNames: Record<string, string> = {};

    for (let i = 0; i < names.length; i += 10) {
      const batch = names.slice(i, i + 10);
      const paramsOut = await ssm.send(new GetParametersCommand({ Names: batch }));

      for (const p of paramsOut.Parameters ?? []) {
        const parts = (p.Name ?? '').split('/');
        const code = parts[parts.length - 2];
        const longName = p.Value;
        if (code && longName) {
          regionLongNames[code] = longName;
        }
      }
    }

    return Object.entries(regionLongNames)
      .map(([code, longName]) => ({ code, longName }))
      .sort((a, b) => a.code.localeCompare(b.code));
  }

  async listAllAccounts(orgClient: OrganizationsClient) {
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

    const allowedAccounts = process.env.AWS_ACCOUNTS?.split(',').map((acc) => acc.trim());
    const filteredAccounts = accounts.filter((a: any) => allowedAccounts?.includes(a.id as string));

    return filteredAccounts.sort((a, b) => (a.name as string).localeCompare(b.name as string));
  }
}

const handlerInstance = new LambdaHandler();
export const lambdaHandler = handlerInstance.handle.bind(handlerInstance);
