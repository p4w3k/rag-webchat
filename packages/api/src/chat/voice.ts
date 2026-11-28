import { PollyClient, SynthesizeSpeechCommand, type VoiceId } from "@aws-sdk/client-polly";
import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { Hash } from "@smithy/hash-node";
import { SignatureV4 } from "@smithy/signature-v4";
import { escapeUri } from "@smithy/util-uri-escape";
import type { Language } from "@rag-webchat/shared";
import type { AwsCredentialIdentityProvider } from "@smithy/types";
import type { VoiceSettings } from "./settings.js";

/** Transcribe streaming takes 16-bit little-endian PCM; 16 kHz is the recommended rate for speech. */
export const TRANSCRIBE_SAMPLE_RATE = 16_000;

/** The browser must open the WebSocket within this time; the stream itself can then run. */
const PRESIGN_SECONDS = 60;

const TRANSCRIBE_LANGUAGES: Record<Language, string> = { pl: "pl-PL", en: "en-US" };

/** The unsigned WebSocket request: Polish or English, identified automatically, preferring the widget's language. */
export function transcribeRequest(region: string, language: Language, sampleRate = TRANSCRIBE_SAMPLE_RATE) {
  const hostname = `transcribestreaming.${region}.amazonaws.com`;
  return {
    method: "GET",
    protocol: "wss:",
    hostname,
    port: 8443,
    path: "/stream-transcription-websocket",
    headers: { host: `${hostname}:8443` },
    query: {
      "media-encoding": "pcm",
      "sample-rate": String(sampleRate),
      "identify-language": "true",
      "language-options": Object.values(TRANSCRIBE_LANGUAGES).join(","),
      "preferred-language": TRANSCRIBE_LANGUAGES[language],
    } as Record<string, string>,
  };
}

/**
 * Signs a Transcribe streaming URL with the Lambda's own role (SigV4 query signing).
 * The URL carries a signature for this one request, never the secret key, so the
 * browser can only open this transcription stream, and only for a minute.
 */
export class TranscribeUrlSigner {
  private readonly signer: SignatureV4;

  constructor(
    private readonly region: string,
    credentials: AwsCredentialIdentityProvider = defaultProvider(),
  ) {
    this.signer = new SignatureV4({
      service: "transcribe",
      region,
      credentials,
      sha256: Hash.bind(null, "sha256"),
    });
  }

  async url(language: Language): Promise<string> {
    const signed = await this.signer.presign(transcribeRequest(this.region, language), { expiresIn: PRESIGN_SECONDS });
    return formatUrl(signed);
  }
}

export function formatUrl(req: { protocol: string; hostname: string; port?: number; path: string; query?: Record<string, string | string[] | null> }): string {
  const query = Object.entries(req.query ?? {})
    .flatMap(([k, v]) => (v === null ? [] : (Array.isArray(v) ? v : [v]).map((x) => `${escapeUri(k)}=${escapeUri(x)}`)))
    .join("&");
  return `${req.protocol}//${req.hostname}${req.port ? `:${req.port}` : ""}${req.path}${query ? `?${query}` : ""}`;
}

/** Reads answer text aloud with an Amazon Polly neural voice, as MP3. */
export class Speech {
  private readonly polly: PollyClient;

  constructor(
    region: string,
    private readonly voices: Pick<VoiceSettings, "pollyVoicePl" | "pollyVoiceEn">,
  ) {
    this.polly = new PollyClient({ region });
  }

  voiceFor(language: Language): string {
    return language === "pl" ? this.voices.pollyVoicePl : this.voices.pollyVoiceEn;
  }

  async synthesize(text: string, language: Language): Promise<Uint8Array> {
    const res = await this.polly.send(
      new SynthesizeSpeechCommand({ Engine: "neural", OutputFormat: "mp3", SampleRate: "24000", Text: speakable(text), VoiceId: this.voiceFor(language) as VoiceId }),
    );
    if (!res.AudioStream) throw new Error("Polly returned no audio");
    return res.AudioStream.transformToByteArray();
  }
}

/** Removes what should not be read aloud: [n] citations, markdown marks, URLs. The widget does the same; this is the backstop. */
export function speakable(text: string): string {
  return text
    .replace(/\s*\[\d{1,2}\]/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[*_#`>|]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
