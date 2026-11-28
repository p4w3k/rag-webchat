import type { Lang } from "../i18n.js";
import { audioContext } from "./audio.js";

export type SpeechFetcher = (text: string, language: Lang, signal: AbortSignal) => Promise<ArrayBuffer>;

/**
 * Reads answer pieces aloud in order. Each piece's audio is requested as soon as it
 * is queued, so the next sentence is usually ready when the current one ends.
 */
export class Speaker {
  private tail: Promise<void> = Promise.resolve();
  private abort = new AbortController();
  private current: AudioBufferSourceNode | undefined;
  private pending = 0;

  constructor(
    private readonly fetchSpeech: SpeechFetcher,
    private readonly onSpeakingChange: (speaking: boolean) => void = () => {},
  ) {}

  get speaking(): boolean {
    return this.pending > 0;
  }

  say(text: string, language: Lang): void {
    const signal = this.abort.signal;
    const audio = this.fetchSpeech(text, language, signal);
    audio.catch(() => {}); // Handled below, in order; avoid an unhandled rejection meanwhile.
    this.pending++;
    if (this.pending === 1) this.onSpeakingChange(true);
    this.tail = this.tail
      .then(async () => {
        if (signal.aborted) return;
        const ctx = audioContext();
        const buffer = await ctx.decodeAudioData(await audio);
        if (signal.aborted) return;
        await this.play(ctx, buffer);
      })
      .catch((err: unknown) => {
        if (!signal.aborted) console.warn("[rag-webchat] could not read the answer aloud", err);
      })
      .finally(() => {
        this.pending = Math.max(0, this.pending - 1);
        if (this.pending === 0) this.onSpeakingChange(false);
      });
  }

  /** Stops the voice at once and drops everything queued. */
  stop(): void {
    this.abort.abort();
    this.abort = new AbortController();
    try {
      this.current?.stop();
    } catch {
      // Already stopped.
    }
    this.current = undefined;
  }

  private play(ctx: AudioContext, buffer: AudioBuffer): Promise<void> {
    return new Promise((resolve) => {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.onended = () => {
        if (this.current === source) this.current = undefined;
        resolve();
      };
      this.current = source;
      source.start();
    });
  }
}
