import {
  AttachUserPolicyCommand,
  CreatePolicyCommand,
  CreatePolicyCommandInput,
  GetUserCommand,
  IAMClient,
} from '@aws-sdk/client-iam';
import { IUserManager } from './user_manager.interface';
import { IAMAssignPolicyContext } from '../types/iam_assign_policy_context';

export class IAMUserManager implements IUserManager<never, IAMAssignPolicyContext> {
  _iamClient = new IAMClient({ region: process.env.AWS_REGION });

  async getUser(name: string): Promise<string | undefined> {
    const result = await this._iamClient.send(
      new GetUserCommand({
        UserName: name,
      }),
    );

    return result.User?.UserId;
  }

  async assignPolicy(userName: string, policy: string, context: IAMAssignPolicyContext): Promise<string | undefined> {
    const createPolicyParams: CreatePolicyCommandInput = {
      PolicyDocument: policy,
      PolicyName: `IAM_${userName}_${context.tableName}_${context.partitionKey}`,
      Tags: [
        { Key: 'ExpiresAt', Value: context.expirationDate.getTime().toString() },
        { Key: 'UserName', Value: userName },
      ],
    };

    const createPolicyOutput = await this._iamClient.send(new CreatePolicyCommand(createPolicyParams));
    const result = await this._iamClient.send(
      new AttachUserPolicyCommand({
        PolicyArn: createPolicyOutput.Policy?.Arn,
        UserName: userName,
      }),
    );

    return result.$metadata.requestId;
  }
}
