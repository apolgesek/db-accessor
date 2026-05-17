import { parse } from '@aws-sdk/util-arn-parser';
import * as cdk from 'aws-cdk-lib';
import { Stack } from 'aws-cdk-lib';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigwv2Authorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as apigwv2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as snsSubscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import { createLambda } from './lambda-factory';
import { createRequestStatusEmailPolicyStatement } from './request-status-email-policy';
import { createRequesterEmailPolicyStatement } from './requester-email-policy';

export interface DbAccessorStackProps extends cdk.StackProps {
  projectName: string;
  cognitoUserPoolId: string;
  cognitoClientId: string;
  allowedIp: string;
  stage: 'dev' | 'prod';
}

export class DbAccessorStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: DbAccessorStackProps) {
    super(scope, id, props);
    const stack = cdk.Stack.of(this);
    const projectName = props.projectName + '-' + props.stage;
    const tableRemovalPolicy = props.stage === 'dev' ? cdk.RemovalPolicy.DESTROY : cdk.RemovalPolicy.RETAIN;

    const auditTable = new dynamodb.Table(this, `${projectName}-audit-logs`, {
      tableName: `${projectName}-audit-logs`,
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.NUMBER },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: tableRemovalPolicy,
    });

    const grantTable = new dynamodb.Table(this, `${projectName}-grants`, {
      tableName: `${projectName}-grants`,
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: tableRemovalPolicy,
    });

    const rulesetTable = new dynamodb.Table(this, `${projectName}-rulesets`, {
      tableName: `${projectName}-rulesets`,
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: tableRemovalPolicy,
    });

    const notificationTable = new dynamodb.Table(this, `${projectName}-notifications`, {
      tableName: `${projectName}-notifications`,
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: tableRemovalPolicy,
    });
    notificationTable.addGlobalSecondaryIndex({
      indexName: 'gsiUserNotification',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'id', type: dynamodb.AttributeType.STRING },
    });

    const websocketConnectionTable = new dynamodb.Table(this, `${projectName}-websocket-connections`, {
      tableName: `${projectName}-websocket-connections`,
      partitionKey: { name: 'connectionId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy: tableRemovalPolicy,
    });

    websocketConnectionTable.addGlobalSecondaryIndex({
      indexName: 'gsiUserId',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
    });

    const issueTrackingAuditDlq = new sqs.Queue(this, `${projectName}-issue-tracking-audit-dlq`, {
      queueName: `${projectName}-issue-tracking-audit-dlq`,
      retentionPeriod: cdk.Duration.days(14),
    });

    const issueTrackingAuditQueue = new sqs.Queue(this, `${projectName}-issue-tracking-audit-queue`, {
      queueName: `${projectName}-issue-tracking-audit-queue`,
      retentionPeriod: cdk.Duration.days(4),
      visibilityTimeout: cdk.Duration.seconds(60),
      deadLetterQueue: {
        queue: issueTrackingAuditDlq,
        maxReceiveCount: 3,
      },
    });

    const requestStatusTopic = new sns.Topic(this, `${projectName}-request-status-topic`, {
      topicName: `${projectName}-request-status`,
    });

    const requestStatusEmailDlq = new sqs.Queue(this, `${projectName}-request-status-email-dlq`, {
      queueName: `${projectName}-request-status-email-dlq`,
      retentionPeriod: cdk.Duration.days(14),
    });

    const requestStatusEmailQueue = new sqs.Queue(this, `${projectName}-request-status-email-queue`, {
      queueName: `${projectName}-request-status-email-queue`,
      retentionPeriod: cdk.Duration.days(4),
      visibilityTimeout: cdk.Duration.seconds(60),
      deadLetterQueue: {
        queue: requestStatusEmailDlq,
        maxReceiveCount: 3,
      },
    });

    const requestStatusNotificationDlq = new sqs.Queue(this, `${projectName}-request-status-notification-dlq`, {
      queueName: `${projectName}-request-status-notification-dlq`,
      retentionPeriod: cdk.Duration.days(14),
    });

    const requestStatusNotificationQueue = new sqs.Queue(this, `${projectName}-request-status-notification-queue`, {
      queueName: `${projectName}-request-status-notification-queue`,
      retentionPeriod: cdk.Duration.days(4),
      visibilityTimeout: cdk.Duration.seconds(60),
      deadLetterQueue: {
        queue: requestStatusNotificationDlq,
        maxReceiveCount: 3,
      },
    });

    requestStatusTopic.addSubscription(
      new snsSubscriptions.SqsSubscription(requestStatusEmailQueue, {
        rawMessageDelivery: true,
      }),
    );
    requestStatusTopic.addSubscription(
      new snsSubscriptions.SqsSubscription(requestStatusNotificationQueue, {
        rawMessageDelivery: true,
      }),
    );

    const issueTrackingSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      `${projectName}-issue-tracking-secret`,
      `${props.projectName}/${props.stage}/issue-tracking`,
    );

    rulesetTable.addGlobalSecondaryIndex({
      indexName: 'gsiAccountRegion',
      partitionKey: { name: 'gsiAccountRegionPk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsiAccountRegionSk', type: dynamodb.AttributeType.STRING },
    });

    rulesetTable.addGlobalSecondaryIndex({
      indexName: 'gsiAccountRegionTable',
      partitionKey: { name: 'gsiAccountRegionTablePk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsiAccountRegionTableSk', type: dynamodb.AttributeType.STRING },
    });

    grantTable.addGlobalSecondaryIndex({
      indexName: 'gsiAll',
      partitionKey: { name: 'gsiAllPk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsiAllSk', type: dynamodb.AttributeType.STRING },
    });

    grantTable.addGlobalSecondaryIndex({
      indexName: 'gsiPending',
      partitionKey: { name: 'gsiPendingPk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsiPendingSk', type: dynamodb.AttributeType.STRING },
    });

    const sharedVars = {
      GRANTS_TABLE_NAME: grantTable.tableName,
      COGNITO_USER_POOL_ID: props.cognitoUserPoolId,
      COGNITO_CLIENT_ID: props.cognitoClientId,
      USERNAME_PREFIX: `${props.projectName}_`,
    };
    const requestStatusEmailSource = 'noreply@4eyesdb.com';
    const requestStatusEmailVars = {
      REQUEST_STATUS_EMAIL_SOURCE: requestStatusEmailSource,
    };

    const getRecordFn = createLambda(this, {
      projectName,
      fnName: 'get-record',
      environment: {
        AUDIT_LOGS_TABLE_NAME: auditTable.tableName,
        ISSUE_TRACKING_AUDIT_QUEUE_URL: issueTrackingAuditQueue.queueUrl,
        RULESET_TABLE_NAME: rulesetTable.tableName,
        STAGE: props.stage,
        ...sharedVars,
      },
    });
    auditTable.grantWriteData(getRecordFn);
    grantTable.grantReadData(getRecordFn);
    issueTrackingAuditQueue.grantSendMessages(getRecordFn);
    rulesetTable.grantReadData(getRecordFn);

    const issueTrackingAuditWorkerFn = createLambda(this, {
      projectName,
      fnName: 'issue-tracking-audit-worker',
      environment: {
        ISSUE_TRACKING_AUDIT_QUEUE_URL: issueTrackingAuditQueue.queueUrl,
        ISSUE_TRACKING_SECRET_NAME: issueTrackingSecret.secretName,
      },
      timeout: cdk.Duration.seconds(30),
    });
    issueTrackingSecret.grantRead(issueTrackingAuditWorkerFn);
    issueTrackingAuditQueue.grantConsumeMessages(issueTrackingAuditWorkerFn);
    issueTrackingAuditWorkerFn.addEventSource(
      new lambdaEventSources.SqsEventSource(issueTrackingAuditQueue, {
        batchSize: 5,
        reportBatchItemFailures: true,
      }),
    );

    const websocketConnectFn = createLambda(this, {
      projectName,
      fnName: 'websocket-connect',
      environment: {
        WEBSOCKET_CONNECTIONS_TABLE_NAME: websocketConnectionTable.tableName,
        ...sharedVars,
      },
    });
    websocketConnectionTable.grantWriteData(websocketConnectFn);

    const websocketAuthorizerFn = createLambda(this, {
      projectName,
      fnName: 'websocket-authorizer',
      environment: sharedVars,
    });
    const websocketAuthorizer = new apigwv2Authorizers.WebSocketLambdaAuthorizer(
      `${projectName}-websocket-authorizer`,
      websocketAuthorizerFn,
      {
        authorizerName: `${projectName}-websocket-authorizer`,
        identitySource: ['route.request.querystring.token'],
      },
    );

    const websocketDisconnectFn = createLambda(this, {
      projectName,
      fnName: 'websocket-disconnect',
      environment: {
        WEBSOCKET_CONNECTIONS_TABLE_NAME: websocketConnectionTable.tableName,
      },
    });
    websocketConnectionTable.grantWriteData(websocketDisconnectFn);

    const websocketApi = new apigwv2.WebSocketApi(this, `${projectName}-websocket-api`, {
      apiName: `${projectName}-notifications`,
      connectRouteOptions: {
        integration: new apigwv2Integrations.WebSocketLambdaIntegration(
          `${projectName}-websocket-connect-integration`,
          websocketConnectFn,
        ),
        authorizer: websocketAuthorizer,
      },
      disconnectRouteOptions: {
        integration: new apigwv2Integrations.WebSocketLambdaIntegration(
          `${projectName}-websocket-disconnect-integration`,
          websocketDisconnectFn,
        ),
      },
    });

    new apigwv2.WebSocketStage(this, `${projectName}-websocket-stage`, {
      webSocketApi: websocketApi,
      stageName: props.stage,
      autoDeploy: true,
    });

    const websocketEndpoint = cdk.Fn.sub('https://${ApiId}.execute-api.${AWS::Region}.${AWS::URLSuffix}/${Stage}', {
      ApiId: websocketApi.apiId,
      Stage: props.stage,
    });

    const requestStatusEmailWorkerFn = createLambda(this, {
      projectName,
      fnName: 'request-status-email-worker',
      environment: {
        ...sharedVars,
        ...requestStatusEmailVars,
      },
      timeout: cdk.Duration.seconds(30),
    });
    requestStatusEmailQueue.grantConsumeMessages(requestStatusEmailWorkerFn);
    requestStatusEmailWorkerFn.addToRolePolicy(
      createRequestStatusEmailPolicyStatement(stack, requestStatusEmailSource),
    );
    requestStatusEmailWorkerFn.addToRolePolicy(createRequesterEmailPolicyStatement(stack, props.cognitoUserPoolId));
    requestStatusEmailWorkerFn.addEventSource(
      new lambdaEventSources.SqsEventSource(requestStatusEmailQueue, {
        batchSize: 5,
        reportBatchItemFailures: true,
      }),
    );

    const requestStatusNotificationWorkerFn = createLambda(this, {
      projectName,
      fnName: 'request-status-notification-worker',
      environment: {
        NOTIFICATIONS_TABLE_NAME: notificationTable.tableName,
        WEBSOCKET_CONNECTIONS_TABLE_NAME: websocketConnectionTable.tableName,
        WEBSOCKET_ENDPOINT: websocketEndpoint,
      },
      timeout: cdk.Duration.seconds(30),
    });
    requestStatusNotificationQueue.grantConsumeMessages(requestStatusNotificationWorkerFn);
    notificationTable.grantWriteData(requestStatusNotificationWorkerFn);
    websocketConnectionTable.grantReadWriteData(requestStatusNotificationWorkerFn);
    requestStatusNotificationWorkerFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['execute-api:ManageConnections'],
        resources: [
          `arn:${stack.partition}:execute-api:${stack.region}:${stack.account}:${websocketApi.apiId}/${props.stage}/POST/@connections/*`,
        ],
      }),
    );
    requestStatusNotificationWorkerFn.addEventSource(
      new lambdaEventSources.SqsEventSource(requestStatusNotificationQueue, {
        batchSize: 5,
        reportBatchItemFailures: true,
      }),
    );

    const managementaccountId = '058264309711';
    const assumeRoleArns = [`arn:aws:iam::${managementaccountId}:role/DbAccessorAppRole`];

    getRecordFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['sts:AssumeRole'],
        resources: assumeRoleArns,
      }),
    );

    const getAccountsFn = createLambda(this, {
      projectName,
      fnName: 'get-accounts',
      environment: {
        AWS_MANAGEMENT_ACCOUNT: managementaccountId,
        AWS_ACCOUNTS: assumeRoleArns.map((arn) => parse(arn).accountId).join(','),
        ...sharedVars,
      },
    });
    getAccountsFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['sts:AssumeRole'],
        resources: assumeRoleArns,
      }),
    );
    getAccountsFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['ssm:GetParameters*'],
        resources: [`arn:aws:ssm:${stack.region}::parameter/aws/service/global-infrastructure/regions*`],
      }),
    );
    const getTablesFn = createLambda(this, {
      projectName,
      fnName: 'get-tables',
      environment: sharedVars,
    });
    getTablesFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['sts:AssumeRole'],
        resources: assumeRoleArns,
      }),
    );
    const createRequestFn = createLambda(this, {
      projectName,
      fnName: 'create-request',
      environment: sharedVars,
    });
    createRequestFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['sts:AssumeRole'],
        resources: assumeRoleArns,
      }),
    );
    grantTable.grantWriteData(createRequestFn);
    const createUnredactRequestFn = createLambda(this, {
      projectName,
      fnName: 'create-unredact-request',
      environment: sharedVars,
    });
    grantTable.grantReadWriteData(createUnredactRequestFn);
    const getRequestFn = createLambda(this, {
      projectName,
      fnName: 'get-request',
      environment: sharedVars,
    });
    grantTable.grantReadData(getRequestFn);
    const getNotificationsFn = createLambda(this, {
      projectName,
      fnName: 'get-notifications',
      environment: {
        NOTIFICATIONS_TABLE_NAME: notificationTable.tableName,
        ...sharedVars,
      },
    });
    notificationTable.grantReadData(getNotificationsFn);
    const markNotificationsReadFn = createLambda(this, {
      projectName,
      fnName: 'mark-notifications-read',
      environment: {
        NOTIFICATIONS_TABLE_NAME: notificationTable.tableName,
        ...sharedVars,
      },
    });
    notificationTable.grantReadWriteData(markNotificationsReadFn);
    const adminGetRequestFn = createLambda(this, {
      projectName,
      fnName: 'admin-get-request',
      environment: sharedVars,
    });
    grantTable.grantReadData(adminGetRequestFn);
    const adminApproveRequestFn = createLambda(this, {
      projectName,
      fnName: 'admin-approve-request',
      environment: {
        ...sharedVars,
        REQUEST_STATUS_TOPIC_ARN: requestStatusTopic.topicArn,
        STAGE: props.stage,
      },
    });
    grantTable.grantReadWriteData(adminApproveRequestFn);
    requestStatusTopic.grantPublish(adminApproveRequestFn);
    const adminRejectRequestFn = createLambda(this, {
      projectName,
      fnName: 'admin-reject-request',
      environment: {
        ...sharedVars,
        REQUEST_STATUS_TOPIC_ARN: requestStatusTopic.topicArn,
        STAGE: props.stage,
      },
    });
    grantTable.grantReadWriteData(adminRejectRequestFn);
    requestStatusTopic.grantPublish(adminRejectRequestFn);
    const adminCreateRulesetFn = createLambda(this, {
      projectName,
      fnName: 'admin-create-ruleset',
      environment: {
        RULESET_TABLE_NAME: rulesetTable.tableName,
        ...sharedVars,
      },
    });
    adminCreateRulesetFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['sts:AssumeRole'],
        resources: assumeRoleArns,
      }),
    );
    rulesetTable.grantWriteData(adminCreateRulesetFn);

    const adminGetRulesetFn = createLambda(this, {
      projectName,
      fnName: 'admin-get-ruleset',
      environment: {
        RULESET_TABLE_NAME: rulesetTable.tableName,
        ...sharedVars,
      },
    });
    rulesetTable.grantReadData(adminGetRulesetFn);

    const api = new apigw.RestApi(this, 'ServerlessRestApi', {
      deployOptions: { stageName: props.stage },
    });
    api.addToResourcePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        principals: [new iam.AnyPrincipal()],
        actions: ['execute-api:Invoke'],
        resources: ['*'],
        conditions: {
          IpAddress: {
            'aws:SourceIp': `${props.allowedIp}/32`,
          },
        },
      }),
    );

    const record = api.root.addResource('record').addResource('{id}');
    record.addCorsPreflight({
      allowOrigins: apigw.Cors.ALL_ORIGINS,
      allowMethods: ['OPTIONS', 'POST', 'GET'],
    });

    const request = api.root.addResource('request');
    request.addCorsPreflight({
      allowOrigins: apigw.Cors.ALL_ORIGINS,
      allowMethods: ['OPTIONS', 'POST', 'GET'],
    });
    const unredactRequest = request.addResource('{id}').addResource('unredact');
    unredactRequest.addCorsPreflight({
      allowOrigins: apigw.Cors.ALL_ORIGINS,
      allowMethods: ['OPTIONS', 'POST'],
    });

    const adminResource = api.root.addResource('admin');
    const adminGetRequest = adminResource.addResource('request');
    adminGetRequest.addCorsPreflight({
      allowOrigins: apigw.Cors.ALL_ORIGINS,
      allowMethods: ['OPTIONS', 'GET'],
    });

    const adminApproveRequest = adminResource.addResource('approve-request');
    adminApproveRequest.addCorsPreflight({
      allowOrigins: apigw.Cors.ALL_ORIGINS,
      allowMethods: ['OPTIONS', 'PUT'],
    });

    const adminRejectRequest = adminResource.addResource('reject-request');
    adminRejectRequest.addCorsPreflight({
      allowOrigins: apigw.Cors.ALL_ORIGINS,
      allowMethods: ['OPTIONS', 'PUT'],
    });

    const getAccounts = api.root.addResource('accounts');
    getAccounts.addCorsPreflight({
      allowOrigins: apigw.Cors.ALL_ORIGINS,
      allowMethods: ['OPTIONS', 'GET'],
    });

    const getTables = api.root.addResource('tables');
    getTables.addCorsPreflight({
      allowOrigins: apigw.Cors.ALL_ORIGINS,
      allowMethods: ['OPTIONS', 'GET'],
    });

    const notifications = api.root.addResource('notifications');
    notifications.addCorsPreflight({
      allowOrigins: apigw.Cors.ALL_ORIGINS,
      allowMethods: ['OPTIONS', 'GET', 'POST'],
    });
    const readNotifications = notifications.addResource('read');
    readNotifications.addCorsPreflight({
      allowOrigins: apigw.Cors.ALL_ORIGINS,
      allowMethods: ['OPTIONS', 'POST'],
    });

    const adminCreateRuleset = adminResource.addResource('create-ruleset');
    adminCreateRuleset.addCorsPreflight({
      allowOrigins: apigw.Cors.ALL_ORIGINS,
      allowMethods: ['OPTIONS', 'POST'],
    });

    const adminGetRuleset = adminResource.addResource('ruleset');
    adminGetRuleset.addCorsPreflight({
      allowOrigins: apigw.Cors.ALL_ORIGINS,
      allowMethods: ['OPTIONS', 'GET'],
    });

    // Import the Cognito User Pool using the ID from shared vars
    const importedUserPool = cognito.UserPool.fromUserPoolId(this, 'ImportedUserPool', sharedVars.COGNITO_USER_POOL_ID);
    // Create a Cognito authorizer for API Gateway
    const cognitoAuthorizer = new apigw.CognitoUserPoolsAuthorizer(this, 'CognitoAuthorizer', {
      cognitoUserPools: [importedUserPool],
      authorizerName: `${projectName}-cognito-authorizer`,
      identitySource: 'method.request.header.Authorization',
    });

    // Attach methods with Cognito authorizer
    record.addMethod('GET', new apigw.LambdaIntegration(getRecordFn), {
      authorizationType: apigw.AuthorizationType.COGNITO,
      authorizer: cognitoAuthorizer,
      authorizationScopes: ['openid'],
    });
    request.addMethod('POST', new apigw.LambdaIntegration(createRequestFn), {
      authorizationType: apigw.AuthorizationType.COGNITO,
      authorizer: cognitoAuthorizer,
      authorizationScopes: ['openid'],
    });
    request.addMethod('GET', new apigw.LambdaIntegration(getRequestFn), {
      authorizationType: apigw.AuthorizationType.COGNITO,
      authorizer: cognitoAuthorizer,
      authorizationScopes: ['openid'],
    });
    unredactRequest.addMethod('POST', new apigw.LambdaIntegration(createUnredactRequestFn), {
      authorizationType: apigw.AuthorizationType.COGNITO,
      authorizer: cognitoAuthorizer,
      authorizationScopes: ['openid'],
    });
    adminGetRequest.addMethod('GET', new apigw.LambdaIntegration(adminGetRequestFn), {
      authorizationType: apigw.AuthorizationType.COGNITO,
      authorizer: cognitoAuthorizer,
      authorizationScopes: ['openid'],
    });
    adminApproveRequest.addMethod('PUT', new apigw.LambdaIntegration(adminApproveRequestFn), {
      authorizationType: apigw.AuthorizationType.COGNITO,
      authorizer: cognitoAuthorizer,
      authorizationScopes: ['openid'],
    });
    adminRejectRequest.addMethod('PUT', new apigw.LambdaIntegration(adminRejectRequestFn), {
      authorizationType: apigw.AuthorizationType.COGNITO,
      authorizer: cognitoAuthorizer,
      authorizationScopes: ['openid'],
    });
    getAccounts.addMethod('GET', new apigw.LambdaIntegration(getAccountsFn), {
      authorizationType: apigw.AuthorizationType.COGNITO,
      authorizer: cognitoAuthorizer,
      authorizationScopes: ['openid'],
    });
    getTables.addMethod('GET', new apigw.LambdaIntegration(getTablesFn), {
      authorizationType: apigw.AuthorizationType.COGNITO,
      authorizer: cognitoAuthorizer,
      authorizationScopes: ['openid'],
    });
    notifications.addMethod('GET', new apigw.LambdaIntegration(getNotificationsFn), {
      authorizationType: apigw.AuthorizationType.COGNITO,
      authorizer: cognitoAuthorizer,
      authorizationScopes: ['openid'],
    });
    readNotifications.addMethod('POST', new apigw.LambdaIntegration(markNotificationsReadFn), {
      authorizationType: apigw.AuthorizationType.COGNITO,
      authorizer: cognitoAuthorizer,
      authorizationScopes: ['openid'],
    });
    adminCreateRuleset.addMethod('POST', new apigw.LambdaIntegration(adminCreateRulesetFn), {
      authorizationType: apigw.AuthorizationType.COGNITO,
      authorizer: cognitoAuthorizer,
      authorizationScopes: ['openid'],
    });
    adminGetRuleset.addMethod('GET', new apigw.LambdaIntegration(adminGetRulesetFn), {
      authorizationType: apigw.AuthorizationType.COGNITO,
      authorizer: cognitoAuthorizer,
      authorizationScopes: ['openid'],
    });

    const preTokenGenerationRole = new iam.Role(this, `${projectName}-pre-token-generation-role`, {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'Execution role for Cognito pre-token-generation Lambda without CloudWatch Logs permissions',
    });
    const preTokenGenerationFn = createLambda(this, {
      projectName,
      fnName: 'pre-token-generation',
      createLogGroup: false,
      role: preTokenGenerationRole,
    });
    const userPoolArn = Stack.of(this).formatArn({
      service: 'cognito-idp',
      resource: 'userpool',
      resourceName: props.cognitoUserPoolId,
    });

    const preTokenGenerationPermission = new lambda.CfnPermission(
      this,
      `${projectName}-pre-token-generation-permission`,
      {
        action: 'lambda:InvokeFunction',
        functionName: preTokenGenerationFn.functionArn,
        principal: 'cognito-idp.amazonaws.com',
        sourceArn: userPoolArn,
      },
    );

    const configureUserPoolTriggerFn = createLambda(this, {
      projectName,
      fnName: 'configure-user-pool-trigger',
      timeout: cdk.Duration.seconds(30),
    });
    configureUserPoolTriggerFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['cognito-idp:DescribeUserPool', 'cognito-idp:UpdateUserPool'],
        resources: [userPoolArn],
      }),
    );

    const userPoolLambdaConfig = new cdk.CustomResource(this, 'UpdateUserPoolLambdaConfig', {
      serviceToken: configureUserPoolTriggerFn.functionArn,
      properties: {
        UserPoolId: props.cognitoUserPoolId,
        LambdaArn: preTokenGenerationFn.functionArn,
        LambdaVersion: 'V3_0',
      },
    });
    userPoolLambdaConfig.node.addDependency(preTokenGenerationPermission);

    new cdk.CfnOutput(this, 'ApiUrl', { value: api.url ?? '' });
    new cdk.CfnOutput(this, 'WebSocketUrl', {
      value: `wss://${websocketApi.apiId}.execute-api.${stack.region}.${stack.urlSuffix}/${props.stage}`,
    });
  }
}

// refresh 20260517-1
