import type { ChatStreamEvent, Citation } from "@rag-webchat/shared";
import { MAX_MESSAGE_CHARS } from "@rag-webchat/shared/limits";
import { ChatHttpError, sendMessage } from "./client.js";
import { demoStream } from "./demo.js";
import { type Lang, type Strings, strings } from "./i18n.js";
import { loadSessionId, loadTranscript, resetSessionId, saveTranscript, type ShownMessage } from "./storage.js";
import { styles } from "./styles.js";
import { citationLabel, stripCitationMarkers } from "./text.js";

export interface WidgetConfig {
  apiUrl: string;
  siteKey: string;
  lang: Lang;
  title?: string;
  color: string;
  demo: boolean;
}

const ICON_CHAT = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>`;
const ICON_CLOSE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>`;
const ICON_SEND = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>`;
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

  init(config: WidgetConfig): void {
    this.config = config;
    this.t = strings[config.lang];
    this.sessionId = loadSessionId();
    this.transcript = loadTranscript(config.demo);
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
    header.append(headerText, resetBtn, closeBtn);
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
    composer.append(this.input, this.sendBtn);
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
      this.launcher.focus();
    }
  }

  private renderTranscript(): void {
    this.list.replaceChildren(this.bubble({ role: "bot", text: this.t.greeting }).node);
    for (const m of this.transcript) this.list.append(this.bubble(m).node);
  }

  private resetConversation(): void {
    if (this.busy) return;
    this.sessionId = resetSessionId();
    this.transcript = [];
    this.renderTranscript();
    this.input.focus();
  }

  private async send(): Promise<void> {
    const text = this.input.value.trim();
    if (!text || this.busy) return;
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
        : sendMessage({ apiUrl: this.config.apiUrl, siteKey: this.config.siteKey, sessionId: this.sessionId, message: text, language: this.config.lang });
      for await (const event of events) this.apply(event, reply, view);
      if (!reply.text && !reply.error) throw new Error("empty reply");
    } catch (err) {
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
