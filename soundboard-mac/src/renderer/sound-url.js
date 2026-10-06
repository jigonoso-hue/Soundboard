// Where the window loads a sound file from. The Mac serves them over
// sound://local/<file> (the library), sound://builtin/<file> (ambience loops)
// and sound://live/<file> (Live Session files); the Android app, which runs
// these same screens, gives its own address through window.soundboard.soundUrl.
function soundFileUrl(host, file) {
  if (window.soundboard && window.soundboard.soundUrl) return window.soundboard.soundUrl(host, file);
  return `sound://${host}/${encodeURIComponent(file)}`;
}
