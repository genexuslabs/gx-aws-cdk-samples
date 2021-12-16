# gx-aws-cdk-samples
GeneXus AWS CDK Samples for Creating Infrastructure

### How to create the Infrastructure for an AWS Serverless GeneXus Application: 

Run in your cmd: 
```
//Navigate to a folder of your preference
npm i aws-cdk -g
git clone https://github.com/genexuslabs/gx-aws-cdk-samples.git
cd gx-aws-cdk-samples/cdk/aws-serverless
npm install
npm run build
cdk bootstrap aws://ACCOUNT-NUMBER/AWS-REGION
cdk deploy --app "node ./bin/create-serverless-app.js" -c name=myGXSlsApp -c stage=test
```

This stack will Deploy:

- AWS Cloudfront for CDN
- AWS S3 Bucket for Angular Website hosting
- AWS S3 Bucket for private storage
- IAM Credentials with minimal permission
- Lambda@Edge for Angular URL Rewrite Rules
- AWS Lambda function for compute
- AWS API Gateway for Deploying Services (OpenAPI)
