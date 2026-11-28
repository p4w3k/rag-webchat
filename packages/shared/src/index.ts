import { z } from "zod";
import { MAX_MESSAGE_CHARS, MAX_SPEECH_CHARS } from "./limits.js";

/** Languages the agent answers in. */
export const Language = z.enum(["pl", "en"]);
export type Language = z.infer<typeof Language>;

/**
 * Who wrote a message. `agent` is a human support agent; it is unused in the
 * MVP but kept in the schema so human handoff can be added without a migration.
 */
export const Sender = z.enum(["visitor", "bot", "agent"]);
export type Sender = z.infer<typeof Sender>;

/** Lifecycle of a conversation, also prepared for human handoff. */
export const ConversationStatus = z.enum(["bot", "waiting_for_agent", "with_agent", "closed"]);
export type ConversationStatus = z.infer<typeof ConversationStatus>;

// In its own file so the widget can import it without bundling zod.
export { MAX_MESSAGE_CHARS, MAX_SPEECH_CHARS };
export { guessLanguage } from "./language.js";

/** Body of POST /chat sent by the widget. */
export const ChatRequest = z.object({
  siteKey: z.string().min(1),
  sessionId: z.string().uuid(),
  message: z.string().trim().min(1).max(MAX_MESSAGE_CHARS),
  language: Language.optional(),
  /** The answer will be read aloud, so it should be short and plain. */
  voice: z.boolean().optional(),
});
export type ChatRequest = z.infer<typeof ChatRequest>;

/** A document passage the answer is based on, shown to the visitor as a source. */
export const Citation = z.object({
  title: z.string(),
  uri: z.string().optional(),
  page: z.number().int().positive().optional(),
});
export type Citation = z.infer<typeof Citation>;

/** Server-Sent Events the chat API streams back to the widget. */
export type ChatStreamEvent =
  | { type: "token"; text: string }
  | { type: "citations"; citations: Citation[] }
  | { type: "done"; messageId: string }
  | { type: "error"; code: "rate_limited" | "invalid_request" | "internal"; message: string };

/** A stored chat message (DynamoDB item shape, without keys). */
export const StoredMessage = z.object({
  messageId: z.string(),
  sessionId: z.string(),
  sender: Sender,
  text: z.string(),
  createdAt: z.string().datetime(),
  citations: z.array(Citation).optional(),
});
export type StoredMessage = z.infer<typeof StoredMessage>;

/** Body of POST /voice/session: asks for a short-lived URL to stream microphone audio to Amazon Transcribe. */
export const VoiceSessionRequest = z.object({
  siteKey: z.string().min(1),
  sessionId: z.string().uuid(),
  /** The widget's language, preferred when Transcribe identifies the spoken language. */
  language: Language,
});
export type VoiceSessionRequest = z.infer<typeof VoiceSessionRequest>;

/** Reply to POST /voice/session. */
export interface VoiceSession {
  /** Presigned wss:// URL for Transcribe streaming (16 kHz, 16-bit PCM, Polish or English). */
  url: string;
  sampleRate: number;
  /** The widget stops recording after this many seconds. */
  maxSeconds: number;
}

/** Body of POST /voice/speech: one or two sentences of an answer to read aloud (returns audio/mpeg). */
export const SpeechRequest = z.object({
  siteKey: z.string().min(1),
  sessionId: z.string().uuid(),
  text: z.string().trim().min(1).max(MAX_SPEECH_CHARS),
  language: Language,
});
export type SpeechRequest = z.infer<typeof SpeechRequest>;
