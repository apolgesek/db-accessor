import { IAMClient } from '@aws-sdk/client-iam';
import { IUserManager } from './user_manager.interface';
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
import crypto from 'crypto';

const slug = (s: string) =>
  String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
const IDENTITY_CENTER_REGION = process.env.IDENTITY_CENTER_REGION ?? 'eu-central-1';

export class SSOUserManager implements IUserManager<SSOGetUserContext, SSOAssignPolicyContext> {
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
        Name: this.setPermissionName('SSO', context.userName, context.tableName, context.partitionKey),
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

  private setPermissionName(prefix3: string, user: string, table: string, pk: string) {
    const canonical = `dynamodb:GetItem|user=${user}|table=${table}|pk=${pk}`;
    const hash = crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');

    const u = slug(user).slice(0, 8);
    const t = slug(table).slice(0, 10);
    const h = hash.slice(0, 8);

    return `${prefix3}_${u}_${t}_${h}`; // <= 32 by construction
  }
}
