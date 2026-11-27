import type { ChatStreamEvent, StoredMessage } from "@rag-webchat/shared";
import { describe, expect, it, vi } from "vitest";
import type { Passage } from "../src/chat/prompt.js";
import { type ChatDeps, guessLanguage, runChat } from "../src/chat/rag.js";

const SESSION = "1b4e28ba-2fa1-4d3b-a3f5-ef19b5a7633b";
const passages: Passage[] = [
  { text: "Ciepłolux Komfort 9 – 9 kW – 38 500 zł", title: "cieplolux-oferta-2026.pdf", uri: "s3://b/cieplolux-oferta-2026.pdf", page: 1 },
  { text: "Gwarancja na sprężarkę: 10 lat", title: "cieplolux-oferta-2026.pdf", uri: "s3://b/cieplolux-oferta-2026.pdf", page: 2 },
];

function fakeDeps(overrides: Partial<ChatDeps> = {}) {
  let id = 0;
  const deps: ChatDeps = {
    loadHistory: vi.fn().mockResolvedValue([]),
    saveMessages: vi.fn().mockResolvedValue(undefined),
    retrieve: vi.fn().mockResolvedValue(passages),
    complete: vi.fn().mockResolvedValue({ text: "standalone query", stopReason: "end_turn" }),
    stream: vi.fn(async (_s, _m, _t, onText: (t: string) => void) => {
      onText("Komfort 9 kosztuje ");
      onText("38 500 zł brutto [1].");
      return { text: "Komfort 9 kosztuje 38 500 zł brutto [1].", stopReason: "end_turn" };
    }),
    now: () => new Date("2026-11-27T12:00:00Z"),
    newId: () => `id-${++id}`,
    ...overrides,
  };
  return deps;
}

async function run(deps: ChatDeps, message = "Ile kosztuje pompa Komfort 9?") {
  const events: ChatStreamEvent[] = [];
  await runChat({ siteKey: "k", sessionId: SESSION, message }, deps, { companyName: "Ciepłolux", maxOutputTokens: 800 }, (e) => events.push(e));
  return events;
}

describe("runChat", () => {
  it("retrieves with the question, streams tokens, cites only used sources and stores both messages", async () => {
    const deps = fakeDeps();
    const events = await run(deps);

    expect(deps.complete).not.toHaveBeenCalled();
    expect(deps.retrieve).toHaveBeenCalledWith("Ile kosztuje pompa Komfort 9?");
    expect(events.filter((e) => e.type === "token").map((e) => (e as { text: string }).text).join("")).toBe(
      "Komfort 9 kosztuje 38 500 zł brutto [1].",
    );
    expect(events).toContainEqual({
      type: "citations",
      citations: [{ title: "cieplolux-oferta-2026.pdf", uri: "s3://b/cieplolux-oferta-2026.pdf", page: 1 }],
    });
    expect(events.at(-1)).toEqual({ type: "done", messageId: "id-2" });

    const saved = vi.mocked(deps.saveMessages).mock.calls[0]?.[0] as StoredMessage[];
    expect(saved.map((m) => m.sender)).toEqual(["visitor", "bot"]);
    expect(saved[1]?.citations).toHaveLength(1);
  });

  it("puts the retrieved passages in the prompt with numbered sources", async () => {
    const deps = fakeDeps();
    await run(deps);
    const [system, messages] = vi.mocked(deps.stream).mock.calls[0]!;
    expect(system).toContain("Ciepłolux");
    const last = messages.at(-1)!;
    expect(last.role).toBe("user");
    expect(last.content).toContain('<document index="1" source="cieplolux-oferta-2026.pdf" page="1">');
    expect(last.content).toContain("Visitor's question: Ile kosztuje pompa Komfort 9?");
  });

  it("rewrites follow-up questions using history before retrieval", async () => {
    const history: StoredMessage[] = [
      { messageId: "a", sessionId: SESSION, sender: "visitor", text: "Ile kosztuje Komfort 9?", createdAt: "2026-11-27T11:00:00.000Z" },
      { messageId: "b", sessionId: SESSION, sender: "bot", text: "38 500 zł [1].", createdAt: "2026-11-27T11:00:05.000Z" },
    ];
    const deps = fakeDeps({ loadHistory: vi.fn().mockResolvedValue(history) });
    await run(deps, "A większy model?");

    const [, condenseMessages] = vi.mocked(deps.complete).mock.calls[0]!;
    expect(condenseMessages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(deps.retrieve).toHaveBeenCalledWith("standalone query");
    const [, answerMessages] = vi.mocked(deps.stream).mock.calls[0]!;
    expect(answerMessages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
  });

  it("replaces a refusal with a polite fallback in the visitor's language", async () => {
    const deps = fakeDeps({ stream: vi.fn().mockResolvedValue({ text: "", stopReason: "refusal" }) });
    const events = await run(deps, "How long is the warranty?");
    expect(events).toContainEqual({ type: "token", text: "Sorry, I can't help with that question. Please contact us directly." });
    expect(events.some((e) => e.type === "citations")).toBe(false);
  });

  it("ignores citation numbers that point to no passage", async () => {
    const deps = fakeDeps({
      stream: vi.fn().mockResolvedValue({ text: "Gwarancja 10 lat [2] [7].", stopReason: "end_turn" }),
    });
    const events = await run(deps);
    expect(events).toContainEqual({
      type: "citations",
      citations: [{ title: "cieplolux-oferta-2026.pdf", uri: "s3://b/cieplolux-oferta-2026.pdf", page: 2 }],
    });
  });
});

describe("guessLanguage", () => {
  it("detects Polish and English", () => {
    expect(guessLanguage("Ile kosztuje pompa?")).toBe("pl");
    expect(guessLanguage("How much is the pump?")).toBe("en");
  });
});
