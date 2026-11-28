import type { Lang } from "../i18n.js";

/** The parts of a Transcribe streaming TranscriptEvent the widget uses. */
export interface TranscriptEvent {
  Transcript?: {
    Results?: Array<{ ResultId?: string; IsPartial?: boolean; LanguageCode?: string; Alternatives?: Array<{ Transcript?: string }> }>;
  };
}

/**
 * Builds the visitor's text from Transcribe results. A result is first sent as
 * partial and updated as more audio arrives, then once more as final (IsPartial false).
 */
export class TranscriptBuilder {
  private readonly segments = new Map<string, string>();
  private lastFinal = false;
  language: Lang | undefined;

  /** Returns true when the event changed the text. */
  apply(event: TranscriptEvent): boolean {
    let changed = false;
    for (const r of event.Transcript?.Results ?? []) {
      const text = r.Alternatives?.[0]?.Transcript?.trim() ?? "";
      const id = r.ResultId ?? `r${this.segments.size}`;
      if (this.segments.get(id) !== text) {
        this.segments.set(id, text);
        changed = true;
      }
      this.lastFinal = r.IsPartial === false;
      const code = r.LanguageCode?.slice(0, 2).toLowerCase();
      if (code === "pl" || code === "en") this.language = code;
    }
    return changed;
  }

  get text(): string {
    return [...this.segments.values()].filter(Boolean).join(" ");
  }

  /** The latest result was final, i.e. Transcribe heard a pause after it. */
  get endsWithPause(): boolean {
    return this.lastFinal;
  }
}
