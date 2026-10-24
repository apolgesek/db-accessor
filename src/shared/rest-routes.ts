// Every REST method, as data. The CDK REST API is built from this table, and backend tests import it,
// so it must not depend on CDK.

export type RestMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

// `session`: requires an active browser login session. `sessionLifecycle`: the session routes themselves.
export type RestRoutePolicy = 'session' | 'sessionLifecycle';

export type RestRoute = {
  method: RestMethod;
  path: string;
  functionName: string; // kebab-case Lambda name; its entrypoint is src/functions/<snake_case>/main.ts
  policy: RestRoutePolicy;
};

export const REST_ROUTES = [
  { method: 'GET', path: '/record/{id}', functionName: 'get-record', policy: 'session' },
  { method: 'POST', path: '/request', functionName: 'create-request', policy: 'session' },
  { method: 'GET', path: '/request', functionName: 'get-request', policy: 'session' },
  { method: 'POST', path: '/request/{id}/unredact', functionName: 'create-unredact-request', policy: 'session' },
  { method: 'GET', path: '/admin/request', functionName: 'admin-get-request', policy: 'session' },
  { method: 'PUT', path: '/admin/approve-request', functionName: 'admin-approve-request', policy: 'session' },
  { method: 'PUT', path: '/admin/reject-request', functionName: 'admin-reject-request', policy: 'session' },
  { method: 'GET', path: '/accounts', functionName: 'get-accounts', policy: 'session' },
  { method: 'GET', path: '/tables', functionName: 'get-tables', policy: 'session' },
  { method: 'GET', path: '/configured-tables', functionName: 'get-configured-tables', policy: 'session' },
  { method: 'GET', path: '/notifications', functionName: 'get-notifications', policy: 'session' },
  { method: 'POST', path: '/notifications/read', functionName: 'mark-notifications-read', policy: 'session' },
  { method: 'POST', path: '/admin/create-ruleset', functionName: 'admin-create-ruleset', policy: 'session' },
  { method: 'GET', path: '/admin/ruleset', functionName: 'admin-get-ruleset', policy: 'session' },
  {
    method: 'POST',
    path: '/admin/configured-tables',
    functionName: 'admin-create-configured-table',
    policy: 'session',
  },
  {
    method: 'PUT',
    path: '/admin/configured-tables/pii-detection',
    functionName: 'admin-update-pii-detection',
    policy: 'session',
  },
  {
    method: 'GET',
    path: '/admin/configured-tables/pii-suggestions',
    functionName: 'admin-get-pii-suggestions',
    policy: 'session',
  },
  {
    method: 'DELETE',
    path: '/admin/configured-tables',
    functionName: 'admin-delete-configured-table',
    policy: 'session',
  },
] as const satisfies readonly RestRoute[];

export type RestFunctionName = (typeof REST_ROUTES)[number]['functionName'];
export type RestPath = (typeof REST_ROUTES)[number]['path'];
export type RestPreflightMethod = 'OPTIONS' | RestMethod;

// Deployed preflight `allowMethods` that cannot be derived from the routes: both also allow POST, which has
// no method. Kept so the deployed API is unchanged.
export const REST_PREFLIGHT_OVERRIDES: Partial<Record<RestPath, readonly RestPreflightMethod[]>> = {
  '/record/{id}': ['OPTIONS', 'POST', 'GET'],
  '/notifications': ['OPTIONS', 'GET', 'POST'],
};

// CORS preflight `allowMethods` per routed path: OPTIONS, then the path's methods in table order.
export const REST_PREFLIGHT_METHODS: ReadonlyMap<RestPath, readonly RestPreflightMethod[]> = (() => {
  const derived = new Map<RestPath, RestPreflightMethod[]>();
  for (const route of REST_ROUTES) {
    derived.set(route.path, [...(derived.get(route.path) ?? ['OPTIONS']), route.method]);
  }
  return new Map([...derived].map(([path, methods]) => [path, REST_PREFLIGHT_OVERRIDES[path] ?? methods]));
})();
