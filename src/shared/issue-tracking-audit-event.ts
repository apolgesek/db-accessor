export type IssueTrackingAuditEvent = {
  version: 1;
  eventType: 'RECORD_ACCESSED';
  issueKey: string;
  userId: string;
  requestId: string;
  tableName: string;
  targetPK: string;
  targetSK: string;
  accountId: string;
  region: string;
  dateTime: string;
  stage?: string;
};
