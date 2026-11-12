import * as cdk from "aws-cdk-lib";
import { SimplePointStack } from "../lib/stack.js";

const app = new cdk.App();
new SimplePointStack(app, "SimplePointLite", {
  env: { region: process.env.CDK_DEFAULT_REGION ?? "ap-northeast-1" }, // Tokyo
  imageTag: app.node.tryGetContext("imageTag") ?? "latest",
  monthlyBudgetUsd: Number(app.node.tryGetContext("budgetUsd") ?? 150),
  budgetEmail: app.node.tryGetContext("budgetEmail"),
});
