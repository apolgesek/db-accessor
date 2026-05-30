import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

export function importIssueTrackingSecret(
  scope: Construct,
  projectName: string,
  baseProjectName: string,
  stage: string,
): secretsmanager.ISecret {
  return secretsmanager.Secret.fromSecretNameV2(
    scope,
    `${projectName}-issue-tracking-secret`,
    `${baseProjectName}/${stage}/issue-tracking`,
  );
}
