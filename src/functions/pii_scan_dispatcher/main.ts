import { AttributeValue, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { SQSClient } from '@aws-sdk/client-sqs';
import { ConfiguredDynamoDbTable, PII_DETECTION_ENABLED_PK } from '../../shared/configured-table';
import { PiiScanTask, getScheduledPiiScanId } from '../../shared/pii-scan';
import { IPiiScanTaskPublisher, PiiScanTaskPublisher } from '../../shared/pii-scan-task-publisher';

type DiagnosticLogger = Pick<Console, 'info'>;

export class LambdaHandler {
  private readonly docClient: DynamoDBDocumentClient;

  constructor(
    ddbClient: DynamoDBClient,
    private readonly publisher: IPiiScanTaskPublisher,
    private readonly now: () => Date = () => new Date(),
    private readonly logger: DiagnosticLogger = console,
  ) {
    this.docClient = DynamoDBDocumentClient.from(ddbClient);
  }

  async handle(): Promise<{ queuedCount: number }> {
    const startedAt = Date.now();
    const requestedAt = this.now();
    let queuedCount = 0;
    let exclusiveStartKey: Record<string, AttributeValue> | undefined;

    do {
      const response = await this.docClient.send(
        new QueryCommand({
          TableName: process.env.CONFIGURED_TABLES_TABLE_NAME,
          IndexName: 'gsiPiiDetection',
          KeyConditionExpression: '#pk = :pk',
          ExpressionAttributeNames: { '#pk': 'gsiPiiDetectionPk' },
          ExpressionAttributeValues: { ':pk': PII_DETECTION_ENABLED_PK },
          ExclusiveStartKey: exclusiveStartKey,
        }),
      );

      for (const item of (response.Items ?? []) as ConfiguredDynamoDbTable[]) {
        const task: PiiScanTask = {
          version: 1,
          scanId: getScheduledPiiScanId(item.accountId, item.region, item.table, requestedAt),
          trigger: 'SCHEDULED',
          accountId: item.accountId,
          region: item.region,
          table: item.table,
          requestedAt: requestedAt.toISOString(),
        };
        await this.publisher.publish(task);
        queuedCount += 1;
      }

      exclusiveStartKey = response.LastEvaluatedKey as Record<string, AttributeValue> | undefined;
    } while (exclusiveStartKey);

    this.logger.info('PII scan dispatch completed', { queuedCount, durationMs: Date.now() - startedAt });
    return { queuedCount };
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
