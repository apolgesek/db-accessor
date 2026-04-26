import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { APIResponse } from '../../shared/response';
import { ACTIVE_RULESET_SK, ActiveRulesetSnapshot, getRulesetSnapshotPk } from '../../shared/ruleset';
import { requestSchema } from './request-schema';

class LambdaHandler {
  constructor(private readonly ddbClient: DynamoDBClient) {}

  async handle(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const claims = event.requestContext?.authorizer?.claims ?? {};
    const rawGroups = claims['cognito:groups'];
    const groups: string[] = Array.isArray(rawGroups)
      ? rawGroups
      : typeof rawGroups === 'string'
      ? rawGroups.split(',')
      : [];

    if (!groups.includes('ADMIN')) {
      return APIResponse.error(401, 'Unauthorized');
    }

    const queryParams = event.queryStringParameters || {};
    const result = requestSchema.validate(queryParams);

    if (result.error) {
      return APIResponse.error(400, 'Invalid request');
    }

    const { accountId, region, table } = result.value;

    const docClient = DynamoDBDocumentClient.from(this.ddbClient);
    const res = await docClient.send(
      new GetCommand({
        TableName: process.env.RULESET_TABLE_NAME,
        Key: {
          PK: getRulesetSnapshotPk(accountId, region, table),
          SK: ACTIVE_RULESET_SK,
        },
      }),
    );

    const snapshot = res.Item as ActiveRulesetSnapshot | undefined;

    return APIResponse.success(200, {
      accountId,
      region,
      table,
      updatedAt: snapshot?.updatedAt ?? null,
      activeRulesets: snapshot?.activeRulesets ?? {},
    });
  }
}

const handlerInstance = new LambdaHandler(new DynamoDBClient({ region: process.env.AWS_REGION }));
export const lambdaHandler = handlerInstance.handle.bind(handlerInstance);
