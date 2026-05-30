import * as cdk from 'aws-cdk-lib';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';

export interface CreateStackOutputsOptions {
  api: apigw.RestApi;
  apiDomainName: string;
  websocketDomain: apigwv2.DomainName;
  websocketDomainName: string;
  userPool: cognito.UserPool;
  userPoolClient: cognito.UserPoolClient;
  userPoolDomain: cognito.UserPoolDomain;
  samlProvider?: cognito.UserPoolIdentityProviderSaml;
}

export function createStackOutputs(scope: Construct, options: CreateStackOutputsOptions): void {
  const stack = cdk.Stack.of(scope);

  new cdk.CfnOutput(scope, 'ApiUrl', { value: options.api.url ?? '' });
  new cdk.CfnOutput(scope, 'ApiDomainName', {
    value: options.apiDomainName,
  });
  new cdk.CfnOutput(scope, 'ApiDomainAliasDomainName', {
    value: options.api.domainName!.domainNameAliasDomainName,
  });
  new cdk.CfnOutput(scope, 'ApiDomainAliasHostedZoneId', {
    value: options.api.domainName!.domainNameAliasHostedZoneId,
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
    value: `https://cognito-idp.${stack.region}.${stack.urlSuffix}/${options.userPool.userPoolId}`,
  });
  new cdk.CfnOutput(scope, 'CognitoHostedUiDomain', {
    value: `https://${options.userPoolDomain.domainName}`,
  });
  new cdk.CfnOutput(scope, 'CognitoDomainCloudFrontEndpoint', {
    value: options.userPoolDomain.cloudFrontEndpoint,
  });
  new cdk.CfnOutput(scope, 'CognitoDomainCloudFrontHostedZoneId', {
    value: 'Z2FDTNDATAQYW2',
  });

  if (options.samlProvider) {
    new cdk.CfnOutput(scope, 'CognitoSamlIdentityProviderName', {
      value: options.samlProvider.providerName,
    });
  }
}
