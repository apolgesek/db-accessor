export type RequestNotification = {
  type: 'REQUEST_STATUS_CHANGED';
  id: string;
  userId: string;
  status: 'APPROVED' | 'REJECTED';
  requestId: string;
  requestPk: string;
  requestSk: string;
  accountId: string;
  region: string;
  table: string;
  targetPk: string;
  targetSk?: string;
  reason: string;
  comment?: string | null;
  decidedAt: string;
  actorUsername: string;
  readAt?: string;
};
