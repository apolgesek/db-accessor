import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigwv2Authorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as apigwv2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

export interface WebSocketApiResources {
  websocketApi: apigwv2.WebSocketApi;
  websocketDomain: apigwv2.DomainName;
  websocketDomainName: string;
  websocketEndpoint: string;
}

export interface CreateWebSocketApiOptions {
  projectName: string;
  stage: string;
  domain: string;
  regionalAcmCertificate: acm.ICertificate;
  websocketConnectFn: lambda.IFunction;
  websocketAuthorizerFn: lambda.IFunction;
  websocketDisconnectFn: lambda.IFunction;
}

export function createWebSocketApi(scope: Construct, options: CreateWebSocketApiOptions): WebSocketApiResources {
  const websocketAuthorizer = new apigwv2Authorizers.WebSocketLambdaAuthorizer(
    `${options.projectName}-websocket-authorizer`,
    options.websocketAuthorizerFn,
    {
      authorizerName: `${options.projectName}-websocket-authorizer`,
      identitySource: ['route.request.querystring.token'],
    },
  );

  const websocketApi = new apigwv2.WebSocketApi(scope, `${options.projectName}-websocket-api`, {
    apiName: `${options.projectName}-notifications`,
    connectRouteOptions: {
      integration: new apigwv2Integrations.WebSocketLambdaIntegration(
        `${options.projectName}-websocket-connect-integration`,
        options.websocketConnectFn,
      ),
      authorizer: websocketAuthorizer,
    },
    disconnectRouteOptions: {
      integration: new apigwv2Integrations.WebSocketLambdaIntegration(
        `${options.projectName}-websocket-disconnect-integration`,
        options.websocketDisconnectFn,
      ),
    },
  });

  const websocketStage = new apigwv2.WebSocketStage(scope, `${options.projectName}-websocket-stage`, {
    webSocketApi: websocketApi,
    stageName: options.stage,
    autoDeploy: true,
  });

  const websocketDomainName = `ws.${options.domain}`;
  const websocketDomain = new apigwv2.DomainName(scope, `${options.projectName}-websocket-domain`, {
    domainName: websocketDomainName,
    certificate: options.regionalAcmCertificate,
  });
  new apigwv2.ApiMapping(scope, `${options.projectName}-websocket-domain-mapping`, {
    api: websocketApi,
    domainName: websocketDomain,
    stage: websocketStage,
  });

  return {
    websocketApi,
    websocketDomain,
    websocketDomainName,
    websocketEndpoint: `https://${websocketDomainName}`,
  };
}
