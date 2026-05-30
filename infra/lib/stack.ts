/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { parse } from '@aws-sdk/util-arn-parser';
import * as cdk from 'aws-cdk-lib';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigwv2Authorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as apigwv2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as snsSubscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { createCognitoResources } from './cognito';
import { CreateLambdaOptions, createLambda } from './lambda-factory';
import { createRequestStatusEmailPolicyStatement } from './request-status-email-policy';
import { createRequesterEmailPolicyStatement } from './requester-email-policy';

export interface DbAccessorStackProps extends cdk.StackProps {
  projectName: string;
  stage: 'dev' | 'prod';
  domain: string;
  samlMetadataFileContent?: string;
}

export class DbAccessorStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: DbAccessorStackProps) {
    super(scope, id, props);

    const stack = cdk.Stack.of(this);
    const projectName = props.projectName + '-' + props.stage;
    const removalPolicy = props.stage === 'dev' ? cdk.RemovalPolicy.DESTROY : cdk.RemovalPolicy.RETAIN;
    const lambdaLogRetention = props.stage === 'dev' ? logs.RetentionDays.THREE_MONTHS : logs.RetentionDays.ONE_YEAR;
    const createStackLambda = (
      options: Omit<CreateLambdaOptions, 'projectName' | 'logGroupRemovalPolicy' | 'logRetention'>,
    ) =>
      createLambda(this, {
        ...options,
        projectName,
        logGroupRemovalPolicy: removalPolicy,
        logRetention: lambdaLogRetention,
      });

    // custom domain regional certificate
    const regionalCertificateArn = ssm.StringParameter.valueForStringParameter(
      this,
      `/${projectName}/acm/regional-certificate-arn`,
    );
    const regionalAcmCertificate = acm.Certificate.fromCertificateArn(
      this,
      `${projectName}-regional-domain-cert`,
      regionalCertificateArn,
    );

    const cognitoResources = createCognitoResources(this, {
      projectName,
      stage: props.stage,
      domain: props.domain,
      removalPolicy,
      lambdaLogRetention,
      samlMetadataFileContent: props.samlMetadataFileContent,
    });
    const { userPool, userPoolClient, userPoolDomain, samlProvider } = cognitoResources;

    const auditTable = new dynamodb.Table(this, `${projectName}-audit-logs`, {
      tableName: `${projectName}-audit-logs`,
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.NUMBER },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: removalPolicy,
    });

    const grantTable = new dynamodb.Table(this, `${projectName}-grants`, {
      tableName: `${projectName}-grants`,
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: removalPolicy,
    });

    const rulesetTable = new dynamodb.Table(this, `${projectName}-rulesets`, {
      tableName: `${projectName}-rulesets`,
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: removalPolicy,
    });

    const notificationTable = new dynamodb.Table(this, `${projectName}-notifications`, {
      tableName: `${projectName}-notifications`,
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: removalPolicy,
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
      removalPolicy: removalPolicy,
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
      COGNITO_USER_POOL_ID: userPool.userPoolId,
      COGNITO_CLIENT_ID: userPoolClient.userPoolClientId,
      USERNAME_PREFIX: `${props.projectName}_`,
    };
    const requestStatusEmailSource = `noreply@${props.domain}`;
    const requestStatusEmailVars = {
      REQUEST_STATUS_EMAIL_SOURCE: requestStatusEmailSource,
    };

    const getRecordFn = createStackLambda({
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

    const issueTrackingAuditWorkerFn = createStackLambda({
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

    const websocketConnectFn = createStackLambda({
      fnName: 'websocket-connect',
      environment: {
        WEBSOCKET_CONNECTIONS_TABLE_NAME: websocketConnectionTable.tableName,
        ...sharedVars,
      },
    });
    websocketConnectionTable.grantWriteData(websocketConnectFn);

    const websocketAuthorizerFn = createStackLambda({
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

    const websocketDisconnectFn = createStackLambda({
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

    const websocketStage = new apigwv2.WebSocketStage(this, `${projectName}-websocket-stage`, {
      webSocketApi: websocketApi,
      stageName: props.stage,
      autoDeploy: true,
    });

    const websocketDomainName = `$ws.${props.domain}`;
    const websocketDomain = new apigwv2.DomainName(this, `${projectName}-websocket-domain`, {
      domainName: websocketDomainName,
      certificate: regionalAcmCertificate,
    });
    new apigwv2.ApiMapping(this, `${projectName}-websocket-domain-mapping`, {
      api: websocketApi,
      domainName: websocketDomain,
      stage: websocketStage,
    });

    const websocketEndpoint = `https://${websocketDomainName}`;

    const requestStatusEmailWorkerFn = createStackLambda({
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
    requestStatusEmailWorkerFn.addToRolePolicy(createRequesterEmailPolicyStatement(stack, userPool.userPoolId));
    requestStatusEmailWorkerFn.addEventSource(
      new lambdaEventSources.SqsEventSource(requestStatusEmailQueue, {
        batchSize: 5,
        reportBatchItemFailures: true,
      }),
    );

    const requestStatusNotificationWorkerFn = createStackLambda({
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

    const getAccountsFn = createStackLambda({
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
    const getTablesFn = createStackLambda({
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
    const createRequestFn = createStackLambda({
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
    const createUnredactRequestFn = createStackLambda({
      fnName: 'create-unredact-request',
      environment: sharedVars,
    });
    grantTable.grantReadWriteData(createUnredactRequestFn);
    const getRequestFn = createStackLambda({
      fnName: 'get-request',
      environment: sharedVars,
    });
    grantTable.grantReadData(getRequestFn);
    const getNotificationsFn = createStackLambda({
      fnName: 'get-notifications',
      environment: {
        NOTIFICATIONS_TABLE_NAME: notificationTable.tableName,
        ...sharedVars,
      },
    });
    notificationTable.grantReadData(getNotificationsFn);
    const markNotificationsReadFn = createStackLambda({
      fnName: 'mark-notifications-read',
      environment: {
        NOTIFICATIONS_TABLE_NAME: notificationTable.tableName,
        ...sharedVars,
      },
    });
    notificationTable.grantReadWriteData(markNotificationsReadFn);
    const adminGetRequestFn = createStackLambda({
      fnName: 'admin-get-request',
      environment: sharedVars,
    });
    grantTable.grantReadData(adminGetRequestFn);
    const adminApproveRequestFn = createStackLambda({
      fnName: 'admin-approve-request',
      environment: {
        ...sharedVars,
        REQUEST_STATUS_TOPIC_ARN: requestStatusTopic.topicArn,
        STAGE: props.stage,
      },
    });
    grantTable.grantReadWriteData(adminApproveRequestFn);
    requestStatusTopic.grantPublish(adminApproveRequestFn);
    const adminRejectRequestFn = createStackLambda({
      fnName: 'admin-reject-request',
      environment: {
        ...sharedVars,
        REQUEST_STATUS_TOPIC_ARN: requestStatusTopic.topicArn,
        STAGE: props.stage,
      },
    });
    grantTable.grantReadWriteData(adminRejectRequestFn);
    requestStatusTopic.grantPublish(adminRejectRequestFn);
    const adminCreateRulesetFn = createStackLambda({
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

    const adminGetRulesetFn = createStackLambda({
      fnName: 'admin-get-ruleset',
      environment: {
        RULESET_TABLE_NAME: rulesetTable.tableName,
        ...sharedVars,
      },
    });
    rulesetTable.grantReadData(adminGetRulesetFn);

    const apiDomainName = `api.${props.domain}`;
    const api = new apigw.RestApi(this, `${projectName}-rest-api`, {
      deployOptions: { stageName: props.stage },
      domainName: {
        certificate: regionalAcmCertificate,
        domainName: apiDomainName,
        endpointType: apigw.EndpointType.REGIONAL,
      },
      endpointTypes: [apigw.EndpointType.REGIONAL],
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

    // Create a Cognito authorizer for API Gateway
    const cognitoAuthorizer = new apigw.CognitoUserPoolsAuthorizer(this, 'CognitoAuthorizer', {
      cognitoUserPools: [userPool],
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

    new cdk.CfnOutput(this, 'ApiUrl', { value: api.url ?? '' });
    new cdk.CfnOutput(this, 'ApiDomainName', {
      value: apiDomainName,
    });
    new cdk.CfnOutput(this, 'ApiDomainAliasDomainName', {
      value: api.domainName!.domainNameAliasDomainName,
    });
    new cdk.CfnOutput(this, 'ApiDomainAliasHostedZoneId', {
      value: api.domainName!.domainNameAliasHostedZoneId,
    });
    new cdk.CfnOutput(this, 'WebSocketUrl', {
      value: `wss://${websocketDomainName}`,
    });
    new cdk.CfnOutput(this, 'WebSocketDomainRegionalDomainName', {
      value: websocketDomain.regionalDomainName,
    });
    new cdk.CfnOutput(this, 'WebSocketDomainRegionalHostedZoneId', {
      value: websocketDomain.regionalHostedZoneId,
    });
    new cdk.CfnOutput(this, 'CognitoUserPoolId', { value: userPool.userPoolId });
    new cdk.CfnOutput(this, 'CognitoUserPoolClientId', { value: userPoolClient.userPoolClientId });
    new cdk.CfnOutput(this, 'CognitoAuthority', {
      value: `https://cognito-idp.${stack.region}.${stack.urlSuffix}/${userPool.userPoolId}`,
    });
    new cdk.CfnOutput(this, 'CognitoHostedUiDomain', {
      value: `https://${userPoolDomain.domainName}`,
    });
    new cdk.CfnOutput(this, 'CognitoDomainCloudFrontEndpoint', {
      value: userPoolDomain.cloudFrontEndpoint,
    });
    new cdk.CfnOutput(this, 'CognitoDomainCloudFrontHostedZoneId', {
      value: 'Z2FDTNDATAQYW2',
    });

    if (samlProvider) {
      new cdk.CfnOutput(this, 'CognitoSamlIdentityProviderName', {
        value: samlProvider.providerName,
      });
    }
  }
}

// refresh 20260530-1
