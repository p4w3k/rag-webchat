/**
 * Per-stage settings. Everything that configures the stack lives here, in git.
 * Secrets never go in this file: put them in AWS Secrets Manager or SSM
 * Parameter Store and reference them by name.
 */
export interface StageConfig {
  stage: "dev" | "prod";
  /** AWS region for all resources. */
  region: string;
  /**
   * Bedrock embedding model id. Changing it after documents were ingested
   * requires recreating the vector index and re-syncing.
   */
  embeddingModelId: string;
  /** Vector size produced by the embedding model. */
  embeddingDimensions: number;
  /** Chunking of PDF text before embedding. */
  chunking: { maxTokens: number; overlapPercentage: number };
  /** Monthly AWS budget in USD and the address that gets alerts. Leave the email empty to skip the budget. */
  budget: { monthlyUsd: number; alertEmail: string };
  /** Keep data (buckets, vector index, chat table) when the stack is deleted. */
  retainData: boolean;
  chat: ChatConfig;
}

export interface ChatConfig {
  /**
   * Claude model id on Claude in Amazon Bedrock (bedrock-mantle endpoint).
   * Haiku is fast and cheap; switch to "anthropic.claude-sonnet-5-5" for harder questions.
   */
  modelId: string;
  /** Company name the assistant speaks for. */
  companyName: string;
  /** Public key the widget sends; identifies the site, not a secret. */
  siteKey: string;
  /** Website origins allowed to call the API. "*" allows any (dev only). */
  allowedOrigins: string[];
  /** Passages retrieved from the knowledge base per question. */
  retrievalResults: number;
  /** Earlier messages (visitor + bot) sent to the model as context. */
  historyMessages: number;
  maxOutputTokens: number;
  maxRequestsPerIpPerHour: number;
  maxMessagesPerSessionPerDay: number;
}

const sharedChat = {
  modelId: "anthropic.claude-haiku-5-5",
  companyName: "Ciepłolux",
  retrievalResults: 6,
  historyMessages: 6,
  maxOutputTokens: 800,
  maxRequestsPerIpPerHour: 60,
  maxMessagesPerSessionPerDay: 40,
} satisfies Partial<ChatConfig>;

const shared = {
  region: "eu-central-1",
  embeddingModelId: "amazon.titan-embed-text-v2:0",
  embeddingDimensions: 1024,
  chunking: { maxTokens: 300, overlapPercentage: 20 },
} satisfies Partial<StageConfig>;

export const stages: Record<StageConfig["stage"], StageConfig> = {
  dev: {
    ...shared,
    stage: "dev",
    budget: { monthlyUsd: 20, alertEmail: "" },
    retainData: false,
    chat: { ...sharedChat, siteKey: "dev-local", allowedOrigins: ["*"] },
  },
  prod: {
    ...shared,
    stage: "prod",
    budget: { monthlyUsd: 30, alertEmail: "" },
    retainData: true,
    // Replace with the company website's origin(s) before the first prod deploy.
    chat: { ...sharedChat, siteKey: "prod-website", allowedOrigins: ["https://www.example.com"] },
  },
};

export function getConfig(stage: unknown): StageConfig {
  if (stage !== "dev" && stage !== "prod") {
    throw new Error(`Unknown stage "${String(stage)}". Use -c stage=dev or -c stage=prod.`);
  }
  return stages[stage];
}
