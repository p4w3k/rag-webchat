import { Stack, type StackProps } from "aws-cdk-lib";
import * as budgets from "aws-cdk-lib/aws-budgets";
import type { Construct } from "constructs";
import type { StageConfig } from "./config.js";

export interface CostStackProps extends StackProps {
  config: StageConfig;
}

/**
 * Account-wide monthly AWS budget with email alerts at 80% actual and 100%
 * forecasted spend. It covers the whole account, not just this project.
 */
export class CostStack extends Stack {
  constructor(scope: Construct, id: string, props: CostStackProps) {
    super(scope, id, props);
    const { monthlyUsd, alertEmail } = props.config.budget;
    const subscribers = [{ subscriptionType: "EMAIL", address: alertEmail }];

    new budgets.CfnBudget(this, "MonthlyBudget", {
      budget: {
        budgetName: `rag-webchat-${props.config.stage}-monthly`,
        budgetType: "COST",
        timeUnit: "MONTHLY",
        budgetLimit: { amount: monthlyUsd, unit: "USD" },
      },
      notificationsWithSubscribers: [
        {
          notification: { notificationType: "ACTUAL", comparisonOperator: "GREATER_THAN", threshold: 80, thresholdType: "PERCENTAGE" },
          subscribers,
        },
        {
          notification: { notificationType: "FORECASTED", comparisonOperator: "GREATER_THAN", threshold: 100, thresholdType: "PERCENTAGE" },
          subscribers,
        },
      ],
    });
  }
}
