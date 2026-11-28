export function styles(color: string): string {
  return `
:host { all: initial; --rw-color: ${color}; --rw-text: #1d2330; --rw-muted: #5b6475; --rw-bg: #ffffff; --rw-soft: #f2f4f7; --rw-border: #dfe3ea;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; font-size: 15px; line-height: 1.45; color: var(--rw-text); }
* { box-sizing: border-box; }
button { font: inherit; cursor: pointer; }
.launcher { position: fixed; right: 20px; bottom: 20px; width: 60px; height: 60px; border-radius: 50%; border: none;
  background: var(--rw-color); color: #fff; box-shadow: 0 6px 20px rgba(0,0,0,.22); display: grid; place-items: center; z-index: 2147483000;
  transition: transform .15s ease; }
.launcher:hover { transform: scale(1.06); }
.launcher:focus-visible, .icon-btn:focus-visible, .send:focus-visible, textarea:focus-visible { outline: 3px solid #f0b429; outline-offset: 2px; }
.launcher svg { width: 28px; height: 28px; }
.panel { position: fixed; right: 20px; bottom: 92px; width: 380px; height: min(600px, calc(100vh - 120px)); background: var(--rw-bg);
  border-radius: 16px; box-shadow: 0 12px 40px rgba(0,0,0,.25); display: flex; flex-direction: column; overflow: hidden; z-index: 2147483000; }
.panel[hidden] { display: none; }
.header { background: var(--rw-color); color: #fff; padding: 14px 12px 14px 16px; display: flex; align-items: center; gap: 8px; }
.header-text { flex: 1; min-width: 0; }
.title { font-weight: 650; font-size: 16px; }
.subtitle { font-size: 12.5px; opacity: .88; }
.icon-btn { background: transparent; border: none; color: #fff; width: 34px; height: 34px; border-radius: 8px; display: grid; place-items: center; }
.icon-btn:hover { background: rgba(255,255,255,.16); }
.icon-btn svg { width: 20px; height: 20px; }
.demo { background: #fff4d6; color: #6b4e00; font-size: 12.5px; padding: 6px 16px; }
.messages { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 10px; background: var(--rw-soft); }
.msg { max-width: 85%; padding: 9px 13px; border-radius: 14px; white-space: pre-wrap; overflow-wrap: anywhere; }
.msg.bot { align-self: flex-start; background: var(--rw-bg); border: 1px solid var(--rw-border); border-bottom-left-radius: 4px; }
.msg.visitor { align-self: flex-end; background: var(--rw-color); color: #fff; border-bottom-right-radius: 4px; }
.msg.error { background: #fdecec; border-color: #f3c2c2; color: #8a1f1f; }
.msg.pending .body::after { content: "▍"; animation: blink 1s steps(2) infinite; color: var(--rw-muted); }
.thinking { color: var(--rw-muted); font-style: italic; }
@keyframes blink { 50% { opacity: 0; } }
.sources { margin-top: 8px; padding-top: 7px; border-top: 1px solid var(--rw-border); font-size: 12.5px; color: var(--rw-muted); white-space: normal; }
.sources ul { margin: 3px 0 0; padding-left: 18px; }
.composer { border-top: 1px solid var(--rw-border); padding: 10px; display: flex; gap: 8px; align-items: flex-end; background: var(--rw-bg); }
textarea { flex: 1; resize: none; border: 1px solid var(--rw-border); border-radius: 10px; padding: 9px 11px; font: inherit; color: inherit;
  max-height: 120px; min-height: 40px; background: #fff; }
.send { border: none; background: var(--rw-color); color: #fff; border-radius: 10px; width: 42px; height: 40px; display: grid; place-items: center; }
.send:disabled { opacity: .5; cursor: default; }
.mic { border: 1px solid var(--rw-border); background: var(--rw-bg); color: var(--rw-color); border-radius: 10px; width: 42px; height: 40px;
  display: grid; place-items: center; flex: none; }
.mic svg { width: 20px; height: 20px; }
.mic:hover { background: var(--rw-soft); }
.mic:focus-visible { outline: 3px solid #f0b429; outline-offset: 2px; }
.mic.connecting { opacity: .7; }
.mic.recording { background: #c62828; border-color: #c62828; color: #fff; animation: rw-pulse 1.4s ease-out infinite; }
@keyframes rw-pulse { 0% { box-shadow: 0 0 0 0 rgba(198,40,40,.45); } 100% { box-shadow: 0 0 0 10px rgba(198,40,40,0); } }
textarea:read-only { background: var(--rw-soft); }
.icon-btn[aria-pressed="true"] { background: rgba(255,255,255,.2); }
.icon-btn.speaking svg { animation: blink 1.2s ease-in-out infinite; }
.send svg { width: 20px; height: 20px; }
.footer { font-size: 11.5px; color: var(--rw-muted); padding: 0 12px 10px; background: var(--rw-bg); }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
@media (max-width: 480px) {
  .panel { right: 0; bottom: 0; width: 100vw; height: 100dvh; border-radius: 0; }
  .launcher { right: 16px; bottom: 16px; }
  .panel:not([hidden]) ~ .launcher { display: none; }
}
@media (prefers-reduced-motion: reduce) { .launcher { transition: none; } .msg.pending .body::after, .mic.recording, .icon-btn.speaking svg { animation: none; } }
`;
}
