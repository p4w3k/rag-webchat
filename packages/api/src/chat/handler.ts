import { randomUUID } from "node:crypto";
import { Readable, type Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { type ChatStreamEvent, SpeechRequest, type VoiceSession, VoiceSessionRequest } from "@rag-webchat/shared";
import type { LambdaFunctionURLEvent } from "aws-lambda";
import { ClaudeModel, KnowledgeBase } from "./aws.js";
import { runChat } from "./rag.js";
import { checkRequest } from "./request.js";
import { settingsFromEnv } from "./settings.js";
import { ChatStore } from "./store.js";
import { Speech, TRANSCRIBE_SAMPLE_RATE, TranscribeUrlSigner } from "./voice.js";

const settings = settingsFromEnv();
const store = new ChatStore(settings.tableName);
const model = new ClaudeModel(settings.region, settings.modelId);
const kb = new KnowledgeBase(settings.region, settings.knowledgeBaseId, settings.retrievalResults);
const voice = settings.voice;
const transcribe = voice ? new TranscribeUrlSigner(settings.region) : undefined;
const speech = voice ? new Speech(settings.region, voice) : undefined;

const RATE_LIMITED = { error: "rate_limited", message: "Too many requests, please try again later." };

/**
 * One Lambda Function URL with response streaming:
 *   POST /               chat turn, Server-Sent Events: token*, citations?, done | error
 *   POST /voice/session  presigned Transcribe streaming URL for the microphone (JSON)
 *   POST /voice/speech   one or two sentences read aloud by Polly (audio/mpeg)
 */
export const handler = awslambda.streamifyResponse<LambdaFunctionURLEvent>(async (event, responseStream) => {
  const path = event.rawPath.replace(/\/+$/, "");
  if (path === "/voice/session") return voiceSession(event, responseStream);
  if (path === "/voice/speech") return voiceSpeech(event, responseStream);
  if (path !== "" && path !== "/chat") return await sendJson(responseStream, 404, { error: "not_found", message: "Unknown path" });

  const check = checkRequest(incoming(event), settings);
  if (!check.ok) return await sendJson(responseStream, check.status, { error: check.code, message: check.message });
  const req = check.request;

  const ip = event.requestContext.http.sourceIp;
  const now = new Date().toISOString();
  const [perIp, perSession] = await Promise.all([
    store.increment(`IP#${ip}`, `RATE#${now.slice(0, 13)}`, 1),
    store.increment(`SESSION#${req.sessionId}`, `RATE#${now.slice(0, 10)}`, 2),
  ]);
  if (perIp > settings.maxRequestsPerIpPerHour || perSession > settings.maxMessagesPerSessionPerDay) {
    console.warn(JSON.stringify({ msg: "rate limited", ip, sessionId: req.sessionId, perIp, perSession }));
    return await sendJson(responseStream, 429, RATE_LIMITED);
  }

  const stream = awslambda.HttpResponseStream.from(responseStream, {
    statusCode: 200,
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" },
  });
  const emit = (e: ChatStreamEvent) => stream.write(`data: ${JSON.stringify(e)}\n\n`);
  const started = Date.now();

  try {
    await runChat(
      req,
      {
        loadHistory: (sessionId) => store.loadHistory(sessionId, settings.historyMessages),
        saveMessages: (messages) => store.saveMessages(messages),
        retrieve: (query) => kb.retrieve(query),
        complete: (system, messages, maxTokens) => model.complete(system, messages, maxTokens),
        stream: (system, messages, maxTokens, onText) => model.stream(system, messages, maxTokens, onText),
        now: () => new Date(),
        newId: () => randomUUID(),
      },
      { companyName: settings.companyName, maxOutputTokens: settings.maxOutputTokens },
      emit,
    );
    console.log(JSON.stringify({ msg: "chat ok", sessionId: req.sessionId, voice: req.voice === true, ms: Date.now() - started }));
  } catch (err) {
    console.error(JSON.stringify({ msg: "chat failed", sessionId: req.sessionId, error: String(err) }));
    emit({ type: "error", code: "internal", message: "Something went wrong. Please try again." });
  } finally {
    stream.end();
  }
});

/** Hands the widget a one-minute URL to stream microphone audio straight to Amazon Transcribe. */
async function voiceSession(event: LambdaFunctionURLEvent, responseStream: Writable): Promise<void> {
  if (!voice || !transcribe) return await sendJson(responseStream, 404, { error: "not_found", message: "Voice is turned off" });
  const check = checkRequest(incoming(event), settings, VoiceSessionRequest);
  if (!check.ok) return await sendJson(responseStream, check.status, { error: check.code, message: check.message });
  const req = check.request;

  const ip = event.requestContext.http.sourceIp;
  const now = new Date().toISOString();
  const [perIp, perSession] = await Promise.all([
    store.increment(`IP#${ip}`, `VOICE#${now.slice(0, 13)}`, 1),
    store.increment(`SESSION#${req.sessionId}`, `VOICE#${now.slice(0, 10)}`, 2),
  ]);
  if (perIp > voice.maxRecordingsPerIpPerHour || perSession > voice.maxRecordingsPerSessionPerDay) {
    console.warn(JSON.stringify({ msg: "voice rate limited", ip, sessionId: req.sessionId, perIp, perSession }));
    return await sendJson(responseStream, 429, RATE_LIMITED);
  }
  try {
    const body: VoiceSession = { url: await transcribe.url(req.language), sampleRate: TRANSCRIBE_SAMPLE_RATE, maxSeconds: voice.maxRecordingSeconds };
    console.log(JSON.stringify({ msg: "voice session", sessionId: req.sessionId }));
    await sendJson(responseStream, 200, body);
  } catch (err) {
    console.error(JSON.stringify({ msg: "voice session failed", sessionId: req.sessionId, error: String(err) }));
    await sendJson(responseStream, 500, { error: "internal", message: "Something went wrong. Please try again." });
  }
}

/** Reads one piece of an answer aloud. Counted in characters, which is how Polly bills. */
async function voiceSpeech(event: LambdaFunctionURLEvent, responseStream: Writable): Promise<void> {
  if (!voice || !speech) return await sendJson(responseStream, 404, { error: "not_found", message: "Voice is turned off" });
  const check = checkRequest(incoming(event), settings, SpeechRequest);
  if (!check.ok) return await sendJson(responseStream, check.status, { error: check.code, message: check.message });
  const req = check.request;

  const ip = event.requestContext.http.sourceIp;
  const now = new Date().toISOString();
  const chars = req.text.length;
  const [perIp, perSession] = await Promise.all([
    store.increment(`IP#${ip}`, `SPEECH#${now.slice(0, 13)}`, 1, chars),
    store.increment(`SESSION#${req.sessionId}`, `SPEECH#${now.slice(0, 10)}`, 2, chars),
  ]);
  if (perIp > voice.maxSpeechCharsPerIpPerHour || perSession > voice.maxSpeechCharsPerSessionPerDay) {
    console.warn(JSON.stringify({ msg: "speech rate limited", ip, sessionId: req.sessionId, perIp, perSession }));
    return await sendJson(responseStream, 429, RATE_LIMITED);
  }
  try {
    const audio = await speech.synthesize(req.text, req.language);
    await sendBody(responseStream, 200, { "content-type": "audio/mpeg", "cache-control": "no-store" }, Buffer.from(audio));
  } catch (err) {
    console.error(JSON.stringify({ msg: "speech failed", sessionId: req.sessionId, error: String(err) }));
    await sendJson(responseStream, 500, { error: "internal", message: "Something went wrong. Please try again." });
  }
}

function incoming(event: LambdaFunctionURLEvent) {
  return {
    method: event.requestContext.http.method,
    origin: event.headers?.origin,
    body: event.body,
    isBase64Encoded: event.isBase64Encoded,
  };
}

function sendJson(responseStream: Writable, statusCode: number, body: unknown): Promise<void> {
  return sendBody(responseStream, statusCode, { "content-type": "application/json" }, Buffer.from(JSON.stringify(body)));
}

/**
 * A whole (non-streamed) response. The Lambda runtime sends the status code and headers
 * from HttpResponseStream.from() on the first write() call, and end(body) does not go
 * through write(), so it produced a response without them: HTTP 502 for every JSON or
 * audio reply. pipeline() calls write() and waits until the stream has finished.
 */
async function sendBody(responseStream: Writable, statusCode: number, headers: Record<string, string>, body: Buffer): Promise<void> {
  const out = awslambda.HttpResponseStream.from(responseStream, { statusCode, headers });
  await pipeline(Readable.from([body]), out);
}
