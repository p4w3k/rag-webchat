/**
 * Turns microphone audio (Float32 at the device rate, usually 44.1 or 48 kHz) into
 * 16-bit little-endian PCM at the rate Transcribe expects. Keeps its position between
 * chunks so there are no clicks at chunk boundaries.
 */
export class PcmEncoder {
  private readonly ratio: number;
  private carry: number[] = [];

  constructor(inputRate: number, outputRate: number) {
    this.ratio = inputRate / outputRate;
  }

  push(input: Float32Array): Uint8Array {
    const samples = this.carry.length ? Float32Array.from([...this.carry, ...input]) : input;
    const count = Math.floor(samples.length / this.ratio);
    const out = new DataView(new ArrayBuffer(count * 2));
    for (let i = 0; i < count; i++) {
      // Average the input samples that fall into this output sample (a simple low-pass).
      const start = Math.floor(i * this.ratio);
      const end = Math.max(start + 1, Math.floor((i + 1) * this.ratio));
      let sum = 0;
      for (let j = start; j < end; j++) sum += samples[j]!;
      const s = Math.max(-1, Math.min(1, sum / (end - start)));
      out.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    this.carry = Array.from(samples.subarray(Math.floor(count * this.ratio)));
    return new Uint8Array(out.buffer);
  }
}
