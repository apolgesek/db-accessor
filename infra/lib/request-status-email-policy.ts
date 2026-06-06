import * as iam from 'aws-cdk-lib/aws-iam';

export function createRequestStatusEmailPolicyStatement(sourceEmail: string, emailIdentityArn: string) {
  return new iam.PolicyStatement({
    effect: iam.Effect.ALLOW,
    actions: ['ses:SendEmail'],
    resources: [emailIdentityArn],
    conditions: {
      StringEquals: {
        'ses:FromAddress': sourceEmail,
      },
    },
  });
}
