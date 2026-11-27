import type { Citation } from "@rag-webchat/shared";

/** The model cites passages as [1], [2]; visitors see the source list instead. */
export function stripCitationMarkers(text: string): string {
  return text.replace(/[ \t]*\[\d{1,2}\]/g, "");
}

export function citationLabel(c: Citation, pageWord: string): string {
  return c.page ? `${c.title}, ${pageWord} ${c.page}` : c.title;
}
