/** Runtime settings for the chat Lambda, passed in as environment variables by the CDK stack. */
export interface ChatSettings {
  region: string;
  tableName: string;
  knowledgeBaseId: string;
  modelId: string;
  companyName: string;
  siteKey: string;
  allowedOrigins: string[];
  retrievalResults: number;
  historyMessages: number;
  maxOutputTokens: number;
  maxRequestsPerIpPerHour: number;
  maxMessagesPerSessionPerDay: number;
}

export function settingsFromEnv(env: NodeJS.ProcessEnv = process.env): ChatSettings {
  const req = (name: string) => {
    const v = env[name];
    if (!v) throw new Error(`Missing environment variable ${name}`);
    return v;
  };
  const num = (name: string) => {
    const n = Number(req(name));
    if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive number`);
    return n;
  };
  return {
    region: req("AWS_REGION"),
    tableName: req("TABLE_NAME"),
    knowledgeBaseId: req("KNOWLEDGE_BASE_ID"),
    modelId: req("MODEL_ID"),
    companyName: req("COMPANY_NAME"),
    siteKey: req("SITE_KEY"),
    allowedOrigins: req("ALLOWED_ORIGINS").split(",").map((o) => o.trim()).filter(Boolean),
    retrievalResults: num("RETRIEVAL_RESULTS"),
    historyMessages: num("HISTORY_MESSAGES"),
    maxOutputTokens: num("MAX_OUTPUT_TOKENS"),
    maxRequestsPerIpPerHour: num("MAX_REQUESTS_PER_IP_PER_HOUR"),
    maxMessagesPerSessionPerDay: num("MAX_MESSAGES_PER_SESSION_PER_DAY"),
  };
}
