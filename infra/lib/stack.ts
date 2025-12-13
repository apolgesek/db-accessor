import * as cdk from 'aws-cdk-lib';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { createLambda } from './lambda-factory';

export interface DbAccessorStackProps extends cdk.StackProps {
  projectName: string;
  githubOrg: string;
  githubRepo: string;
  stage: 'dev' | 'prod';
  identityCenterRoleArn: string;
  ssoInstanceArn: string;
}

export class DbAccessorStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: DbAccessorStackProps) {
    super(scope, id, props);
    const stack = cdk.Stack.of(this);
    const projectName = props.projectName + '-' + props.stage;
    const ghOidcProviderArn = `arn:aws:iam::${stack.account}:oidc-provider/token.actions.githubusercontent.com`;

    const table = new dynamodb.Table(this, 'AuditLogTable', {
      tableName: `${projectName}-audit-logs`,
      partitionKey: { name: 'UserId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'CreatedAt', type: dynamodb.AttributeType.NUMBER },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN, // keep data safe
    });

    const iamGrantReadOnlyAccessFn = createLambda(this, projectName, 'grant-read-only-access', 'iam', {
      AUDIT_LOGS_TABLE_NAME: table.tableName,
    });
    table.grantWriteData(iamGrantReadOnlyAccessFn);
    iamGrantReadOnlyAccessFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['iam:CreatePolicy', 'iam:TagPolicy'],
        resources: ['arn:aws:iam::*:policy/*'],
      }),
    );
    iamGrantReadOnlyAccessFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['iam:AttachUserPolicy', 'iam:GetUser'],
        resources: ['arn:aws:iam::*:user/*'],
      }),
    );

    const ssoGrantReadOnlyAccessFn = createLambda(this, projectName, 'grant-read-only-access', 'sso', {
      AUDIT_LOGS_TABLE_NAME: table.tableName,
      IDENTITY_CENTER_ROLE_ARN: props.identityCenterRoleArn,
    });
    table.grantWriteData(ssoGrantReadOnlyAccessFn);
    ssoGrantReadOnlyAccessFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['sts:AssumeRole'],
        resources: [props.identityCenterRoleArn],
      }),
    );

    const iamGetActivePoliciesFn = createLambda(this, projectName, 'get-active-policies', 'iam', {
      TABLE_NAME: table.tableName,
    });

    iamGetActivePoliciesFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['iam:ListPolicies', 'iam:ListPolicyTags'],
        resources: ['arn:aws:iam::*:policy/*'],
      }),
    );

    const ssoGetActivePoliciesFn = createLambda(this, projectName, 'get-active-policies', 'sso', {
      TABLE_NAME: table.tableName,
      IDENTITY_CENTER_ROLE_ARN: props.identityCenterRoleArn,
      INSTANCE_ARN: props.ssoInstanceArn,
    });
    ssoGetActivePoliciesFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['sts:AssumeRole'],
        resources: [props.identityCenterRoleArn],
      }),
    );

    const api = new apigw.RestApi(this, 'ServerlessRestApi', {
      deployOptions: { stageName: props.stage },
    });
    api.addToResourcePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        principals: [new iam.AnyPrincipal()],
        actions: ['execute-api:Invoke'],
        resources: ['*'],
      }),
    );

    const iamAccess = api.root.addResource('iam').addResource('access');
    iamAccess.addCorsPreflight({
      allowOrigins: apigw.Cors.ALL_ORIGINS,
      allowMethods: ['OPTIONS', 'POST', 'GET'],
    });
    iamAccess.addMethod('POST', new apigw.LambdaIntegration(iamGrantReadOnlyAccessFn));
    iamAccess.addMethod('GET', new apigw.LambdaIntegration(iamGetActivePoliciesFn));

    const ssoAccess = api.root.addResource('sso').addResource('access');
    ssoAccess.addCorsPreflight({
      allowOrigins: apigw.Cors.ALL_ORIGINS,
      allowMethods: ['OPTIONS', 'POST', 'GET'],
    });
    ssoAccess.addMethod('POST', new apigw.LambdaIntegration(ssoGrantReadOnlyAccessFn));
    ssoAccess.addMethod('GET', new apigw.LambdaIntegration(ssoGetActivePoliciesFn));

    const iamCleanupFn = createLambda(this, projectName, 'delete-expired-user-roles', 'iam', {
      TABLE_NAME: table.tableName,
    });

    iamCleanupFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['iam:ListPolicies', 'iam:ListPolicyTags', 'iam:DeletePolicy'],
        resources: ['arn:aws:iam::*:policy/*'],
      }),
    );
    iamCleanupFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['iam:DetachUserPolicy'],
        resources: ['arn:aws:iam::*:user/*'],
      }),
    );

    const rule = new events.Rule(this, 'InvocationLevelRule', {
      schedule: events.Schedule.cron({ minute: '0', hour: '*' }),
    });
    rule.addTarget(new targets.LambdaFunction(iamCleanupFn));

    // --- OIDC provider (imported) ---
    const oidcProvider = iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(
      this,
      'GitHubOidcProvider',
      ghOidcProviderArn,
    );

    // --- Federated principal for GitHub Actions ---
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

    // --- CDK role: for cdk diff/deploy of this stack ---
    const cdkRole = new iam.Role(this, `GitHubCdkRole`, {
      roleName: `${projectName}-github-cdk`,
      assumedBy,
      description: 'Role assumed by GitHub Actions to run cdk diff/deploy for this stack',
    });

    // --- CDK bootstrap integration (assume bootstrap roles + read bootstrap version) ---
    const qualifier = 'hnb659fds'; // default CDK bootstrap qualifier

    const bootstrapVersionParamArn = stack.formatArn({
      service: 'ssm',
      resource: 'parameter',
      resourceName: `/cdk-bootstrap/${qualifier}/version`,
    });

    const filePublishingRoleArn = `arn:aws:iam::${stack.account}:role/cdk-${qualifier}-file-publishing-role-${stack.account}-${stack.region}`;
    const deployRoleArn = `arn:aws:iam::${stack.account}:role/cdk-${qualifier}-deploy-role-${stack.account}-${stack.region}`;
    const lookupRoleArn = `arn:aws:iam::${stack.account}:role/cdk-${qualifier}-lookup-role-${stack.account}-${stack.region}`;

    // Allow GitHubCdkRole to assume CDK bootstrap roles (assets, deploy, lookup)
    cdkRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'AssumeCdkBootstrapRoles',
        effect: iam.Effect.ALLOW,
        actions: ['sts:AssumeRole'],
        resources: [filePublishingRoleArn, deployRoleArn, lookupRoleArn],
      }),
    );

    // Allow reading the bootstrap stack version (CDK requires this)
    cdkRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ReadCdkBootstrapVersion',
        effect: iam.Effect.ALLOW,
        actions: ['ssm:GetParameter'],
        resources: [bootstrapVersionParamArn],
      }),
    );

    new cdk.CfnOutput(this, 'ApiUrl', { value: api.url ?? '' });

    new cdk.CfnOutput(this, 'GitHubCdkRoleArn', {
      value: cdkRole.roleArn,
      description: 'ARN to use for CDK diff/deploy from GitHub',
    });
  }
}
