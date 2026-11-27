import { randomUUID } from "node:crypto";
import type { Writable } from "node:stream";
import type { ChatStreamEvent } from "@rag-webchat/shared";
import type { LambdaFunctionURLEvent } from "aws-lambda";
import { ClaudeModel, KnowledgeBase } from "./aws.js";
import { runChat } from "./rag.js";
import { checkRequest } from "./request.js";
import { settingsFromEnv } from "./settings.js";
import { ChatStore } from "./store.js";

const settings = settingsFromEnv();
const store = new ChatStore(settings.tableName);
const model = new ClaudeModel(settings.region, settings.modelId);
const kb = new KnowledgeBase(settings.region, settings.knowledgeBaseId, settings.retrievalResults);

/**
 * POST /chat on a Lambda Function URL with response streaming.
 * Replies with Server-Sent Events: token*, citations?, done | error.
 */
export const handler = awslambda.streamifyResponse<LambdaFunctionURLEvent>(async (event, responseStream) => {
  const check = checkRequest(
    {
      method: event.requestContext.http.method,
      origin: event.headers?.origin,
      body: event.body,
      isBase64Encoded: event.isBase64Encoded,
    },
    settings,
  );
  if (!check.ok) return sendJson(responseStream, check.status, { error: check.code, message: check.message });
  const req = check.request;

  const ip = event.requestContext.http.sourceIp;
  const now = new Date().toISOString();
  const [perIp, perSession] = await Promise.all([
    store.increment(`IP#${ip}`, `RATE#${now.slice(0, 13)}`, 1),
    store.increment(`SESSION#${req.sessionId}`, `RATE#${now.slice(0, 10)}`, 2),
  ]);
  if (perIp > settings.maxRequestsPerIpPerHour || perSession > settings.maxMessagesPerSessionPerDay) {
    console.warn(JSON.stringify({ msg: "rate limited", ip, sessionId: req.sessionId, perIp, perSession }));
    return sendJson(responseStream, 429, { error: "rate_limited", message: "Too many messages, please try again later." });
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
    console.log(JSON.stringify({ msg: "chat ok", sessionId: req.sessionId, ms: Date.now() - started }));
  } catch (err) {
    console.error(JSON.stringify({ msg: "chat failed", sessionId: req.sessionId, error: String(err) }));
    emit({ type: "error", code: "internal", message: "Something went wrong. Please try again." });
  } finally {
    stream.end();
  }
});

function sendJson(responseStream: Writable, statusCode: number, body: unknown): void {
  const out = awslambda.HttpResponseStream.from(responseStream, {
    statusCode,
    headers: { "content-type": "application/json" },
  });
  out.end(JSON.stringify(body));
}
