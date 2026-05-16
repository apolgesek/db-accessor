import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { SESv2Client } from '@aws-sdk/client-sesv2';
import { SQSBatchResponse, SQSEvent, SQSRecord } from 'aws-lambda';
import { RequesterEmailProvider, CognitoRequesterEmailProvider } from '../../shared/requester-email';
import { RequestStatusEmailNotifier, SesRequestStatusEmailNotifier } from '../../shared/request-status-email';
import { getRequestIdFromSk, RequestStatusEvent } from '../../shared/request-status-event';

class LambdaHandler {
  constructor(
    private readonly requestStatusEmailNotifier: RequestStatusEmailNotifier,
    private readonly requesterEmailProvider: RequesterEmailProvider,
  ) {}

  async handle(event: SQSEvent): Promise<SQSBatchResponse> {
    const batchItemFailures: SQSBatchResponse['batchItemFailures'] = [];

    for (const record of event.Records) {
      try {
        await this.processRecord(record);
      } catch (error) {
        console.warn('Failed to process request status email event', {
          messageId: record.messageId,
          error: error instanceof Error ? error.message : String(error),
        });
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    }

    return { batchItemFailures };
  }

  private async processRecord(record: SQSRecord): Promise<void> {
    const event = parseRequestStatusEvent(record.body);
    const requesterEmail = await this.requesterEmailProvider.getEmail(event.request.userId);

    await this.requestStatusEmailNotifier.sendRequestStatusMessage({
      recipientEmail: requesterEmail,
      status: event.status,
      id: getRequestIdFromSk(event.request.sk),
      accountId: event.request.accountId,
      region: event.request.region,
      targetPk: event.request.targetPk,
      targetSk: event.request.targetSk,
      reason: event.request.reason,
    });
  }
}

function parseRequestStatusEvent(body: string): RequestStatusEvent {
  const parsed = JSON.parse(body) as RequestStatusEvent;

  if (
    parsed.version !== 1 ||
    (parsed.eventType !== 'RequestApproved' && parsed.eventType !== 'RequestRejected') ||
    (parsed.status !== 'APPROVED' && parsed.status !== 'REJECTED')
  ) {
    throw new Error('Unsupported request status event');
  }

  return parsed;
}

const handlerInstance = new LambdaHandler(
  new SesRequestStatusEmailNotifier(new SESv2Client({ region: process.env.AWS_REGION })),
  new CognitoRequesterEmailProvider(new CognitoIdentityProviderClient({ region: process.env.AWS_REGION })),
);
export const lambdaHandler = handlerInstance.handle.bind(handlerInstance);
