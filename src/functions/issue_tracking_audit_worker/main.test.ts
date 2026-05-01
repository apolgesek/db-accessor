import { ChangeMessageVisibilityCommand, SQSClient } from '@aws-sdk/client-sqs';
import { SQSRecord } from 'aws-lambda';
import { IssueTrackingAuditEvent } from '../../shared/issue-tracking-audit-event';
import {
  buildCommentDocument,
  getRetryDelaySeconds,
  IssueTrackingAuditWorker,
  IssueTrackingClient,
  IssueTrackingCredentialsProvider,
} from './main';

const auditEvent: IssueTrackingAuditEvent = {
  version: 1,
  eventType: 'RECORD_ACCESSED',
  issueKey: 'FEYES-5',
  userId: 'user-1',
  requestId: 'REQUEST#1',
  tableName: 'Customers',
  targetPK: 'CUSTOMER#1',
  targetSK: 'N/A',
  accountId: '123456789012',
  region: 'eu-central-1',
  dateTime: '2026-05-01T12:00:00.000Z',
  stage: 'dev',
};

function makeRecord(overrides: Partial<SQSRecord> = {}): SQSRecord {
  return {
    messageId: 'message-1',
    receiptHandle: 'receipt-1',
    body: JSON.stringify(auditEvent),
    attributes: {
      ApproximateReceiveCount: '2',
      SentTimestamp: '0',
      SenderId: 'sender',
      ApproximateFirstReceiveTimestamp: '0',
    },
    messageAttributes: {},
    md5OfBody: '',
    eventSource: 'aws:sqs',
    eventSourceARN: 'arn:aws:sqs:eu-central-1:123456789012:queue',
    awsRegion: 'eu-central-1',
    ...overrides,
  };
}

describe('issue tracking audit worker helpers', () => {
  test('computes exponential retry delay with cap', () => {
    expect(getRetryDelaySeconds(1)).toBe(30);
    expect(getRetryDelaySeconds(2)).toBe(60);
    expect(getRetryDelaySeconds(7)).toBe(1_800);
    expect(getRetryDelaySeconds(20)).toBe(1_800);
  });

  test('builds ADF comment without record contents', () => {
    const document = buildCommentDocument(auditEvent);
    const serialized = JSON.stringify(document);

    expect(document.type).toBe('doc');
    expect(serialized).toContain('User: user-1');
    expect(serialized).toContain('Table: Customers');
    expect(serialized).not.toContain('item');
  });
});

describe('IssueTrackingClient', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('posts audit comment to issue tracking service with API token basic auth', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);
    const credentialsProvider = {
      getCredentials: jest.fn().mockResolvedValue({
        domain: 'https://4eyes.atlassian.net/',
        email: 'service@example.com',
        apiToken: 'token-1',
      }),
    } as unknown as IssueTrackingCredentialsProvider;
    const client = new IssueTrackingClient(credentialsProvider);

    await client.addAuditComment(auditEvent);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://4eyes.atlassian.net/rest/api/3/issue/FEYES-5/comment');
    expect(init?.headers).toMatchObject({
      Authorization: `Basic ${Buffer.from('service@example.com:token-1').toString('base64')}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    });
    expect(init?.body).toContain('Record access audit');
    expect(init?.body).not.toContain('apiToken');
  });

  test('throws for non-2xx issue tracking responses', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 401,
      text: jest.fn().mockResolvedValue('Unauthorized'),
    } as unknown as Response);
    const credentialsProvider = {
      getCredentials: jest.fn().mockResolvedValue({
        domain: '4eyes.atlassian.net',
        email: 'service@example.com',
        apiToken: 'token-1',
      }),
    } as unknown as IssueTrackingCredentialsProvider;
    const client = new IssueTrackingClient(credentialsProvider);

    await expect(client.addAuditComment(auditEvent)).rejects.toThrow('Issue tracking comment request failed with 401');
  });
});

describe('IssueTrackingAuditWorker', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('reports failed message and changes visibility for retry', async () => {
    jest.spyOn(console, 'warn').mockImplementation();
    const issueTrackingClient = {
      addAuditComment: jest.fn().mockRejectedValue(new Error('Issue tracking service unavailable')),
    } as unknown as IssueTrackingClient;
    const send = jest.fn().mockResolvedValue({});
    const worker = new IssueTrackingAuditWorker(
      issueTrackingClient,
      { send } as unknown as SQSClient,
      'https://sqs.example/queue',
    );
    const record = makeRecord();

    const response = await worker.handle({ Records: [record] });

    expect(response).toEqual({ batchItemFailures: [{ itemIdentifier: 'message-1' }] });
    const command = send.mock.calls[0][0] as ChangeMessageVisibilityCommand;
    expect(command.input).toEqual({
      QueueUrl: 'https://sqs.example/queue',
      ReceiptHandle: 'receipt-1',
      VisibilityTimeout: 60,
    });
  });
});
