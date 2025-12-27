import { APIGatewayProxyEvent } from 'aws-lambda';

export function getBearerToken(event: APIGatewayProxyEvent): string | null {
  const h = event.headers || {};
  const auth = h.Authorization || h.authorization;
  if (!auth) return null;
  const m = auth.match(/^Bearer\s+(.+)$/i);

  return m ? m[1] : null;
}
