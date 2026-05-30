import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { DbAccessorLambdaFunctions } from './lambda-functions';

export interface RestApiResources {
  api: apigw.RestApi;
  apiDomainName: string;
}

export interface CreateRestApiOptions {
  projectName: string;
  stage: string;
  domain: string;
  regionalAcmCertificate: acm.ICertificate;
  userPool: cognito.IUserPool;
  lambdas: DbAccessorLambdaFunctions;
}

export function createRestApi(scope: Construct, options: CreateRestApiOptions): RestApiResources {
  const apiDomainName = `api.${options.domain}`;
  const api = new apigw.RestApi(scope, `${options.projectName}-rest-api`, {
    deployOptions: { stageName: options.stage },
    domainName: {
      certificate: options.regionalAcmCertificate,
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

  const cognitoAuthorizer = new apigw.CognitoUserPoolsAuthorizer(scope, 'CognitoAuthorizer', {
    cognitoUserPools: [options.userPool],
    authorizerName: `${options.projectName}-cognito-authorizer`,
    identitySource: 'method.request.header.Authorization',
  });

  const methodOptions = {
    authorizationType: apigw.AuthorizationType.COGNITO,
    authorizer: cognitoAuthorizer,
    authorizationScopes: ['openid'],
  };

  record.addMethod('GET', new apigw.LambdaIntegration(options.lambdas.getRecordFn), methodOptions);
  request.addMethod('POST', new apigw.LambdaIntegration(options.lambdas.createRequestFn), methodOptions);
  request.addMethod('GET', new apigw.LambdaIntegration(options.lambdas.getRequestFn), methodOptions);
  unredactRequest.addMethod(
    'POST',
    new apigw.LambdaIntegration(options.lambdas.createUnredactRequestFn),
    methodOptions,
  );
  adminGetRequest.addMethod('GET', new apigw.LambdaIntegration(options.lambdas.adminGetRequestFn), methodOptions);
  adminApproveRequest.addMethod(
    'PUT',
    new apigw.LambdaIntegration(options.lambdas.adminApproveRequestFn),
    methodOptions,
  );
  adminRejectRequest.addMethod('PUT', new apigw.LambdaIntegration(options.lambdas.adminRejectRequestFn), methodOptions);
  getAccounts.addMethod('GET', new apigw.LambdaIntegration(options.lambdas.getAccountsFn), methodOptions);
  getTables.addMethod('GET', new apigw.LambdaIntegration(options.lambdas.getTablesFn), methodOptions);
  notifications.addMethod('GET', new apigw.LambdaIntegration(options.lambdas.getNotificationsFn), methodOptions);
  readNotifications.addMethod(
    'POST',
    new apigw.LambdaIntegration(options.lambdas.markNotificationsReadFn),
    methodOptions,
  );
  adminCreateRuleset.addMethod(
    'POST',
    new apigw.LambdaIntegration(options.lambdas.adminCreateRulesetFn),
    methodOptions,
  );
  adminGetRuleset.addMethod('GET', new apigw.LambdaIntegration(options.lambdas.adminGetRulesetFn), methodOptions);

  return { api, apiDomainName };
}
