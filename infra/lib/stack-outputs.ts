import * as cdk from 'aws-cdk-lib';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

export interface CreateStackOutputsOptions {
  projectName: string;
  stage: 'dev' | 'prod';
  api: apigw.RestApi;
  apiOriginDomainName: string;
  apiOriginPath: string;
  websocketDomain: apigwv2.DomainName;
  websocketDomainName: string;
  userPool: cognito.UserPool;
  userPoolClient: cognito.UserPoolClient;
  userPoolDomain: cognito.UserPoolDomain;
  samlProvider?: cognito.UserPoolIdentityProviderSaml;
}

export function createStackOutputs(scope: Construct, options: CreateStackOutputsOptions): void {
  const stack = cdk.Stack.of(scope);
  const paramPrefix = `/${options.projectName}`;
  const cognitoAuthority = `https://cognito-idp.${stack.region}.${stack.urlSuffix}/${options.userPool.userPoolId}`;
  const cognitoHostedUiDomain = `https://${options.userPoolDomain.domainName}`;

  new cdk.CfnOutput(scope, 'ApiUrl', { value: options.api.url ?? '' });
  new cdk.CfnOutput(scope, 'ApiOriginDomainName', {
    value: options.apiOriginDomainName,
  });
  new cdk.CfnOutput(scope, 'ApiOriginPath', {
    value: options.apiOriginPath,
  });
  new cdk.CfnOutput(scope, 'WebSocketUrl', {
    value: `wss://${options.websocketDomainName}`,
  });
  new cdk.CfnOutput(scope, 'WebSocketDomainRegionalDomainName', {
    value: options.websocketDomain.regionalDomainName,
  });
  new cdk.CfnOutput(scope, 'WebSocketDomainRegionalHostedZoneId', {
    value: options.websocketDomain.regionalHostedZoneId,
  });
  new cdk.CfnOutput(scope, 'CognitoUserPoolId', { value: options.userPool.userPoolId });
  new cdk.CfnOutput(scope, 'CognitoUserPoolClientId', { value: options.userPoolClient.userPoolClientId });
  new cdk.CfnOutput(scope, 'CognitoAuthority', {
    value: cognitoAuthority,
  });
  new cdk.CfnOutput(scope, 'CognitoHostedUiDomain', {
    value: cognitoHostedUiDomain,
  });
  new cdk.CfnOutput(scope, 'CognitoDomainCloudFrontEndpoint', {
    value: options.userPoolDomain.cloudFrontEndpoint,
  });
  new cdk.CfnOutput(scope, 'CognitoDomainCloudFrontHostedZoneId', {
    value: 'Z2FDTNDATAQYW2',
  });

  new ssm.StringParameter(scope, 'ApiOriginDomainNameParameter', {
    parameterName: `${paramPrefix}/api/rest-api-origin-domain-name`,
    stringValue: options.apiOriginDomainName,
  });
  new ssm.StringParameter(scope, 'ApiOriginPathParameter', {
    parameterName: `${paramPrefix}/api/rest-api-origin-path`,
    stringValue: options.apiOriginPath,
  });
  new ssm.StringParameter(scope, 'WebSocketRegionalDomainNameParameter', {
    parameterName: `${paramPrefix}/websocket/regional-domain-name`,
    stringValue: options.websocketDomain.regionalDomainName,
  });
  new ssm.StringParameter(scope, 'WebSocketRegionalHostedZoneIdParameter', {
    parameterName: `${paramPrefix}/websocket/regional-hosted-zone-id`,
    stringValue: options.websocketDomain.regionalHostedZoneId,
  });
  new ssm.StringParameter(scope, 'AuthCloudFrontDomainNameParameter', {
    parameterName: `${paramPrefix}/auth/cloudfront-domain-name`,
    stringValue: options.userPoolDomain.cloudFrontEndpoint,
  });
  new ssm.StringParameter(scope, 'AuthCloudFrontHostedZoneIdParameter', {
    parameterName: `${paramPrefix}/auth/cloudfront-hosted-zone-id`,
    stringValue: 'Z2FDTNDATAQYW2',
  });
  new ssm.StringParameter(scope, 'AuthAuthorityParameter', {
    parameterName: `${paramPrefix}/auth/authority`,
    stringValue: cognitoAuthority,
  });
  new ssm.StringParameter(scope, 'AuthClientIdParameter', {
    parameterName: `${paramPrefix}/auth/client-id`,
    stringValue: options.userPoolClient.userPoolClientId,
  });
  new ssm.StringParameter(scope, 'AuthHostedUiDomainParameter', {
    parameterName: `${paramPrefix}/auth/hosted-ui-domain`,
    stringValue: cognitoHostedUiDomain,
  });

  if (options.samlProvider) {
    new cdk.CfnOutput(scope, 'CognitoSamlIdentityProviderName', {
      value: options.samlProvider.providerName,
    });
  }
}
