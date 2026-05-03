import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';

export interface RequestStatusEmailNotifier {
  sendTestMessage(): Promise<void>;
}

export class SesRequestStatusEmailNotifier implements RequestStatusEmailNotifier {
  constructor(
    private readonly sesClient: SESv2Client,
    private readonly sourceEmail = process.env.REQUEST_STATUS_EMAIL_SOURCE ?? 'noreply@4eyesdb.com',
    private readonly recipientEmail = process.env.REQUEST_STATUS_EMAIL_RECIPIENT ??
      process.env.REQUEST_STATUS_EMAIL_SOURCE ??
      'noreply@4eyesdb.com',
  ) {}

  async sendTestMessage(): Promise<void> {
    await this.sesClient.send(
      new SendEmailCommand({
        FromEmailAddress: this.sourceEmail,
        Destination: {
          ToAddresses: [this.recipientEmail],
        },
        Content: {
          Simple: {
            Subject: {
              Data: 'test',
            },
            Body: {
              Text: {
                Data: 'test',
              },
            },
          },
        },
      }),
    );
  }
}
