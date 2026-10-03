// Downloads the full audio of a YouTube video with yt-dlp.
// The app never downloads or installs yt-dlp itself: it uses a copy the user
// installed (e.g. "brew install yt-dlp") and explains how when it's missing.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SEARCH_DIRS = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'];
const INSTALL_HELP = 'Saving full audio needs the free tool yt-dlp. Install it with Homebrew by running "brew install yt-dlp" in Terminal, then try again.';

class YtDlp {
  constructor() {
    this.active = new Map(); // job id -> child process
  }

  // Finds an installed yt-dlp (Homebrew, MacPorts/pipx locations or PATH).
  binary() {
    const dirs = [...SEARCH_DIRS, path.join(os.homedir(), '.local', 'bin'), ...(process.env.PATH || '').split(path.delimiter)];
    const name = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
    const found = dirs.filter(Boolean).map((d) => path.join(d, name)).find(isExecutable);
    if (!found) throw new Error(INSTALL_HELP);
    return found;
  }

  // Resolves to { file, title } in a temp folder. The caller moves/deletes the file.
  async download(jobId, url, onProgress) {
    const bin = this.binary();
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soundboard-'));
    const args = [
      url,
      '--no-playlist',
      '--no-warnings',
      '--newline',
      '-f', 'bestaudio[ext=m4a]/bestaudio/best',
      '-o', path.join(outDir, '%(id)s.%(ext)s'),
      '--progress-template', 'download:SBPROGRESS %(progress._percent_str)s',
      '--print', 'before_dl:SBTITLE %(title)s',
      '--print', 'after_move:SBFILE %(filepath)s',
      '--no-simulate',
    ];
    // Let yt-dlp find Homebrew tools (deno, ffmpeg) when launched from Finder.
    const env = { ...process.env, PATH: ['/opt/homebrew/bin', '/usr/local/bin', process.env.PATH || ''].join(path.delimiter) };

    onProgress({ message: 'Starting download…', percent: 0 });
    return new Promise((resolve, reject) => {
      const child = spawn(bin, args, { env });
      this.active.set(jobId, child);
      let title = '';
      let file = '';
      let stderr = '';
      let buffered = '';

      child.stdout.on('data', (chunk) => {
        buffered += chunk.toString();
        const lines = buffered.split(/\r?\n/);
        buffered = lines.pop();
        for (const line of lines) {
          if (line.startsWith('SBTITLE ')) title = line.slice(8).trim();
          else if (line.startsWith('SBFILE ')) file = line.slice(7).trim();
          else if (line.startsWith('SBPROGRESS ')) {
            const percent = parseFloat(line.slice(11));
            if (Number.isFinite(percent)) onProgress({ message: 'Downloading…', percent });
          }
        }
      });
      child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-4000); });
      child.on('error', (err) => {
        this.active.delete(jobId);
        reject(new Error(`Couldn't run yt-dlp: ${err.message}`));
      });
      child.on('close', (code, signal) => {
        this.active.delete(jobId);
        if (signal) return reject(new Error('Download cancelled.'));
        if (code !== 0 || !file || !fs.existsSync(file)) {
          return reject(new Error(friendlyError(stderr) || `yt-dlp failed (exit code ${code}).`));
        }
        resolve({ file, title, cleanup: () => fs.rmSync(outDir, { recursive: true, force: true }) });
      });
    });
  }

  cancel(jobId) {
    const child = this.active.get(jobId);
    if (child) child.kill('SIGTERM');
  }
}

function isExecutable(p) {
  try {
    fs.accessSync(p, fs.constants.X_OK);
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function friendlyError(stderr) {
  const lines = stderr.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const error = lines.reverse().find((l) => l.startsWith('ERROR:'));
  if (!error) return lines[0] || '';
  const message = error.replace(/^ERROR:\s*(\[[^\]]+\]\s*)?([\w-]+:\s*)?/, '');
  if (/Sign in to confirm/i.test(message)) return 'YouTube asked to confirm you\'re not a bot. Try again later.';
  if (/Private video|members-only|Join this channel/i.test(message)) return 'That video is private or members-only.';
  if (/Unsupported URL/i.test(message)) return 'Open a YouTube video page first.';
  return message;
}

module.exports = { YtDlp, friendlyError, INSTALL_HELP };
