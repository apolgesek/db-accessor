import * as cdk from 'aws-cdk-lib';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as ses from 'aws-cdk-lib/aws-ses';
import { Construct } from 'constructs';

export interface RequestStatusEmailResources {
  sourceEmail: string;
  emailIdentityArn: string;
}

export interface CreateRequestStatusEmailResourcesOptions {
  projectName: string;
  domain: string;
  hostedZoneName: string;
  removalPolicy: cdk.RemovalPolicy;
}

export function createRequestStatusEmailResources(
  scope: Construct,
  options: CreateRequestStatusEmailResourcesOptions,
): RequestStatusEmailResources {
  const stack = cdk.Stack.of(scope);
  const sourceEmail = `noreply@${options.domain}`;
  const hostedZoneName = withTrailingDot(options.hostedZoneName);

  const identity = new ses.CfnEmailIdentity(scope, `${options.projectName}-request-status-email-identity`, {
    emailIdentity: options.domain,
    dkimAttributes: {
      signingEnabled: true,
    },
    dkimSigningAttributes: {
      nextSigningKeyLength: 'RSA_2048_BIT',
    },
  });
  identity.applyRemovalPolicy(options.removalPolicy);

  createDkimRecord(scope, `${options.projectName}-request-status-email-dkim-1`, {
    hostedZoneName,
    name: identity.attrDkimDnsTokenName1,
    value: identity.attrDkimDnsTokenValue1,
    removalPolicy: options.removalPolicy,
  });
  createDkimRecord(scope, `${options.projectName}-request-status-email-dkim-2`, {
    hostedZoneName,
    name: identity.attrDkimDnsTokenName2,
    value: identity.attrDkimDnsTokenValue2,
    removalPolicy: options.removalPolicy,
  });
  createDkimRecord(scope, `${options.projectName}-request-status-email-dkim-3`, {
    hostedZoneName,
    name: identity.attrDkimDnsTokenName3,
    value: identity.attrDkimDnsTokenValue3,
    removalPolicy: options.removalPolicy,
  });

  return {
    sourceEmail,
    emailIdentityArn: stack.formatArn({
      service: 'ses',
      resource: 'identity',
      resourceName: identity.ref,
    }),
  };
}

function createDkimRecord(
  scope: Construct,
  id: string,
  options: {
    hostedZoneName: string;
    name: string;
    value: string;
    removalPolicy: cdk.RemovalPolicy;
  },
): void {
  const record = new route53.CfnRecordSet(scope, id, {
    hostedZoneName: options.hostedZoneName,
    name: options.name,
    type: 'CNAME',
    resourceRecords: [options.value],
    ttl: '1800',
  });
  record.applyRemovalPolicy(options.removalPolicy);
}

function withTrailingDot(domainName: string): string {
  return domainName.endsWith('.') ? domainName : `${domainName}.`;
}
