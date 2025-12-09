import * as cdk from 'aws-cdk-lib';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import * as path from 'path';

export interface DbAccessorStackProps extends cdk.StackProps {
  projectName: string;
  githubOrg: string;
  githubRepo: string;
  stage: 'dev' | 'prod';
}

export class DbAccessorStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: DbAccessorStackProps) {
    super(scope, id, props);
    const stack = cdk.Stack.of(this);
    const projectName = props.projectName + '-' + props.stage;
    const ghOidcProviderArn = `arn:aws:iam::${stack.account}:oidc-provider/token.actions.githubusercontent.com`;
    const node22 = (lambda.Runtime as any).NODEJS_22_X ?? new lambda.Runtime('nodejs22.x', lambda.RuntimeFamily.NODEJS);

    const table = new dynamodb.Table(this, 'AuditLogTable', {
      tableName: `${projectName}-audit-logs`,
      partitionKey: { name: 'UserId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'CreatedAt', type: dynamodb.AttributeType.NUMBER },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN, // keep data safe
    });

    const grantReadOnlyAccessFn = new nodejs.NodejsFunction(this, 'GrantReadOnlyAccess', {
      functionName: `${projectName}-grant-read-only-access`,
      entry: path.join(__dirname, '..', '..', 'src', 'functions', 'grant_read_only_access', 'main.ts'),
      handler: 'lambdaHandler',
      runtime: node22,
      architecture: lambda.Architecture.X86_64,
      environment: { AUDIT_LOGS_TABLE_NAME: table.tableName },
      bundling: { minify: true, sourceMap: true, target: 'es2020' },
    });

    table.grantWriteData(grantReadOnlyAccessFn);
    grantReadOnlyAccessFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['iam:CreatePolicy', 'iam:TagPolicy'],
        resources: ['arn:aws:iam::*:policy/*'],
      }),
    );
    grantReadOnlyAccessFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['iam:AttachUserPolicy', 'iam:GetUser'],
        resources: ['arn:aws:iam::*:user/*'],
      }),
    );

    const getActivePoliciesFn = new nodejs.NodejsFunction(this, 'GetActivePolicies', {
      functionName: `${projectName}-get-active-policies`,
      entry: path.join(__dirname, '..', '..', 'src', 'functions', 'get_active_policies', 'main.ts'),
      handler: 'lambdaHandler',
      runtime: node22,
      architecture: lambda.Architecture.X86_64,
      environment: { TABLE_NAME: table.tableName },
      bundling: { minify: true, sourceMap: true, target: 'es2020' },
    });
    getActivePoliciesFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['iam:ListPolicies', 'iam:ListPolicyTags'],
        resources: ['arn:aws:iam::*:policy/*'],
      }),
    );

    // API Gateway: POST /access
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

    const access = api.root.addResource('access');
    access.addCorsPreflight({
      allowOrigins: apigw.Cors.ALL_ORIGINS,
      allowMethods: ['OPTIONS', 'POST', 'GET'],
    });
    access.addMethod('POST', new apigw.LambdaIntegration(grantReadOnlyAccessFn));
    access.addMethod('GET', new apigw.LambdaIntegration(getActivePoliciesFn));

    const cleanupFn = new nodejs.NodejsFunction(this, 'DeleteExpiredUserRoles', {
      functionName: `${projectName}-delete-expired-user-roles`,
      entry: path.join(__dirname, '..', '..', 'src', 'functions', 'delete_expired_user_roles', 'main.ts'),
      handler: 'lambdaHandler',
      runtime: node22,
      architecture: lambda.Architecture.X86_64,
      environment: { TABLE_NAME: table.tableName },
      bundling: { minify: true, sourceMap: true, target: 'es2020' },
    });

    table.grantWriteData(cleanupFn);
    cleanupFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['iam:ListPolicies', 'iam:ListPolicyTags', 'iam:DeletePolicy'],
        resources: ['arn:aws:iam::*:policy/*'],
      }),
    );
    cleanupFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['iam:DetachUserPolicy'],
        resources: ['arn:aws:iam::*:user/*'],
      }),
    );

    const rule = new events.Rule(this, 'InvocationLevelRule', {
      schedule: events.Schedule.cron({ minute: '0', hour: '*' }),
    });
    rule.addTarget(new targets.LambdaFunction(cleanupFn));

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
