export type ApprovedBy = {
  role: 'ADMIN';
  approvedAt: string;
  username: string;
};

export type RejectedBy = {
  role: 'ADMIN';
  rejectedAt: string;
  username: string;
};

export type UnredactRequest = {
  requestId: string;
  createdAt: string;
  approvalRequired: boolean;
  reason: string;
  paths: string[];
  approvedBy?: ApprovedBy[];
};

export type EntityRequest = {
  gsiAllPk: string;
  gsiAllSk: string;
  gsiPendingPk: string;
  gsiPendingSk: string;
  pk: string;
  sk: string;
  accountId: string;
  createdAt: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  reason: string;
  issueKey: string;
  duration: number;
  region: string;
  table: string;
  userId: string;
  targetPk: string;
  targetSk?: string;
  comment?: string | null;
  rejectedBy?: RejectedBy;
  approvedBy?: ApprovedBy[];
  unredactRequests?: UnredactRequest[];
};
