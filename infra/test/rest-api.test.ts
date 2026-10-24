import { beforeAll, describe, expect, test } from '@jest/globals';
import * as cdk from 'aws-cdk-lib';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import { Template } from 'aws-cdk-lib/assertions';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { REST_PREFLIGHT_METHODS, REST_ROUTES } from '../../src/shared/rest-routes';
import { RestLambdaFunctions, createRestApi } from '../lib/rest-api';

const lambdaKeys: (keyof RestLambdaFunctions)[] = [
  'getRecordFn',
  'createRequestFn',
  'getRequestFn',
  'createUnredactRequestFn',
  'adminGetRequestFn',
  'adminApproveRequestFn',
  'adminRejectRequestFn',
  'getAccountsFn',
  'getTablesFn',
  'getConfiguredTablesFn',
  'getNotificationsFn',
  'markNotificationsReadFn',
  'adminCreateRulesetFn',
  'adminGetRulesetFn',
  'adminCreateConfiguredTableFn',
  'adminUpdatePiiDetectionFn',
  'adminGetPiiSuggestionsFn',
  'adminDeleteConfiguredTableFn',
];

// Lambda key → kebab-case function name, e.g. getRecordFn → get-record.
const functionNameOf = (key: string) => key.replace(/Fn$/, '').replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

describe('REST API', () => {
  let stack: cdk.Stack;
  let api: apigw.RestApi;
  let functionsByName: Map<string, lambda.Function>;
  let resources: Record<string, { Type: string; Properties: Record<string, unknown> }>;

  beforeAll(() => {
    stack = new cdk.Stack();
    const userPool = new cognito.UserPool(stack, 'UserPool');
    functionsByName = new Map();
    const lambdas = {} as Record<keyof RestLambdaFunctions, lambda.IFunction>;
    for (const key of lambdaKeys) {
      const fn = new lambda.Function(stack, key, {
        runtime: lambda.Runtime.NODEJS_22_X,
        handler: 'index.handler',
        code: lambda.Code.fromInline('exports.handler = async () => ({});'),
      });
      lambdas[key] = fn;
      functionsByName.set(functionNameOf(key), fn);
    }

    api = createRestApi(stack, { projectName: 'db-accessor-dev', stage: 'dev', userPool, lambdas }).api;
    resources = Template.fromStack(stack).toJSON().Resources;
  });

  const methodProperties = (method: apigw.Method) =>
    resources[stack.getLogicalId(method.node.defaultChild as cdk.CfnElement)].Properties;

  // Reads the synthesized template, so methods created outside the RestApi construct's helpers are counted too.
  test('creates exactly the methods the route table lists', () => {
    const rootId = stack.resolve(api.restApiRootResourceId);
    const pathOf = (resourceId: unknown): string => {
      if (JSON.stringify(resourceId) === JSON.stringify(rootId)) return '';
      const resource = resources[(resourceId as { Ref: string }).Ref].Properties;
      return `${pathOf(resource.ParentId)}/${resource.PathPart}`;
    };
    const created = Object.values(resources)
      .filter((resource) => resource.Type === 'AWS::ApiGateway::Method' && resource.Properties.HttpMethod !== 'OPTIONS')
      .map((resource) => `${resource.Properties.HttpMethod} ${pathOf(resource.Properties.ResourceId)}`);

    expect(created.sort()).toEqual(REST_ROUTES.map((route) => `${route.method} ${route.path}`).sort());
  });

  test('integrates each route with its Lambda behind the Cognito authorizer', () => {
    for (const route of REST_ROUTES) {
      const method = api.methods.find((m) => m.httpMethod === route.method && m.resource.path === route.path)!;
      const properties = methodProperties(method);
      const functionLogicalId = stack.getLogicalId(
        functionsByName.get(route.functionName)!.node.defaultChild as cdk.CfnElement,
      );

      expect(properties).toMatchObject({
        AuthorizationType: 'COGNITO_USER_POOLS',
        AuthorizationScopes: ['openid'],
        Integration: { Type: 'AWS_PROXY' },
      });
      expect(JSON.stringify((properties.Integration as { Uri: unknown }).Uri)).toContain(functionLogicalId);
    }
  });

  test('adds CORS preflight with the declared methods to exactly the declared paths', () => {
    const preflights = api.methods.filter((method) => method.httpMethod === 'OPTIONS');

    expect(preflights.map((method) => method.resource.path).sort()).toEqual(Object.keys(REST_PREFLIGHT_METHODS).sort());
    for (const method of preflights) {
      const integration = methodProperties(method).Integration as {
        IntegrationResponses: { ResponseParameters: Record<string, string> }[];
      };

      expect(integration.IntegrationResponses[0].ResponseParameters).toMatchObject({
        'method.response.header.Access-Control-Allow-Origin': "'*'",
        'method.response.header.Access-Control-Allow-Methods': `'${REST_PREFLIGHT_METHODS[method.resource.path].join(',')}'`,
      });
    }
  });
});
