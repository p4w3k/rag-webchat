import type { VoiceSession } from "@rag-webchat/shared";
import type { Lang } from "../i18n.js";
import { audioContext } from "./audio.js";
import { decodeMessage, encodeAudioEvent } from "./eventstream.js";
import { PcmEncoder } from "./pcm.js";
import { TranscriptBuilder, type TranscriptEvent } from "./transcript.js";

/** Stop by itself this long after Transcribe marks a pause at the end of what was said. */
const PAUSE_STOP_MS = 1500;
/** Stop if nothing at all was recognised in this time. */
const SILENCE_STOP_MS = 8000;
/** Send audio in chunks of about 100 ms. */
const CHUNK_MS = 100;

export interface RecordingResult {
  text: string;
  language: Lang | undefined;
}

export class MicrophoneError extends Error {}

const WORKLET = `class RwCapture extends AudioWorkletProcessor {
  process(inputs) { const ch = inputs[0] && inputs[0][0]; if (ch) this.port.postMessage(ch.slice(0)); return true; }
}
registerProcessor("rw-capture", RwCapture);`;

/**
 * One utterance: microphone to Amazon Transcribe over a presigned WebSocket, with live
 * text as it is recognised. Ends when the visitor taps stop, after a pause, or at the
 * time limit, and resolves with the final text and the language Transcribe identified.
 */
export class Recorder {
  private readonly transcript = new TranscriptBuilder();
  private stream: MediaStream | undefined;
  private nodes: AudioNode[] = [];
  private ws: WebSocket | undefined;
  private queue: Uint8Array[] = [];
  private stopping = false;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private pauseTimer: ReturnType<typeof setTimeout> | undefined;
  private finished!: Promise<RecordingResult>;
  private resolveFinished!: (r: RecordingResult) => void;

  constructor(private readonly onText: (text: string) => void) {
    this.finished = new Promise((resolve) => (this.resolveFinished = resolve));
  }

  /** Opens the microphone and the transcription stream. Resolves once listening has started. */
  async start(session: VoiceSession): Promise<void> {
    if (this.stopping) return this.finish();
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (err) {
      throw new MicrophoneError(String(err));
    }
    // Stopped while the browser was asking for microphone permission.
    if (this.stopping) return this.finish();

    const ws = new WebSocket(session.url);
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    ws.onopen = () => {
      for (const chunk of this.queue) ws.send(encodeAudioEvent(chunk));
      this.queue = [];
    };
    ws.onmessage = (e) => this.onMessage(e.data as ArrayBuffer);
    ws.onerror = () => console.warn("[rag-webchat] transcription connection failed");
    ws.onclose = () => this.finish();

    const ctx = audioContext();
    if (ctx.state === "suspended") await ctx.resume();
    const encoder = new PcmEncoder(ctx.sampleRate, session.sampleRate);
    const minBytes = (session.sampleRate * 2 * CHUNK_MS) / 1000;
    let pending: Uint8Array[] = [];
    let pendingBytes = 0;
    const onAudio = (samples: Float32Array) => {
      if (this.stopping) return;
      const pcm = encoder.push(samples);
      pending.push(pcm);
      pendingBytes += pcm.length;
      if (pendingBytes < minBytes) return;
      const chunk = new Uint8Array(pendingBytes);
      let offset = 0;
      for (const p of pending) {
        chunk.set(p, offset);
        offset += p.length;
      }
      pending = [];
      pendingBytes = 0;
      this.sendAudio(chunk);
    };

    const source = ctx.createMediaStreamSource(this.stream);
    this.nodes.push(source);
    try {
      const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
      await ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      const node = new AudioWorkletNode(ctx, "rw-capture");
      node.port.onmessage = (e) => onAudio(e.data as Float32Array);
      source.connect(node);
      this.nodes.push(node);
    } catch {
      // Pages whose Content-Security-Policy blocks blob: workers: use the older, still widely supported node.
      const node = ctx.createScriptProcessor(4096, 1, 1);
      node.onaudioprocess = (e) => onAudio(e.inputBuffer.getChannelData(0));
      source.connect(node);
      node.connect(ctx.destination); // Needed for it to run; it outputs silence.
      this.nodes.push(node);
    }

    this.timers.push(setTimeout(() => this.stop(), session.maxSeconds * 1000));
    this.timers.push(
      setTimeout(() => {
        if (!this.transcript.text) this.stop();
      }, SILENCE_STOP_MS),
    );
  }

  /** Stops recording; Transcribe then sends its final results and closes the stream. */
  stop(): void {
    if (this.stopping) return;
    this.stopping = true;
    this.releaseMicrophone();
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(encodeAudioEvent(new Uint8Array(0)));
      this.timers.push(setTimeout(() => this.finish(), 2500));
    } else {
      this.finish();
    }
  }

  /** Stops without using the result. */
  cancel(): void {
    this.stopping = true;
    this.releaseMicrophone();
    this.ws?.close();
    this.finish();
  }

  result(): Promise<RecordingResult> {
    return this.finished;
  }

  private sendAudio(chunk: Uint8Array): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(encodeAudioEvent(chunk));
    else if (this.ws?.readyState === WebSocket.CONNECTING) this.queue.push(chunk);
  }

  private onMessage(data: ArrayBuffer): void {
    let msg;
    try {
      msg = decodeMessage(new Uint8Array(data));
    } catch {
      return;
    }
    const json = new TextDecoder().decode(msg.payload);
    if (msg.headers[":message-type"] === "exception") {
      console.warn("[rag-webchat] transcription error", msg.headers[":exception-type"], json);
      this.stop();
      return;
    }
    if (msg.headers[":event-type"] !== "TranscriptEvent") return;
    let event: TranscriptEvent;
    try {
      event = JSON.parse(json) as TranscriptEvent;
    } catch {
      return;
    }
    if (this.transcript.apply(event)) this.onText(this.transcript.text);
    // Transcribe also sends events with no results; only real results move the pause timer.
    if (!event.Transcript?.Results?.length) return;
    if (this.pauseTimer) clearTimeout(this.pauseTimer);
    if (!this.stopping && this.transcript.endsWithPause && this.transcript.text) {
      this.pauseTimer = setTimeout(() => this.stop(), PAUSE_STOP_MS);
    }
  }

  private releaseMicrophone(): void {
    for (const node of this.nodes) node.disconnect();
    this.nodes = [];
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = undefined;
  }

  private finish(): void {
    for (const t of this.timers) clearTimeout(t);
    if (this.pauseTimer) clearTimeout(this.pauseTimer);
    this.releaseMicrophone();
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) this.ws.close();
    this.resolveFinished({ text: this.transcript.text, language: this.transcript.language });
  }
}
