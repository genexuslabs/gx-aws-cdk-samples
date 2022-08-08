# AWS Serverless GeneXus Application
This sample creates all the infrastructure necessary for publish AWS Serverless GeneXus Application.

This stack will Deploy:

- AWS Cloudfront for CDN
- AWS S3 Bucket for Angular Website hosting
- AWS S3 Bucket for private storage
- IAM Credentials with minimal permission
- Lambda@Edge for Angular URL Rewrite Rules
- AWS Lambda function for compute
- AWS API Gateway for Deploying Services (OpenAPI)

## Running the script
Run in your cmd: 
```
//Navigate to a folder of your preference
npm i aws-cdk -g
git clone https://github.com/genexuslabs/gx-aws-cdk-samples.git
cd gx-aws-cdk-samples/aws-serverless
npm install
npm run build
cdk bootstrap aws://ACCOUNT-NUMBER/AWS-REGION
cdk deploy --app "node ./bin/create-serverless-app.js" -c name=myGXSlsApp -c stage=test
```

## Useful commands

 * `npm run build`   compile typescript to js
 * `npm run watch`   watch for changes and compile
 * `npm run test`    perform the jest unit tests
 * `cdk deploy`      deploy this stack to your default AWS account/region
 * `cdk diff`        compare deployed stack with current state
 * `cdk synth`       emits the synthesized CloudFormation template
