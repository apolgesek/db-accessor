/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { OrganizationsClient, paginateListAccounts } from '@aws-sdk/client-organizations';
import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { getStsSession } from '../../shared/get-sts-session';
import { APIResponse } from '../../shared/response';
import {
  GetParametersByPathCommand,
  GetParametersByPathCommandOutput,
  GetParametersCommand,
  SSMClient,
} from '@aws-sdk/client-ssm';

const ssm = new SSMClient({ region: process.env.AWS_REGION });

class LambdaHandler {
  async handle(event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> {
    const managementAccount = process.env.AWS_MANAGEMENT_ACCOUNT;
    const awsRegion = process.env.AWS_REGION;

    if (!managementAccount || !awsRegion) {
      return APIResponse.error(500, 'Missing AWS management account or region configuration');
    }

    const creds = await getStsSession(managementAccount, awsRegion);
    const orgClient = new OrganizationsClient({ region: process.env.AWS_REGION, credentials: creds });
    const [accounts, regions] = await Promise.all([this.listAllAccounts(orgClient), this.listRegionsViaSsm()]);

    return APIResponse.success(200, { accounts, regions });
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
    const filteredAccounts = accounts.filter((a) => allowedAccounts?.includes(a.id as string));

    return filteredAccounts.sort((a, b) => (a.name as string).localeCompare(b.name as string));
  }
}

const handlerInstance = new LambdaHandler();
export const lambdaHandler = handlerInstance.handle.bind(handlerInstance);
