import * as cdk from "aws-cdk-lib";
import { GeneXusServerlessAngularApp } from "./constructs/gxapp-serverless-construct";

export interface GXServerlessStackProps extends cdk.StackProps {
  readonly apiName: string;
  readonly apiDescription?: string;
  readonly webDomainName?: string;
  readonly stageName?: string;
  readonly timeout?: cdk.Duration;
  readonly memorySize?: number;
  readonly certificateARN?: string | null;
}

export class GXServerlessStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props: GXServerlessStackProps) {
    super(scope, id, props);
    
    new GeneXusServerlessAngularApp(
      this,
      "ServerlessApp",
      {
        apiName: props.apiName,
        stageName: props.stageName,
        certificateARN: props.certificateARN,
        webDomainName: props.webDomainName
      }
    );
  }
}
