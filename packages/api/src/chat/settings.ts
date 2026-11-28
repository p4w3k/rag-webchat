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
  /** Speech in and out; undefined when voice is turned off for the stage. */
  voice?: VoiceSettings;
}

export interface VoiceSettings {
  /** Amazon Polly voices (neural engine) for answers in each language. */
  pollyVoicePl: string;
  pollyVoiceEn: string;
  maxRecordingSeconds: number;
  maxRecordingsPerSessionPerDay: number;
  maxRecordingsPerIpPerHour: number;
  maxSpeechCharsPerSessionPerDay: number;
  maxSpeechCharsPerIpPerHour: number;
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
    ...(env.VOICE_ENABLED === "true"
      ? {
          voice: {
            pollyVoicePl: req("POLLY_VOICE_PL"),
            pollyVoiceEn: req("POLLY_VOICE_EN"),
            maxRecordingSeconds: num("VOICE_MAX_RECORDING_SECONDS"),
            maxRecordingsPerSessionPerDay: num("VOICE_MAX_RECORDINGS_PER_SESSION_PER_DAY"),
            maxRecordingsPerIpPerHour: num("VOICE_MAX_RECORDINGS_PER_IP_PER_HOUR"),
            maxSpeechCharsPerSessionPerDay: num("VOICE_MAX_SPEECH_CHARS_PER_SESSION_PER_DAY"),
            maxSpeechCharsPerIpPerHour: num("VOICE_MAX_SPEECH_CHARS_PER_IP_PER_HOUR"),
          },
        }
      : {}),
  };
}
