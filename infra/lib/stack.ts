import * as cdk from 'aws-cdk-lib';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';
import { createLambda } from './lambda-factory';
import { Stack } from 'aws-cdk-lib';

export interface DbAccessorStackProps extends cdk.StackProps {
  projectName: string;
  githubOrg: string;
  githubRepo: string;
  existingUserPoolId: string;
  stage: 'dev' | 'prod';
}

export class DbAccessorStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: DbAccessorStackProps) {
    super(scope, id, props);
    const stack = cdk.Stack.of(this);
    const projectName = props.projectName + '-' + props.stage;
    const ghOidcProviderArn = `arn:aws:iam::${stack.account}:oidc-provider/token.actions.githubusercontent.com`;

    const auditTable = new dynamodb.Table(this, `${projectName}-audit-logs`, {
      tableName: `${projectName}-audit-logs`,
      partitionKey: { name: 'UserId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'CreatedAt', type: dynamodb.AttributeType.NUMBER },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN, // keep data safe
    });

    const grantTable = new dynamodb.Table(this, `${projectName}-grants`, {
      tableName: `${projectName}-grants`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN, // keep data safe
    });

    const getRecordFn = createLambda(this, projectName, 'get-record', {
      AUDIT_LOGS_TABLE_NAME: auditTable.tableName,
    });
    auditTable.grantWriteData(getRecordFn);
    grantTable.grantReadData(getRecordFn);

    getRecordFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['sts:AssumeRole'],
        resources: ['arn:aws:iam::058264309711:role/DbAccessorAppRole'],
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

    const iamAccess = api.root.addResource('record');
    iamAccess.addCorsPreflight({
      allowOrigins: apigw.Cors.ALL_ORIGINS,
      allowMethods: ['OPTIONS', 'POST', 'GET'],
    });
    // iamAccess.addMethod('POST', new apigw.LambdaIntegration(iamGrantReadOnlyAccessFn));
    iamAccess.addMethod('GET', new apigw.LambdaIntegration(getRecordFn));

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

    const preSignUpFn = createLambda(this, projectName, 'pre-token-generation');

    preSignUpFn.addPermission('AllowCognitoInvokeImported', {
      principal: new iam.ServicePrincipal('cognito-idp.amazonaws.com'),
      sourceArn: Stack.of(this).formatArn({
        service: 'cognito-idp',
        resource: 'userpool',
        resourceName: props.existingUserPoolId,
      }),
    });

    new cr.AwsCustomResource(this, 'UpdateUserPoolLambdaConfig', {
      onCreate: {
        service: 'CognitoIdentityServiceProvider',
        action: 'updateUserPool',
        parameters: {
          UserPoolId: props.existingUserPoolId,
          LambdaConfig: {
            PreTokenGeneration: preSignUpFn.functionArn,
          },
        },
        physicalResourceId: cr.PhysicalResourceId.of(`${props.existingUserPoolId}-LambdaConfig`),
      },
      onUpdate: {
        service: 'CognitoIdentityServiceProvider',
        action: 'updateUserPool',
        parameters: {
          UserPoolId: props.existingUserPoolId,
          LambdaConfig: {
            PreTokenGeneration: preSignUpFn.functionArn,
          },
        },
        physicalResourceId: cr.PhysicalResourceId.of(`${props.existingUserPoolId}-LambdaConfig`),
      },
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          actions: ['cognito-idp:UpdateUserPool'],
          resources: ['*'], // tighten if you prefer
        }),
      ]),
    });

    new cdk.CfnOutput(this, 'ApiUrl', { value: api.url ?? '' });

    new cdk.CfnOutput(this, 'GitHubCdkRoleArn', {
      value: cdkRole.roleArn,
      description: 'ARN to use for CDK diff/deploy from GitHub',
    });
  }
}
