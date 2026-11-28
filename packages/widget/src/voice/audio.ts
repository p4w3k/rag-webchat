/**
 * One AudioContext for the widget, for both the microphone and playback. Browsers
 * (Safari on iPhone in particular) only let audio start after a tap or key press,
 * so unlock() is called synchronously from those handlers.
 */
let ctx: AudioContext | undefined;

export function audioContext(): AudioContext {
  ctx ??= new AudioContext();
  return ctx;
}

export function unlockAudio(): void {
  const c = audioContext();
  if (c.state === "suspended") void c.resume();
}

/** Voice needs a microphone API, WebSockets and Web Audio, on HTTPS. */
export function voiceSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    typeof WebSocket !== "undefined" &&
    typeof AudioContext !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function"
  );
}
