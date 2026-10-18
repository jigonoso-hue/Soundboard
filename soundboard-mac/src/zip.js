// A small zip reader and writer for shared libraries (library-share.js).
// Files that are already compressed (mp3, m4a, ogg, jpg, …) are stored as
// they are; the rest (the list of sounds, wav and aiff audio) are deflated
// when that makes them smaller. No zip64: a library file stays under 4 GB.
// The iPhone/iPad app (Model/LibraryShare.swift) and the Android app
// (core/…/bridge/LibraryZip.kt) read and write the same files.
const fs = require('fs');
const zlib = require('zlib');

const MAX_SIZE = 0xffffffff;
// Deflate these kinds of file; the rest are compressed already.
const DEFLATE = /\.(json|wav|aif|aiff|caf)$/i;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data) {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// DOS date and time, as zip headers keep them.
function dosTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((Math.max(1980, date.getFullYear()) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

// Writes a zip to `outPath`. entries: [{ name, data: Buffer } | { name, path }],
// read and written one at a time.
function writeZip(outPath, entries) {
  const fd = fs.openSync(outPath, 'w');
  const central = [];
  let offset = 0;
  const { time, day } = dosTime(new Date());
  const write = (buf) => { fs.writeSync(fd, buf); offset += buf.length; };
  try {
    for (const entry of entries) {
      const raw = entry.data ? Buffer.from(entry.data) : fs.readFileSync(entry.path);
      let body = raw;
      let method = 0;
      if (DEFLATE.test(entry.name)) {
        const packed = zlib.deflateRawSync(raw, { level: 9 });
        if (packed.length < raw.length) { body = packed; method = 8; }
      }
      const name = Buffer.from(entry.name, 'utf8');
      const crc = crc32(raw);
      if (offset + 30 + name.length + body.length > MAX_SIZE) throw new Error('The library is too big to share as one file (over 4 GB).');
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4); // version needed
      local.writeUInt16LE(0x0800, 6); // UTF-8 names
      local.writeUInt16LE(method, 8);
      local.writeUInt16LE(time, 10);
      local.writeUInt16LE(day, 12);
      local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(body.length, 18);
      local.writeUInt32LE(raw.length, 22);
      local.writeUInt16LE(name.length, 26);
      local.writeUInt16LE(0, 28);
      central.push({ name, method, crc, compressed: body.length, size: raw.length, offset });
      write(local);
      write(name);
      write(body);
    }
    const start = offset;
    for (const e of central) {
      const head = Buffer.alloc(46);
      head.writeUInt32LE(0x02014b50, 0);
      head.writeUInt16LE(20, 4); // made by
      head.writeUInt16LE(20, 6); // needed
      head.writeUInt16LE(0x0800, 8);
      head.writeUInt16LE(e.method, 10);
      head.writeUInt16LE(time, 12);
      head.writeUInt16LE(day, 14);
      head.writeUInt32LE(e.crc, 16);
      head.writeUInt32LE(e.compressed, 20);
      head.writeUInt32LE(e.size, 24);
      head.writeUInt16LE(e.name.length, 28);
      head.writeUInt32LE(e.offset, 42);
      write(head);
      write(e.name);
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(central.length, 8);
    end.writeUInt16LE(central.length, 10);
    end.writeUInt32LE(offset - start, 12);
    end.writeUInt32LE(start, 16);
    write(end);
  } finally {
    fs.closeSync(fd);
  }
}

// Opens a zip for reading. Returns { names, size(name), read(name) → Buffer, close() }.
// Only stored and deflated entries are read; `maxEntry` caps one entry's size.
function openZip(zipPath, { maxEntry = 2 * 1024 * 1024 * 1024 } = {}) {
  const fd = fs.openSync(zipPath, 'r');
  const readAt = (pos, length) => {
    const buf = Buffer.alloc(length);
    const got = fs.readSync(fd, buf, 0, length, pos);
    if (got !== length) throw new Error('That file is cut short.');
    return buf;
  };
  try {
    const total = fs.fstatSync(fd).size;
    // The end record is in the last 22 bytes plus up to 64 KB of comment.
    const tailLength = Math.min(total, 22 + 0xffff);
    const tail = readAt(total - tailLength, tailLength);
    let at = -1;
    for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { at = i; break; }
    if (at < 0) throw new Error('That isn’t a zip file.');
    const count = tail.readUInt16LE(at + 10);
    const dirSize = tail.readUInt32LE(at + 12);
    const dirStart = tail.readUInt32LE(at + 16);
    if (dirStart + dirSize > total) throw new Error('That zip file is damaged.');
    const dir = readAt(dirStart, dirSize);
    const entries = new Map();
    let p = 0;
    for (let i = 0; i < count; i++) {
      if (p + 46 > dir.length || dir.readUInt32LE(p) !== 0x02014b50) throw new Error('That zip file is damaged.');
      const method = dir.readUInt16LE(p + 10);
      const crc = dir.readUInt32LE(p + 16);
      const compressed = dir.readUInt32LE(p + 20);
      const size = dir.readUInt32LE(p + 24);
      const nameLength = dir.readUInt16LE(p + 28);
      const extraLength = dir.readUInt16LE(p + 30);
      const commentLength = dir.readUInt16LE(p + 32);
      const offset = dir.readUInt32LE(p + 42);
      const name = dir.subarray(p + 46, p + 46 + nameLength).toString('utf8');
      entries.set(name, { method, crc, compressed, size, offset });
      p += 46 + nameLength + extraLength + commentLength;
    }
    return {
      names: [...entries.keys()],
      size: (name) => (entries.has(name) ? entries.get(name).size : null),
      read(name) {
        const e = entries.get(name);
        if (!e) return null;
        if (e.size > maxEntry || e.compressed > maxEntry) throw new Error('A file in that library is too big.');
        const local = readAt(e.offset, 30);
        if (local.readUInt32LE(0) !== 0x04034b50) throw new Error('That zip file is damaged.');
        const start = e.offset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
        const body = readAt(start, e.compressed);
        let data;
        if (e.method === 0) data = body;
        else if (e.method === 8) data = zlib.inflateRawSync(body, { maxOutputLength: Math.max(1, e.size) });
        else throw new Error('That zip uses a kind of compression Dungeon Radio can’t read.');
        if (data.length !== e.size || crc32(data) !== e.crc) throw new Error('That zip file is damaged.');
        return data;
      },
      close: () => fs.closeSync(fd),
    };
  } catch (err) {
    fs.closeSync(fd);
    throw err;
  }
}

module.exports = { writeZip, openZip, crc32 };
