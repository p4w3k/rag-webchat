import { SpeechRequest, VoiceSessionRequest } from "@rag-webchat/shared";
import { describe, expect, it, vi } from "vitest";
import { answerMessages, VOICE_NOTE } from "../src/chat/prompt.js";
import { type ChatDeps, runChat } from "../src/chat/rag.js";
import { checkRequest } from "../src/chat/request.js";
import { settingsFromEnv } from "../src/chat/settings.js";
import { formatUrl, speakable, TranscribeUrlSigner, transcribeRequest } from "../src/chat/voice.js";

const SESSION = "1b4e28ba-2fa1-4d3b-a3f5-ef19b5a7633b";
const settings = { siteKey: "site-123", allowedOrigins: ["*"] };
const post = (body: unknown) => ({ method: "POST", origin: "https://example.com", body: JSON.stringify(body), isBase64Encoded: false });

describe("Transcribe streaming URL", () => {
  it("asks for Polish or English, identified automatically, preferring the widget's language", () => {
    const req = transcribeRequest("eu-central-1", "pl");
    expect(req.hostname).toBe("transcribestreaming.eu-central-1.amazonaws.com");
    expect(req.query).toMatchObject({
      "media-encoding": "pcm",
      "sample-rate": "16000",
      "identify-language": "true",
      "language-options": "pl-PL,en-US",
      "preferred-language": "pl-PL",
    });
    expect(transcribeRequest("eu-central-1", "en").query["preferred-language"]).toBe("en-US");
  });

  it("presigns a wss URL for one minute without exposing the secret key", async () => {
    const signer = new TranscribeUrlSigner("eu-central-1", async () => ({ accessKeyId: "AKIDEXAMPLE", secretAccessKey: "SECRETEXAMPLE", sessionToken: "TOKEN/+=" }));
    const url = new URL(await signer.url("pl"));
    expect(url.protocol).toBe("wss:");
    expect(url.host).toBe("transcribestreaming.eu-central-1.amazonaws.com:8443");
    expect(url.pathname).toBe("/stream-transcription-websocket");
    expect(url.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("60");
    expect(url.searchParams.get("X-Amz-Credential")).toMatch(/^AKIDEXAMPLE\/\d{8}\/eu-central-1\/transcribe\/aws4_request$/);
    expect(url.searchParams.get("X-Amz-Security-Token")).toBe("TOKEN/+=");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    expect(url.searchParams.get("language-options")).toBe("pl-PL,en-US");
    expect(url.href).not.toContain("SECRETEXAMPLE");
  });

  it("percent-encodes query values", () => {
    expect(formatUrl({ protocol: "wss:", hostname: "h", port: 8443, path: "/p", query: { a: "x/y,z", b: null } })).toBe("wss://h:8443/p?a=x%2Fy%2Cz");
  });
});

describe("speech text", () => {
  it("drops citations, markdown and links before Polly reads it", () => {
    expect(speakable("**Komfort 9** kosztuje 38 500 zł [1]. Zobacz https://x.pl/a")).toBe("Komfort 9 kosztuje 38 500 zł. Zobacz");
  });
});

describe("voice requests", () => {
  it("accept a session request and short speech, and reject long speech or a wrong site key", () => {
    expect(checkRequest(post({ siteKey: "site-123", sessionId: SESSION, language: "pl" }), settings, VoiceSessionRequest).ok).toBe(true);
    expect(checkRequest(post({ siteKey: "site-123", sessionId: SESSION, text: "Dzień dobry.", language: "pl" }), settings, SpeechRequest).ok).toBe(true);
    expect(checkRequest(post({ siteKey: "site-123", sessionId: SESSION, text: "x".repeat(601), language: "pl" }), settings, SpeechRequest)).toMatchObject({ ok: false, status: 400 });
    expect(checkRequest(post({ siteKey: "nope", sessionId: SESSION, language: "en" }), settings, VoiceSessionRequest)).toMatchObject({ ok: false, status: 403 });
    expect(checkRequest(post({ siteKey: "site-123", sessionId: SESSION, language: "de" }), settings, VoiceSessionRequest)).toMatchObject({ ok: false, status: 400 });
  });
});

describe("voice settings", () => {
  const base = {
    AWS_REGION: "eu-central-1", TABLE_NAME: "t", KNOWLEDGE_BASE_ID: "kb", MODEL_ID: "m", COMPANY_NAME: "c", SITE_KEY: "k", ALLOWED_ORIGINS: "*",
    RETRIEVAL_RESULTS: "6", HISTORY_MESSAGES: "6", MAX_OUTPUT_TOKENS: "800", MAX_REQUESTS_PER_IP_PER_HOUR: "60", MAX_MESSAGES_PER_SESSION_PER_DAY: "40",
  };
  it("are absent unless voice is enabled", () => {
    expect(settingsFromEnv(base).voice).toBeUndefined();
  });
  it("are read when voice is enabled", () => {
    const voice = settingsFromEnv({
      ...base, VOICE_ENABLED: "true", POLLY_VOICE_PL: "Ola", POLLY_VOICE_EN: "Joanna", VOICE_MAX_RECORDING_SECONDS: "30",
      VOICE_MAX_RECORDINGS_PER_SESSION_PER_DAY: "30", VOICE_MAX_RECORDINGS_PER_IP_PER_HOUR: "40",
      VOICE_MAX_SPEECH_CHARS_PER_SESSION_PER_DAY: "15000", VOICE_MAX_SPEECH_CHARS_PER_IP_PER_HOUR: "20000",
    }).voice;
    expect(voice).toMatchObject({ pollyVoicePl: "Ola", pollyVoiceEn: "Joanna", maxRecordingSeconds: 30 });
  });
});

describe("spoken answers", () => {
  it("add the voice note to the question only when the answer will be spoken", () => {
    expect(answerMessages([], [], "Ile kosztuje?", true).at(-1)?.content).toContain(VOICE_NOTE);
    expect(answerMessages([], [], "Ile kosztuje?").at(-1)?.content).not.toContain(VOICE_NOTE);
  });

  it("are requested by runChat when the widget sends voice: true", async () => {
    const stream = vi.fn<ChatDeps["stream"]>(async (_s, _m, _t, onText) => {
      onText("Kosztuje 38 500 zł [1].");
      return { text: "Kosztuje 38 500 zł [1].", stopReason: "end_turn" };
    });
    const deps: ChatDeps = {
      loadHistory: async () => [],
      saveMessages: async () => undefined,
      retrieve: async () => [{ text: "38 500 zł", title: "oferta.pdf" }],
      complete: async () => ({ text: "", stopReason: "end_turn" }),
      stream,
      now: () => new Date("2026-11-28T10:00:00Z"),
      newId: () => "id",
    };
    await runChat({ siteKey: "k", sessionId: SESSION, message: "Ile kosztuje?", voice: true }, deps, { companyName: "C", maxOutputTokens: 300 }, () => {});
    expect(stream.mock.calls[0]?.[1].at(-1)?.content).toContain(VOICE_NOTE);
  });
});
