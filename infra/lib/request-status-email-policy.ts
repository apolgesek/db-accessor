import { Stack } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';

export function createRequestStatusEmailPolicyStatement(stack: Stack, sourceEmail: string) {
  void stack;

  return new iam.PolicyStatement({
    effect: iam.Effect.ALLOW,
    actions: ['ses:SendEmail'],
    resources: ['*'],
    conditions: {
      StringEquals: {
        'ses:FromAddress': sourceEmail,
      },
    },
  });
}
