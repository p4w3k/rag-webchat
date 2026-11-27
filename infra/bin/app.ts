import { App, Annotations, Tags } from "aws-cdk-lib";
import { getConfig } from "../lib/config.js";
import { ChatStack } from "../lib/chat-stack.js";
import { CostStack } from "../lib/cost-stack.js";
import { KnowledgeBaseStack } from "../lib/knowledge-base-stack.js";

const app = new App();
const config = getConfig(app.node.tryGetContext("stage"));
const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: config.region };
const name = (part: string) => `RagWebchat-${config.stage}-${part}`;

const kb = new KnowledgeBaseStack(app, name("KnowledgeBase"), { env, config });
new ChatStack(app, name("Chat"), {
  env,
  config,
  knowledgeBaseId: kb.knowledgeBase.attrKnowledgeBaseId,
  knowledgeBaseArn: kb.knowledgeBase.attrKnowledgeBaseArn,
});

if (config.budget.alertEmail) {
  new CostStack(app, name("Cost"), { env, config });
} else {
  Annotations.of(app).addWarningV2("rag-webchat:no-budget", `No budget alert email set for "${config.stage}" in infra/lib/config.ts, so the budget stack is skipped.`);
}

Tags.of(app).add("Project", "rag-webchat");
Tags.of(app).add("Stage", config.stage);
