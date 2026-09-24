/**
 * Offline QR Code encoder (ISO/IEC 18004), byte mode, versions 1–40,
 * error-correction levels L/M/Q/H, automatic mask selection.
 * Pure JavaScript, no dependencies, no network. Follows the structure of
 * Project Nayuki's reference implementation (MIT).
 */

/** @typedef {'L' | 'M' | 'Q' | 'H'} EccLevel */

const ECC_ORDINAL = { L: 0, M: 1, Q: 2, H: 3 };
/** Format-bits value per level (note: not the same order as ordinal). */
const ECC_FORMAT_BITS = { L: 1, M: 0, Q: 3, H: 2 };

// prettier-ignore
const ECC_CODEWORDS_PER_BLOCK = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];

// prettier-ignore
const NUM_ERROR_CORRECTION_BLOCKS = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];

const PENALTY_N1 = 3;
const PENALTY_N2 = 3;
const PENALTY_N3 = 40;
const PENALTY_N4 = 10;

/** Number of data+ECC bits available in a symbol of this version. */
export function numRawDataModules(ver) {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}

/** Data codewords (bytes) available for this version and level. */
export function numDataCodewords(ver, ecl) {
  const o = ECC_ORDINAL[ecl];
  return (
    Math.floor(numRawDataModules(ver) / 8) - ECC_CODEWORDS_PER_BLOCK[o][ver] * NUM_ERROR_CORRECTION_BLOCKS[o][ver]
  );
}

// --- Reed–Solomon over GF(2^8), primitive polynomial 0x11D ------------------

function rsMultiply(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i -= 1) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

/** @param {number} degree */
export function rsComputeDivisor(degree) {
  const result = new Array(degree - 1).fill(0);
  result.push(1);
  let root = 1;
  for (let i = 0; i < degree; i += 1) {
    for (let j = 0; j < result.length; j += 1) {
      result[j] = rsMultiply(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = rsMultiply(root, 0x02);
  }
  return result;
}

/** @param {number[]} data @param {number[]} divisor */
export function rsComputeRemainder(data, divisor) {
  const result = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ result.shift();
    result.push(0);
    divisor.forEach((coef, i) => {
      result[i] ^= rsMultiply(coef, factor);
    });
  }
  return result;
}

// --- Symbol construction -----------------------------------------------------

function alignmentPatternPositions(ver) {
  if (ver === 1) return [];
  const numAlign = Math.floor(ver / 7) + 2;
  const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2;
  const result = [6];
  for (let pos = ver * 4 + 10; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
  return result;
}

function getBit(x, i) {
  return ((x >>> i) & 1) !== 0;
}

class QrSymbol {
  /** @param {number} version @param {EccLevel} ecl @param {number[]} dataCodewords @param {number} [forcedMask] */
  constructor(version, ecl, dataCodewords, forcedMask = -1) {
    this.version = version;
    this.ecl = ecl;
    this.size = version * 4 + 17;
    /** @type {boolean[][]} */
    this.modules = Array.from({ length: this.size }, () => new Array(this.size).fill(false));
    /** @type {boolean[][]} */
    this.isFunction = Array.from({ length: this.size }, () => new Array(this.size).fill(false));

    this.drawFunctionPatterns();
    this.drawCodewords(this.addEccAndInterleave(dataCodewords));

    let mask = forcedMask;
    if (mask === -1) {
      let minPenalty = Infinity;
      for (let i = 0; i < 8; i += 1) {
        this.applyMask(i);
        this.drawFormatBits(i);
        const penalty = this.getPenaltyScore();
        if (penalty < minPenalty) {
          mask = i;
          minPenalty = penalty;
        }
        this.applyMask(i); // XOR again to undo
      }
    }
    this.mask = mask;
    this.applyMask(mask);
    this.drawFormatBits(mask);
    this.isFunction = [];
  }

  setFunctionModule(x, y, dark) {
    this.modules[y][x] = dark;
    this.isFunction[y][x] = true;
  }

  drawFunctionPatterns() {
    for (let i = 0; i < this.size; i += 1) {
      this.setFunctionModule(6, i, i % 2 === 0);
      this.setFunctionModule(i, 6, i % 2 === 0);
    }
    this.drawFinderPattern(3, 3);
    this.drawFinderPattern(this.size - 4, 3);
    this.drawFinderPattern(3, this.size - 4);

    const pos = alignmentPatternPositions(this.version);
    const n = pos.length;
    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j < n; j += 1) {
        if (!((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0))) {
          this.drawAlignmentPattern(pos[i], pos[j]);
        }
      }
    }
    this.drawFormatBits(0); // placeholder, overwritten after masking
    this.drawVersion();
  }

  drawFormatBits(mask) {
    const data = (ECC_FORMAT_BITS[this.ecl] << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i += 1) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;

    for (let i = 0; i <= 5; i += 1) this.setFunctionModule(8, i, getBit(bits, i));
    this.setFunctionModule(8, 7, getBit(bits, 6));
    this.setFunctionModule(8, 8, getBit(bits, 7));
    this.setFunctionModule(7, 8, getBit(bits, 8));
    for (let i = 9; i < 15; i += 1) this.setFunctionModule(14 - i, 8, getBit(bits, i));

    for (let i = 0; i < 8; i += 1) this.setFunctionModule(this.size - 1 - i, 8, getBit(bits, i));
    for (let i = 8; i < 15; i += 1) this.setFunctionModule(8, this.size - 15 + i, getBit(bits, i));
    this.setFunctionModule(8, this.size - 8, true); // always dark
  }

  drawVersion() {
    if (this.version < 7) return;
    let rem = this.version;
    for (let i = 0; i < 12; i += 1) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (this.version << 12) | rem;
    for (let i = 0; i < 18; i += 1) {
      const bit = getBit(bits, i);
      const a = this.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      this.setFunctionModule(a, b, bit);
      this.setFunctionModule(b, a, bit);
    }
  }

  drawFinderPattern(x, y) {
    for (let dy = -4; dy <= 4; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && xx < this.size && yy >= 0 && yy < this.size) {
          this.setFunctionModule(xx, yy, dist !== 2 && dist !== 4);
        }
      }
    }
  }

  drawAlignmentPattern(x, y) {
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        this.setFunctionModule(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }

  addEccAndInterleave(data) {
    const ver = this.version;
    const o = ECC_ORDINAL[this.ecl];
    const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[o][ver];
    const blockEccLen = ECC_CODEWORDS_PER_BLOCK[o][ver];
    const rawCodewords = Math.floor(numRawDataModules(ver) / 8);
    const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
    const shortBlockLen = Math.floor(rawCodewords / numBlocks);

    const blocks = [];
    const divisor = rsComputeDivisor(blockEccLen);
    for (let i = 0, k = 0; i < numBlocks; i += 1) {
      const dat = data.slice(k, k + shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1));
      k += dat.length;
      const ecc = rsComputeRemainder(dat, divisor);
      if (i < numShortBlocks) dat.push(0);
      blocks.push(dat.concat(ecc));
    }

    const result = [];
    for (let i = 0; i < blocks[0].length; i += 1) {
      blocks.forEach((block, j) => {
        if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) result.push(block[i]);
      });
    }
    return result;
  }

  drawCodewords(data) {
    let i = 0;
    for (let right = this.size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < this.size; vert += 1) {
        for (let j = 0; j < 2; j += 1) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? this.size - 1 - vert : vert;
          if (!this.isFunction[y][x] && i < data.length * 8) {
            this.modules[y][x] = getBit(data[i >>> 3], 7 - (i & 7));
            i += 1;
          }
        }
      }
    }
  }

  applyMask(mask) {
    for (let y = 0; y < this.size; y += 1) {
      for (let x = 0; x < this.size; x += 1) {
        let invert;
        switch (mask) {
          case 0: invert = (x + y) % 2 === 0; break;
          case 1: invert = y % 2 === 0; break;
          case 2: invert = x % 3 === 0; break;
          case 3: invert = (x + y) % 3 === 0; break;
          case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break;
          case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
          case 7: invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; break;
          default: throw new Error('Invalid mask');
        }
        if (!this.isFunction[y][x] && invert) this.modules[y][x] = !this.modules[y][x];
      }
    }
  }

  getPenaltyScore() {
    let result = 0;
    const size = this.size;
    const m = this.modules;

    for (let y = 0; y < size; y += 1) {
      let runColor = false;
      let runX = 0;
      const runHistory = [0, 0, 0, 0, 0, 0, 0];
      for (let x = 0; x < size; x += 1) {
        if (m[y][x] === runColor) {
          runX += 1;
          if (runX === 5) result += PENALTY_N1;
          else if (runX > 5) result += 1;
        } else {
          this.finderPenaltyAddHistory(runX, runHistory);
          if (!runColor) result += this.finderPenaltyCountPatterns(runHistory) * PENALTY_N3;
          runColor = m[y][x];
          runX = 1;
        }
      }
      result += this.finderPenaltyTerminateAndCount(runColor, runX, runHistory) * PENALTY_N3;
    }
    for (let x = 0; x < size; x += 1) {
      let runColor = false;
      let runY = 0;
      const runHistory = [0, 0, 0, 0, 0, 0, 0];
      for (let y = 0; y < size; y += 1) {
        if (m[y][x] === runColor) {
          runY += 1;
          if (runY === 5) result += PENALTY_N1;
          else if (runY > 5) result += 1;
        } else {
          this.finderPenaltyAddHistory(runY, runHistory);
          if (!runColor) result += this.finderPenaltyCountPatterns(runHistory) * PENALTY_N3;
          runColor = m[y][x];
          runY = 1;
        }
      }
      result += this.finderPenaltyTerminateAndCount(runColor, runY, runHistory) * PENALTY_N3;
    }

    for (let y = 0; y < size - 1; y += 1) {
      for (let x = 0; x < size - 1; x += 1) {
        const c = m[y][x];
        if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) result += PENALTY_N2;
      }
    }

    let dark = 0;
    for (const row of m) dark += row.reduce((n, v) => n + (v ? 1 : 0), 0);
    const total = size * size;
    const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
    result += k * PENALTY_N4;
    return result;
  }

  finderPenaltyCountPatterns(h) {
    const n = h[1];
    const core = n > 0 && h[2] === n && h[3] === n * 3 && h[4] === n && h[5] === n;
    return (core && h[0] >= n * 4 && h[6] >= n ? 1 : 0) + (core && h[6] >= n * 4 && h[0] >= n ? 1 : 0);
  }

  finderPenaltyTerminateAndCount(currentRunColor, currentRunLength, runHistory) {
    let len = currentRunLength;
    if (currentRunColor) {
      this.finderPenaltyAddHistory(len, runHistory);
      len = 0;
    }
    len += this.size;
    this.finderPenaltyAddHistory(len, runHistory);
    return this.finderPenaltyCountPatterns(runHistory);
  }

  finderPenaltyAddHistory(currentRunLength, runHistory) {
    let len = currentRunLength;
    if (runHistory[0] === 0) len += this.size; // light border
    runHistory.pop();
    runHistory.unshift(len);
  }
}

/**
 * Encode text (UTF-8, byte mode) as a QR symbol.
 * @param {string} text
 * @param {{ ecc?: EccLevel, boostEcc?: boolean, mask?: number }} [options]
 * @returns {{ version: number, size: number, ecc: EccLevel, mask: number, modules: boolean[][] }}
 * @throws {RangeError} when the text does not fit in version 40
 */
export function encodeQr(text, { ecc = 'M', boostEcc = true, mask = -1 } = {}) {
  const bytes = [...new TextEncoder().encode(text)];
  let version = 1;
  let dataUsedBits = 0;
  for (; ; version += 1) {
    if (version > 40) throw new RangeError('Text is too long for a QR code (max ≈2.9 KB at level L).');
    const ccBits = version <= 9 ? 8 : 16;
    if (bytes.length < 1 << ccBits) {
      dataUsedBits = 4 + ccBits + bytes.length * 8;
      if (dataUsedBits <= numDataCodewords(version, ecc) * 8) break;
    }
  }
  let level = ecc;
  if (boostEcc) {
    for (const higher of /** @type {EccLevel[]} */ (['M', 'Q', 'H'])) {
      if (ECC_ORDINAL[higher] > ECC_ORDINAL[level] && dataUsedBits <= numDataCodewords(version, higher) * 8) {
        level = higher;
      }
    }
  }

  /** @type {number[]} */
  const bits = [];
  const append = (val, len) => {
    for (let i = len - 1; i >= 0; i -= 1) bits.push((val >>> i) & 1);
  };
  append(0x4, 4); // byte mode
  append(bytes.length, version <= 9 ? 8 : 16);
  for (const b of bytes) append(b, 8);

  const capacityBits = numDataCodewords(version, level) * 8;
  append(0, Math.min(4, capacityBits - bits.length));
  append(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacityBits; pad ^= 0xec ^ 0x11) append(pad, 8);

  const dataCodewords = new Array(bits.length / 8).fill(0);
  bits.forEach((b, i) => {
    dataCodewords[i >>> 3] |= b << (7 - (i & 7));
  });

  const symbol = new QrSymbol(version, level, dataCodewords, mask);
  return { version, size: symbol.size, ecc: level, mask: symbol.mask, modules: symbol.modules };
}

/**
 * Render a symbol as an SVG path "d" string (one unit per module, offset by `border`).
 * @param {boolean[][]} modules
 * @param {number} border quiet-zone modules (spec requires 4)
 */
export function qrToSvgPath(modules, border = 4) {
  const parts = [];
  modules.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) parts.push(`M${x + border},${y + border}h1v1h-1z`);
    });
  });
  return parts.join('');
}
