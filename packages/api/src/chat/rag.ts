import { type ChatRequest, type ChatStreamEvent, type Citation, guessLanguage, type StoredMessage } from "@rag-webchat/shared";
import { answerMessages, citedIndices, condensePrompt, historyMessages, type Passage, type PromptMessage, systemPrompt } from "./prompt.js";

export interface ModelResult {
  text: string;
  stopReason: string | null;
}

/** Everything the RAG pipeline talks to, injected so it can be unit-tested without AWS. */
export interface ChatDeps {
  loadHistory(sessionId: string): Promise<StoredMessage[]>;
  saveMessages(messages: StoredMessage[]): Promise<void>;
  retrieve(query: string): Promise<Passage[]>;
  complete(system: string, messages: PromptMessage[], maxTokens: number): Promise<ModelResult>;
  stream(system: string, messages: PromptMessage[], maxTokens: number, onText: (text: string) => void): Promise<ModelResult>;
  now(): Date;
  newId(): string;
}

export interface ChatOptions {
  companyName: string;
  maxOutputTokens: number;
}

const FALLBACK = {
  pl: "Przepraszam, nie mogę odpowiedzieć na to pytanie. Skontaktuj się z nami bezpośrednio.",
  en: "Sorry, I can't help with that question. Please contact us directly.",
};

/**
 * One chat turn: condense the question with history, retrieve passages, stream a
 * grounded answer, emit the cited sources, and store both messages.
 */
export async function runChat(
  req: ChatRequest,
  deps: ChatDeps,
  opts: ChatOptions,
  emit: (event: ChatStreamEvent) => void,
): Promise<void> {
  const history = await deps.loadHistory(req.sessionId);
  const visitorMessage: StoredMessage = {
    messageId: deps.newId(),
    sessionId: req.sessionId,
    sender: "visitor",
    text: req.message,
    createdAt: deps.now().toISOString(),
  };

  const query = await searchQuery(req.message, history, deps);
  const passages = await deps.retrieve(query);

  const system = systemPrompt(opts.companyName);
  const result = await deps.stream(system, answerMessages(history, passages, req.message, req.voice === true), opts.maxOutputTokens, (text) =>
    emit({ type: "token", text }),
  );

  let answer = result.text;
  if (result.stopReason === "refusal" || answer.trim() === "") {
    answer = FALLBACK[req.language ?? guessLanguage(req.message)];
    emit({ type: "token", text: answer });
  }

  const citations = citedIndices(answer, passages.length).map((i) => toCitation(passages[i - 1]!));
  const unique = dedupeCitations(citations);
  if (unique.length > 0) emit({ type: "citations", citations: unique });

  const botMessage: StoredMessage = {
    messageId: deps.newId(),
    sessionId: req.sessionId,
    sender: "bot",
    text: answer,
    createdAt: deps.now().toISOString(),
    ...(unique.length > 0 ? { citations: unique } : {}),
  };
  await deps.saveMessages([visitorMessage, botMessage]);
  emit({ type: "done", messageId: botMessage.messageId });
}

/** Follow-up questions ("and the bigger one?") are rewritten into a standalone query for retrieval. */
async function searchQuery(message: string, history: StoredMessage[], deps: ChatDeps): Promise<string> {
  const prior = historyMessages(history);
  if (prior.length === 0) return message;
  try {
    const res = await deps.complete(condensePrompt(), [...prior, { role: "user", content: message }], 200);
    const query = res.text.trim();
    return query.length > 0 && res.stopReason !== "refusal" ? query : message;
  } catch (err) {
    // The rewrite only sharpens retrieval; searching with the visitor's own words still works.
    console.warn(JSON.stringify({ msg: "query rewrite failed, using the original question", error: String(err) }));
    return message;
  }
}

function toCitation(p: Passage): Citation {
  return { title: p.title, ...(p.uri ? { uri: p.uri } : {}), ...(p.page ? { page: p.page } : {}) };
}

function dedupeCitations(citations: Citation[]): Citation[] {
  const seen = new Set<string>();
  return citations.filter((c) => {
    const key = `${c.title}#${c.page ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export { guessLanguage };
