const test = require('node:test');
const assert = require('node:assert');
const { encodeWav, trimChannels, parseTime, formatTime } = require('../src/renderer/audio-utils');

test('parseTime / formatTime', () => {
  assert.equal(parseTime('1:23.5'), 83.5);
  assert.equal(parseTime('83.5'), 83.5);
  assert.equal(parseTime('1:02:03'), 3723);
  assert.ok(Number.isNaN(parseTime('abc')));
  assert.ok(Number.isNaN(parseTime('')));
  assert.equal(formatTime(83.5), '1:23.5');
  assert.equal(formatTime(3723), '1:02:03.0');
  assert.equal(parseTime(formatTime(61.2)), 61.2);
});

test('trimChannels cuts the right samples with fades', () => {
  const data = new Float32Array(1000).fill(1);
  const [out] = trimChannels([data], 100, 2, 5, 0.05);
  assert.equal(out.length, 300);
  assert.equal(out[0], 0);
  assert.equal(out[150], 1);
  const [clamped] = trimChannels([data], 100, 8, 50);
  assert.equal(clamped.length, 200);
});

test('encodeWav writes a valid header', () => {
  const buf = encodeWav([new Float32Array([0, 1, -1]), new Float32Array([0, 0.5, -0.5])], 48000);
  const v = new DataView(buf);
  const str = (o, n) => String.fromCharCode(...new Uint8Array(buf, o, n));
  assert.equal(str(0, 4), 'RIFF');
  assert.equal(str(8, 4), 'WAVE');
  assert.equal(v.getUint16(22, true), 2);
  assert.equal(v.getUint32(24, true), 48000);
  assert.equal(v.getUint32(40, true), 12);
  assert.equal(buf.byteLength, 56);
  assert.equal(v.getInt16(48, true), 32767);
  assert.equal(v.getInt16(52, true), -32768);
});
