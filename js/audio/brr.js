// SNES BRR (Bit Rate Reduction) codec.
// Every instrument the S-DSP played was stored as 4-bit ADPCM in 9-byte blocks of
// 16 samples. Running a sample through an encode/decode round trip reproduces
// the quantisation grit that gives SNES soundtracks their character.

const clamp16 = (v) => (v > 32767 ? 32767 : v < -32768 ? -32768 : v);

function predict(filter, p1, p2) {
  switch (filter) {
    case 1: return p1 + ((-p1) >> 4);
    case 2: return (p1 << 1) + ((-(p1 * 3)) >> 5) - p2 + (p2 >> 4);
    case 3: return (p1 << 1) + ((-(p1 * 13)) >> 6) - p2 + ((p2 * 3) >> 4);
    default: return 0;
  }
}

function decodeNibble(nibble, shift, filter, p1, p2) {
  const s = clamp16(((nibble << shift) >> 1) + predict(filter, p1, p2));
  // The DSP doubles into 16 bits (wrapping) and keeps 15 bits of history.
  return (((s << 1) << 16) >> 16) >> 1;
}

// Encodes and immediately decodes `input` (floats in -1..1, length a multiple
// of 16). Returns a new Float32Array with the BRR-quantised signal.
export function brrRoundTrip(input) {
  const out = new Float32Array(input.length);
  const target = new Int32Array(16);
  let p1 = 0;
  let p2 = 0;

  for (let block = 0; block * 16 < input.length; block++) {
    const base = block * 16;
    for (let i = 0; i < 16; i++) {
      const v = input[base + i] || 0;
      target[i] = Math.round(Math.max(-1, Math.min(1, v)) * 16000);
    }

    let bestErr = Infinity;
    let bestFilter = 0;
    let bestShift = 0;
    const filters = block === 0 ? 1 : 4;

    for (let filter = 0; filter < filters; filter++) {
      // Estimate the residual range (using the input as history) and only try
      // the shifts around the one that fits it.
      let peak = 0;
      let a = p1;
      let b = p2;
      for (let i = 0; i < 16; i++) {
        peak = Math.max(peak, Math.abs(target[i] - predict(filter, a, b)));
        b = a;
        a = target[i];
      }
      const guess = peak > 4 ? Math.ceil(Math.log2(peak / 4)) : 0;
      const lo = Math.max(0, guess - 1);
      const hi = Math.min(12, guess + 1);
      for (let shift = lo; shift <= hi; shift++) {
        let a = p1;
        let b = p2;
        let err = 0;
        const scale = 2 / (1 << shift);
        for (let i = 0; i < 16 && err < bestErr; i++) {
          const want = target[i] - predict(filter, a, b);
          let nib = Math.round(want * scale);
          nib = nib > 7 ? 7 : nib < -8 ? -8 : nib;
          const got = decodeNibble(nib, shift, filter, a, b);
          const d = got - target[i];
          err += d * d;
          b = a;
          a = got;
        }
        if (err < bestErr) {
          bestErr = err;
          bestFilter = filter;
          bestShift = shift;
        }
      }
    }

    const scale = 2 / (1 << bestShift);
    for (let i = 0; i < 16; i++) {
      const want = target[i] - predict(bestFilter, p1, p2);
      let nib = Math.round(want * scale);
      nib = nib > 7 ? 7 : nib < -8 ? -8 : nib;
      const got = decodeNibble(nib, bestShift, bestFilter, p1, p2);
      p2 = p1;
      p1 = got;
      if (base + i < out.length) out[base + i] = got / 16384;
    }
  }
  return out;
}
