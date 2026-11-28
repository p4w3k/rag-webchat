import { describe, expect, it } from "vitest";
import { crc32, decodeMessage, encodeAudioEvent, encodeMessage } from "../src/voice/eventstream.js";
import { PcmEncoder } from "../src/voice/pcm.js";
import { SentenceSplitter, toSpeech } from "../src/voice/sentences.js";
import { TranscriptBuilder } from "../src/voice/transcript.js";

describe("event stream codec", () => {
  it("computes the standard CRC-32", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("encodes an audio event that decodes back to the same headers and payload", () => {
    const pcm = new Uint8Array([1, 2, 3, 4]);
    const msg = encodeAudioEvent(pcm);
    const view = new DataView(msg.buffer);
    expect(view.getUint32(0)).toBe(msg.length);
    const decoded = decodeMessage(msg);
    expect(decoded.headers).toEqual({ ":content-type": "application/octet-stream", ":event-type": "AudioEvent", ":message-type": "event" });
    expect([...decoded.payload]).toEqual([1, 2, 3, 4]);
  });

  it("encodes the empty end-of-audio event", () => {
    expect(decodeMessage(encodeAudioEvent(new Uint8Array(0))).payload.length).toBe(0);
  });

  it("rejects a corrupted message", () => {
    const msg = encodeMessage({ ":message-type": "event" }, new TextEncoder().encode("{}"));
    msg[msg.length - 6]! ^= 0xff;
    expect(() => decodeMessage(msg)).toThrow();
  });
});

describe("PcmEncoder", () => {
  it("downsamples 48 kHz floats to 16 kHz 16-bit little-endian PCM", () => {
    const enc = new PcmEncoder(48_000, 16_000);
    const out = enc.push(new Float32Array(480).fill(0.5)); // 10 ms
    expect(out.length).toBe(160 * 2);
    expect(new DataView(out.buffer).getInt16(0, true)).toBe(Math.floor(0.5 * 0x7fff));
  });

  it("carries leftover samples into the next chunk", () => {
    const enc = new PcmEncoder(44_100, 16_000);
    const a = enc.push(new Float32Array(441)).length / 2;
    const b = enc.push(new Float32Array(441)).length / 2;
    expect(a + b).toBe(320);
  });

  it("clips out-of-range samples", () => {
    const out = new PcmEncoder(16_000, 16_000).push(Float32Array.from([2, -2]));
    const view = new DataView(out.buffer);
    expect([view.getInt16(0, true), view.getInt16(2, true)]).toEqual([32767, -32768]);
  });
});

describe("SentenceSplitter", () => {
  it("emits the first sentence as soon as it is complete, with citations removed", () => {
    const s = new SentenceSplitter();
    expect(s.push("Pompa Komfort 9 kosztuje 38 500 zł")).toEqual([]);
    expect(s.push(" brutto [1]")).toEqual([]);
    expect(s.push(". Montaż")).toEqual(["Pompa Komfort 9 kosztuje 38 500 zł brutto."]);
    expect(s.push(" trwa 3–6 tygodni.")).toEqual([]);
    expect(s.flush()).toEqual(["Montaż trwa 3–6 tygodni."]);
  });

  it("keeps a citation that follows the full stop with its sentence", () => {
    const s = new SentenceSplitter();
    expect(s.push("Gwarancja na sprężarkę to 10 lat.")).toEqual([]);
    expect(s.push(" [2] Warunkiem")).toEqual(["Gwarancja na sprężarkę to 10 lat."]);
  });

  it("joins short sentences after the first one", () => {
    const s = new SentenceSplitter(3, 20);
    expect(s.push("Tak. Ma. Ten model. Pracuje do minus 25 stopni. Dalej")).toEqual(["Tak.", "Ma. Ten model. Pracuje do minus 25 stopni."]);
  });

  it("does not split decimal numbers", () => {
    const s = new SentenceSplitter();
    expect(s.push("Moc grzewcza wynosi 9.5 kW przy A7")).toEqual([]);
  });

  it("splits very long text without sentence ends", () => {
    const s = new SentenceSplitter();
    const pieces = s.push("słowo ".repeat(150));
    expect(pieces.length).toBe(1);
    expect(pieces[0]!.length).toBeLessThanOrEqual(600);
  });
});

describe("toSpeech", () => {
  it("strips markdown, links and citations, and drops pieces with nothing to say", () => {
    expect(toSpeech("**Eko 6** [1] – zobacz https://example.com")).toBe("Eko 6 – zobacz");
    expect(toSpeech(" [1] ")).toBe("");
  });
});

describe("TranscriptBuilder", () => {
  it("replaces partial results, keeps final ones and reports the language", () => {
    const t = new TranscriptBuilder();
    t.apply({ Transcript: { Results: [{ ResultId: "a", IsPartial: true, Alternatives: [{ Transcript: "Ile kosz" }] }] } });
    expect(t.text).toBe("Ile kosz");
    expect(t.endsWithPause).toBe(false);
    t.apply({ Transcript: { Results: [{ ResultId: "a", IsPartial: false, LanguageCode: "pl-PL", Alternatives: [{ Transcript: "Ile kosztuje Komfort 9?" }] }] } });
    t.apply({ Transcript: { Results: [{ ResultId: "b", IsPartial: true, Alternatives: [{ Transcript: "A gwarancja" }] }] } });
    expect(t.text).toBe("Ile kosztuje Komfort 9? A gwarancja");
    expect(t.language).toBe("pl");
    expect(t.endsWithPause).toBe(false);
  });

  it("ignores events without results", () => {
    const t = new TranscriptBuilder();
    expect(t.apply({ Transcript: { Results: [] } })).toBe(false);
    expect(t.text).toBe("");
  });
});
