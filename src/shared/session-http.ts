import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { recordOperationalFailure } from './operational-metrics';
import { APIResponse } from './response';
import { SessionClaims, SessionRejection } from './session-policy';
import { SessionDecision } from './session-service';
import { SessionUnavailableError } from './session-store';
import { toAppUsername } from './username';

const NO_STORE = { headers: { 'Cache-Control': 'no-store' } };

const REJECTION_MESSAGES: Record<SessionRejection, string> = {
  SESSION_REQUIRED: 'Session required',
  SESSION_EXPIRED: 'Session expired',
  SESSION_REVOKED: 'Session revoked',
  LOGIN_REQUIRED: 'Login required',
};

export type SessionOperation = 'establish' | 'observe';

// Shared body of the session route handlers: claims, decision, response, structured log, and store failures.
// Logs carry no tokens or session IDs.
export async function handleSessionOperation(
  operation: SessionOperation,
  event: APIGatewayProxyEvent,
  decide: (claims: SessionClaims) => Promise<SessionDecision>,
  options: { logSuccess: boolean },
): Promise<APIGatewayProxyResult> {
  const startedAt = Date.now();
  const log = (outcome: string, reason?: string) =>
    console.info(
      JSON.stringify({
        operation,
        outcome,
        reason,
        requestId: event.requestContext?.requestId,
        latencyMs: Date.now() - startedAt,
      }),
    );

  const claims = sessionClaimsFrom(event, process.env.COGNITO_CLIENT_ID ?? '');
  if (!claims) {
    log('rejected', 'LOGIN_REQUIRED');
    return rejectionResponse('LOGIN_REQUIRED');
  }

  try {
    const decision = await decide(claims);
    if (!decision.ok) {
      log('rejected', decision.code);
      return rejectionResponse(decision.code);
    }

    if (options.logSuccess) log(decision.created ? 'created' : 'returned');
    return APIResponse.success(decision.created ? 201 : 200, decision.snapshot, NO_STORE);
  } catch (err) {
    if (!(err instanceof SessionUnavailableError)) throw err;

    log('unavailable', 'SESSION_UNAVAILABLE');
    recordOperationalFailure(operation);
    return APIResponse.error(503, 'Session unavailable', { ...NO_STORE, code: 'SESSION_UNAVAILABLE' });
  }
}

// Session identity from a validated web-client access token, or undefined when the token lacks it.
// There is no fallback identity from username, auth_time, or iat.
function sessionClaimsFrom(event: APIGatewayProxyEvent, webClientId: string): SessionClaims | undefined {
  const claims = event.requestContext?.authorizer?.claims ?? {};
  const { token_use: tokenUse, client_id: clientId, sub, origin_jti: sessionId, username } = claims;
  if (
    !webClientId ||
    tokenUse !== 'access' ||
    clientId !== webClientId ||
    !isNonEmptyString(sub) ||
    !isNonEmptyString(sessionId)
  ) {
    return undefined;
  }

  return {
    sessionId,
    ownerSub: sub,
    clientId,
    userId: typeof username === 'string' ? toAppUsername(username) : '',
  };
}

function rejectionResponse(code: SessionRejection): APIGatewayProxyResult {
  return APIResponse.error(401, REJECTION_MESSAGES[code], { ...NO_STORE, code });
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}
