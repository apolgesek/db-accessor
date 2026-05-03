import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';

export type RequestStatusEmailMessage = {
  recipientEmail: string;
  status: 'APPROVED' | 'REJECTED';
  id: string;
  accountId: string;
  region: string;
  targetPK: string;
  targetSK?: string;
  reason: string;
};

export interface RequestStatusEmailNotifier {
  sendRequestStatusMessage(message: RequestStatusEmailMessage): Promise<void>;
}

export class SesRequestStatusEmailNotifier implements RequestStatusEmailNotifier {
  constructor(
    private readonly sesClient: SESv2Client,
    private readonly sourceEmail = process.env.REQUEST_STATUS_EMAIL_SOURCE ?? 'noreply@4eyesdb.com',
  ) {}

  async sendRequestStatusMessage(message: RequestStatusEmailMessage): Promise<void> {
    const subject = `[4Eyes] Request ${message.status.toLowerCase()}: ${message.id}`;
    const rows: Array<[string, string]> = [
      ['Status', message.status],
      ['Request ID', message.id],
      ['Account', message.accountId],
      ['Region', message.region],
      ['Target PK', message.targetPK],
      ['Target SK', message.targetSK ?? ''],
      ['Reason', message.reason],
    ];
    const bodyLines = [
      `Your request has been ${message.status.toLowerCase()}.`,
      '',
      `Status: ${message.status}`,
      `Request ID: ${message.id}`,
      `Account: ${message.accountId}`,
      `Region: ${message.region}`,
      `Target PK: ${message.targetPK}`,
      `Target SK: ${message.targetSK ?? ''}`,
      `Reason: ${message.reason}`,
    ];
    const htmlRows = rows
      .map(
        ([key, value]) =>
          `<tr><th align="left" style="border:1px solid #d0d7de;padding:8px;background:#f6f8fa;">${escapeHtml(
            key,
          )}</th><td style="border:1px solid #d0d7de;padding:8px;">${escapeHtml(value)}</td></tr>`,
      )
      .join('');
    const htmlBody = [
      '<!doctype html>',
      '<html>',
      '<body style="font-family:Arial,sans-serif;color:#24292f;">',
      `<p>Your request has been <strong>${escapeHtml(message.status.toLowerCase())}</strong>.</p>`,
      '<table style="border-collapse:collapse;border:1px solid #d0d7de;">',
      '<tbody>',
      htmlRows,
      '</tbody>',
      '</table>',
      '</body>',
      '</html>',
    ].join('');

    await this.sesClient.send(
      new SendEmailCommand({
        FromEmailAddress: this.sourceEmail,
        Destination: {
          ToAddresses: [message.recipientEmail],
        },
        Content: {
          Simple: {
            Subject: {
              Data: subject,
            },
            Body: {
              Text: {
                Data: bodyLines.join('\n'),
              },
              Html: {
                Data: htmlBody,
              },
            },
          },
        },
      }),
    );
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
