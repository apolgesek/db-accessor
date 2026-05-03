import { Stack } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';

export function createRequestStatusEmailPolicyStatement(stack: Stack, sourceEmail: string) {
  const sourceEmailDomain = sourceEmail.split('@')[1];

  return new iam.PolicyStatement({
    effect: iam.Effect.ALLOW,
    actions: ['ses:SendEmail'],
    resources: [
      stack.formatArn({
        service: 'ses',
        resource: 'identity',
        resourceName: sourceEmail,
      }),
      stack.formatArn({
        service: 'ses',
        resource: 'identity',
        resourceName: sourceEmailDomain,
      }),
    ],
    conditions: {
      StringEquals: {
        'ses:FromAddress': sourceEmail,
      },
    },
  });
}
