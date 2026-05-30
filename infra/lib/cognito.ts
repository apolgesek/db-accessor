import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { createLambda, CreateLambdaOptions } from './lambda-factory';

export interface CreateCognitoResourcesOptions {
  projectName: string;
  stage: string;
  domain: string;
  removalPolicy: cdk.RemovalPolicy;
  lambdaLogRetention: logs.RetentionDays;
  samlMetadataFileContent?: string;
}

export interface CognitoResources {
  userPool: cognito.UserPool;
  userPoolClient: cognito.UserPoolClient;
  userPoolDomain: cognito.UserPoolDomain;
  samlProvider?: cognito.UserPoolIdentityProviderSaml;
}

export function createCognitoResources(scope: Construct, options: CreateCognitoResourcesOptions): CognitoResources {
  const stack = cdk.Stack.of(scope);
  const createCognitoLambda = (
    lambdaOptions: Omit<CreateLambdaOptions, 'projectName' | 'logGroupRemovalPolicy' | 'logRetention'>,
  ) =>
    createLambda(scope, {
      ...lambdaOptions,
      projectName: options.projectName,
      logGroupRemovalPolicy: options.removalPolicy,
      logRetention: options.lambdaLogRetention,
    });

  const preTokenGenerationRole = new iam.Role(scope, `${options.projectName}-pre-token-generation-role`, {
    assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    description: 'Execution role for Cognito pre-token-generation Lambda without CloudWatch Logs permissions',
  });
  const preTokenGenerationFn = createCognitoLambda({
    fnName: 'pre-token-generation',
    createLogGroup: false,
    role: preTokenGenerationRole,
  });

  const userPool = new cognito.UserPool(scope, `${options.projectName}-user-pool`, {
    userPoolName: `${options.projectName}-users`,
    selfSignUpEnabled: false,
    signInAliases: {
      email: true,
    },
    autoVerify: {
      email: true,
    },
    standardAttributes: {
      email: {
        required: true,
        mutable: true,
      },
    },
    customAttributes: {
      idc_groups: new cognito.StringAttribute({
        mutable: true,
        minLen: 0,
        maxLen: 2048,
      }),
    },
    accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
    removalPolicy: options.removalPolicy,
  });

  const userPoolPreTokenPermission = new lambda.CfnPermission(
    scope,
    `${options.projectName}-pre-token-generation-permission`,
    {
      action: 'lambda:InvokeFunction',
      functionName: preTokenGenerationFn.functionArn,
      principal: 'cognito-idp.amazonaws.com',
      sourceAccount: stack.account,
      sourceArn: stack.formatArn({
        service: 'cognito-idp',
        resource: 'userpool',
        resourceName: '*',
      }),
    },
  );

  const cfnUserPool = userPool.node.defaultChild as cognito.CfnUserPool;
  cfnUserPool.lambdaConfig = {
    preTokenGenerationConfig: {
      lambdaArn: preTokenGenerationFn.functionArn,
      lambdaVersion: 'V3_0',
    },
  };
  cfnUserPool.node.addDependency(userPoolPreTokenPermission);

  const samlMetadata = options.samlMetadataFileContent
    ? cognito.UserPoolIdentityProviderSamlMetadata.file(options.samlMetadataFileContent)
    : undefined;
  const samlProvider = samlMetadata
    ? new cognito.UserPoolIdentityProviderSaml(scope, `${options.projectName}-saml-idp`, {
        userPool,
        name: 'external-idp',
        metadata: samlMetadata,
        attributeMapping: {
          email: cognito.ProviderAttribute.other('Email'),
          preferredUsername: cognito.ProviderAttribute.other('Subject'),
          custom: {
            'custom:idc_groups': cognito.ProviderAttribute.other('Groups'),
          },
        },
      })
    : undefined;
  const supportedIdentityProviders = [
    cognito.UserPoolClientIdentityProvider.COGNITO,
    ...(samlProvider ? [cognito.UserPoolClientIdentityProvider.custom(samlProvider.providerName)] : []),
  ];

  const userPoolClient = userPool.addClient(`${options.projectName}-web-client`, {
    userPoolClientName: `${options.projectName}-web`,
    generateSecret: false,
    preventUserExistenceErrors: true,
    supportedIdentityProviders,
    authFlows: {
      userSrp: true,
    },
    oAuth: {
      flows: {
        authorizationCodeGrant: true,
      },
      scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
      callbackUrls: [`https://${options.domain}`, 'http://localhost:4200'],
      logoutUrls: [`https://${options.domain}/login`, 'http://localhost:4200/login'],
    },
  });
  if (samlProvider) {
    userPoolClient.node.addDependency(samlProvider);
  }

  // custom domain global certificate
  const globalCertificateArn = ssm.StringParameter.valueForStringParameter(
    scope,
    `/${options.projectName}/acm/global-certificate-arn`,
  );
  const globalAcmCertificate = acm.Certificate.fromCertificateArn(
    scope,
    `${options.projectName}-global-domain-cert`,
    globalCertificateArn,
  );

  const userPoolDomain = userPool.addDomain(`${options.projectName}-domain`, {
    customDomain: {
      domainName: `auth.${options.domain}`,
      certificate: globalAcmCertificate,
    },
  });

  return {
    userPool,
    userPoolClient,
    userPoolDomain,
    samlProvider,
  };
}
