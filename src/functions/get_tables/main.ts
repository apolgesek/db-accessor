/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { AssumeRoleCommand, STSClient } from '@aws-sdk/client-sts';
import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { APIResponse } from '../../shared/response';
import {
  DynamoDBClient,
  ListTablesCommand,
  DescribeTableCommand,
  ListTablesCommandOutput,
} from '@aws-sdk/client-dynamodb';
import { requestSchema } from './request-schema';

const sts = new STSClient({ region: process.env.AWS_REGION });

async function getMgmtCreds(accountId: string) {
  const res = await sts.send(
    new AssumeRoleCommand({
      RoleArn: `arn:aws:iam::${accountId}:role/DbAccessorAppRole`,
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
    const result = requestSchema.validate(event.queryStringParameters);

    if (result.error) {
      return APIResponse.error(400, 'Invalid request');
    }

    const creds = await getMgmtCreds(result.value.account);
    const ddbClient = new DynamoDBClient({ region: result.value.region, credentials: creds });
    const tables = await this.listAllTables(ddbClient);

    return APIResponse.success(200, { tables });
  }

  async listAllTables(ddbClient: DynamoDBClient) {
    const results: Array<{ name: string; pK: string; sK?: string }> = [];
    let ExclusiveStartTableName: string | undefined = undefined;

    do {
      const listRes: ListTablesCommandOutput = await ddbClient.send(
        new ListTablesCommand({ ExclusiveStartTableName, Limit: 100 }),
      );

      const names = listRes.TableNames || [];
      for (const name of names) {
        try {
          const desc = await ddbClient.send(new DescribeTableCommand({ TableName: name }));
          const keySchema = desc.Table?.KeySchema || [];
          const pK = keySchema.find((k) => k.KeyType === 'HASH')?.AttributeName || '';
          const sK = keySchema.find((k) => k.KeyType === 'RANGE')?.AttributeName;
          results.push(sK ? { name, pK, sK } : { name, pK });
        } catch (err) {
          results.push({ name, pK: '' });
        }
      }

      ExclusiveStartTableName = listRes.LastEvaluatedTableName;
    } while (ExclusiveStartTableName);

    return results;
  }
}

const handlerInstance = new LambdaHandler();
export const lambdaHandler = handlerInstance.handle.bind(handlerInstance);
