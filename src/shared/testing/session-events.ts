import { APIGatewayProxyEvent } from 'aws-lambda';

// Claims as the REST Cognito authorizer passes them for a web-client access token. Fake values only.
export function sessionClaims(overrides: Record<string, string | undefined> = {}): Record<string, string> {
  const claims: Record<string, string | undefined> = {
    sub: 'sub-1',
    client_id: 'web-client',
    token_use: 'access',
    origin_jti: 'lineage-1',
    jti: 'token-1',
    username: 'external-idp_user-1',
    ...overrides,
  };

  return Object.fromEntries(Object.entries(claims).filter(([, value]) => value !== undefined)) as Record<
    string,
    string
  >;
}

export function createSessionEvent(claims: Record<string, string>): APIGatewayProxyEvent {
  return {
    body: null,
    headers: { Authorization: 'Bearer fake-access-token' },
    multiValueHeaders: {},
    httpMethod: 'POST',
    isBase64Encoded: false,
    path: '/session',
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    resource: '/session',
    requestContext: {
      requestId: 'request-1',
      authorizer: { claims },
    } as unknown as APIGatewayProxyEvent['requestContext'],
  };
}
