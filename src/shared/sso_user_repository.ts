import { IAMClient } from '@aws-sdk/client-iam';
import { IUserRepository } from './user_repository.interface';
import { GetUserIdCommand, IdentitystoreClient } from '@aws-sdk/client-identitystore';
import { Creds } from '../types/creds';
import { SSOGetUserContext } from '../types/sso_get_user_context';
import {
  CreatePermissionSetCommand,
  PutInlinePolicyToPermissionSetCommand,
  CreateAccountAssignmentCommand,
  SSOAdminClient,
} from '@aws-sdk/client-sso-admin';
import { SSOAssignPolicyContext } from '../types/sso_assign_policy_context';

const IDENTITY_CENTER_REGION = process.env.IDENTITY_CENTER_REGION ?? 'eu-central-1';

export class SSOUserRepository implements IUserRepository<SSOGetUserContext, SSOAssignPolicyContext> {
  constructor(private readonly _creds?: Creds) {}

  iamClient = new IAMClient({ region: process.env.AWS_REGION });
  _identityStore = new IdentitystoreClient({ region: IDENTITY_CENTER_REGION, credentials: this._creds });
  _ssoAdmin = new SSOAdminClient({ region: IDENTITY_CENTER_REGION, credentials: this._creds });

  async getUser(name: string, context: SSOGetUserContext): Promise<string | undefined> {
    const userIdRes = await this._identityStore.send(
      new GetUserIdCommand({
        IdentityStoreId: context?.identityStoreId,
        AlternateIdentifier: {
          UniqueAttribute: {
            AttributePath: 'userName',
            AttributeValue: name,
          },
        },
      }),
    );

    return userIdRes.UserId;
  }

  async assignPolicy(userId: string, policy: string, context: SSOAssignPolicyContext): Promise<string | undefined> {
    const psRes = await this._ssoAdmin.send(
      new CreatePermissionSetCommand({
        InstanceArn: context.instanceArn,
        Name: `SSOdynamodb_GetItemPolicy_${context.userName}_${context.tableName}_${context.partitionKey}`,
        SessionDuration: 'PT1H',
        Tags: [
          { Key: 'ExpiresAt', Value: context.expirationDate.getTime().toString() },
          { Key: 'UserName', Value: userId },
        ],
      }),
    );

    const permissionSetArn = psRes.PermissionSet?.PermissionSetArn;
    if (!permissionSetArn) throw new Error('Failed to create Permission Set');

    await this._ssoAdmin.send(
      new PutInlinePolicyToPermissionSetCommand({
        InstanceArn: context.instanceArn,
        PermissionSetArn: permissionSetArn,
        InlinePolicy: policy,
      }),
    );

    const assignRes = await this._ssoAdmin.send(
      new CreateAccountAssignmentCommand({
        InstanceArn: context.instanceArn,
        PermissionSetArn: permissionSetArn,
        PrincipalType: 'USER',
        PrincipalId: userId,
        TargetType: 'AWS_ACCOUNT',
        TargetId: context.awsAccountId,
      }),
    );

    const requestId = assignRes.AccountAssignmentCreationStatus?.RequestId;
    if (!requestId) throw new Error('Missing RequestId from CreateAccountAssignment.');

    return requestId;
  }
}
