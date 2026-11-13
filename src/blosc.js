'use strict';

// Blosc (version 1 frames) with the LZ4 codec, as Copernicus Marine packs its data (zarr).
// Small and dependency-free: the 16-byte header, the block offsets, each block's streams
// (one per byte of the type when split), LZ4, then the byte shuffle undone.

// One LZ4 block into out[at .. at + size].
function lz4(src, s, end, out, at, size) {
  const stop = at + size;
  let o = at;
  while (s < end) {
    const token = src[s++];
    let lit = token >> 4;
    if (lit === 15) { let b; do { b = src[s++]; lit += b; } while (b === 255); }
    for (let k = 0; k < lit; k++) out[o++] = src[s++];
    if (s >= end || o >= stop) break; // the last sequence is literals only
    const off = src[s] | (src[s + 1] << 8); s += 2;
    let len = token & 15;
    if (len === 15) { let b; do { b = src[s++]; len += b; } while (b === 255); }
    len += 4;
    for (let k = 0, from = o - off; k < len; k++) out[o++] = out[from + k];
  }
  if (o !== stop) throw new Error(`LZ4: ${o - at} of ${size} bytes`);
}

function decompress(buf) {
  const src = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(src.buffer, src.byteOffset, src.byteLength);
  const flags = src[2]; const typesize = src[3];
  const nbytes = dv.getUint32(4, true); const blocksize = dv.getUint32(8, true);
  const out = new Uint8Array(nbytes);
  if (flags & 0x02) { out.set(src.subarray(16, 16 + nbytes)); return out; } // stored as is
  if ((flags >> 5) !== 1) throw new Error(`Blosc: codec ${flags >> 5}, only LZ4 is read`);
  if (flags & 0x04) throw new Error('Blosc: bit shuffle is not read');
  const nblocks = Math.ceil(nbytes / blocksize);
  const tmp = new Uint8Array(blocksize);
  for (let b = 0; b < nblocks; b++) {
    const bsize = b === nblocks - 1 && nbytes % blocksize ? nbytes % blocksize : blocksize;
    // Split into one stream per byte of the type, except the shorter last block.
    const split = !(flags & 0x10) && bsize === blocksize && typesize <= 16 && bsize / typesize >= 128;
    const nstreams = split ? typesize : 1;
    const neblock = bsize / nstreams;
    let s = dv.getInt32(16 + b * 4, true);
    const dst = flags & 0x01 ? tmp : out;
    const base = flags & 0x01 ? 0 : b * blocksize;
    for (let k = 0; k < nstreams; k++) {
      const csize = dv.getInt32(s, true); s += 4;
      if (csize === neblock) dst.set(src.subarray(s, s + csize), base + k * neblock); // not compressed
      else lz4(src, s, s + csize, dst, base + k * neblock, neblock);
      s += csize;
    }
    if (flags & 0x01) {
      // Undo the byte shuffle: all first bytes, then all second bytes, ...
      const n = Math.floor(bsize / typesize); const o0 = b * blocksize;
      for (let j = 0; j < typesize; j++) for (let i = 0; i < n; i++) out[o0 + i * typesize + j] = tmp[j * n + i];
      for (let i = n * typesize; i < bsize; i++) out[o0 + i] = tmp[i];
    }
  }
  return out;
}

module.exports = { decompress };
