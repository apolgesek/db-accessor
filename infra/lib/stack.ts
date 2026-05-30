import * as cdk from 'aws-cdk-lib';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { importCertificateResources } from './certificates';
import { createCognitoResources } from './cognito';
import { createDynamoDbTables } from './dynamodb-tables';
import {
  DbAccessorLambdaFunctions,
  createApplicationLambdaFunctions,
  createRequestStatusNotificationWorker,
} from './lambda-functions';
import { createMessagingResources } from './messaging';
import { createRestApi } from './rest-api';
import { importIssueTrackingSecret } from './secrets';
import { createStackOutputs } from './stack-outputs';
import { createWebSocketApi } from './websocket-api';

export interface DbAccessorStackProps extends cdk.StackProps {
  projectName: string;
  stage: 'dev' | 'prod';
  domain: string;
  samlMetadataFileContent?: string;
}

export class DbAccessorStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: DbAccessorStackProps) {
    super(scope, id, props);

    const projectName = `${props.projectName}-${props.stage}`;
    const removalPolicy = props.stage === 'dev' ? cdk.RemovalPolicy.DESTROY : cdk.RemovalPolicy.RETAIN;
    const lambdaLogRetention = props.stage === 'dev' ? logs.RetentionDays.THREE_MONTHS : logs.RetentionDays.ONE_YEAR;

    const certificates = importCertificateResources(this, projectName);
    const cognitoResources = createCognitoResources(this, {
      projectName,
      stage: props.stage,
      domain: props.domain,
      removalPolicy,
      lambdaLogRetention,
      samlMetadataFileContent: props.samlMetadataFileContent,
    });
    const tables = createDynamoDbTables(this, { projectName, removalPolicy });
    const messaging = createMessagingResources(this, projectName);
    const issueTrackingSecret = importIssueTrackingSecret(this, projectName, props.projectName, props.stage);

    const sharedEnvironment = {
      GRANTS_TABLE_NAME: tables.grantTable.tableName,
      COGNITO_USER_POOL_ID: cognitoResources.userPool.userPoolId,
      COGNITO_CLIENT_ID: cognitoResources.userPoolClient.userPoolClientId,
      USERNAME_PREFIX: `${props.projectName}_`,
    };
    const requestStatusEmailSource = `noreply@${props.domain}`;
    const lambdaDefaults = {
      projectName,
      removalPolicy,
      lambdaLogRetention,
    };

    const applicationLambdas = createApplicationLambdaFunctions(this, {
      ...lambdaDefaults,
      stage: props.stage,
      baseProjectName: props.projectName,
      requestStatusEmailSource,
      sharedEnvironment,
      tables,
      messaging,
      issueTrackingSecret,
      userPool: cognitoResources.userPool,
    });

    const websocket = createWebSocketApi(this, {
      projectName,
      stage: props.stage,
      domain: props.domain,
      regionalAcmCertificate: certificates.regionalAcmCertificate,
      websocketConnectFn: applicationLambdas.websocketConnectFn,
      websocketAuthorizerFn: applicationLambdas.websocketAuthorizerFn,
      websocketDisconnectFn: applicationLambdas.websocketDisconnectFn,
    });

    const lambdas: DbAccessorLambdaFunctions = {
      ...applicationLambdas,
      requestStatusNotificationWorkerFn: createRequestStatusNotificationWorker(this, {
        ...lambdaDefaults,
        stage: props.stage,
        tables,
        messaging,
        websocketApi: websocket.websocketApi,
        websocketEndpoint: websocket.websocketEndpoint,
      }),
    };

    const restApi = createRestApi(this, {
      projectName,
      stage: props.stage,
      domain: props.domain,
      regionalAcmCertificate: certificates.regionalAcmCertificate,
      userPool: cognitoResources.userPool,
      lambdas,
    });

    createStackOutputs(this, {
      api: restApi.api,
      apiDomainName: restApi.apiDomainName,
      websocketDomain: websocket.websocketDomain,
      websocketDomainName: websocket.websocketDomainName,
      userPool: cognitoResources.userPool,
      userPoolClient: cognitoResources.userPoolClient,
      userPoolDomain: cognitoResources.userPoolDomain,
      samlProvider: cognitoResources.samlProvider,
    });
  }
}
