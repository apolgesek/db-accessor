import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { isAdmin } from '../../shared/auth';
import { CONFIGURED_TABLE_SK, ConfiguredDynamoDbTable, getConfiguredTablePk } from '../../shared/configured-table';
import { PII_SUGGESTION_STATE_SK, PiiSuggestionState, getPiiSuggestionPk } from '../../shared/pii-scan';
import { APIResponse } from '../../shared/response';
import { requestSchema } from './request-schema';

export class LambdaHandler {
  private readonly docClient: DynamoDBDocumentClient;

  constructor(ddbClient: DynamoDBClient) {
    this.docClient = DynamoDBDocumentClient.from(ddbClient);
  }

  async handle(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const claims = event.requestContext?.authorizer?.claims ?? {};
    if (!isAdmin(claims)) return APIResponse.error(401, 'Unauthorized');

    const result = requestSchema.validate(event.queryStringParameters || {});
    if (result.error) return APIResponse.error(400, 'Invalid request');

    const { accountId, region, table } = result.value;
    const [configuredResponse, stateResponse] = await Promise.all([
      this.docClient.send(
        new GetCommand({
          TableName: process.env.CONFIGURED_TABLES_TABLE_NAME,
          Key: { pk: getConfiguredTablePk(accountId, region, table), sk: CONFIGURED_TABLE_SK },
        }),
      ),
      this.docClient.send(
        new GetCommand({
          TableName: process.env.PII_SUGGESTIONS_TABLE_NAME,
          Key: { pk: getPiiSuggestionPk(accountId, region, table), sk: PII_SUGGESTION_STATE_SK },
        }),
      ),
    ]);

    if (!configuredResponse.Item) return APIResponse.error(404, 'Configured table not found');

    const configured = configuredResponse.Item as ConfiguredDynamoDbTable;
    const state = stateResponse.Item as PiiSuggestionState | undefined;
    return APIResponse.success(200, {
      version: 1,
      accountId,
      region,
      table,
      piiDetectionEnabled: configured.piiDetectionEnabled === true,
      latestScan: state?.latestScan ?? null,
      suggestionsGeneratedAt: state?.suggestionsGeneratedAt ?? null,
      totalSuggestionCount: state?.totalSuggestionCount ?? 0,
      suggestionsTruncated: state?.suggestionsTruncated ?? false,
      suggestions: state?.suggestions ?? [],
    });
  }
}

const handlerInstance = new LambdaHandler(new DynamoDBClient({ region: process.env.AWS_REGION }));
export const lambdaHandler = handlerInstance.handle.bind(handlerInstance);
