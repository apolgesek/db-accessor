#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-non-null-assertion */
import * as cdk from 'aws-cdk-lib';
import { DbAccessorDeployAccessStack } from '../lib/deploy-access-stack';
import { DbAccessorStack } from '../lib/stack';

const app = new cdk.App();
const env = {
  account: process.env.CDK_DEPLOY_ACCOUNT || process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEPLOY_REGION || process.env.CDK_DEFAULT_REGION,
};
const stage = process.env.STAGE as 'dev' | 'prod';
const projectName = 'db-accessor';
const githubOrg = 'apolgesek';
const githubRepo = 'db-accessor';

new DbAccessorDeployAccessStack(app, 'DbAccessorDeployAccessStack', {
  env,
  stage,
  projectName,
  githubOrg,
  githubRepo,
});

new DbAccessorStack(app, 'DbAccessorStack', {
  env,
  stage,
  projectName,
  cognitoUserPoolId: 'eu-central-1_6rLj50DRM',
  cognitoClientId: '6n5d5gru7c0ncf5npa0m5ls2n8',
  allowedIp: '63.176.89.71',
});
