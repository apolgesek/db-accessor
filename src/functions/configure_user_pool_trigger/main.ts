import {
  CognitoIdentityProviderClient,
  DescribeUserPoolCommand,
  PreTokenGenerationLambdaVersionType,
  UpdateUserPoolCommand,
  UpdateUserPoolCommandInput,
  UserPoolType,
} from '@aws-sdk/client-cognito-identity-provider';
import { CloudFormationCustomResourceEvent, CloudFormationCustomResourceResponse } from 'aws-lambda';

interface ResourceProperties {
  UserPoolId: string;
  LambdaArn: string;
  LambdaVersion: PreTokenGenerationLambdaVersionType;
}

const client = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION });

export const lambdaHandler = async (event: CloudFormationCustomResourceEvent<ResourceProperties>) => {
  const physicalResourceId = `${event.ResourceProperties.UserPoolId}-pre-token-generation-trigger`;

  try {
    if (event.RequestType === 'Create' || event.RequestType === 'Update') {
      await updatePreTokenGenerationTrigger(event.ResourceProperties);
    }

    if (event.RequestType === 'Delete') {
      await removePreTokenGenerationTrigger(event.ResourceProperties);
    }

    await sendResponse(event, {
      Status: 'SUCCESS',
      PhysicalResourceId: event.RequestType === 'Create' ? physicalResourceId : event.PhysicalResourceId,
      StackId: event.StackId,
      RequestId: event.RequestId,
      LogicalResourceId: event.LogicalResourceId,
    });
  } catch (error) {
    await sendResponse(event, {
      Status: 'FAILED',
      Reason: error instanceof Error ? error.message : 'Unknown error',
      PhysicalResourceId: event.RequestType === 'Create' ? physicalResourceId : event.PhysicalResourceId,
      StackId: event.StackId,
      RequestId: event.RequestId,
      LogicalResourceId: event.LogicalResourceId,
    });
  }
};

async function updatePreTokenGenerationTrigger(properties: ResourceProperties) {
  const userPool = await describeUserPool(properties.UserPoolId);
  const updateInput = toUpdateUserPoolInput(userPool, {
    PreTokenGeneration: properties.LambdaArn,
    PreTokenGenerationConfig: {
      LambdaArn: properties.LambdaArn,
      LambdaVersion: properties.LambdaVersion,
    },
  });

  await client.send(new UpdateUserPoolCommand(updateInput));
}

async function removePreTokenGenerationTrigger(properties: ResourceProperties) {
  const userPool = await describeUserPool(properties.UserPoolId);
  const lambdaConfig = { ...userPool.LambdaConfig };
  const currentLambdaArn = lambdaConfig.PreTokenGenerationConfig?.LambdaArn ?? lambdaConfig.PreTokenGeneration;

  if (currentLambdaArn !== properties.LambdaArn) {
    return;
  }

  delete lambdaConfig.PreTokenGeneration;
  delete lambdaConfig.PreTokenGenerationConfig;

  await client.send(new UpdateUserPoolCommand(toUpdateUserPoolInput(userPool, lambdaConfig)));
}

async function describeUserPool(userPoolId: string): Promise<UserPoolType> {
  const response = await client.send(new DescribeUserPoolCommand({ UserPoolId: userPoolId }));

  if (!response.UserPool) {
    throw new Error(`User pool ${userPoolId} was not found`);
  }

  return response.UserPool;
}

function toUpdateUserPoolInput(
  userPool: UserPoolType,
  lambdaConfig: UserPoolType['LambdaConfig'],
): UpdateUserPoolCommandInput {
  return removeUndefinedValues({
    UserPoolId: userPool.Id,
    Policies: userPool.Policies,
    DeletionProtection: userPool.DeletionProtection,
    LambdaConfig: lambdaConfig,
    AutoVerifiedAttributes: userPool.AutoVerifiedAttributes,
    SmsVerificationMessage: userPool.SmsVerificationMessage,
    EmailVerificationMessage: userPool.EmailVerificationMessage,
    EmailVerificationSubject: userPool.EmailVerificationSubject,
    VerificationMessageTemplate: userPool.VerificationMessageTemplate,
    SmsAuthenticationMessage: userPool.SmsAuthenticationMessage,
    UserAttributeUpdateSettings: userPool.UserAttributeUpdateSettings,
    MfaConfiguration: userPool.MfaConfiguration,
    DeviceConfiguration: userPool.DeviceConfiguration,
    EmailConfiguration: userPool.EmailConfiguration,
    SmsConfiguration: userPool.SmsConfiguration,
    UserPoolTags: userPool.UserPoolTags,
    AdminCreateUserConfig: userPool.AdminCreateUserConfig,
    UserPoolAddOns: userPool.UserPoolAddOns,
    AccountRecoverySetting: userPool.AccountRecoverySetting,
    PoolName: userPool.Name,
    UserPoolTier: userPool.UserPoolTier,
  });
}

function removeUndefinedValues<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entryValue]) => entryValue !== undefined)) as T;
}

async function sendResponse(
  event: CloudFormationCustomResourceEvent<ResourceProperties>,
  response: CloudFormationCustomResourceResponse,
) {
  const responseBody = JSON.stringify(response);
  const result = await fetch(event.ResponseURL, {
    method: 'PUT',
    body: responseBody,
    headers: {
      'content-type': '',
      'content-length': responseBody.length.toString(),
    },
  });

  if (!result.ok) {
    throw new Error(`CloudFormation response failed with status ${result.status}`);
  }
}
