import type { Citation } from "@rag-webchat/shared";

export interface ShownMessage {
  role: "visitor" | "bot";
  text: string;
  citations?: Citation[];
  error?: boolean;
}

const SESSION_KEY = "rag-webchat:session";
const TRANSCRIPT_KEY = "rag-webchat:transcript";

/** Browser storage can be blocked (private mode, iframes); every access is best effort. */
function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export function loadSessionId(): string {
  const existing = safe(() => localStorage.getItem(SESSION_KEY), null);
  if (existing) return existing;
  const id = crypto.randomUUID();
  safe(() => localStorage.setItem(SESSION_KEY, id), undefined);
  return id;
}

export function resetSessionId(): string {
  safe(() => localStorage.removeItem(SESSION_KEY), undefined);
  safe(() => sessionStorage.removeItem(TRANSCRIPT_KEY), undefined);
  return loadSessionId();
}

/** The visible transcript survives navigation between pages of the same site in one tab. */
export function loadTranscript(): ShownMessage[] {
  const raw = safe(() => sessionStorage.getItem(TRANSCRIPT_KEY), null);
  if (!raw) return [];
  return safe(() => (JSON.parse(raw) as ShownMessage[]).slice(-50), []);
}

export function saveTranscript(messages: ShownMessage[]): void {
  safe(() => sessionStorage.setItem(TRANSCRIPT_KEY, JSON.stringify(messages.slice(-50))), undefined);
}
