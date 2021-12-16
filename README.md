# gx-aws-cdk-samples
GeneXus AWS CDK Samples for Creating Infrastructure

### How to create Infrastructure

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
