import { AdminGetUserCommand, CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { CognitoRequesterEmailProvider } from './requester-email';

describe('CognitoRequesterEmailProvider', () => {
  test('fetches requester email from Cognito using app username prefix convention', async () => {
    const send = jest.fn().mockResolvedValue({
      UserAttributes: [{ Name: 'email', Value: 'requester@example.com' }],
    });
    const provider = new CognitoRequesterEmailProvider(
      { send } as unknown as CognitoIdentityProviderClient,
      'user-pool-1',
      'db-accessor_',
    );

    await expect(provider.getEmail('user-1')).resolves.toBe('requester@example.com');

    const command = send.mock.calls[0][0] as AdminGetUserCommand;
    expect(command.input).toEqual({
      UserPoolId: 'user-pool-1',
      Username: 'db-accessor_user-1',
    });
  });

  test('does not duplicate configured Cognito username prefix', async () => {
    const send = jest.fn().mockResolvedValue({
      UserAttributes: [{ Name: 'email', Value: 'requester@example.com' }],
    });
    const provider = new CognitoRequesterEmailProvider(
      { send } as unknown as CognitoIdentityProviderClient,
      'user-pool-1',
      'db-accessor_',
    );

    await provider.getEmail('db-accessor_user-1');

    const command = send.mock.calls[0][0] as AdminGetUserCommand;
    expect(command.input.Username).toBe('db-accessor_user-1');
  });
});
