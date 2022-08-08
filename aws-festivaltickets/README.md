# FestivalTickets CDK Sample
Festival Tickets is an example of a massive event ticket giveaway, which can have hundreds of thousands or millions of subscriptions per hour.

For more information about FestivalTickets, follow this link:
[FestivalTickets Sample](https://wiki.genexus.com/commwiki/servlet/wiki?51266,KB%3AFestivalTickets+-+High+Scalability+Sample)

This stack will Deploy:
* Amazon VPC
* IAM User
* IAM Rol
* Amazon DynamoDB Table DTicket
* Amazon DynamoDB Table DCache
* Amazon RDS MySQL 8.0
* SecurityGroup for RDS (with a rule for your public IP to access the db)
* Amazon SQS Queue for ticket process
* AWS Lambda to process the Queue
* AWS Lambda Cron for ticket ruffle
* Amazon EventBridge rule for lambda con
* Amazon S3 Bucket for Angular App (frontend)
* Amazon S3 Bucket for Storage
* Amazon API Gateway (backend)
* AWS Lambda (backend)
* AWS Lambda (rewrite)
* Amazon Cloudfront - GeneXus Angular Rewrite Lambda

## Running the script
Run in your cmd: 
```
//Navigate to a folder of your preference
npm i aws-cdk -g
git clone https://github.com/genexuslabs/gx-aws-cdk-samples.git
cd gx-aws-cdk-samples/aws-festivaltickets
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
