import { DynamoDBClient, TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { isAdmin } from '../../shared/auth';
import { CONFIGURED_TABLE_SK, getConfiguredTablePk } from '../../shared/configured-table';
import { APIResponse } from '../../shared/response';
import { PII_SUGGESTION_STATE_SK, getPiiSuggestionPk } from '../../shared/pii-scan';
import { requestSchema } from './request-schema';

class LambdaHandler {
  constructor(private readonly ddbClient: DynamoDBClient) {}

  async handle(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const claims = event.requestContext?.authorizer?.claims ?? {};
    if (!isAdmin(claims)) {
      return APIResponse.error(401, 'Unauthorized');
    }

    const queryParams = event.queryStringParameters || {};
    const result = requestSchema.validate(queryParams);

    if (result.error) {
      return APIResponse.error(400, 'Invalid request');
    }

    const { accountId, region, table } = result.value;
    const docClient = DynamoDBDocumentClient.from(this.ddbClient);

    try {
      await docClient.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Delete: {
                TableName: process.env.CONFIGURED_TABLES_TABLE_NAME,
                Key: { pk: getConfiguredTablePk(accountId, region, table), sk: CONFIGURED_TABLE_SK },
                ConditionExpression: 'attribute_exists(pk)',
              },
            },
            {
              Delete: {
                TableName: process.env.PII_SUGGESTIONS_TABLE_NAME,
                Key: { pk: getPiiSuggestionPk(accountId, region, table), sk: PII_SUGGESTION_STATE_SK },
              },
            },
          ],
        }),
      );
    } catch (err) {
      if (
        (err instanceof TransactionCanceledException ||
          (err as { name?: string }).name === 'TransactionCanceledException') &&
        ((err as TransactionCanceledException).CancellationReasons ?? []).some(
          (reason) => reason.Code === 'ConditionalCheckFailed',
        )
      ) {
        return APIResponse.error(404, 'Configured table not found');
      }

      throw err;
    }

    return APIResponse.success(200, { deleted: true });
  }
}

const handlerInstance = new LambdaHandler(new DynamoDBClient({ region: process.env.AWS_REGION }));
export const lambdaHandler = handlerInstance.handle.bind(handlerInstance);
