import { AdminGetUserCommand, CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { toCognitoUsername } from './username';

export interface RequesterEmailProvider {
  getEmail(userId: string): Promise<string>;
}

export class CognitoRequesterEmailProvider implements RequesterEmailProvider {
  constructor(
    private readonly cognitoClient: CognitoIdentityProviderClient,
    private readonly userPoolId = process.env.COGNITO_USER_POOL_ID,
    private readonly usernamePrefix = process.env.USERNAME_PREFIX,
  ) {}

  async getEmail(userId: string): Promise<string> {
    if (!this.userPoolId) throw new Error('COGNITO_USER_POOL_ID is not configured');

    const response = await this.cognitoClient.send(
      new AdminGetUserCommand({
        UserPoolId: this.userPoolId,
        Username: toCognitoUsername(userId, this.usernamePrefix),
      }),
    );

    const email = response.UserAttributes?.find((attribute) => attribute.Name === 'email')?.Value;
    if (!email) throw new Error(`Cognito user ${userId} does not have an email attribute`);

    return email;
  }
}
