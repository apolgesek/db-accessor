import { SessionService } from '../../shared/session-service';
import { InMemorySessionStore } from '../../shared/testing/in-memory-session-store';
import { createSessionEvent, sessionClaims } from '../../shared/testing/session-events';
import { LambdaHandler } from './main';

const NOW = 1_800_000_000_000;

describe('POST /session/activity', () => {
  let store: InMemorySessionStore;
  let now: number;
  let handler: LambdaHandler;

  beforeEach(() => {
    process.env.COGNITO_CLIENT_ID = 'web-client';
    process.env.USERNAME_PREFIX = 'external-idp_';
    for (const level of ['log', 'info', 'warn', 'error'] as const) {
      jest.spyOn(console, level).mockImplementation();
    }
    store = new InMemorySessionStore();
    now = NOW;
    handler = new LambdaHandler(new SessionService(store, () => now));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('extends an active session to 15 minutes after the server time and increments its revision', async () => {
    store.records.set('lineage-1', activeRecord());

    const result = await handler.handle(createSessionEvent(sessionClaims()));

    expect(result.statusCode).toBe(200);
    expect(result.headers).toMatchObject({ 'Cache-Control': 'no-store' });
    expect(JSON.parse(result.body)).toEqual({
      sessionId: 'lineage-1',
      serverNow: NOW,
      idleExpiresAt: 1_800_000_900_000,
      revision: 4,
    });
    expect(store.records.get('lineage-1')).toEqual({
      ...activeRecord(),
      idleExpiresAt: 1_800_000_900_000,
      revision: 4,
    });
  });

  test.each([
    ['SESSION_EXPIRED', 'the idle deadline has passed', { idleExpiresAt: NOW }],
    ['SESSION_REVOKED', 'the session was explicitly ended', { invalidatedAt: NOW - 1000 }],
    ['SESSION_REQUIRED', 'the row belongs to another owner', { ownerSub: 'sub-2' }],
    ['SESSION_REQUIRED', 'the row belongs to another client', { clientId: 'other-client' }],
  ])('rejects the report with 401 %s when %s, without changing the row', async (code, _, ended) => {
    const row = { ...activeRecord(), ...ended };
    store.records.set('lineage-1', row);

    const result = await handler.handle(createSessionEvent(sessionClaims()));

    expect(result.statusCode).toBe(401);
    expect(result.headers).toMatchObject({ 'Cache-Control': 'no-store' });
    expect(JSON.parse(result.body)).toMatchObject({ code });
    expect(store.records.get('lineage-1')).toEqual(row);
  });

  test('returns 200 with the later deadline when a report loses the race to one sampled later', async () => {
    store.records.set('lineage-1', activeRecord());
    now = NOW + 60_000;
    await handler.handle(createSessionEvent(sessionClaims()));
    now = NOW;

    const result = await handler.handle(createSessionEvent(sessionClaims()));

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({
      sessionId: 'lineage-1',
      serverNow: NOW,
      idleExpiresAt: 1_800_000_960_000,
      revision: 4,
    });
    expect(store.records.get('lineage-1')).toMatchObject({ idleExpiresAt: 1_800_000_960_000, revision: 4 });
  });

  test('accepts concurrent reports at the same server time once, and answers both with that deadline', async () => {
    store.records.set('lineage-1', activeRecord());

    const results = await Promise.all([
      handler.handle(createSessionEvent(sessionClaims())),
      handler.handle(createSessionEvent(sessionClaims())),
    ]);

    expect(results.map((result) => result.statusCode)).toEqual([200, 200]);
    expect(results.map((result) => JSON.parse(result.body).idleExpiresAt)).toEqual([
      1_800_000_900_000, 1_800_000_900_000,
    ]);
    expect(store.records.get('lineage-1')).toMatchObject({ idleExpiresAt: 1_800_000_900_000, revision: 4 });
  });

  test('rejects a report for a lineage without a session, without creating one', async () => {
    const result = await handler.handle(createSessionEvent(sessionClaims()));

    expect(result.statusCode).toBe(401);
    expect(JSON.parse(result.body)).toEqual({ message: 'Session required', code: 'SESSION_REQUIRED' });
    expect(store.records.size).toBe(0);
  });

  test.each([
    ['an ID token', { token_use: 'id' }],
    ['a token without origin_jti', { origin_jti: undefined }],
  ])('rejects %s with 401 LOGIN_REQUIRED without touching the session', async (_, overrides) => {
    store.records.set('lineage-1', activeRecord());

    const result = await handler.handle(createSessionEvent(sessionClaims(overrides)));

    expect(result.statusCode).toBe(401);
    expect(JSON.parse(result.body)).toEqual({ message: 'Login required', code: 'LOGIN_REQUIRED' });
    expect(store.records.get('lineage-1')).toEqual(activeRecord());
  });

  test('reports an unavailable session store as 503', async () => {
    store.unavailable = true;

    const result = await handler.handle(createSessionEvent(sessionClaims()));

    expect(result.statusCode).toBe(503);
    expect(result.headers).toMatchObject({ 'Cache-Control': 'no-store' });
    expect(JSON.parse(result.body)).toEqual({ message: 'Session unavailable', code: 'SESSION_UNAVAILABLE' });
  });

  test('logs rejections but not accepted reports, and never logs session IDs', async () => {
    store.records.set('lineage-1', activeRecord());
    await handler.handle(createSessionEvent(sessionClaims()));

    expect(console.info).not.toHaveBeenCalled();

    store.records.set('lineage-1', { ...activeRecord(), idleExpiresAt: NOW });
    await handler.handle(createSessionEvent(sessionClaims()));

    const lines = (console.info as jest.Mock).mock.calls.map((args: unknown[]) => String(args[0]));
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      expect.objectContaining({ operation: 'recordActivity', outcome: 'rejected', reason: 'SESSION_EXPIRED' }),
    ]);
    expect(lines.join(' ')).not.toContain('lineage-1');
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
