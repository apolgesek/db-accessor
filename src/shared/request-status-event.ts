import { EntityRequest } from './entity-request';

export type RequestStatusEventType = 'RequestApproved' | 'RequestRejected';
export type RequestStatusDecision = 'APPROVED' | 'REJECTED';

export type RequestStatusEvent = {
  version: 1;
  eventType: RequestStatusEventType;
  status: RequestStatusDecision;
  decidedAt: string;
  actor: {
    role: 'ADMIN';
    username: string;
  };
  request: Pick<
    EntityRequest,
    'PK' | 'SK' | 'accountId' | 'region' | 'table' | 'targetPK' | 'targetSK' | 'reason' | 'userId' | 'issueKey'
  > & {
    comment?: string | null;
  };
  stage?: string;
};

export function getRequestIdFromSk(SK: string): string {
  return SK.split('#').at(-1) ?? SK;
}
