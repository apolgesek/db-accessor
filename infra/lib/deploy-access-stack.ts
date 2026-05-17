import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface DbAccessorDeployAccessStackProps extends cdk.StackProps {
  projectName: string;
  githubOrg: string;
  githubRepo: string;
  stage: 'dev' | 'prod';
}

export class DbAccessorDeployAccessStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: DbAccessorDeployAccessStackProps) {
    super(scope, id, props);

    const stack = cdk.Stack.of(this);
    const projectName = `${props.projectName}-${props.stage}`;
    const qualifier = 'hnb659fds';
    const oidcProviderArn = `arn:aws:iam::${stack.account}:oidc-provider/token.actions.githubusercontent.com`;

    const oidcProvider = iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(
      this,
      'GitHubOidcProvider',
      oidcProviderArn,
    );

    const assumedBy = new iam.FederatedPrincipal(
      oidcProvider.openIdConnectProviderArn,
      {
        StringEquals: {
          'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
        },
        StringLike: {
          'token.actions.githubusercontent.com:sub': `repo:${props.githubOrg}/${props.githubRepo}:*`,
        },
      },
      'sts:AssumeRoleWithWebIdentity',
    );

    const cdkRole = new iam.Role(this, 'GitHubCdkRole', {
      roleName: `${projectName}-github-cdk`,
      assumedBy,
      description: 'Role assumed by GitHub Actions to run cdk diff/deploy for this app',
    });

    const bootstrapVersionParamArn = stack.formatArn({
      service: 'ssm',
      resource: 'parameter',
      resourceName: `/cdk-bootstrap/${qualifier}/version`,
    });

    const filePublishingRoleArn = `arn:aws:iam::${stack.account}:role/cdk-${qualifier}-file-publishing-role-${stack.account}-${stack.region}`;
    const deployRoleArn = `arn:aws:iam::${stack.account}:role/cdk-${qualifier}-deploy-role-${stack.account}-${stack.region}`;
    const lookupRoleArn = `arn:aws:iam::${stack.account}:role/cdk-${qualifier}-lookup-role-${stack.account}-${stack.region}`;

    cdkRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'AssumeCdkBootstrapRoles',
        effect: iam.Effect.ALLOW,
        actions: ['sts:AssumeRole'],
        resources: [filePublishingRoleArn, deployRoleArn, lookupRoleArn],
      }),
    );

    cdkRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ReadCdkBootstrapVersion',
        effect: iam.Effect.ALLOW,
        actions: ['ssm:GetParameter'],
        resources: [bootstrapVersionParamArn],
      }),
    );

    new cdk.CfnOutput(this, 'GitHubCdkRoleArn', {
      value: cdkRole.roleArn,
      description: 'ARN to use for CDK diff/deploy from GitHub',
    });
  }
}
