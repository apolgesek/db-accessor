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
    'pk' | 'sk' | 'accountId' | 'region' | 'table' | 'targetPk' | 'targetSk' | 'reason' | 'userId' | 'issueKey'
  > & {
    comment?: string | null;
  };
  stage?: string;
};

export function getRequestIdFromSk(sk: string): string {
  return sk.split('#').at(-1) ?? sk;
}
