import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import { REST_PREFLIGHT_METHODS, REST_ROUTES, RestFunctionName } from '../../src/shared/rest-routes';
import { ApplicationLambdaFunctions } from './lambda-functions';

export interface RestApiResources {
  api: apigw.RestApi;
  apiOriginDomainName: string;
  apiOriginPath: string;
}

export interface CreateRestApiOptions {
  projectName: string;
  stage: string;
  userPool: cognito.IUserPool;
  lambdas: RestLambdaFunctions;
}

export type RestLambdaFunctions = Pick<
  ApplicationLambdaFunctions,
  | 'getRecordFn'
  | 'createRequestFn'
  | 'getRequestFn'
  | 'createUnredactRequestFn'
  | 'adminGetRequestFn'
  | 'adminApproveRequestFn'
  | 'adminRejectRequestFn'
  | 'getAccountsFn'
  | 'getTablesFn'
  | 'getConfiguredTablesFn'
  | 'getNotificationsFn'
  | 'markNotificationsReadFn'
  | 'adminCreateRulesetFn'
  | 'adminGetRulesetFn'
  | 'adminCreateConfiguredTableFn'
  | 'adminUpdatePiiDetectionFn'
  | 'adminGetPiiSuggestionsFn'
  | 'adminDeleteConfiguredTableFn'
>;

export function createRestApi(scope: Construct, options: CreateRestApiOptions): RestApiResources {
  const stack = cdk.Stack.of(scope);
  const api = new apigw.RestApi(scope, `${options.projectName}-rest-api`, {
    deployOptions: { stageName: options.stage },
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

  for (const [path, allowMethods] of Object.entries(REST_PREFLIGHT_METHODS)) {
    api.root.resourceForPath(path).addCorsPreflight({
      allowOrigins: apigw.Cors.ALL_ORIGINS,
      allowMethods: [...allowMethods],
    });
  }

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

  const functions = restFunctions(options.lambdas);
  for (const route of REST_ROUTES) {
    api.root
      .resourceForPath(route.path)
      .addMethod(route.method, new apigw.LambdaIntegration(functions[route.functionName]), methodOptions);
  }

  return {
    api,
    apiOriginDomainName: `${api.restApiId}.execute-api.${stack.region}.${stack.urlSuffix}`,
    apiOriginPath: `/${options.stage}`,
  };
}

// Typed by the route table, so a new route does not compile until its Lambda is mapped here.
function restFunctions(lambdas: RestLambdaFunctions): Record<RestFunctionName, lambda.IFunction> {
  return {
    'get-record': lambdas.getRecordFn,
    'create-request': lambdas.createRequestFn,
    'get-request': lambdas.getRequestFn,
    'create-unredact-request': lambdas.createUnredactRequestFn,
    'admin-get-request': lambdas.adminGetRequestFn,
    'admin-approve-request': lambdas.adminApproveRequestFn,
    'admin-reject-request': lambdas.adminRejectRequestFn,
    'get-accounts': lambdas.getAccountsFn,
    'get-tables': lambdas.getTablesFn,
    'get-configured-tables': lambdas.getConfiguredTablesFn,
    'get-notifications': lambdas.getNotificationsFn,
    'mark-notifications-read': lambdas.markNotificationsReadFn,
    'admin-create-ruleset': lambdas.adminCreateRulesetFn,
    'admin-get-ruleset': lambdas.adminGetRulesetFn,
    'admin-create-configured-table': lambdas.adminCreateConfiguredTableFn,
    'admin-update-pii-detection': lambdas.adminUpdatePiiDetectionFn,
    'admin-get-pii-suggestions': lambdas.adminGetPiiSuggestionsFn,
    'admin-delete-configured-table': lambdas.adminDeleteConfiguredTableFn,
  };
}
