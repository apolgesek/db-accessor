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

// CORS preflight `allowMethods` per path, as deployed. `/record/{id}` and `/notifications` also allow POST,
// which has no method; kept so the deployed API is unchanged.
export const REST_PREFLIGHT_METHODS: Readonly<Record<string, readonly string[]>> = {
  '/record/{id}': ['OPTIONS', 'POST', 'GET'],
  '/request': ['OPTIONS', 'POST', 'GET'],
  '/request/{id}/unredact': ['OPTIONS', 'POST'],
  '/admin/request': ['OPTIONS', 'GET'],
  '/admin/approve-request': ['OPTIONS', 'PUT'],
  '/admin/reject-request': ['OPTIONS', 'PUT'],
  '/accounts': ['OPTIONS', 'GET'],
  '/tables': ['OPTIONS', 'GET'],
  '/configured-tables': ['OPTIONS', 'GET'],
  '/notifications': ['OPTIONS', 'GET', 'POST'],
  '/notifications/read': ['OPTIONS', 'POST'],
  '/admin/create-ruleset': ['OPTIONS', 'POST'],
  '/admin/ruleset': ['OPTIONS', 'GET'],
  '/admin/configured-tables': ['OPTIONS', 'POST', 'DELETE'],
  '/admin/configured-tables/pii-detection': ['OPTIONS', 'PUT'],
  '/admin/configured-tables/pii-suggestions': ['OPTIONS', 'GET'],
};
