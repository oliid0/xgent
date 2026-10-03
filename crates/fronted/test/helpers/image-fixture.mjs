import { deflateSync, inflateSync } from "node:zlib";

function chunk(type, data) {
  const payload = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const value of payload) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  const head = Buffer.alloc(4), tail = Buffer.alloc(4);
  head.writeUInt32BE(data.length); tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([head, payload, tail]);
}
export function imageFixture() {
  const header = Buffer.alloc(13); header.writeUInt32BE(2); header.writeUInt32BE(3, 4); header[8] = 8; header[9] = 6;
  const pixels = [
    [255, 0, 0, 255], [0, 255, 0, 255],
    [0, 0, 255, 255], [255, 255, 0, 255],
    [255, 0, 255, 255], [0, 255, 255, 255],
  ];
  const rows = Buffer.from([0, ...pixels[0], ...pixels[1], 0, ...pixels[2], ...pixels[3], 0, ...pixels[4], ...pixels[5]]);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}
/** Decode actual PNG bytes independently of the production rotation implementation. */
export function pngPixels(bytes) {
  const buffer = Buffer.from(bytes), chunks = [];
  let width, height, channels;
  for (let offset = 8; offset < buffer.length;) {
    const length = buffer.readUInt32BE(offset), type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") { width = data.readUInt32BE(0); height = data.readUInt32BE(4); channels = data[9] === 6 ? 4 : data[9] === 2 ? 3 : 0; if (data[8] !== 8 || !channels) throw new Error("Unsupported test PNG"); }
    if (type === "IDAT") chunks.push(data);
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks)), stride = width * channels, rows = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(stride), start = y * (stride + 1), filter = raw[start];
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? row[x - channels] : 0, b = rows[y - 1]?.[x] ?? 0, c = x >= channels ? rows[y - 1]?.[x - channels] ?? 0 : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const predictor = filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a + b) / 2) : filter === 4 ? pa <= pb && pa <= pc ? a : pb <= pc ? b : c : NaN;
      if (!Number.isFinite(predictor)) throw new Error("Unsupported PNG filter");
      row[x] = (raw[start + 1 + x] + predictor) & 255;
    }
    rows.push(row);
  }
  return { width, height, pixels: rows.flatMap(row => Array.from({ length: width }, (_, x) => [...row.subarray(x * channels, (x + 1) * channels), ...(channels === 3 ? [255] : [])])) };
}
