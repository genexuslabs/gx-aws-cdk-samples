#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { AwsApprunnerStack } from '../lib/aws-apprunner-stack';

const profileAccountId = process.env.CDK_DEFAULT_ACCOUNT;
const profileRegion = process.env.CDK_DEFAULT_REGION;

const env = {
  account: profileAccountId,
  region: profileRegion,
};

const app = new cdk.App();
const appName = app.node.tryGetContext('appname');
const stageName = app.node.tryGetContext('appstage');

new AwsApprunnerStack(app, 'AwsApprunnerStack', {
  env,
  appName,
  stageName
});