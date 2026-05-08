import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import { RequestStatusEvent } from './request-status-event';

export interface RequestStatusEventPublisher {
  publish(event: RequestStatusEvent): Promise<void>;
}

export class SnsRequestStatusEventPublisher implements RequestStatusEventPublisher {
  constructor(
    private readonly snsClient: SNSClient,
    private readonly topicArn = process.env.REQUEST_STATUS_TOPIC_ARN,
  ) {}

  async publish(event: RequestStatusEvent): Promise<void> {
    if (!this.topicArn) throw new Error('REQUEST_STATUS_TOPIC_ARN is not configured');

    await this.snsClient.send(
      new PublishCommand({
        TopicArn: this.topicArn,
        Message: JSON.stringify(event),
        Subject: event.eventType,
        MessageAttributes: {
          eventType: {
            DataType: 'String',
            StringValue: event.eventType,
          },
        },
      }),
    );
  }
}
