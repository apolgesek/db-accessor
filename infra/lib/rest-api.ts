import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
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

// Route-table Lambda name → stack Lambda. A new route does not compile until its Lambda is mapped here.
export const REST_LAMBDA_KEYS = {
  'get-record': 'getRecordFn',
  'create-request': 'createRequestFn',
  'get-request': 'getRequestFn',
  'create-unredact-request': 'createUnredactRequestFn',
  'admin-get-request': 'adminGetRequestFn',
  'admin-approve-request': 'adminApproveRequestFn',
  'admin-reject-request': 'adminRejectRequestFn',
  'get-accounts': 'getAccountsFn',
  'get-tables': 'getTablesFn',
  'get-configured-tables': 'getConfiguredTablesFn',
  'get-notifications': 'getNotificationsFn',
  'mark-notifications-read': 'markNotificationsReadFn',
  'admin-create-ruleset': 'adminCreateRulesetFn',
  'admin-get-ruleset': 'adminGetRulesetFn',
  'admin-create-configured-table': 'adminCreateConfiguredTableFn',
  'admin-update-pii-detection': 'adminUpdatePiiDetectionFn',
  'admin-get-pii-suggestions': 'adminGetPiiSuggestionsFn',
  'admin-delete-configured-table': 'adminDeleteConfiguredTableFn',
  'create-session': 'createSessionFn',
  'get-session': 'getSessionFn',
} as const satisfies Record<RestFunctionName, keyof ApplicationLambdaFunctions>;

export type RestLambdaFunctions = Pick<ApplicationLambdaFunctions, (typeof REST_LAMBDA_KEYS)[RestFunctionName]>;

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

  for (const [path, allowMethods] of REST_PREFLIGHT_METHODS) {
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

  for (const route of REST_ROUTES) {
    const fn = options.lambdas[REST_LAMBDA_KEYS[route.functionName]];
    api.root.resourceForPath(route.path).addMethod(route.method, new apigw.LambdaIntegration(fn), methodOptions);
  }

  return {
    api,
    apiOriginDomainName: `${api.restApiId}.execute-api.${stack.region}.${stack.urlSuffix}`,
    apiOriginPath: `/${options.stage}`,
  };
}
