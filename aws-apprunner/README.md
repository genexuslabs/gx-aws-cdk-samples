# Pesobook CDK
Lleve control de su peso de forma fácil y rápida.

For more information about FestivalTickets, follow this link:

This stack will Deploy:
* Amazon VPC
* IAM User
* IAM Rol
* Amazon RDS MySQL 8.0
* SecurityGroup for RDS (with a rule for your public IP to access the db)
* Amazon S3 Bucket for Storage
* Frontend Apprunner
* Backend Apprunner
* Apprunner VPCConnector


View Cloud Formation script
cdk synth --context appname=[name_of_the_app] --context appstage=[stage_of_the_app]

cdk deploy --context appname=[name_of_the_app] --context appstage=[stage_of_the_app]

cdk diff --context appname=[name_of_the_app] --context appstage=[stage_of_the_app]

## Useful commands

* `npm run build`   compile typescript to js
* `npm run watch`   watch for changes and compile
* `npm run test`    perform the jest unit tests
* `cdk deploy`      deploy this stack to your default AWS account/region
* `cdk diff`        compare deployed stack with current state
* `cdk synth`       emits the synthesized CloudFormation template
