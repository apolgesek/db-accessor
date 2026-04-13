import { AssumeRoleCommand, STSClient } from '@aws-sdk/client-sts';

type StsCreds = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
};

type CachedSession = {
  creds: StsCreds;
  expiresAtMs: number;
};

const RENEWAL_WINDOW_MS = 5 * 60 * 1000;
const FALLBACK_TTL_MS = 60 * 1000;

const sessionCacheByAccountAndRegion = new Map<string, CachedSession>();
const inFlightRefreshByAccountAndRegion = new Map<string, Promise<CachedSession>>();

function getCacheKey(accountId: string, region: string): string {
  return `${accountId}:${region}`;
}

function isSessionFresh(session: CachedSession): boolean {
  return Date.now() < session.expiresAtMs - RENEWAL_WINDOW_MS;
}

function isSessionNotExpired(session: CachedSession): boolean {
  return Date.now() < session.expiresAtMs;
}

async function assumeStsSession(accountId: string, region: string): Promise<CachedSession> {
  const sts = new STSClient({ region });

  const res = await sts.send(
    new AssumeRoleCommand({
      // todo: fetch from lambda execution role policy and pass in request
      RoleArn: `arn:aws:iam::${accountId}:role/DbAccessorAppRole`,
      RoleSessionName: `GetDbRecordSession_${Date.now()}`,
      DurationSeconds: 900,
    }),
  );

  if (!res.Credentials) throw new Error('AssumeRole returned no credentials');
  if (!res.Credentials.AccessKeyId) throw new Error('AssumeRole returned no access key id');
  if (!res.Credentials.SecretAccessKey) throw new Error('AssumeRole returned no secret access key');
  if (!res.Credentials.SessionToken) throw new Error('AssumeRole returned no session token');

  return {
    creds: {
      accessKeyId: res.Credentials.AccessKeyId,
      secretAccessKey: res.Credentials.SecretAccessKey,
      sessionToken: res.Credentials.SessionToken,
    },
    expiresAtMs: res.Credentials.Expiration?.getTime() ?? Date.now() + FALLBACK_TTL_MS,
  };
}

export async function getStsSession(accountId: string, region: string) {
  const cacheKey = getCacheKey(accountId, region);
  const cachedSession = sessionCacheByAccountAndRegion.get(cacheKey);

  if (cachedSession && isSessionFresh(cachedSession)) {
    return cachedSession.creds;
  }

  const inFlightRefresh = inFlightRefreshByAccountAndRegion.get(cacheKey);
  if (inFlightRefresh) {
    return (await inFlightRefresh).creds;
  }

  const refreshPromise = assumeStsSession(accountId, region)
    .then((newSession) => {
      sessionCacheByAccountAndRegion.set(cacheKey, newSession);
      return newSession;
    })
    .finally(() => {
      inFlightRefreshByAccountAndRegion.delete(cacheKey);
    });

  inFlightRefreshByAccountAndRegion.set(cacheKey, refreshPromise);

  try {
    return (await refreshPromise).creds;
  } catch (error) {
    if (cachedSession && isSessionNotExpired(cachedSession)) {
      return cachedSession.creds;
    }
    throw error;
  }
}
