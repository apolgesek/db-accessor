import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { PII_SUGGESTION_STATE_SK, PiiScanTask, getPiiScanMessageGroupId, getPiiSuggestionPk } from './pii-scan';

export interface IPiiScanTaskPublisher {
  publish(task: PiiScanTask): Promise<void>;
}

export class PiiScanTaskPublisher implements IPiiScanTaskPublisher {
  private readonly docClient: DynamoDBDocumentClient;

  constructor(
    ddbClient: DynamoDBClient,
    private readonly sqsClient: SQSClient,
    private readonly suggestionTableName: string,
    private readonly queueUrl: string,
  ) {
    this.docClient = DynamoDBDocumentClient.from(ddbClient);
  }

  async publish(task: PiiScanTask): Promise<void> {
    try {
      await this.docClient.send(
        new UpdateCommand({
          TableName: this.suggestionTableName,
          Key: { pk: getPiiSuggestionPk(task.accountId, task.region, task.table), sk: PII_SUGGESTION_STATE_SK },
          UpdateExpression:
            'SET #entityType = :entityType, #accountId = :accountId, #region = :region, #table = :table, #latestScan = :latestScan',
          ConditionExpression: 'attribute_not_exists(#latestScan.#scanId) OR #latestScan.#scanId <> :scanId',
          ExpressionAttributeNames: {
            '#entityType': 'entityType',
            '#accountId': 'accountId',
            '#region': 'region',
            '#table': 'table',
            '#latestScan': 'latestScan',
            '#scanId': 'scanId',
          },
          ExpressionAttributeValues: {
            ':scanId': task.scanId,
            ':entityType': 'PII_SUGGESTION_STATE',
            ':accountId': task.accountId,
            ':region': task.region,
            ':table': task.table,
            ':latestScan': {
              scanId: task.scanId,
              trigger: task.trigger,
              status: 'QUEUED',
              requestedAt: task.requestedAt,
            },
          },
        }),
      );
    } catch (error) {
      if (
        !(error instanceof ConditionalCheckFailedException) &&
        (error as { name?: string }).name !== 'ConditionalCheckFailedException'
      ) {
        throw error;
      }
    }

    await this.sqsClient.send(
      new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: JSON.stringify(task),
        MessageGroupId: getPiiScanMessageGroupId(task.accountId, task.region, task.table),
        MessageDeduplicationId: task.scanId,
      }),
    );
  }
}
