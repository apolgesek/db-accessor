import { randomUUID } from 'crypto';
import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SQSClient } from '@aws-sdk/client-sqs';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { isAdmin } from '../../shared/auth';
import {
  CONFIGURED_TABLE_SK,
  PII_DETECTION_ENABLED_PK,
  getConfiguredTablePk,
  getPiiDetectionSortKey,
} from '../../shared/configured-table';
import { PiiScanTask } from '../../shared/pii-scan';
import { IPiiScanTaskPublisher, PiiScanTaskPublisher } from '../../shared/pii-scan-task-publisher';
import { APIResponse } from '../../shared/response';
import { toAppUsername } from '../../shared/username';
import { requestSchema } from './request-schema';

export class LambdaHandler {
  private readonly docClient: DynamoDBDocumentClient;

  constructor(
    ddbClient: DynamoDBClient,
    private readonly taskPublisher: IPiiScanTaskPublisher,
    private readonly now: () => Date = () => new Date(),
    private readonly createId: () => string = randomUUID,
  ) {
    this.docClient = DynamoDBDocumentClient.from(ddbClient);
  }

  async handle(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const claims = event.requestContext?.authorizer?.claims ?? {};
    if (!isAdmin(claims)) return APIResponse.error(401, 'Unauthorized');

    let body: unknown;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return APIResponse.error(400, 'Invalid request');
    }

    const result = requestSchema.validate(body);
    if (result.error) return APIResponse.error(400, 'Invalid request');

    const { accountId, region, table, enabled } = result.value;
    const updatedAt = this.now().toISOString();
    const expressionAttributeNames: Record<string, string> = {
      '#enabled': 'piiDetectionEnabled',
      '#updatedAt': 'piiDetectionUpdatedAt',
      '#updatedBy': 'piiDetectionUpdatedBy',
      '#gsiPk': 'gsiPiiDetectionPk',
      '#gsiSk': 'gsiPiiDetectionSk',
    };
    const expressionAttributeValues: Record<string, unknown> = {
      ':enabled': enabled,
      ':updatedAt': updatedAt,
      ':updatedBy': toAppUsername(claims.username),
    };

    if (enabled) {
      expressionAttributeValues[':gsiPk'] = PII_DETECTION_ENABLED_PK;
      expressionAttributeValues[':gsiSk'] = getPiiDetectionSortKey(accountId, region, table);
    }

    try {
      const response = await this.docClient.send(
        new UpdateCommand({
          TableName: process.env.CONFIGURED_TABLES_TABLE_NAME,
          Key: { pk: getConfiguredTablePk(accountId, region, table), sk: CONFIGURED_TABLE_SK },
          UpdateExpression: enabled
            ? 'SET #enabled = :enabled, #updatedAt = :updatedAt, #updatedBy = :updatedBy, #gsiPk = :gsiPk, #gsiSk = :gsiSk'
            : 'SET #enabled = :enabled, #updatedAt = :updatedAt, #updatedBy = :updatedBy REMOVE #gsiPk, #gsiSk',
          ConditionExpression: 'attribute_exists(pk)',
          ExpressionAttributeNames: expressionAttributeNames,
          ExpressionAttributeValues: expressionAttributeValues,
          ReturnValues: 'ALL_OLD',
        }),
      );

      const wasEnabled = response.Attributes?.piiDetectionEnabled === true;
      if (enabled && !wasEnabled) {
        const task: PiiScanTask = {
          version: 1,
          scanId: `enabled-${this.createId()}`,
          trigger: 'ENABLED',
          accountId,
          region,
          table,
          requestedAt: updatedAt,
        };
        await this.taskPublisher.publish(task);
      }
    } catch (error) {
      if (
        error instanceof ConditionalCheckFailedException ||
        (error as { name?: string }).name === 'ConditionalCheckFailedException'
      ) {
        return APIResponse.error(404, 'Configured table not found');
      }
      throw error;
    }

    return APIResponse.success(200, { accountId, region, table, piiDetectionEnabled: enabled, updatedAt });
  }
}

const ddbClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const handlerInstance = new LambdaHandler(
  ddbClient,
  new PiiScanTaskPublisher(
    ddbClient,
    new SQSClient({ region: process.env.AWS_REGION }),
    process.env.PII_SUGGESTIONS_TABLE_NAME ?? '',
    process.env.PII_SCAN_QUEUE_URL ?? '',
  ),
);
export const lambdaHandler = handlerInstance.handle.bind(handlerInstance);
