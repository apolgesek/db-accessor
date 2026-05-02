import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { ChangeMessageVisibilityCommand, SQSClient } from '@aws-sdk/client-sqs';
import { SQSBatchResponse, SQSEvent, SQSRecord } from 'aws-lambda';
import { fetchWithTimeout, RequestTimeoutOptions } from '../../shared/fetch.util';
import { IssueTrackingAuditEvent } from '../../shared/issue-tracking-audit-event';
import {
  getRateLimitRetryDelaySeconds,
  getRetryDelaySeconds,
  parseRetryAfterSeconds,
  RateLimitError,
} from '../../shared/retry.util';

const ISSUE_TRACKING_POST_TIMEOUT_MS = 3_000;

type IssueTrackingSecret = {
  cloudId: string;
  email: string;
  apiToken: string;
};

type AtlassianDocument = {
  type: 'doc';
  version: 1;
  content: Array<{
    type: 'paragraph';
    content: Array<{
      type: 'text';
      text: string;
    }>;
  }>;
};

export class IssueTrackingAuditWorker {
  constructor(
    private readonly issueTrackingClient: IssueTrackingClient,
    private readonly sqsClient: SQSClient,
    private readonly queueUrl?: string,
    private readonly random: () => number = Math.random,
  ) {}

  async handle(event: SQSEvent): Promise<SQSBatchResponse> {
    const batchItemFailures = [];

    for (const record of event.Records) {
      try {
        await this.processRecord(record);
      } catch (err) {
        console.warn('Failed to process issue tracking audit event', {
          messageId: record.messageId,
          receiveCount: record.attributes.ApproximateReceiveCount,
          error: err instanceof Error ? err.message : String(err),
        });

        await this.delayRetry(record, err);
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    }

    return { batchItemFailures };
  }

  private async processRecord(record: SQSRecord): Promise<void> {
    const auditEvent = parseIssueTrackingAuditEvent(record.body);
    await this.issueTrackingClient.addAuditComment(auditEvent);
  }

  private async delayRetry(record: SQSRecord, err: unknown): Promise<void> {
    if (!this.queueUrl) {
      console.warn('Issue tracking audit queue URL is not configured; using queue default visibility timeout');
      return;
    }

    const receiveCount = Number.parseInt(record.attributes.ApproximateReceiveCount || '1', 10);
    const retryCount = Number.isNaN(receiveCount) ? 1 : receiveCount;
    const visibilityTimeout =
      err instanceof RateLimitError
        ? getRateLimitRetryDelaySeconds(retryCount, err.retryAfterSeconds, this.random())
        : getRetryDelaySeconds(retryCount);

    try {
      await this.sqsClient.send(
        new ChangeMessageVisibilityCommand({
          QueueUrl: this.queueUrl,
          ReceiptHandle: record.receiptHandle,
          VisibilityTimeout: visibilityTimeout,
        }),
      );
    } catch (err) {
      console.warn('Failed to change issue tracking audit message visibility', {
        messageId: record.messageId,
        visibilityTimeout,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

export class IssueTrackingClient {
  private readonly requestTimeoutMs: number;

  constructor(
    private readonly credentialsProvider: IssueTrackingCredentialsProvider,
    options: RequestTimeoutOptions = {},
  ) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? ISSUE_TRACKING_POST_TIMEOUT_MS;
  }

  async addAuditComment(event: IssueTrackingAuditEvent): Promise<void> {
    const secret = await this.credentialsProvider.getCredentials();
    const issueKey = encodeURIComponent(event.issueKey || 'FEYES-5');
    const url = `https://api.atlassian.com/ex/jira/${secret.cloudId}/rest/api/3/issue/${issueKey}/comment`;
    const auth = Buffer.from(`${secret.email}:${secret.apiToken}`).toString('base64');
    const body = JSON.stringify({ body: buildCommentDocument(event) });

    await fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body,
      },
      this.requestTimeoutMs,
      async (response) => {
        if (response.ok) return;

        const responseBody = await response.text();

        if (response.status === 429) {
          throw new RateLimitError(
            `Issue tracking comment request rate limited with 429: ${responseBody}`,
            parseRetryAfterSeconds(response.headers.get('Retry-After')),
          );
        }

        throw new Error(`Issue tracking comment request failed with ${response.status}: ${responseBody}`);
      },
    );
  }
}

export class IssueTrackingCredentialsProvider {
  private cachedSecret?: IssueTrackingSecret;

  constructor(private readonly secretsClient: SecretsManagerClient, private readonly secretName?: string) {}

  async getCredentials(): Promise<IssueTrackingSecret> {
    if (this.cachedSecret) return this.cachedSecret;
    if (!this.secretName) throw new Error('ISSUE_TRACKING_SECRET_NAME is not configured');

    const response = await this.secretsClient.send(new GetSecretValueCommand({ SecretId: this.secretName }));
    if (!response.SecretString) throw new Error('Issue tracking secret must contain SecretString JSON');

    const secret = parseIssueTrackingSecret(response.SecretString);
    this.cachedSecret = secret;
    return secret;
  }
}

export function buildCommentDocument(event: IssueTrackingAuditEvent): AtlassianDocument {
  const details = [
    `Record access audit`,
    `User: ${event.userId}`,
    `Request: ${event.requestId}`,
    `Table: ${event.tableName}`,
    `Target PK: ${event.targetPK}`,
    `Target SK: ${event.targetSK ?? 'N/A'}`,
    `Account: ${event.accountId}`,
    `Region: ${event.region}`,
    `Occurred at: ${event.dateTime}`,
  ];

  if (event.stage) details.push(`Stage: ${event.stage}`);

  return {
    type: 'doc',
    version: 1,
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: details.join(' | ') }],
      },
    ],
  };
}

function parseIssueTrackingSecret(secretString: string): IssueTrackingSecret {
  const secret = JSON.parse(secretString) as Partial<IssueTrackingSecret>;

  if (!secret.cloudId || !secret.email || !secret.apiToken) {
    throw new Error('Issue tracking secret must include cloudId, email, and apiToken');
  }

  return {
    cloudId: secret.cloudId,
    email: secret.email,
    apiToken: secret.apiToken,
  };
}

function parseIssueTrackingAuditEvent(body: string): IssueTrackingAuditEvent {
  const event = JSON.parse(body) as Partial<IssueTrackingAuditEvent>;

  if (
    event.version !== 1 ||
    event.eventType !== 'RECORD_ACCESSED' ||
    !event.issueKey ||
    !event.userId ||
    !event.requestId ||
    !event.tableName ||
    !event.targetPK ||
    !event.accountId ||
    !event.region ||
    !event.dateTime
  ) {
    throw new Error('Invalid issue tracking audit event');
  }

  return event as IssueTrackingAuditEvent;
}

const handlerInstance = new IssueTrackingAuditWorker(
  new IssueTrackingClient(
    new IssueTrackingCredentialsProvider(
      new SecretsManagerClient({ region: process.env.AWS_REGION }),
      process.env.ISSUE_TRACKING_SECRET_NAME,
    ),
  ),
  new SQSClient({ region: process.env.AWS_REGION }),
  process.env.ISSUE_TRACKING_AUDIT_QUEUE_URL,
);

export const lambdaHandler = handlerInstance.handle.bind(handlerInstance);
