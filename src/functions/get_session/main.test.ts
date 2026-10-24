import { SessionService } from '../../shared/session-service';
import { InMemorySessionStore } from '../../shared/testing/in-memory-session-store';
import { createSessionEvent, sessionClaims } from '../../shared/testing/session-events';
import { LambdaHandler } from './main';

const NOW = 1_800_000_000_000;

describe('GET /session', () => {
  let store: InMemorySessionStore;
  let handler: LambdaHandler;

  beforeEach(() => {
    process.env.COGNITO_CLIENT_ID = 'web-client';
    process.env.USERNAME_PREFIX = 'external-idp_';
    for (const level of ['log', 'info', 'warn', 'error'] as const) {
      jest.spyOn(console, level).mockImplementation();
    }
    store = new InMemorySessionStore();
    handler = new LambdaHandler(new SessionService(store, () => NOW));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('returns the active session without extending it', async () => {
    store.records.set('lineage-1', activeRecord());

    const result = await handler.handle(createSessionEvent(sessionClaims()));

    expect(result.statusCode).toBe(200);
    expect(result.headers).toMatchObject({ 'Cache-Control': 'no-store' });
    expect(JSON.parse(result.body)).toEqual({
      sessionId: 'lineage-1',
      serverNow: NOW,
      idleExpiresAt: 1_800_000_300_000,
      revision: 3,
    });
    expect(store.records.get('lineage-1')).toEqual(activeRecord());
  });

  test.each([
    ['SESSION_REQUIRED', 'no row exists for the lineage', undefined],
    ['SESSION_REQUIRED', 'the row belongs to another owner', { ownerSub: 'sub-2' }],
    ['SESSION_EXPIRED', 'the idle deadline has passed', { idleExpiresAt: NOW }],
    ['SESSION_REVOKED', 'the session was explicitly ended', { invalidatedAt: NOW - 1000 }],
  ])('returns 401 %s when %s, without creating a row', async (code, _, overrides) => {
    if (overrides) store.records.set('lineage-1', { ...activeRecord(), ...overrides });

    const result = await handler.handle(createSessionEvent(sessionClaims()));

    expect(result.statusCode).toBe(401);
    expect(JSON.parse(result.body)).toMatchObject({ code });
    expect(store.records.size).toBe(overrides ? 1 : 0);
  });

  test('reports an unavailable session store as 503', async () => {
    store.unavailable = true;

    const result = await handler.handle(createSessionEvent(sessionClaims()));

    expect(result.statusCode).toBe(503);
    expect(JSON.parse(result.body)).toEqual({ message: 'Session unavailable', code: 'SESSION_UNAVAILABLE' });
  });
});

function activeRecord() {
  return {
    sessionId: 'lineage-1',
    ownerSub: 'sub-1',
    clientId: 'web-client',
    userId: 'user-1',
    createdAt: NOW - 20 * 60 * 1000,
    idleExpiresAt: NOW + 5 * 60 * 1000,
    revision: 3,
    ttl: 1_800_129_300,
  };
}
