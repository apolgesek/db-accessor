import { APIGatewayRequestAuthorizerEvent } from 'aws-lambda';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { lambdaHandler } from './main';

const mockVerify = jest.fn();

jest.mock('aws-jwt-verify', () => ({
  CognitoJwtVerifier: {
    create: jest.fn(() => ({ verify: mockVerify })),
  },
}));

describe('websocket authorizer', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    process.env.COGNITO_USER_POOL_ID = 'eu-central-1_pool';
    process.env.COGNITO_CLIENT_ID = 'client-id';
    mockVerify.mockReset();
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  test('allows a valid Cognito JWT from the token query parameter', async () => {
    mockVerify.mockResolvedValue({
      sub: 'sub-1',
      username: 'db-accessor_user-1',
      'cognito:groups': ['USER'],
    });

    const result = await lambdaHandler(createEvent({ token: 'Bearer token-1' }));

    expect(CognitoJwtVerifier.create).toHaveBeenCalledWith({
      userPoolId: 'eu-central-1_pool',
      tokenUse: null,
      clientId: 'client-id',
    });
    expect(mockVerify).toHaveBeenCalledWith('token-1');
    expect(result.principalId).toBe('user-1');
    expect(result.policyDocument.Statement[0].Effect).toBe('Allow');
    expect(result.context).toEqual({ username: 'user-1', sub: 'sub-1', groups: 'USER' });
  });

  test('denies when Cognito JWT verification fails', async () => {
    mockVerify.mockRejectedValue(new Error('invalid token'));

    const result = await lambdaHandler(createEvent({ token: 'token-1' }));

    expect(result.principalId).toBe('anonymous');
    expect(result.policyDocument.Statement[0].Effect).toBe('Deny');
  });
});

function createEvent(queryStringParameters: Record<string, string>): APIGatewayRequestAuthorizerEvent {
  return {
    type: 'REQUEST',
    methodArn: 'arn:aws:execute-api:eu-central-1:123456789012:api/dev/$connect',
    resource: '/$connect',
    path: '/$connect',
    httpMethod: 'GET',
    headers: null,
    multiValueHeaders: null,
    pathParameters: null,
    queryStringParameters,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {} as APIGatewayRequestAuthorizerEvent['requestContext'],
  };
}
