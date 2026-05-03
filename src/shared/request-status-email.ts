import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';

export interface RequestStatusEmailNotifier {
  sendTestMessage(recipientEmail: string): Promise<void>;
}

export class SesRequestStatusEmailNotifier implements RequestStatusEmailNotifier {
  constructor(
    private readonly sesClient: SESv2Client,
    private readonly sourceEmail = process.env.REQUEST_STATUS_EMAIL_SOURCE ?? 'noreply@4eyesdb.com',
  ) {}

  async sendTestMessage(recipientEmail: string): Promise<void> {
    await this.sesClient.send(
      new SendEmailCommand({
        FromEmailAddress: this.sourceEmail,
        Destination: {
          ToAddresses: [recipientEmail],
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
