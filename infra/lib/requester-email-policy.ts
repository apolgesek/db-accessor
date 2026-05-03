import { Stack } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';

export function createRequesterEmailPolicyStatement(stack: Stack, userPoolId: string) {
  return new iam.PolicyStatement({
    effect: iam.Effect.ALLOW,
    actions: ['cognito-idp:AdminGetUser'],
    resources: [
      stack.formatArn({
        service: 'cognito-idp',
        resource: 'userpool',
        resourceName: userPoolId,
      }),
    ],
  });
}
