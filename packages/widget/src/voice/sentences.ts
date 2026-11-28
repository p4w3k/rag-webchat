import { MAX_SPEECH_CHARS } from "@rag-webchat/shared/limits";
import { stripCitationMarkers } from "../text.js";

/**
 * Cuts a streamed answer into pieces to read aloud, so speech starts after the
 * first sentence instead of after the whole answer. A piece ends at . ! ? … or a
 * line break (citations like [1] after the mark stay with it). Short sentences are
 * joined so the voice does not sound choppy; the first piece may be shorter, to start sooner.
 */
export class SentenceSplitter {
  private buffer = "";
  private pieces = 0;

  constructor(
    private readonly firstMin = 20,
    private readonly nextMin = 60,
  ) {}

  push(text: string): string[] {
    this.buffer += text;
    const out: string[] = [];
    for (;;) {
      const piece = this.take();
      if (piece === undefined) break;
      const spoken = toSpeech(piece);
      if (spoken) out.push(spoken);
    }
    return out;
  }

  /** The rest of the answer, once the stream has ended. */
  flush(): string[] {
    const rest = toSpeech(this.buffer);
    this.buffer = "";
    return rest ? splitLong(rest) : [];
  }

  private take(): string | undefined {
    const min = this.pieces === 0 ? this.firstMin : this.nextMin;
    const boundary = /[.!?…](?:\s*\[\d{1,2}\])*(?=\s)|\n/g;
    let match: RegExpExecArray | null;
    while ((match = boundary.exec(this.buffer))) {
      const end = match.index + match[0].length;
      if (end >= min || match[0] === "\n") {
        // Wait for the next character: a citation such as " [1]" may still follow.
        if (match[0] !== "\n" && /^\s*\[?\d?$/.test(this.buffer.slice(end))) return undefined;
        const piece = this.buffer.slice(0, end);
        this.buffer = this.buffer.slice(end);
        this.pieces++;
        return piece;
      }
    }
    if (this.buffer.length > MAX_SPEECH_CHARS) {
      const cut = Math.max(this.buffer.lastIndexOf(", ", MAX_SPEECH_CHARS), this.buffer.lastIndexOf(" ", MAX_SPEECH_CHARS));
      const end = cut > 0 ? cut + 1 : MAX_SPEECH_CHARS;
      const piece = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end);
      this.pieces++;
      return piece;
    }
    return undefined;
  }
}

/** What the voice should say: no citation markers, markdown marks or links. Empty if nothing is left to read. */
export function toSpeech(text: string): string {
  const clean = stripCitationMarkers(text)
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[*_#`>|]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return /[\p{L}\p{N}]/u.test(clean) ? clean : "";
}

function splitLong(text: string): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > MAX_SPEECH_CHARS) {
    const cut = rest.lastIndexOf(" ", MAX_SPEECH_CHARS);
    const end = cut > 0 ? cut : MAX_SPEECH_CHARS;
    out.push(rest.slice(0, end).trim());
    rest = rest.slice(end).trim();
  }
  if (rest) out.push(rest);
  return out;
}
