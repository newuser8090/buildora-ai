// ---------------------------------------------------------------------------
// QR code generation (Stage 5 — publish modal "scan to view live site")
//
// A small, dependency-free QR encoder: byte mode, error-correction level M,
// versions 1-6 (up to 108 bytes — plenty for a preview/share URL). Produces a
// boolean matrix the component renders as SVG rects.
//
// Layout follows ISO/IEC 18004 (model 2), structured like the Nayuki
// reference implementation: finder + timing + alignment function patterns,
// format info with BCH(15,5) protection (masked with 0x5412), zigzag data
// placement with the mask folded into placement (so function modules are
// never touched), Reed-Solomon EC over GF(256), and mask selection via the
// four standard penalty rules.
// ---------------------------------------------------------------------------

// --- GF(256) arithmetic (poly 0x11d) ---------------------------------------

const GF_EXP = new Uint8Array(256);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  GF_EXP[255] = GF_EXP[0];
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[(GF_LOG[a] + GF_LOG[b]) % 255];
}

// --- Reed-Solomon EC ---------------------------------------------------------

/** Divisor polynomial for `degree` EC codewords. */
function rsComputeDivisor(degree: number): number[] {
  const result: number[] = new Array(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMul(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return result;
}

function rsComputeRemainder(data: number[], divisor: number[]): number[] {
  const result: number[] = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ result.shift()!;
    result.push(0);
    for (let i = 0; i < divisor.length; i++) {
      result[i] ^= gfMul(divisor[i], factor);
    }
  }
  return result;
}

// --- Version tables (versions 1-6, EC level M) ------------------------------

const TOTAL_CODEWORDS = [26, 44, 70, 100, 134, 172];
const EC_PER_BLOCK = [10, 16, 26, 18, 24, 16]; // level M
const NUM_BLOCKS = [1, 1, 1, 2, 2, 4];
const ALIGNMENT_CENTERS: number[][] = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34]];

function dataCodewords(version: number): number {
  return TOTAL_CODEWORDS[version - 1] - EC_PER_BLOCK[version - 1] * NUM_BLOCKS[version - 1];
}

// --- Bit buffer --------------------------------------------------------------

class BitBuffer {
  readonly bits: number[] = [];

  put(num: number, length: number): void {
    for (let i = length - 1; i >= 0; i--) this.bits.push((num >>> i) & 1);
  }

  get lengthInBits(): number {
    return this.bits.length;
  }

  toBytes(): number[] {
    const bytes: number[] = [];
    for (let i = 0; i + 8 <= this.bits.length; i += 8) {
      let b = 0;
      for (let j = 0; j < 8; j++) b = (b << 1) | this.bits[i + j];
      bytes.push(b);
    }
    return bytes;
  }
}

// --- Format info (BCH(15,5), masked with 0x5412) -----------------------------

function formatBits(mask: number): number {
  // EC level M is 0b00, so the 5 data bits are simply the mask index.
  const data = mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

// --- Matrix construction -----------------------------------------------------

type Grid = Array<Array<boolean | null>>;

function makeGrid(size: number): Grid {
  return Array.from({ length: size }, () => new Array<boolean | null>(size).fill(null));
}

function drawFinder(grid: Grid, row: number, col: number): void {
  const size = grid.length;
  for (let r = -1; r <= 7; r++) {
    if (row + r < 0 || row + r >= size) continue;
    for (let c = -1; c <= 7; c++) {
      if (col + c < 0 || col + c >= size) continue;
      grid[row + r][col + c] =
        (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
        (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
        (r >= 2 && r <= 4 && c >= 2 && c <= 4);
    }
  }
}

function drawFunctionPatterns(grid: Grid, version: number): void {
  const size = grid.length;
  drawFinder(grid, 0, 0);
  drawFinder(grid, 0, size - 7);
  drawFinder(grid, size - 7, 0);

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    grid[6][i] = i % 2 === 0;
    grid[i][6] = i % 2 === 0;
  }

  // Alignment patterns (skip the three finder corners)
  const centers = ALIGNMENT_CENTERS[version - 1];
  for (const r of centers) {
    for (const c of centers) {
      if ((r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8)) {
        continue;
      }
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          grid[r + dr][c + dc] =
            dr === -2 || dr === 2 || dc === -2 || dc === 2 || (dr === 0 && dc === 0);
        }
      }
    }
  }

  // Reserve format-info areas (overwritten later, keeps codewords out)
  for (let i = 0; i < 9; i++) {
    if (grid[8][i] === null) grid[8][i] = false;
    if (grid[i][8] === null) grid[i][8] = false;
  }
  for (let i = 0; i < 8; i++) {
    if (grid[8][size - 1 - i] === null) grid[8][size - 1 - i] = false;
    if (grid[size - 1 - i][8] === null) grid[size - 1 - i][8] = false;
  }
  grid[size - 8][8] = true; // dark module
}

/**
 * Zigzag codeword placement with the mask folded in — only NULL cells are
 * data modules, so function patterns (finders, timing, alignment, reserved
 * format areas) are never masked.
 */
function drawCodewords(grid: Grid, data: number[], mask: number): void {
  const size = grid.length;
  const maskFn = MASK_FNS[mask];
  let bitIndex = 7;
  let byteIndex = 0;
  let inc = -1;
  let row = size - 1;

  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (;;) {
      for (let c = 0; c < 2; c++) {
        if (grid[row][col - c] === null) {
          let dark = false;
          if (byteIndex < data.length) dark = ((data[byteIndex] >>> bitIndex) & 1) === 1;
          bitIndex--;
          if (bitIndex === -1) {
            byteIndex++;
            bitIndex = 7;
          }
          grid[row][col - c] = dark !== maskFn(row, col - c);
        }
      }
      row += inc;
      if (row < 0 || row >= size) {
        row -= inc;
        inc = -inc;
        break;
      }
    }
  }
}

const MASK_FNS: Array<(i: number, j: number) => boolean> = [
  (i, j) => (i + j) % 2 === 0,
  (i) => i % 2 === 0,
  (_i, j) => j % 3 === 0,
  (i, j) => (i + j) % 3 === 0,
  (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0,
  (i, j) => ((i * j) % 2) + ((i * j) % 3) === 0,
  (i, j) => (((i * j) % 2) + ((i * j) % 3)) % 2 === 0,
  (i, j) => (((i * j) % 3) + ((i + j) % 2)) % 2 === 0,
];

/** Nayuki-style penalty score (lower is better). */
function penaltyScore(grid: Grid): number {
  const size = grid.length;
  let result = 0;

  // Rule 1 — runs of same color in rows and columns
  for (let y = 0; y < size; y++) {
    let runColor: boolean | null = null;
    let runLen = 0;
    for (let x = 0; x < size; x++) {
      const c = grid[y][x] === true;
      if (c !== runColor) {
        if (runLen >= 5) result += runLen - 2;
        runColor = c;
        runLen = 1;
      } else runLen++;
    }
    if (runLen >= 5) result += runLen - 2;
  }
  for (let x = 0; x < size; x++) {
    let runColor: boolean | null = null;
    let runLen = 0;
    for (let y = 0; y < size; y++) {
      const c = grid[y][x] === true;
      if (c !== runColor) {
        if (runLen >= 5) result += runLen - 2;
        runColor = c;
        runLen = 1;
      } else runLen++;
    }
    if (runLen >= 5) result += runLen - 2;
  }

  // Rule 2 — 2x2 blocks
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const c = grid[y][x] === true;
      if (
        c === (grid[y][x + 1] === true) &&
        c === (grid[y + 1][x] === true) &&
        c === (grid[y + 1][x + 1] === true)
      ) {
        result += 3;
      }
    }
  }

  // Rule 3 — finder-like patterns (3 dark, 1 light, 3 dark) with 4 light aside
  const PAT1 = [true, false, true, true, true, false, true, false, false, false];
  const PAT2 = [false, false, false, true, false, true, true, true, false, true];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x <= size - 10; x++) {
      let m1 = true;
      let m2 = true;
      for (let k = 0; k < 10; k++) {
        const c = grid[y][x + k] === true;
        if (c !== PAT1[k]) m1 = false;
        if (c !== PAT2[k]) m2 = false;
      }
      if (m1 || m2) result += 40;
    }
  }
  for (let x = 0; x < size; x++) {
    for (let y = 0; y <= size - 10; y++) {
      let m1 = true;
      let m2 = true;
      for (let k = 0; k < 10; k++) {
        const c = grid[y + k][x] === true;
        if (c !== PAT1[k]) m1 = false;
        if (c !== PAT2[k]) m2 = false;
      }
      if (m1 || m2) result += 40;
    }
  }

  // Rule 4 — dark/light balance
  let dark = 0;
  for (const row of grid) for (const c of row) if (c === true) dark++;
  const total = size * size;
  result += Math.floor(Math.abs(dark * 20 - total * 10) / total) * 10;

  return result;
}

function drawFormatInfo(grid: Grid, mask: number): void {
  const size = grid.length;
  const bits = formatBits(mask);
  const bit = (i: number): boolean => ((bits >> i) & 1) === 1;

  // First copy — around the top-left finder.
  for (let i = 0; i <= 5; i++) grid[i][8] = bit(i); // column 8, rows 0-5
  grid[7][8] = bit(6);
  grid[8][8] = bit(7);
  grid[8][7] = bit(8);
  for (let i = 9; i < 15; i++) grid[8][14 - i] = bit(i); // row 8, cols 5-0

  // Second copy — split across the top-right and bottom-left.
  for (let i = 0; i < 8; i++) grid[8][size - 1 - i] = bit(i); // row 8, right side
  for (let i = 8; i < 15; i++) grid[size - 15 + i][8] = bit(i); // column 8, bottom

  grid[size - 8][8] = true; // dark module
}

// --- Assembly ----------------------------------------------------------------

export interface QrMatrix {
  size: number;
  /** `true` = dark module. */
  modules: boolean[][];
}

/**
 * Encode `text` (UTF-8) as a QR matrix (byte mode, EC level M, versions 1-6).
 * Throws when the text exceeds the 108-byte capacity.
 */
export function buildQrMatrix(text: string): QrMatrix {
  const bytes = Array.from(new TextEncoder().encode(text));

  let version = 0;
  for (let v = 1; v <= 6; v++) {
    if (bytes.length + 1 <= dataCodewords(v)) {
      version = v;
      break;
    }
  }
  if (version === 0) {
    throw new Error("QR payload too long (max 108 bytes at EC level M, versions 1-6)");
  }

  const dataCw = dataCodewords(version);

  // Segment: byte-mode indicator + 8-bit count + payload (+ terminator/padding)
  const buffer = new BitBuffer();
  buffer.put(0b0100, 4);
  buffer.put(bytes.length, 8);
  for (const b of bytes) buffer.put(b, 8);
  buffer.put(0, Math.min(4, dataCw * 8 - buffer.lengthInBits));
  while (buffer.lengthInBits % 8 !== 0) buffer.bits.push(0);
  const padBytes = [0xec, 0x11];
  for (let i = 0; buffer.lengthInBits < dataCw * 8; i++) {
    buffer.put(padBytes[i % 2], 8);
  }

  // Split into blocks + compute EC, then interleave.
  const blocks = NUM_BLOCKS[version - 1];
  const blockDataLen = dataCw / blocks;
  const ecLen = EC_PER_BLOCK[version - 1];
  const dataBlocks: number[][] = [];
  const ecBlocks: number[][] = [];
  const divisor = rsComputeDivisor(ecLen);
  for (let b = 0; b < blocks; b++) {
    const block = buffer.toBytes().slice(b * blockDataLen, (b + 1) * blockDataLen);
    dataBlocks.push(block);
    ecBlocks.push(rsComputeRemainder(block, divisor));
  }

  const finalData: number[] = [];
  for (let i = 0; i < blockDataLen; i++) for (const block of dataBlocks) finalData.push(block[i]);
  for (let i = 0; i < ecLen; i++) for (const block of ecBlocks) finalData.push(block[i]);
  // Remainder bits (7 for v2-6) are placed by drawCodewords as light modules
  // XORed with the mask, matching the spec.

  // Choose the best mask by penalty score.
  const size = 17 + version * 4;
  let best: Grid | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let mask = 0; mask < 8; mask++) {
    const grid = makeGrid(size);
    drawFunctionPatterns(grid, version);
    drawCodewords(grid, finalData, mask);
    drawFormatInfo(grid, mask);
    const score = penaltyScore(grid);
    if (score < bestScore) {
      bestScore = score;
      best = grid;
    }
  }

  return {
    size,
    modules: (best as Grid).map((row) => row.map((c) => c === true)),
  };
}
