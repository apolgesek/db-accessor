#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-non-null-assertion */
import fs from 'fs';
import path from 'path';
import * as cdk from 'aws-cdk-lib';
import { DbAccessorDeployStack } from '../lib/deploy-stack';
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
const domain = `${stage}.4eyesdb.com`;
const hostedZoneName = process.env.HOSTED_ZONE_NAME || domain;

const samlMetadataFilePath = path.join('config', stage, 'idp', 'saml-metadata.xml');
const samlMetadataFileContent = fs.readFileSync(path.resolve(samlMetadataFilePath), 'utf8');

new DbAccessorDeployStack(app, `${projectName}-deploy-stack`, {
  env,
  stage,
  projectName,
  githubOrg,
  githubRepo,
});

new DbAccessorStack(app, `${projectName}-stack`, {
  projectName,
  env,
  stage,
  domain,
  hostedZoneName,
  samlMetadataFileContent,
});
