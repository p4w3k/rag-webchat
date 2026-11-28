import type { ChatStreamEvent } from "@rag-webchat/shared";
import { SseParser } from "./sse.js";

export class ChatHttpError extends Error {
  constructor(readonly status: number) {
    super(`Chat API returned ${status}`);
  }
}

export interface SendArgs {
  apiUrl: string;
  siteKey: string;
  sessionId: string;
  message: string;
  language: "pl" | "en";
  /** The answer will be read aloud. */
  voice?: boolean;
  signal?: AbortSignal;
}

/** POSTs a message and yields the streamed events as they arrive. */
export async function* sendMessage(args: SendArgs): AsyncGenerator<ChatStreamEvent> {
  const res = await fetch(args.apiUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ siteKey: args.siteKey, sessionId: args.sessionId, message: args.message, language: args.language, ...(args.voice ? { voice: true } : {}) }),
    ...(args.signal ? { signal: args.signal } : {}),
  });
  if (!res.ok || !res.body) throw new ChatHttpError(res.status);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    yield* parser.push(decoder.decode(value, { stream: true }));
  }
  yield* parser.push(decoder.decode() + "\n\n");
}
