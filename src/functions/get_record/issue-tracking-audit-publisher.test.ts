import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { IssueTrackingAuditEvent } from '../../shared/issue-tracking-audit-event';
import { SqsIssueTrackingAuditPublisher } from './main';

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

describe('SqsIssueTrackingAuditPublisher', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('sends issue tracking audit event to SQS', async () => {
    const send = jest.fn().mockResolvedValue({});
    const publisher = new SqsIssueTrackingAuditPublisher({ send } as unknown as SQSClient, 'https://sqs.example/queue');

    await publisher.publish(auditEvent);

    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0][0] as SendMessageCommand;
    expect(command.input).toEqual({
      QueueUrl: 'https://sqs.example/queue',
      MessageBody: JSON.stringify(auditEvent),
    });
  });

  test('does not call SQS when queue URL is missing', async () => {
    jest.spyOn(console, 'warn').mockImplementation();
    const send = jest.fn().mockResolvedValue({});
    const publisher = new SqsIssueTrackingAuditPublisher({ send } as unknown as SQSClient);

    await publisher.publish(auditEvent);

    expect(send).not.toHaveBeenCalled();
  });
});
