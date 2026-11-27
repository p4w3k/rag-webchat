import type { Citation } from "@rag-webchat/shared";

export interface ShownMessage {
  role: "visitor" | "bot";
  text: string;
  citations?: Citation[];
  error?: boolean;
}

const SESSION_KEY = "rag-webchat:session";
const TRANSCRIPT_KEY = "rag-webchat:transcript";
// Demo answers are canned, so they are kept apart and never shown in a live conversation.
const DEMO_TRANSCRIPT_KEY = "rag-webchat:demo-transcript";
const transcriptKey = (demo: boolean) => (demo ? DEMO_TRANSCRIPT_KEY : TRANSCRIPT_KEY);

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
  safe(() => sessionStorage.removeItem(DEMO_TRANSCRIPT_KEY), undefined);
  return loadSessionId();
}

/** The visible transcript survives navigation between pages of the same site in one tab. */
export function loadTranscript(demo: boolean): ShownMessage[] {
  const raw = safe(() => sessionStorage.getItem(transcriptKey(demo)), null);
  if (!raw) return [];
  return safe(() => (JSON.parse(raw) as ShownMessage[]).slice(-50), []);
}

export function saveTranscript(messages: ShownMessage[], demo: boolean): void {
  safe(() => sessionStorage.setItem(transcriptKey(demo), JSON.stringify(messages.slice(-50))), undefined);
}
