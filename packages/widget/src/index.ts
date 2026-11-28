import { pickLang } from "./i18n.js";
import { RagWebchat, type WidgetConfig } from "./widget.js";

/**
 * Embed with:
 *   <script src="https://<host>/widget.js" data-api-url="https://<chat-api>" data-site-key="<key>" defer></script>
 * or, on the demo site, data-config-url="/widget-config.json" to read apiUrl/siteKey from a JSON file.
 * Optional: data-lang="pl|en", data-title, data-color="#0b5d3b", data-demo="true",
 * data-voice="true" (microphone and spoken answers; needs voice enabled in the API).
 * Adding ?chatdemo=1 to the page URL turns on demo mode (canned answers, no API calls).
 */
const TAG = "rag-webchat";
const script = document.currentScript as HTMLScriptElement | null;

async function start(): Promise<void> {
  if (document.querySelector(TAG)) return;
  const data = script?.dataset ?? {};
  let fileConfig: Partial<Pick<WidgetConfig, "apiUrl" | "siteKey" | "voice">> = {};
  if (data.configUrl) {
    try {
      fileConfig = (await (await fetch(data.configUrl, { cache: "no-cache" })).json()) as typeof fileConfig;
    } catch {
      console.warn("[rag-webchat] could not load", data.configUrl);
    }
  }
  const demo = data.demo === "true" || new URLSearchParams(location.search).has("chatdemo");
  const apiUrl = data.apiUrl ?? fileConfig.apiUrl ?? "";
  const siteKey = data.siteKey ?? fileConfig.siteKey ?? "";
  if (!demo && (!apiUrl || !siteKey)) {
    console.warn("[rag-webchat] missing data-api-url or data-site-key; widget not started");
    return;
  }

  if (!customElements.get(TAG)) customElements.define(TAG, RagWebchat);
  const widget = document.createElement(TAG) as RagWebchat;
  document.body.append(widget);
  widget.init({
    apiUrl,
    siteKey,
    demo,
    lang: pickLang(data.lang, document.documentElement.lang, navigator.language),
    color: data.color ?? "#0b5d3b",
    // Voice needs the API, so it is off in demo mode.
    voice: !demo && (data.voice !== undefined ? data.voice === "true" : fileConfig.voice === true),
    ...(data.title ? { title: data.title } : {}),
  });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => void start());
else void start();
