import * as path from "path";
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as apigw from "aws-cdk-lib/aws-apigateway";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";

export class DbAccessorStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const node22 =
      (lambda.Runtime as any).NODEJS_22_X ??
      new lambda.Runtime("nodejs22.x", lambda.RuntimeFamily.NODEJS);

    const table = new dynamodb.Table(this, "AuditLogTable", {
      tableName: "AuditLogs",
      partitionKey: { name: "UserId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "CreatedAt", type: dynamodb.AttributeType.NUMBER },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN, // keep data safe
    });

    const dbAccessorFn = new nodejs.NodejsFunction(
      this,
      "GrantReadOnlyAccess",
      {
        entry: path.join(
          __dirname,
          "..",
          "..",
          "functions",
          "grant_read_only_access",
          "main.ts"
        ),
        handler: "lambdaHandler",
        runtime: node22,
        architecture: lambda.Architecture.X86_64,
        environment: { TABLE_NAME: table.tableName },
        bundling: { minify: true, sourceMap: true, target: "es2020" },
      }
    );

    table.grantWriteData(dbAccessorFn);
    dbAccessorFn.addToRolePolicy(
      new iam.PolicyStatement({
        sid: "AllowPolicyCreation",
        effect: iam.Effect.ALLOW,
        actions: ["iam:CreatePolicy", "iam:TagPolicy"],
        resources: ["arn:aws:iam::*:policy/*"],
      })
    );
    dbAccessorFn.addToRolePolicy(
      new iam.PolicyStatement({
        sid: "AllowAttachingPoliciesToUsers",
        effect: iam.Effect.ALLOW,
        actions: ["iam:AttachUserPolicy"],
        resources: ["arn:aws:iam::*:user/*"],
      })
    );

    // API Gateway: POST /access
    const api = new apigw.RestApi(this, "ServerlessRestApi", {
      deployOptions: { stageName: "Prod" },
      policy: new iam.PolicyDocument({
        statements: [
          new iam.PolicyStatement({
            effect: iam.Effect.DENY,
            principals: [new iam.AnyPrincipal()],
            actions: ["execute-api:Invoke"],
            resources: ["execute-api:/*"],
            conditions: {
              NotIpAddress: { "aws:SourceIp": [
                "109.243.65.77/24",
                "89.64.29.102/24"
              ] },
            },
          }),
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            principals: [new iam.AnyPrincipal()],
            actions: ["execute-api:Invoke"],
            resources: ["execute-api:/*"],
          }),
        ],
      }),
    });
    const access = api.root.addResource("access");
    access.addMethod("POST", new apigw.LambdaIntegration(dbAccessorFn));

    const cleanupFn = new nodejs.NodejsFunction(
      this,
      "DeleteExpiredUserRoles",
      {
        entry: path.join(
          __dirname,
          "..",
          "..",
          "functions",
          "delete_expired_user_roles",
          "main.ts"
        ),
        handler: "lambdaHandler",
        runtime: node22,
        architecture: lambda.Architecture.X86_64,
        environment: { TABLE_NAME: table.tableName },
        bundling: { minify: true, sourceMap: true, target: "es2020" },
      }
    );

    table.grantWriteData(cleanupFn);
    cleanupFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["iam:ListPolicies", "iam:ListPolicyTags", "iam:DeletePolicy"],
        resources: ["arn:aws:iam::*:policy/*"],
      })
    );
    cleanupFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["iam:DetachUserPolicy"],
        resources: ["arn:aws:iam::*:user/*"],
      })
    );

    // EventBridge rule: cron(0 * * * ? *)  -> every hour at minute 0
    const rule = new events.Rule(this, "InvocationLevelRule", {
      schedule: events.Schedule.cron({ minute: "0", hour: "*" }),
    });
    rule.addTarget(new targets.LambdaFunction(cleanupFn));

    new cdk.CfnOutput(this, "ApiUrl", { value: api.url ?? "" });
    new cdk.CfnOutput(this, "DbAccessorFunctionArn", {
      value: dbAccessorFn.functionArn,
    });
    new cdk.CfnOutput(this, "DbAccessorFunctionRoleArn", {
      value: dbAccessorFn.role!.roleArn,
    });
  }
}












