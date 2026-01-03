import * as cdk from 'aws-cdk-lib';
import { Stack } from 'aws-cdk-lib';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';
import { createLambda } from './lambda-factory';
import { parse } from '@aws-sdk/util-arn-parser';

export interface DbAccessorStackProps extends cdk.StackProps {
  projectName: string;
  githubOrg: string;
  githubRepo: string;
  cognitoUserPoolId: string;
  cognitoClientId: string;
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

    grantTable.addGlobalSecondaryIndex({
      indexName: 'GSI_ALL',
      partitionKey: { name: 'GSI_ALL_PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI_ALL_SK', type: dynamodb.AttributeType.STRING },
    });

    grantTable.addGlobalSecondaryIndex({
      indexName: 'GSI_PENDING',
      partitionKey: { name: 'GSI_PENDING_PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI_PENDING_SK', type: dynamodb.AttributeType.STRING },
    });

    const sharedVars = {
      GRANTS_TABLE_NAME: grantTable.tableName,
      COGNITO_USER_POOL_ID: props.cognitoUserPoolId,
      COGNITO_CLIENT_ID: props.cognitoClientId,
    };

    const getRecordFn = createLambda(this, projectName, 'get-record', {
      AUDIT_LOGS_TABLE_NAME: auditTable.tableName,
      ...sharedVars,
    });
    auditTable.grantWriteData(getRecordFn);
    grantTable.grantReadData(getRecordFn);

    const managementAccountId = '058264309711';
    const assumeRoleArns = [`arn:aws:iam::${managementAccountId}:role/DbAccessorAppRole`];

    getRecordFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['sts:AssumeRole'],
        resources: assumeRoleArns,
      }),
    );

    const getAccountsFn = createLambda(this, projectName, 'get-accounts', {
      AWS_MANAGEMENT_ACCOUNT: managementAccountId,
      AWS_ACCOUNTS: assumeRoleArns.map((arn) => parse(arn).accountId).join(','),
      ...sharedVars,
    });
    getAccountsFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['sts:AssumeRole'],
        resources: [`arn:aws:iam::${managementAccountId}:role/DbAccessorAppRole`],
      }),
    );
    const createRequestFn = createLambda(this, projectName, 'create-request', sharedVars);
    grantTable.grantWriteData(createRequestFn);
    const getRequestFn = createLambda(this, projectName, 'get-request', sharedVars);
    grantTable.grantReadData(getRequestFn);
    const adminGetRequestFn = createLambda(this, projectName, 'admin-get-request', sharedVars);
    grantTable.grantReadData(adminGetRequestFn);
    const adminApproveRequestFn = createLambda(this, projectName, 'admin-approve-request', sharedVars);
    grantTable.grantReadWriteData(adminApproveRequestFn);
    const adminRejectRequestFn = createLambda(this, projectName, 'admin-reject-request', sharedVars);
    grantTable.grantReadWriteData(adminRejectRequestFn);

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

    const record = api.root.addResource('record').addResource('{id}');
    record.addCorsPreflight({
      allowOrigins: apigw.Cors.ALL_ORIGINS,
      allowMethods: ['OPTIONS', 'POST', 'GET'],
    });
    record.addMethod('GET', new apigw.LambdaIntegration(getRecordFn));

    const request = api.root.addResource('request');
    request.addCorsPreflight({
      allowOrigins: apigw.Cors.ALL_ORIGINS,
      allowMethods: ['OPTIONS', 'POST', 'GET'],
    });
    request.addMethod('POST', new apigw.LambdaIntegration(createRequestFn));
    request.addMethod('GET', new apigw.LambdaIntegration(getRequestFn));

    const adminResource = api.root.addResource('admin');
    const adminGetRequest = adminResource.addResource('request');
    adminGetRequest.addCorsPreflight({
      allowOrigins: apigw.Cors.ALL_ORIGINS,
      allowMethods: ['OPTIONS', 'GET'],
    });
    adminGetRequest.addMethod('GET', new apigw.LambdaIntegration(adminGetRequestFn));

    const adminApproveRequest = adminResource.addResource('approve-request');
    adminApproveRequest.addCorsPreflight({
      allowOrigins: apigw.Cors.ALL_ORIGINS,
      allowMethods: ['OPTIONS', 'POST'],
    });
    adminApproveRequest.addMethod('POST', new apigw.LambdaIntegration(adminApproveRequestFn));

    const adminRejectRequest = adminResource.addResource('reject-request');
    adminRejectRequest.addCorsPreflight({
      allowOrigins: apigw.Cors.ALL_ORIGINS,
      allowMethods: ['OPTIONS', 'POST'],
    });
    adminRejectRequest.addMethod('POST', new apigw.LambdaIntegration(adminRejectRequestFn));

    const getAccounts = api.root.addResource('accounts');
    getAccounts.addCorsPreflight({
      allowOrigins: apigw.Cors.ALL_ORIGINS,
      allowMethods: ['OPTIONS', 'GET'],
    });
    getAccounts.addMethod('GET', new apigw.LambdaIntegration(getAccountsFn));

    const preTokenGenerationFn = createLambda(this, projectName, 'pre-token-generation');

    preTokenGenerationFn.addPermission('AllowCognitoInvokeImported', {
      principal: new iam.ServicePrincipal('cognito-idp.amazonaws.com'),
      sourceArn: Stack.of(this).formatArn({
        service: 'cognito-idp',
        resource: 'userpool',
        resourceName: props.cognitoUserPoolId,
      }),
    });

    new cr.AwsCustomResource(this, 'UpdateUserPoolLambdaConfig', {
      onCreate: {
        service: 'CognitoIdentityServiceProvider',
        action: 'updateUserPool',
        parameters: {
          UserPoolId: props.cognitoUserPoolId,
          LambdaConfig: {
            PreTokenGeneration: preTokenGenerationFn.functionArn,
            PreTokenGenerationConfig: {
              LambdaArn: preTokenGenerationFn.functionArn,
              LambdaVersion: 'V3_0',
            },
          },
        },
        physicalResourceId: cr.PhysicalResourceId.of(`${props.cognitoUserPoolId}-LambdaConfig`),
      },
      onUpdate: {
        service: 'CognitoIdentityServiceProvider',
        action: 'updateUserPool',
        parameters: {
          UserPoolId: props.cognitoUserPoolId,
          LambdaConfig: {
            PreTokenGeneration: preTokenGenerationFn.functionArn,
            PreTokenGenerationConfig: {
              LambdaArn: preTokenGenerationFn.functionArn,
              LambdaVersion: 'V3_0',
            },
          },
        },
        physicalResourceId: cr.PhysicalResourceId.of(`${props.cognitoUserPoolId}-LambdaConfig`),
      },
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          actions: ['cognito-idp:UpdateUserPool'],
          resources: ['*'], // tighten if you prefer
        }),
      ]),
    });

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

// refresh
