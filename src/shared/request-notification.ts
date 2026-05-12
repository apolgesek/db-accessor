export type RequestNotification = {
  id: string;
  userId: string;
  status: 'APPROVED' | 'REJECTED';
  requestId: string;
  requestPK: string;
  requestSK: string;
  accountId: string;
  region: string;
  table: string;
  targetPK: string;
  targetSK?: string;
  reason: string;
  comment?: string | null;
  decidedAt: string;
  actorUsername: string;
  read?: boolean;
};

export type RequestNotificationEntity = {
  UserId: string;
  CreatedAt: string;
  NotificationId: string;
  Type: 'REQUEST_STATUS_CHANGED';
  Status: RequestNotification['status'];
  RequestId: string;
  RequestPK: string;
  RequestSK: string;
  AccountId: string;
  Region: string;
  TableName: string;
  TargetPK: string;
  TargetSK?: string;
  Reason: string;
  Comment?: string;
  ActorUsername: string;
  Read: boolean;
};
