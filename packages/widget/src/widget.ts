import type { ChatStreamEvent, Citation } from "@rag-webchat/shared";
import { guessLanguage } from "@rag-webchat/shared/language";
import { MAX_MESSAGE_CHARS } from "@rag-webchat/shared/limits";
import { ChatHttpError, sendMessage } from "./client.js";
import { demoStream } from "./demo.js";
import { type Lang, type Strings, strings } from "./i18n.js";
import { loadSessionId, loadTranscript, loadVoiceReplies, resetSessionId, saveTranscript, saveVoiceReplies, type ShownMessage } from "./storage.js";
import { styles } from "./styles.js";
import { citationLabel, stripCitationMarkers } from "./text.js";
import { fetchSpeech, startVoiceSession, type VoiceApi } from "./voice/api.js";
import { unlockAudio, voiceSupported } from "./voice/audio.js";
import { MicrophoneError, Recorder } from "./voice/recorder.js";
import { SentenceSplitter } from "./voice/sentences.js";
import { Speaker } from "./voice/speaker.js";

export interface WidgetConfig {
  apiUrl: string;
  siteKey: string;
  lang: Lang;
  title?: string;
  color: string;
  demo: boolean;
  /** Microphone input and spoken answers (Amazon Transcribe and Polly through the chat API). */
  voice: boolean;
}

type MicState = "idle" | "connecting" | "listening";

const ICON_CHAT = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>`;
const ICON_CLOSE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>`;
const ICON_SEND = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>`;
const ICON_MIC = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8"/></svg>`;
const ICON_STOP = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>`;
const ICON_SPEAKER_ON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/></svg>`;
const ICON_SPEAKER_OFF = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M22 9l-6 6M16 9l6 6"/></svg>`;
const ICON_RESET = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>`;

/** The chat bubble and panel, isolated from the host page in a Shadow DOM. */
export class RagWebchat extends HTMLElement {
  private config!: WidgetConfig;
  private t!: Strings;
  private sessionId = "";
  private transcript: ShownMessage[] = [];
  private busy = false;
  private root!: ShadowRoot;
  private panel!: HTMLElement;
  private launcher!: HTMLButtonElement;
  private list!: HTMLElement;
  private input!: HTMLTextAreaElement;
  private sendBtn!: HTMLButtonElement;
  private live!: HTMLElement;
  // Voice: present only when enabled and the browser supports it.
  private voiceOn = false;
  /** Answers are read aloud. Undefined until the visitor chooses; using the microphone turns it on. */
  private voiceReplies: boolean | undefined;
  private speaker: Speaker | undefined;
  private recorder: Recorder | undefined;
  private micBtn: HTMLButtonElement | undefined;
  private voiceBtn: HTMLButtonElement | undefined;

  init(config: WidgetConfig): void {
    this.config = config;
    this.t = strings[config.lang];
    this.sessionId = loadSessionId();
    this.transcript = loadTranscript(config.demo);
    this.voiceOn = config.voice && voiceSupported();
    if (this.voiceOn) {
      this.voiceReplies = loadVoiceReplies();
      this.speaker = new Speaker(
        (text, language, signal) => fetchSpeech(this.voiceApi(), text, language, signal),
        (speaking) => this.voiceBtn?.classList.toggle("speaking", speaking),
      );
    }
    this.root = this.attachShadow({ mode: "open" });
    this.render();
  }

  private render(): void {
    const t = this.t;
    const style = document.createElement("style");
    style.textContent = styles(this.config.color);

    this.panel = el("section", "panel");
    this.panel.hidden = true;
    this.panel.setAttribute("role", "dialog");
    this.panel.setAttribute("aria-label", this.config.title ?? t.title);

    const header = el("div", "header");
    const headerText = el("div", "header-text");
    headerText.append(el("div", "title", this.config.title ?? t.title), el("div", "subtitle", t.subtitle));
    const resetBtn = iconButton(ICON_RESET, t.newChat, () => this.resetConversation());
    const closeBtn = iconButton(ICON_CLOSE, t.close, () => this.toggle(false));
    header.append(headerText);
    if (this.voiceOn) {
      this.voiceBtn = iconButton(ICON_SPEAKER_OFF, t.voiceOn, () => this.setVoiceReplies(!this.voiceReplies, true));
      header.append(this.voiceBtn);
      this.renderVoiceButton();
    }
    header.append(resetBtn, closeBtn);
    this.panel.append(header);
    if (this.config.demo) this.panel.append(el("div", "demo", t.demoNotice));

    this.list = el("div", "messages");
    this.list.setAttribute("aria-live", "polite");
    this.live = el("div", "sr-only");
    this.live.setAttribute("aria-live", "assertive");

    const composer = el("form", "composer") as HTMLFormElement;
    this.input = document.createElement("textarea");
    this.input.rows = 1;
    this.input.maxLength = MAX_MESSAGE_CHARS;
    this.input.placeholder = t.placeholder;
    this.input.setAttribute("aria-label", t.placeholder);
    this.input.addEventListener("input", () => this.autosize());
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        composer.requestSubmit();
      }
    });
    this.sendBtn = document.createElement("button");
    this.sendBtn.type = "submit";
    this.sendBtn.className = "send";
    this.sendBtn.innerHTML = ICON_SEND;
    this.sendBtn.setAttribute("aria-label", t.send);
    composer.append(this.input);
    if (this.voiceOn) {
      this.micBtn = document.createElement("button");
      this.micBtn.type = "button";
      this.micBtn.className = "mic";
      this.micBtn.addEventListener("click", () => void this.toggleMic());
      composer.append(this.micBtn);
      this.setMicState("idle");
    }
    composer.append(this.sendBtn);
    composer.addEventListener("submit", (e) => {
      e.preventDefault();
      void this.send();
    });

    this.panel.append(this.list, composer, el("div", "footer", t.privacy), this.live);

    this.launcher = document.createElement("button");
    this.launcher.className = "launcher";
    this.launcher.innerHTML = ICON_CHAT;
    this.launcher.setAttribute("aria-label", t.open);
    this.launcher.setAttribute("aria-expanded", "false");
    this.launcher.addEventListener("click", () => this.toggle());

    this.panel.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.toggle(false);
    });

    this.root.append(style, this.panel, this.launcher);
    this.renderTranscript();
  }

  toggle(open = this.panel.hidden): void {
    this.panel.hidden = !open;
    this.launcher.setAttribute("aria-expanded", String(open));
    this.launcher.setAttribute("aria-label", open ? this.t.close : this.t.open);
    this.launcher.innerHTML = open ? ICON_CLOSE : ICON_CHAT;
    if (open) {
      this.input.focus();
      this.scrollToEnd();
    } else {
      this.stopVoice();
      this.launcher.focus();
    }
  }

  private renderTranscript(): void {
    this.list.replaceChildren(this.bubble({ role: "bot", text: this.t.greeting }).node);
    for (const m of this.transcript) this.list.append(this.bubble(m).node);
  }

  private resetConversation(): void {
    if (this.busy) return;
    this.stopVoice();
    this.sessionId = resetSessionId();
    this.transcript = [];
    this.renderTranscript();
    this.input.focus();
  }

  /** Sends the typed message, or the text the visitor just said (with the language Transcribe heard). */
  private async send(spoken?: { text: string; language: Lang | undefined }): Promise<void> {
    const text = (spoken?.text ?? this.input.value).trim();
    if (!text || this.busy) return;
    this.speaker?.stop();
    const speak = this.voiceOn && this.voiceReplies === true;
    // Called from the key press or tap, before any await, so the browser allows playback later.
    if (speak) unlockAudio();
    const splitter = speak ? new SentenceSplitter() : undefined;
    let speechLang: Lang | undefined = spoken?.language;
    const say = (pieces: string[]) => {
      for (const piece of pieces) {
        // The assistant answers in the visitor's language; for typed questions, tell it from the answer itself.
        speechLang ??= guessLanguage(piece);
        this.speaker?.say(piece, speechLang);
      }
    };
    this.busy = true;
    this.sendBtn.disabled = true;
    this.input.value = "";
    this.autosize();

    this.addMessage({ role: "visitor", text });
    const reply: ShownMessage = { role: "bot", text: "" };
    const view = this.bubble(reply, true);
    this.list.append(view.node);
    this.scrollToEnd();

    try {
      const events = this.config.demo
        ? demoStream(text, this.config.lang)
        : sendMessage({
            apiUrl: this.config.apiUrl,
            siteKey: this.config.siteKey,
            sessionId: this.sessionId,
            message: text,
            language: spoken?.language ?? this.config.lang,
            voice: speak,
          });
      for await (const event of events) {
        this.apply(event, reply, view);
        if (!splitter) continue;
        if (event.type === "token") say(splitter.push(event.text));
        else if (event.type === "done") say(splitter.flush());
        else if (event.type === "error") this.speaker?.stop();
      }
      if (!reply.text && !reply.error) throw new Error("empty reply");
    } catch (err) {
      this.speaker?.stop();
      reply.error = true;
      reply.text = err instanceof ChatHttpError && err.status === 429 ? this.t.errorRateLimited : err instanceof ChatHttpError ? this.t.errorGeneric : this.t.errorNetwork;
      view.update(reply);
    } finally {
      view.finish();
      this.transcript.push(reply);
      saveTranscript(this.transcript, this.config.demo);
      this.live.textContent = stripCitationMarkers(reply.text);
      this.busy = false;
      this.sendBtn.disabled = false;
      this.input.focus();
      this.scrollToEnd();
    }
  }

  private voiceApi(): VoiceApi {
    return { apiUrl: this.config.apiUrl, siteKey: this.config.siteKey, sessionId: this.sessionId };
  }

  /** Tap once to talk, tap again to stop and send; it also stops by itself after a pause. */
  private async toggleMic(): Promise<void> {
    if (this.recorder) {
      this.recorder.stop();
      return;
    }
    if (this.busy) return;
    unlockAudio();
    this.speaker?.stop();
    // Someone who talks to the assistant most likely wants to hear the answer, unless they turned it off.
    if (this.voiceReplies === undefined) this.setVoiceReplies(true, false);

    const recorder = new Recorder((text) => {
      this.input.value = text;
      this.autosize();
    });
    this.recorder = recorder;
    this.setMicState("connecting");
    try {
      await recorder.start(await startVoiceSession(this.voiceApi(), this.config.lang));
      if (this.recorder === recorder) this.setMicState("listening");
    } catch (err) {
      recorder.cancel();
      if (this.recorder === recorder) {
        this.recorder = undefined;
        this.setMicState("idle");
        this.notice(err instanceof MicrophoneError ? this.t.errorMic : err instanceof ChatHttpError && err.status === 429 ? this.t.errorRateLimited : this.t.errorVoice);
      }
      return;
    }

    const result = await recorder.result();
    if (this.recorder !== recorder) return; // Cancelled (panel closed or new chat).
    this.recorder = undefined;
    this.setMicState("idle");
    this.input.value = "";
    this.autosize();
    if (result.text.trim()) await this.send({ text: result.text, language: result.language });
    else this.notice(this.t.notHeard);
  }

  private setMicState(state: MicState): void {
    const btn = this.micBtn;
    if (!btn) return;
    const active = state !== "idle";
    btn.classList.toggle("recording", state === "listening");
    btn.classList.toggle("connecting", state === "connecting");
    btn.innerHTML = active ? ICON_STOP : ICON_MIC;
    btn.setAttribute("aria-label", active ? this.t.micStop : this.t.micStart);
    btn.title = active ? this.t.micStop : this.t.micStart;
    btn.setAttribute("aria-pressed", String(active));
    this.input.readOnly = active;
    this.input.placeholder = state === "listening" ? this.t.listening : state === "connecting" ? this.t.connecting : this.t.placeholder;
    this.sendBtn.disabled = active || this.busy;
    if (state === "listening") this.live.textContent = this.t.listening;
  }

  private setVoiceReplies(on: boolean, save: boolean): void {
    this.voiceReplies = on;
    if (save) saveVoiceReplies(on);
    if (on) unlockAudio();
    else this.speaker?.stop();
    this.renderVoiceButton();
  }

  private renderVoiceButton(): void {
    const btn = this.voiceBtn;
    if (!btn) return;
    const on = this.voiceReplies === true;
    btn.innerHTML = on ? ICON_SPEAKER_ON : ICON_SPEAKER_OFF;
    btn.setAttribute("aria-pressed", String(on));
    // The label says what the button does now: pressing it while on turns reading off.
    const label = on ? this.t.voiceOff : this.t.voiceOn;
    btn.setAttribute("aria-label", label);
    btn.title = label;
  }

  private stopVoice(): void {
    this.speaker?.stop();
    if (this.recorder) {
      const r = this.recorder;
      this.recorder = undefined;
      r.cancel();
      this.input.value = "";
      this.setMicState("idle");
    }
  }

  /** A short message in the conversation that is not part of the transcript (e.g. microphone blocked). */
  private notice(text: string): void {
    this.list.append(this.bubble({ role: "bot", text, error: true }).node);
    this.live.textContent = text;
    this.scrollToEnd();
  }

  private apply(event: ChatStreamEvent, reply: ShownMessage, view: BubbleView): void {
    switch (event.type) {
      case "token":
        reply.text += event.text;
        break;
      case "citations":
        reply.citations = event.citations;
        break;
      case "error":
        reply.error = true;
        reply.text = this.t.errorGeneric;
        break;
      case "done":
        break;
    }
    view.update(reply);
    this.scrollToEnd();
  }

  private addMessage(m: ShownMessage): void {
    this.transcript.push(m);
    saveTranscript(this.transcript, this.config.demo);
    this.list.append(this.bubble(m).node);
  }

  private bubble(m: ShownMessage, pending = false): BubbleView {
    const node = el("div", `msg ${m.role}`);
    const body = el("div", "body");
    node.append(body);
    const t = this.t;
    const update = (msg: ShownMessage) => {
      node.classList.toggle("error", Boolean(msg.error));
      if (!msg.text && pending) {
        body.className = "body thinking";
        body.textContent = t.thinking;
      } else {
        body.className = "body";
        body.textContent = msg.role === "bot" ? stripCitationMarkers(msg.text) : msg.text;
      }
      node.querySelector(".sources")?.remove();
      if (msg.citations?.length) node.append(sourcesList(msg.citations, t));
    };
    if (pending) node.classList.add("pending");
    update(m);
    return { node, update, finish: () => node.classList.remove("pending") };
  }

  private autosize(): void {
    this.input.style.height = "auto";
    this.input.style.height = `${Math.min(this.input.scrollHeight, 120)}px`;
  }

  private scrollToEnd(): void {
    this.list.scrollTop = this.list.scrollHeight;
  }
}

interface BubbleView {
  node: HTMLElement;
  update(m: ShownMessage): void;
  finish(): void;
}

function sourcesList(citations: Citation[], t: Strings): HTMLElement {
  const box = el("div", "sources", `${t.sources}:`);
  const ul = document.createElement("ul");
  for (const c of citations) ul.append(el("li", "", citationLabel(c, t.page)));
  box.append(ul);
  return box;
}

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function iconButton(svg: string, label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "icon-btn";
  b.innerHTML = svg;
  b.setAttribute("aria-label", label);
  b.title = label;
  b.addEventListener("click", onClick);
  return b;
}
