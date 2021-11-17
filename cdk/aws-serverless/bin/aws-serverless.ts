#!/usr/bin/env node
import * as cdk from "@aws-cdk/core";
import { AwsServerlessAPIStack } from "../lib/aws-serverless-api";

const profileAccountId = process.env.CDK_DEFAULT_ACCOUNT;
const profileRegion = process.env.CDK_DEFAULT_REGION;

const envSandbox = {
  account: profileAccountId,
  region: profileRegion,
};

const app = new cdk.App();

new AwsServerlessAPIStack(app, "MyGeneXusServerlessApp", {
  apiName: "MyApp",
  stageName: "test-trunk",
  env: envSandbox
});
