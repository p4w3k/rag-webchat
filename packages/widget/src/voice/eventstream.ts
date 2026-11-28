/**
 * Minimal AWS event stream codec (application/vnd.amazon.eventstream), enough for
 * Amazon Transcribe streaming over WebSocket: encode audio frames, decode transcript events.
 * Message: total length, headers length, prelude CRC, headers, payload, message CRC (all big-endian).
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const b of bytes) crc = CRC_TABLE[(crc ^ b) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const STRING_TYPE = 7;
const utf8 = new TextEncoder();

export function encodeMessage(headers: Record<string, string>, payload: Uint8Array): Uint8Array {
  const headerParts = Object.entries(headers).map(([name, value]) => {
    const n = utf8.encode(name);
    const v = utf8.encode(value);
    const part = new Uint8Array(1 + n.length + 1 + 2 + v.length);
    const view = new DataView(part.buffer);
    part[0] = n.length;
    part.set(n, 1);
    part[1 + n.length] = STRING_TYPE;
    view.setUint16(2 + n.length, v.length);
    part.set(v, 4 + n.length);
    return part;
  });
  const headersLength = headerParts.reduce((sum, p) => sum + p.length, 0);
  const total = 12 + headersLength + payload.length + 4;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, total);
  view.setUint32(4, headersLength);
  view.setUint32(8, crc32(out.subarray(0, 8)));
  let offset = 12;
  for (const p of headerParts) {
    out.set(p, offset);
    offset += p.length;
  }
  out.set(payload, offset);
  view.setUint32(total - 4, crc32(out.subarray(0, total - 4)));
  return out;
}

/** One chunk of 16-bit PCM audio; an empty chunk tells Transcribe the audio has ended. */
export function encodeAudioEvent(pcm: Uint8Array): Uint8Array {
  return encodeMessage({ ":content-type": "application/octet-stream", ":event-type": "AudioEvent", ":message-type": "event" }, pcm);
}

export interface DecodedMessage {
  headers: Record<string, string>;
  payload: Uint8Array;
}

/** Decodes one complete message (each WebSocket frame carries exactly one). */
export function decodeMessage(bytes: Uint8Array): DecodedMessage {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const total = view.getUint32(0);
  const headersLength = view.getUint32(4);
  if (total !== bytes.length || crc32(bytes.subarray(0, total - 4)) !== view.getUint32(total - 4)) {
    throw new Error("corrupt event stream message");
  }
  const text = new TextDecoder();
  const headers: Record<string, string> = {};
  let offset = 12;
  const end = 12 + headersLength;
  while (offset < end) {
    const nameLength = bytes[offset]!;
    const name = text.decode(bytes.subarray(offset + 1, offset + 1 + nameLength));
    offset += 1 + nameLength;
    const type = bytes[offset]!;
    offset += 1;
    if (type !== STRING_TYPE) throw new Error(`unsupported header type ${type}`);
    const valueLength = view.getUint16(offset);
    headers[name] = text.decode(bytes.subarray(offset + 2, offset + 2 + valueLength));
    offset += 2 + valueLength;
  }
  return { headers, payload: bytes.subarray(end, total - 4) };
}
