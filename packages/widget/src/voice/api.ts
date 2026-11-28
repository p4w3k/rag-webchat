import type { VoiceSession } from "@rag-webchat/shared";
import type { Lang } from "../i18n.js";
import { ChatHttpError } from "../client.js";

export interface VoiceApi {
  apiUrl: string;
  siteKey: string;
  sessionId: string;
}

/** The chat API serves voice under the same Function URL: /voice/session and /voice/speech. */
function voiceUrl(apiUrl: string, path: string): string {
  return new URL(path, apiUrl.endsWith("/") ? apiUrl : `${apiUrl}/`).toString();
}

export async function startVoiceSession(api: VoiceApi, language: Lang): Promise<VoiceSession> {
  const res = await fetch(voiceUrl(api.apiUrl, "voice/session"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ siteKey: api.siteKey, sessionId: api.sessionId, language }),
  });
  if (!res.ok) throw new ChatHttpError(res.status);
  return (await res.json()) as VoiceSession;
}

/** MP3 audio of the text, read by the neural voice for the language. */
export async function fetchSpeech(api: VoiceApi, text: string, language: Lang, signal?: AbortSignal): Promise<ArrayBuffer> {
  const res = await fetch(voiceUrl(api.apiUrl, "voice/speech"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ siteKey: api.siteKey, sessionId: api.sessionId, text, language }),
    ...(signal ? { signal } : {}),
  });
  if (!res.ok) throw new ChatHttpError(res.status);
  return res.arrayBuffer();
}
