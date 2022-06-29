# Welcome to FestivalTickets CDK TypeScript project!

The `cdk.json` file tells the CDK Toolkit how to execute your app.

## Tutorial  
See [this useful workshop](https://cdkworkshop.com/20-typescript.html) on working with the AWS CDK for Typescript projects.

## Build
cdk bootstrap --profile gxsincrum
npm run build

cdk deploy --app "node ./bin/create-serverless-app.js" -c appname=festival -c stage=test --profile gxsincrum

## Items created by this script
* VPC
* IAM User
* IAM Rol
* Dynamo Table DTicket
* Dynamo Table DCache
* RDS MySQL 8.0
* SecurityGroup for RDS (with a rule for your public IP to access the db)
* SQS Queue for ticket process
* Lambda to process the Queue
* Lambda Cron for ticket ruffle
* EventBridge rule for lambda con
* S3 Bucket for Angular App (frontend)
* S3 Bucket for Storage
* Api Gateway (backend)
* Lambda (backend)
* Lambda (rewrite)
* Cloudfront - GeneXus Angular Rewrite Lambda


## Useful commands

 * `npm run build`   compile typescript to js
 * `npm run watch`   watch for changes and compile
 * `npm run test`    perform the jest unit tests
 * `cdk deploy`      deploy this stack to your default AWS account/region
 * `cdk diff`        compare deployed stack with current state
 * `cdk synth`       emits the synthesized CloudFormation template
