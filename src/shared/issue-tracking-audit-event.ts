export type IssueTrackingAuditEvent = {
  version: 1;
  eventType: 'RECORD_ACCESSED';
  issueKey: string;
  userId: string;
  requestId: string;
  table: string;
  targetPk: string;
  targetSk: string;
  accountId: string;
  region: string;
  dateTime: string;
  stage?: string;
};
