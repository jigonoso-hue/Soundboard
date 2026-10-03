// Small audio helpers shared by the renderer (and unit tests in Node).
(function (root) {
  // Encodes Float32Array channel data as a 16-bit PCM WAV file.
  function encodeWav(channels, sampleRate) {
    const numChannels = channels.length;
    const length = channels[0].length;
    const bytesPerSample = 2;
    const dataSize = length * numChannels * bytesPerSample;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    const writeString = (offset, str) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
    view.setUint16(32, numChannels * bytesPerSample, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);

    let offset = 44;
    for (let i = 0; i < length; i++) {
      for (let c = 0; c < numChannels; c++) {
        const s = Math.max(-1, Math.min(1, channels[c][i]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        offset += 2;
      }
    }
    return buffer;
  }

  // Cuts [start, end) seconds out of channel data and applies short fades
  // so the clip doesn't click when it starts or stops.
  function trimChannels(channels, sampleRate, start, end, fadeSeconds = 0.008) {
    const total = channels[0].length;
    const from = Math.max(0, Math.min(total, Math.round(start * sampleRate)));
    const to = Math.max(from, Math.min(total, Math.round(end * sampleRate)));
    const fade = Math.min(Math.round(fadeSeconds * sampleRate), Math.floor((to - from) / 2));
    return channels.map((data) => {
      const out = data.slice(from, to);
      for (let i = 0; i < fade; i++) {
        const g = i / fade;
        out[i] *= g;
        out[out.length - 1 - i] *= g;
      }
      return out;
    });
  }

  // "1:23.4" / "83.4" / "1:02:03" -> seconds. Returns NaN when unparseable.
  function parseTime(text) {
    const parts = String(text).trim().split(':');
    if (!parts.length || parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return NaN;
    return parts.reduce((acc, p) => acc * 60 + Number(p), 0);
  }

  function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = (seconds % 60).toFixed(1).padStart(4, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
  }

  const api = { encodeWav, trimChannels, parseTime, formatTime };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AudioUtils = api;
})(this);
