import { describe, expect, it, vi } from "vitest";
import type { ChatStreamEvent } from "@rag-webchat/shared";
import { demoStream } from "../src/demo.js";
import { pickLang } from "../src/i18n.js";
import { SseParser } from "../src/sse.js";
import { citationLabel, stripCitationMarkers } from "../src/text.js";

describe("SseParser", () => {
  it("returns events only once they are complete, across chunk boundaries", () => {
    const p = new SseParser();
    expect(p.push('data: {"type":"token","te')).toEqual([]);
    expect(p.push('xt":"Cześć"}\n\ndata: {"type":"done","messageId":"m1"}\r\n\r\n')).toEqual([
      { type: "token", text: "Cześć" },
      { type: "done", messageId: "m1" },
    ]);
  });

  it("skips comments and malformed data", () => {
    const p = new SseParser();
    expect(p.push(': keep-alive\n\ndata: {oops\n\ndata: {"type":"done","messageId":"x"}\n\n')).toEqual([{ type: "done", messageId: "x" }]);
  });
});

describe("text helpers", () => {
  it("removes [n] citation markers", () => {
    expect(stripCitationMarkers("Kosztuje 38 500 zł. [1] Gwarancja 5 lat [2][3].")).toBe("Kosztuje 38 500 zł. Gwarancja 5 lat.");
  });

  it("labels citations with the page when known", () => {
    expect(citationLabel({ title: "oferta.pdf", page: 2 }, "s.")).toBe("oferta.pdf, s. 2");
    expect(citationLabel({ title: "oferta.pdf" }, "p.")).toBe("oferta.pdf");
  });
});

describe("pickLang", () => {
  it("prefers the explicit setting, then the page, then the browser", () => {
    expect(pickLang("en", "pl", "pl-PL")).toBe("en");
    expect(pickLang(undefined, "pl", "en-US")).toBe("pl");
    expect(pickLang(null, "", "pl-PL")).toBe("pl");
    expect(pickLang("de", "fr", "es")).toBe("en");
  });
});

describe("demoStream", () => {
  it("streams a canned answer with citations, then done", async () => {
    vi.useFakeTimers();
    const events: ChatStreamEvent[] = [];
    const run = (async () => {
      for await (const e of demoStream("Ile kosztuje Komfort 9?", "pl")) events.push(e);
    })();
    await vi.runAllTimersAsync();
    await run;
    vi.useRealTimers();
    const text = events.flatMap((e) => (e.type === "token" ? [e.text] : [])).join("");
    expect(text).toContain("38 500 zł");
    expect(events.at(-2)).toEqual({ type: "citations", citations: [{ title: "cieplolux-oferta-2026.pdf", page: 1 }] });
    expect(events.at(-1)?.type).toBe("done");
  });
});
