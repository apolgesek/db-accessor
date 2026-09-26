import { ConditionalCheckFailedException, DynamoDBClient, ResourceNotFoundException } from '@aws-sdk/client-dynamodb';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SQSEvent, SQSBatchResponse } from 'aws-lambda';
import { CONFIGURED_TABLE_SK, ConfiguredDynamoDbTable, getConfiguredTablePk } from '../../shared/configured-table';
import { getStsSession } from '../../shared/get-sts-session';
import {
  PII_SUGGESTION_STATE_SK,
  PiiRulesetSuggestion,
  PiiScanFailureCode,
  PiiScanSummary,
  PiiScanTask,
  PiiSuggestionState,
  getPiiSuggestionPk,
} from '../../shared/pii-scan';
import { DynamoDbSampler } from './dynamodb-sampler';
import { ObservationFlattener } from './observation-flattener';
import { PiiDetectorClient, PiiDetectorInvocationError } from './pii-detector-client';
import { aggregateSuggestions } from './suggestion-aggregator';

const MAX_STORED_SUGGESTIONS = 250;
const MAX_SUGGESTIONS_BYTES = 300 * 1024;
const MAX_RECEIVE_COUNT = 3;

type DiagnosticLogger = Pick<Console, 'info' | 'warn'>;

function parseTask(body: string): PiiScanTask {
  const value = JSON.parse(body) as Partial<PiiScanTask>;
  if (
    value.version !== 1 ||
    typeof value.scanId !== 'string' ||
    value.scanId.length === 0 ||
    value.scanId.length > 128 ||
    (value.trigger !== 'ENABLED' && value.trigger !== 'SCHEDULED') ||
    typeof value.accountId !== 'string' ||
    !/^\d{12}$/.test(value.accountId) ||
    typeof value.region !== 'string' ||
    value.region.length === 0 ||
    typeof value.table !== 'string' ||
    value.table.length === 0 ||
    typeof value.requestedAt !== 'string' ||
    !Number.isFinite(Date.parse(value.requestedAt))
  ) {
    throw new Error('Invalid PII scan task');
  }
  return value as PiiScanTask;
}

function failureCode(error: unknown): PiiScanFailureCode {
  if ((error as { name?: string }).name === 'AccessDeniedException') {
    return 'ACCESS_DENIED';
  }
  if (error instanceof ResourceNotFoundException || (error as { name?: string }).name === 'ResourceNotFoundException') {
    return 'TABLE_NOT_FOUND';
  }
  if (error instanceof PiiDetectorInvocationError) return 'DETECTOR_ERROR';
  if ((error as { name?: string }).name === 'TimeoutError') return 'TIMEOUT';
  return 'INTERNAL_ERROR';
}

function truncateSuggestions(suggestions: readonly PiiRulesetSuggestion[]): PiiRulesetSuggestion[] {
  const retained: PiiRulesetSuggestion[] = [];
  for (const suggestion of suggestions) {
    if (retained.length >= MAX_STORED_SUGGESTIONS) break;
    const candidate = [...retained, suggestion];
    if (Buffer.byteLength(JSON.stringify(candidate), 'utf8') > MAX_SUGGESTIONS_BYTES) break;
    retained.push(suggestion);
  }
  return retained;
}

export class LambdaHandler {
  private readonly docClient: DynamoDBDocumentClient;

  constructor(
    ddbClient: DynamoDBClient,
    private readonly detectorClient: PiiDetectorClient,
    private readonly createTargetClient: (task: PiiScanTask) => Promise<DynamoDBClient> = async (task) =>
      new DynamoDBClient({ region: task.region, credentials: await getStsSession(task.accountId, task.region) }),
    private readonly now: () => Date = () => new Date(),
    private readonly logger: DiagnosticLogger = console,
  ) {
    this.docClient = DynamoDBDocumentClient.from(ddbClient);
  }

  async handle(event: SQSEvent): Promise<SQSBatchResponse> {
    const batchItemFailures: SQSBatchResponse['batchItemFailures'] = [];
    for (const record of event.Records) {
      let task: PiiScanTask | undefined;
      try {
        task = parseTask(record.body);
        await this.process(task);
      } catch (error) {
        const receiveCount = Number(record.attributes.ApproximateReceiveCount || '1');
        if (task && receiveCount >= MAX_RECEIVE_COUNT) await this.markFailed(task, failureCode(error));
        this.logger.warn('PII scan task failed', {
          failureCode: task ? failureCode(error) : 'INVALID_TASK',
          receiveCount,
        });
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    }
    return { batchItemFailures };
  }

  private async process(task: PiiScanTask): Promise<void> {
    const startedAtMs = Date.now();
    const state = await this.getSuggestionState(task);
    if (
      state?.latestScan.scanId === task.scanId &&
      (state.latestScan.status === 'SUCCEEDED' || state.latestScan.status === 'CANCELLED')
    ) {
      return;
    }
    const configured = await this.getConfiguredTable(task);
    if (!configured || configured.piiDetectionEnabled !== true) {
      await this.updateLatestScan(task, {
        ...this.baseSummary(task),
        status: 'CANCELLED',
        completedAt: this.now().toISOString(),
      });
      return;
    }

    const startedAt = this.now().toISOString();
    const acquired = await this.updateLatestScan(task, {
      ...this.baseSummary(task),
      status: 'RUNNING',
      startedAt,
    });
    if (!acquired) return;

    const targetClient = await this.createTargetClient(task);
    const sampled = await new DynamoDbSampler(targetClient).sample(task.table);
    const flattened = new ObservationFlattener().flatten(sampled.items);
    const detectionResults = await this.detectorClient.detect(flattened.items);
    const suggestions = aggregateSuggestions(flattened.items, flattened.recordIndexById, detectionResults);
    const retainedSuggestions = truncateSuggestions(suggestions);
    const completedAt = this.now().toISOString();
    const latestScan: PiiScanSummary = {
      ...this.baseSummary(task),
      status: 'SUCCEEDED',
      startedAt,
      completedAt,
      evaluatedItemCount: sampled.evaluatedItemCount,
      sampledItemCount: sampled.items.length,
      analyzedObservationCount: flattened.items.length,
      skippedObservationCount: flattened.skippedObservationCount,
      unsupportedPathCount: detectionResults.filter((result) => result.status === 'UNSUPPORTED_PATH').length,
      consumedCapacityUnits: sampled.consumedCapacityUnits,
    };

    await this.docClient.send(
      new UpdateCommand({
        TableName: process.env.PII_SUGGESTIONS_TABLE_NAME,
        Key: { pk: getPiiSuggestionPk(task.accountId, task.region, task.table), sk: PII_SUGGESTION_STATE_SK },
        UpdateExpression:
          'SET #latestScan = :latestScan, #suggestions = :suggestions, #generatedAt = :generatedAt, #total = :total, #truncated = :truncated',
        ConditionExpression: '#latestScan.#scanId = :scanId',
        ExpressionAttributeNames: {
          '#latestScan': 'latestScan',
          '#scanId': 'scanId',
          '#suggestions': 'suggestions',
          '#generatedAt': 'suggestionsGeneratedAt',
          '#total': 'totalSuggestionCount',
          '#truncated': 'suggestionsTruncated',
        },
        ExpressionAttributeValues: {
          ':scanId': task.scanId,
          ':latestScan': latestScan,
          ':suggestions': retainedSuggestions,
          ':generatedAt': completedAt,
          ':total': suggestions.length,
          ':truncated': retainedSuggestions.length < suggestions.length,
        },
      }),
    );

    this.logger.info('PII scan completed', {
      evaluatedItemCount: sampled.evaluatedItemCount,
      sampledItemCount: sampled.items.length,
      analyzedObservationCount: flattened.items.length,
      skippedObservationCount: flattened.skippedObservationCount,
      suggestionCount: suggestions.length,
      durationMs: Date.now() - startedAtMs,
    });
  }

  private async getConfiguredTable(task: PiiScanTask): Promise<ConfiguredDynamoDbTable | undefined> {
    const response = await this.docClient.send(
      new GetCommand({
        TableName: process.env.CONFIGURED_TABLES_TABLE_NAME,
        Key: { pk: getConfiguredTablePk(task.accountId, task.region, task.table), sk: CONFIGURED_TABLE_SK },
      }),
    );
    return response.Item as ConfiguredDynamoDbTable | undefined;
  }

  private async getSuggestionState(task: PiiScanTask): Promise<PiiSuggestionState | undefined> {
    const response = await this.docClient.send(
      new GetCommand({
        TableName: process.env.PII_SUGGESTIONS_TABLE_NAME,
        Key: { pk: getPiiSuggestionPk(task.accountId, task.region, task.table), sk: PII_SUGGESTION_STATE_SK },
      }),
    );
    return response.Item as PiiSuggestionState | undefined;
  }

  private baseSummary(task: PiiScanTask): Pick<PiiScanSummary, 'scanId' | 'trigger' | 'requestedAt'> {
    return { scanId: task.scanId, trigger: task.trigger, requestedAt: task.requestedAt };
  }

  private async updateLatestScan(task: PiiScanTask, summary: PiiScanSummary): Promise<boolean> {
    try {
      await this.docClient.send(
        new UpdateCommand({
          TableName: process.env.PII_SUGGESTIONS_TABLE_NAME,
          Key: { pk: getPiiSuggestionPk(task.accountId, task.region, task.table), sk: PII_SUGGESTION_STATE_SK },
          UpdateExpression: 'SET #latestScan = :latestScan',
          ConditionExpression: '#latestScan.#scanId = :scanId',
          ExpressionAttributeNames: { '#latestScan': 'latestScan', '#scanId': 'scanId' },
          ExpressionAttributeValues: { ':scanId': task.scanId, ':latestScan': summary },
        }),
      );
      return true;
    } catch (error) {
      if (
        error instanceof ConditionalCheckFailedException ||
        (error as { name?: string }).name === 'ConditionalCheckFailedException'
      ) {
        return false;
      }
      throw error;
    }
  }

  private async markFailed(task: PiiScanTask, code: PiiScanFailureCode): Promise<void> {
    await this.updateLatestScan(task, {
      ...this.baseSummary(task),
      status: 'FAILED',
      completedAt: this.now().toISOString(),
      failureCode: code,
    });
  }
}

const detectorClient = new PiiDetectorClient(
  new LambdaClient({ region: process.env.AWS_REGION }),
  process.env.PII_DETECTOR_FUNCTION_NAME ?? '',
);
const handlerInstance = new LambdaHandler(new DynamoDBClient({ region: process.env.AWS_REGION }), detectorClient);
export const lambdaHandler = handlerInstance.handle.bind(handlerInstance);
