// Existing fixed-size encoding and non-ASCII handling are preserved verbatim.

function initQrTables(): { exp: number[]; log: number[] } {
  const exp = Array<number>(512).fill(0);
  const log = Array<number>(256).fill(0);
  let value = 1;
  for (let index = 0; index < 255; index++) {
    exp[index] = value;
    log[value] = index;
    value <<= 1;
    if (value & 0x100) value ^= 0x11d;
  }
  for (let index = 255; index < 512; index++) exp[index] = exp[index - 255];
  return { exp, log };
}

const QR_TABLES = initQrTables();

function qrMultiply(left: number, right: number): number {
  if (left === 0 || right === 0) return 0;
  return QR_TABLES.exp[QR_TABLES.log[left] + QR_TABLES.log[right]];
}

function qrGeneratorPolynomial(degree: number): number[] {
  let poly = [1];
  for (let index = 0; index < degree; index++) {
    const next = Array<number>(poly.length + 1).fill(0);
    for (let polyIndex = 0; polyIndex < poly.length; polyIndex++) {
      next[polyIndex] ^= poly[polyIndex];
      next[polyIndex + 1] ^= qrMultiply(poly[polyIndex], QR_TABLES.exp[index]);
    }
    poly = next;
  }
  return poly;
}

function qrEncodeBytes(value: string): number[] {
  const bytes = Array.from(value.trim().toUpperCase()).map((char) => char.charCodeAt(0) & 0xff);
  const bits: number[] = [];
  const pushBits = (data: number, length: number) => {
    for (let bit = length - 1; bit >= 0; bit--) bits.push((data >> bit) & 1);
  };

  pushBits(0b0100, 4);
  pushBits(bytes.length, 8);
  bytes.forEach((byte) => pushBits(byte, 8));

  const capacityBits = 19 * 8;
  const terminatorLength = Math.min(4, capacityBits - bits.length);
  for (let index = 0; index < terminatorLength; index++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const dataCodewords: number[] = [];
  for (let index = 0; index < bits.length; index += 8) {
    dataCodewords.push(bits.slice(index, index + 8).reduce((sum, bit) => (sum << 1) | bit, 0));
  }
  const pads = [0xec, 0x11];
  let padIndex = 0;
  while (dataCodewords.length < 19) {
    dataCodewords.push(pads[padIndex % pads.length]);
    padIndex++;
  }

  const generator = qrGeneratorPolynomial(7);
  const ecc = Array<number>(7).fill(0);
  dataCodewords.forEach((codeword) => {
    const factor = codeword ^ ecc[0];
    ecc.shift();
    ecc.push(0);
    for (let index = 0; index < ecc.length; index++) {
      ecc[index] ^= qrMultiply(generator[index + 1], factor);
    }
  });

  return [...dataCodewords, ...ecc];
}

export function createQrMatrix(value: string): boolean[][] {
  const size = 21;
  const matrix = Array.from({ length: size }, () => Array<boolean | null>(size).fill(null));
  const reserved = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
  const setModule = (x: number, y: number, dark: boolean, reserve = true) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    matrix[y][x] = dark;
    if (reserve) reserved[y][x] = true;
  };
  const drawFinder = (x: number, y: number) => {
    for (let dy = -1; dy <= 7; dy++) {
      for (let dx = -1; dx <= 7; dx++) {
        const xx = x + dx;
        const yy = y + dy;
        const inPattern = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6;
        const dark =
          inPattern &&
          (dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4));
        setModule(xx, yy, dark);
      }
    }
  };

  drawFinder(0, 0);
  drawFinder(size - 7, 0);
  drawFinder(0, size - 7);
  for (let index = 8; index < size - 8; index++) {
    setModule(index, 6, index % 2 === 0);
    setModule(6, index, index % 2 === 0);
  }
  setModule(8, 13, true);

  const formatBits = "111011111000100";
  const formatCoords1 = [
    [8, 0],
    [8, 1],
    [8, 2],
    [8, 3],
    [8, 4],
    [8, 5],
    [8, 7],
    [8, 8],
    [7, 8],
    [5, 8],
    [4, 8],
    [3, 8],
    [2, 8],
    [1, 8],
    [0, 8],
  ];
  const formatCoords2 = [
    [8, 20],
    [8, 19],
    [8, 18],
    [8, 17],
    [8, 16],
    [8, 15],
    [8, 14],
    [13, 8],
    [14, 8],
    [15, 8],
    [16, 8],
    [17, 8],
    [18, 8],
    [19, 8],
    [20, 8],
  ];
  [...formatCoords1, ...formatCoords2].forEach(([x, y]) => {
    reserved[y][x] = true;
  });

  const codewords = qrEncodeBytes(value || "-");
  const dataBits = codewords.flatMap((codeword) =>
    Array.from({ length: 8 }, (_, index) => (codeword >> (7 - index)) & 1),
  );
  let bitIndex = 0;
  let upward = true;
  for (let x = size - 1; x > 0; x -= 2) {
    if (x === 6) x--;
    for (let row = 0; row < size; row++) {
      const y = upward ? size - 1 - row : row;
      for (let dx = 0; dx < 2; dx++) {
        const xx = x - dx;
        if (reserved[y][xx]) continue;
        const rawBit = bitIndex < dataBits.length ? dataBits[bitIndex] === 1 : false;
        bitIndex++;
        setModule(xx, y, rawBit !== ((xx + y) % 2 === 0), false);
      }
    }
    upward = !upward;
  }

  formatCoords1.forEach(([x, y], index) => setModule(x, y, formatBits[index] === "1"));
  formatCoords2.forEach(([x, y], index) => setModule(x, y, formatBits[index] === "1"));

  return matrix.map((row) => row.map(Boolean));
}

export const QR_QUIET_ZONE = 2;

/**
 * 暗モジュールを1本のパスにまとめる。
 * モジュールごとに<rect>を出すとQR1枚で約200要素になり、ラベル印刷のように数百枚を
 * 並べる画面でブラウザが固まる（2026-08-15 本番で実測）。見た目は変えない。
 */
export function buildQrPath(matrix: boolean[][]): string {
  let path = "";
  for (let y = 0; y < matrix.length; y += 1) {
    const row = matrix[y];
    for (let x = 0; x < row.length; x += 1) {
      if (row[x]) path += `M${x + QR_QUIET_ZONE} ${y + QR_QUIET_ZONE}h1v1h-1z`;
    }
  }
  return path;
}
