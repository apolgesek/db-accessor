import { parse } from '@aws-sdk/util-arn-parser';
import * as cdk from 'aws-cdk-lib';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { DynamoDbTables } from './dynamodb-tables';
import { CreateLambdaOptions, createLambda } from './lambda-factory';
import { MessagingResources } from './messaging';
import { createRequestStatusEmailPolicyStatement } from './request-status-email-policy';
import { createRequesterEmailPolicyStatement } from './requester-email-policy';

export interface LambdaFactoryDefaults {
  projectName: string;
  removalPolicy: cdk.RemovalPolicy;
  lambdaLogRetention: logs.RetentionDays;
}

export interface ApplicationLambdaFunctions {
  getRecordFn: lambda.IFunction;
  issueTrackingAuditWorkerFn: lambda.IFunction;
  websocketConnectFn: lambda.IFunction;
  websocketAuthorizerFn: lambda.IFunction;
  websocketDisconnectFn: lambda.IFunction;
  requestStatusEmailWorkerFn: lambda.IFunction;
  getAccountsFn: lambda.IFunction;
  getTablesFn: lambda.IFunction;
  createRequestFn: lambda.IFunction;
  createUnredactRequestFn: lambda.IFunction;
  getRequestFn: lambda.IFunction;
  getNotificationsFn: lambda.IFunction;
  markNotificationsReadFn: lambda.IFunction;
  getConfiguredTablesFn: lambda.IFunction;
  adminGetRequestFn: lambda.IFunction;
  adminApproveRequestFn: lambda.IFunction;
  adminRejectRequestFn: lambda.IFunction;
  adminCreateRulesetFn: lambda.IFunction;
  adminGetRulesetFn: lambda.IFunction;
  adminCreateConfiguredTableFn: lambda.IFunction;
  adminDeleteConfiguredTableFn: lambda.IFunction;
}

export interface DbAccessorLambdaFunctions extends ApplicationLambdaFunctions {
  requestStatusNotificationWorkerFn: lambda.IFunction;
}

export interface CreateApplicationLambdaFunctionsOptions extends LambdaFactoryDefaults {
  stage: string;
  baseProjectName: string;
  requestStatusEmailSource: string;
  requestStatusEmailIdentityArn: string;
  sharedEnvironment: Record<string, string>;
  tables: DynamoDbTables;
  messaging: MessagingResources;
  issueTrackingSecret: secretsmanager.ISecret;
  userPool: cognito.IUserPool;
}

export interface CreateRequestStatusNotificationWorkerOptions extends LambdaFactoryDefaults {
  stage: string;
  tables: DynamoDbTables;
  messaging: MessagingResources;
  websocketApi: apigwv2.WebSocketApi;
  websocketEndpoint: string;
}

function createConfiguredLambda(
  scope: Construct,
  defaults: LambdaFactoryDefaults,
  options: Omit<CreateLambdaOptions, 'projectName' | 'logGroupRemovalPolicy' | 'logRetention'>,
) {
  return createLambda(scope, {
    ...options,
    projectName: defaults.projectName,
    logGroupRemovalPolicy: defaults.removalPolicy,
    logRetention: defaults.lambdaLogRetention,
  });
}

export function createApplicationLambdaFunctions(
  scope: Construct,
  options: CreateApplicationLambdaFunctionsOptions,
): ApplicationLambdaFunctions {
  const stack = cdk.Stack.of(scope);
  const { projectName, sharedEnvironment, tables, messaging } = options;

  const getRecordFn = createConfiguredLambda(scope, options, {
    fnName: 'get-record',
    environment: {
      AUDIT_LOGS_TABLE_NAME: tables.auditTable.tableName,
      ISSUE_TRACKING_AUDIT_QUEUE_URL: messaging.issueTrackingAuditQueue.queueUrl,
      RULESET_TABLE_NAME: tables.rulesetTable.tableName,
      STAGE: options.stage,
      ...sharedEnvironment,
    },
  });
  tables.auditTable.grantWriteData(getRecordFn);
  tables.grantTable.grantReadData(getRecordFn);
  messaging.issueTrackingAuditQueue.grantSendMessages(getRecordFn);
  tables.rulesetTable.grantReadData(getRecordFn);

  const issueTrackingAuditWorkerFn = createConfiguredLambda(scope, options, {
    fnName: 'issue-tracking-audit-worker',
    environment: {
      ISSUE_TRACKING_AUDIT_QUEUE_URL: messaging.issueTrackingAuditQueue.queueUrl,
      ISSUE_TRACKING_SECRET_NAME: options.issueTrackingSecret.secretName,
    },
    timeout: cdk.Duration.seconds(30),
  });
  options.issueTrackingSecret.grantRead(issueTrackingAuditWorkerFn);
  messaging.issueTrackingAuditQueue.grantConsumeMessages(issueTrackingAuditWorkerFn);
  issueTrackingAuditWorkerFn.addEventSource(
    new lambdaEventSources.SqsEventSource(messaging.issueTrackingAuditQueue, {
      batchSize: 5,
      reportBatchItemFailures: true,
    }),
  );

  const websocketConnectFn = createConfiguredLambda(scope, options, {
    fnName: 'websocket-connect',
    environment: {
      WEBSOCKET_CONNECTIONS_TABLE_NAME: tables.websocketConnectionTable.tableName,
      ...sharedEnvironment,
    },
  });
  tables.websocketConnectionTable.grantWriteData(websocketConnectFn);

  const websocketAuthorizerFn = createConfiguredLambda(scope, options, {
    fnName: 'websocket-authorizer',
    environment: sharedEnvironment,
  });

  const websocketDisconnectFn = createConfiguredLambda(scope, options, {
    fnName: 'websocket-disconnect',
    environment: {
      WEBSOCKET_CONNECTIONS_TABLE_NAME: tables.websocketConnectionTable.tableName,
    },
  });
  tables.websocketConnectionTable.grantWriteData(websocketDisconnectFn);

  const requestStatusEmailWorkerFn = createConfiguredLambda(scope, options, {
    fnName: 'request-status-email-worker',
    environment: {
      ...sharedEnvironment,
      REQUEST_STATUS_EMAIL_SOURCE: options.requestStatusEmailSource,
    },
    timeout: cdk.Duration.seconds(30),
  });
  messaging.requestStatusEmailQueue.grantConsumeMessages(requestStatusEmailWorkerFn);
  requestStatusEmailWorkerFn.addToRolePolicy(
    createRequestStatusEmailPolicyStatement(options.requestStatusEmailSource, options.requestStatusEmailIdentityArn),
  );
  requestStatusEmailWorkerFn.addToRolePolicy(createRequesterEmailPolicyStatement(stack, options.userPool.userPoolId));
  requestStatusEmailWorkerFn.addEventSource(
    new lambdaEventSources.SqsEventSource(messaging.requestStatusEmailQueue, {
      batchSize: 5,
      reportBatchItemFailures: true,
    }),
  );

  const managementAccountId = '058264309711';
  const assumeRoleArns = [`arn:aws:iam::${managementAccountId}:role/DbAccessorAppRole`];

  getRecordFn.addToRolePolicy(
    new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['sts:AssumeRole'],
      resources: assumeRoleArns,
    }),
  );

  const getAccountsFn = createConfiguredLambda(scope, options, {
    fnName: 'get-accounts',
    environment: {
      AWS_MANAGEMENT_ACCOUNT: managementAccountId,
      AWS_ACCOUNTS: assumeRoleArns.map((arn) => parse(arn).accountId).join(','),
      ...sharedEnvironment,
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

  const getTablesFn = createConfiguredLambda(scope, options, {
    fnName: 'get-tables',
    environment: sharedEnvironment,
  });
  getTablesFn.addToRolePolicy(
    new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['sts:AssumeRole'],
      resources: assumeRoleArns,
    }),
  );

  const createRequestFn = createConfiguredLambda(scope, options, {
    fnName: 'create-request',
    environment: {
      CONFIGURED_TABLES_TABLE_NAME: tables.configuredTablesTable.tableName,
      ...sharedEnvironment,
    },
  });
  createRequestFn.addToRolePolicy(
    new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['sts:AssumeRole'],
      resources: assumeRoleArns,
    }),
  );
  tables.grantTable.grantWriteData(createRequestFn);
  tables.configuredTablesTable.grantReadData(createRequestFn);

  const createUnredactRequestFn = createConfiguredLambda(scope, options, {
    fnName: 'create-unredact-request',
    environment: sharedEnvironment,
  });
  tables.grantTable.grantReadWriteData(createUnredactRequestFn);

  const getRequestFn = createConfiguredLambda(scope, options, {
    fnName: 'get-request',
    environment: sharedEnvironment,
  });
  tables.grantTable.grantReadData(getRequestFn);

  const getNotificationsFn = createConfiguredLambda(scope, options, {
    fnName: 'get-notifications',
    environment: {
      NOTIFICATIONS_TABLE_NAME: tables.notificationTable.tableName,
      ...sharedEnvironment,
    },
  });
  tables.notificationTable.grantReadData(getNotificationsFn);

  const markNotificationsReadFn = createConfiguredLambda(scope, options, {
    fnName: 'mark-notifications-read',
    environment: {
      NOTIFICATIONS_TABLE_NAME: tables.notificationTable.tableName,
      ...sharedEnvironment,
    },
  });
  tables.notificationTable.grantReadWriteData(markNotificationsReadFn);

  const getConfiguredTablesFn = createConfiguredLambda(scope, options, {
    fnName: 'get-configured-tables',
    environment: {
      CONFIGURED_TABLES_TABLE_NAME: tables.configuredTablesTable.tableName,
      ...sharedEnvironment,
    },
  });
  tables.configuredTablesTable.grantReadData(getConfiguredTablesFn);

  const adminGetRequestFn = createConfiguredLambda(scope, options, {
    fnName: 'admin-get-request',
    environment: sharedEnvironment,
  });
  tables.grantTable.grantReadData(adminGetRequestFn);

  const adminApproveRequestFn = createConfiguredLambda(scope, options, {
    fnName: 'admin-approve-request',
    environment: {
      ...sharedEnvironment,
      REQUEST_STATUS_TOPIC_ARN: messaging.requestStatusTopic.topicArn,
      STAGE: options.stage,
    },
  });
  tables.grantTable.grantReadWriteData(adminApproveRequestFn);
  messaging.requestStatusTopic.grantPublish(adminApproveRequestFn);

  const adminRejectRequestFn = createConfiguredLambda(scope, options, {
    fnName: 'admin-reject-request',
    environment: {
      ...sharedEnvironment,
      REQUEST_STATUS_TOPIC_ARN: messaging.requestStatusTopic.topicArn,
      STAGE: options.stage,
    },
  });
  tables.grantTable.grantReadWriteData(adminRejectRequestFn);
  messaging.requestStatusTopic.grantPublish(adminRejectRequestFn);

  const adminCreateRulesetFn = createConfiguredLambda(scope, options, {
    fnName: 'admin-create-ruleset',
    environment: {
      RULESET_TABLE_NAME: tables.rulesetTable.tableName,
      ...sharedEnvironment,
    },
  });
  adminCreateRulesetFn.addToRolePolicy(
    new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['sts:AssumeRole'],
      resources: assumeRoleArns,
    }),
  );
  tables.rulesetTable.grantWriteData(adminCreateRulesetFn);

  const adminGetRulesetFn = createConfiguredLambda(scope, options, {
    fnName: 'admin-get-ruleset',
    environment: {
      RULESET_TABLE_NAME: tables.rulesetTable.tableName,
      ...sharedEnvironment,
    },
  });
  tables.rulesetTable.grantReadData(adminGetRulesetFn);

  const adminCreateConfiguredTableFn = createConfiguredLambda(scope, options, {
    fnName: 'admin-create-configured-table',
    environment: {
      CONFIGURED_TABLES_TABLE_NAME: tables.configuredTablesTable.tableName,
      ...sharedEnvironment,
    },
  });
  adminCreateConfiguredTableFn.addToRolePolicy(
    new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['sts:AssumeRole'],
      resources: assumeRoleArns,
    }),
  );
  tables.configuredTablesTable.grantWriteData(adminCreateConfiguredTableFn);

  const adminDeleteConfiguredTableFn = createConfiguredLambda(scope, options, {
    fnName: 'admin-delete-configured-table',
    environment: {
      CONFIGURED_TABLES_TABLE_NAME: tables.configuredTablesTable.tableName,
      ...sharedEnvironment,
    },
  });
  tables.configuredTablesTable.grantWriteData(adminDeleteConfiguredTableFn);

  return {
    getRecordFn,
    issueTrackingAuditWorkerFn,
    websocketConnectFn,
    websocketAuthorizerFn,
    websocketDisconnectFn,
    requestStatusEmailWorkerFn,
    getAccountsFn,
    getTablesFn,
    createRequestFn,
    createUnredactRequestFn,
    getRequestFn,
    getNotificationsFn,
    markNotificationsReadFn,
    getConfiguredTablesFn,
    adminGetRequestFn,
    adminApproveRequestFn,
    adminRejectRequestFn,
    adminCreateRulesetFn,
    adminGetRulesetFn,
    adminCreateConfiguredTableFn,
    adminDeleteConfiguredTableFn,
  };
}

export function createRequestStatusNotificationWorker(
  scope: Construct,
  options: CreateRequestStatusNotificationWorkerOptions,
): lambda.IFunction {
  const stack = cdk.Stack.of(scope);

  const requestStatusNotificationWorkerFn = createConfiguredLambda(scope, options, {
    fnName: 'request-status-notification-worker',
    environment: {
      NOTIFICATIONS_TABLE_NAME: options.tables.notificationTable.tableName,
      WEBSOCKET_CONNECTIONS_TABLE_NAME: options.tables.websocketConnectionTable.tableName,
      WEBSOCKET_ENDPOINT: options.websocketEndpoint,
    },
    timeout: cdk.Duration.seconds(30),
  });
  options.messaging.requestStatusNotificationQueue.grantConsumeMessages(requestStatusNotificationWorkerFn);
  options.tables.notificationTable.grantWriteData(requestStatusNotificationWorkerFn);
  options.tables.websocketConnectionTable.grantReadWriteData(requestStatusNotificationWorkerFn);
  requestStatusNotificationWorkerFn.addToRolePolicy(
    new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['execute-api:ManageConnections'],
      resources: [
        `arn:${stack.partition}:execute-api:${stack.region}:${stack.account}:${options.websocketApi.apiId}/${options.stage}/POST/@connections/*`,
      ],
    }),
  );
  requestStatusNotificationWorkerFn.addEventSource(
    new lambdaEventSources.SqsEventSource(options.messaging.requestStatusNotificationQueue, {
      batchSize: 5,
      reportBatchItemFailures: true,
    }),
  );

  return requestStatusNotificationWorkerFn;
}
