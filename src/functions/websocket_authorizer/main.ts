import {
  APIGatewayAuthorizerResult,
  APIGatewayRequestAuthorizerEvent,
  APIGatewayRequestAuthorizerEventV2,
} from 'aws-lambda';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { toAppUsername } from '../../shared/username';

type AuthorizerEvent = APIGatewayRequestAuthorizerEvent | APIGatewayRequestAuthorizerEventV2;

type CognitoClaims = {
  sub?: string;
  username?: string;
  ['cognito:username']?: string;
  ['cognito:groups']?: string[];
};

let verifier: ReturnType<typeof CognitoJwtVerifier.create> | undefined;

class LambdaHandler {
  async handle(event: AuthorizerEvent): Promise<APIGatewayAuthorizerResult> {
    const methodArn = 'methodArn' in event ? event.methodArn : event.routeArn;

    try {
      const token = getBearerToken(event);
      if (!token) return createPolicy('anonymous', 'Deny', methodArn);

      const claims = await getVerifier().verify(token);
      const usernameClaim = claims.username ?? claims['cognito:username'];
      if (!usernameClaim) throw new Error('JWT missing username');
      if (!claims.sub) throw new Error('JWT missing sub');

      const username = toAppUsername(usernameClaim);

      return {
        ...createPolicy(username, 'Allow', methodArn),
        context: {
          username,
          sub: claims.sub,
          groups: normalizeGroups(claims['cognito:groups']).join(','),
        },
      };
    } catch (error) {
      console.warn('WebSocket authorization failed', error);
      return createPolicy('anonymous', 'Deny', methodArn);
    }
  }
}

function getBearerToken(event: AuthorizerEvent): string {
  const authorization = getQueryStringParameter(event, 'token');

  if (!authorization) return '';

  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return (match?.[1] ?? authorization).trim();
}

function getVerifier() {
  verifier ??= CognitoJwtVerifier.create({
    userPoolId: getRequiredEnv('COGNITO_USER_POOL_ID'),
    tokenUse: null,
    clientId: getRequiredEnv('COGNITO_CLIENT_ID'),
  });

  return verifier as { verify: (token: string) => Promise<CognitoClaims> };
}

function createPolicy(principalId: string, effect: 'Allow' | 'Deny', resource: string): APIGatewayAuthorizerResult {
  return {
    principalId,
    policyDocument: {
      Version: '2012-10-17',
      Statement: [
        {
          Action: 'execute-api:Invoke',
          Effect: effect,
          Resource: resource,
        },
      ],
    },
  };
}

function getQueryStringParameter(event: AuthorizerEvent, name: string): string | undefined {
  const params = event.queryStringParameters ?? {};
  const key = Object.keys(params).find((paramName) => paramName.toLowerCase() === name.toLowerCase());
  return key ? params[key] : undefined;
}

function normalizeGroups(groups: string[] | undefined): string[] {
  return groups ?? [];
}

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

const handlerInstance = new LambdaHandler();
export const lambdaHandler = handlerInstance.handle.bind(handlerInstance);
