# Welcome to FestivalTickets CDK TypeScript project!

The `cdk.json` file tells the CDK Toolkit how to execute your app.

## Tutorial  
See [this useful workshop](https://cdkworkshop.com/20-typescript.html) on working with the AWS CDK for Typescript projects.

## Build
cdk bootstrap --profile gxsincrum
npm run build

cdk deploy --app "node ./bin/create-serverless-app.js" -c appname=festival -c stage=test --profile gxsincrum


## Useful commands

 * `npm run build`   compile typescript to js
 * `npm run watch`   watch for changes and compile
 * `npm run test`    perform the jest unit tests
 * `cdk deploy`      deploy this stack to your default AWS account/region
 * `cdk diff`        compare deployed stack with current state
 * `cdk synth`       emits the synthesized CloudFormation template
