#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-non-null-assertion */
import fs from 'fs';
import path from 'path';
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
const domain = '4eyesdb.com';

const samlMetadataFilePath = path.join('config', stage, 'idp', 'saml-metadata.xml');
const samlMetadataFileContent = fs.readFileSync(path.resolve(samlMetadataFilePath), 'utf8');

new DbAccessorDeployAccessStack(app, 'DbAccessorDeployAccessStack', {
  env,
  stage,
  projectName,
  githubOrg,
  githubRepo,
});

new DbAccessorStack(app, 'DbAccessorStack', {
  projectName,
  env,
  stage,
  domain,
  allowedIp: '63.176.89.71',
  samlMetadataFileContent,
});
