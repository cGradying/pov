// pov: a personal viewing shelf.
// Zero-dependency Node server: YouTube links (metadata only, never downloaded)
// plus videos already on this computer (streamed in place, never copied).
// Run: node server.js  ->  http://localhost:3000

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA_FILE = path.join(ROOT, 'data', 'shelves.json');
const THUMBS = path.join(ROOT, 'cache', 'thumbs');
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));

const VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v', '.webm']);
const SKIP_DIRS = new Set(['Library', 'node_modules', 'Applications', 'cache']);
const MAX_DEPTH = 4;
const MAX_FILES = 300; // ponytail: hard cap on scan size, add paging if someone keeps thousands of clips
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
};

// ---------- small pure helpers (tested in test.js) ----------

// Pull the 11-char video id out of any common YouTube URL shape.
function ytId(url) {
  const m = String(url).match(/(?:youtu\.be\/|[?&]v=|\/(?:embed|shorts|live)\/)([\w-]{11})/);
  return m ? m[1] : null;
}

// "bytes=0-99" -> {start:0,end:99}. Returns null when the header is unusable.
function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header || '');
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start, end;
  if (m[1] === '') { // suffix range: last N bytes
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  return start <= end && start < size ? { start, end } : null;
}

const expandHome = (p) => (p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p);
const shortId = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);
const run = (cmd, args, timeout = 30000) => new Promise((resolve, reject) =>
  execFile(cmd, args, { timeout, maxBuffer: 64 * 1024 * 1024 }, (err, out) => (err ? reject(err) : resolve(out))));

// ---------- YouTube shelves (data/shelves.json) ----------

function loadShelves() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { return []; }
}
function saveShelves(shelves) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(shelves, null, 2));
}

function ytCard(e) {
  const d = e.upload_date; // YYYYMMDD
  return {
    id: e.id,
    title: e.title || 'Untitled video',
    channel: e.channel || e.uploader || e.playlist_uploader || '',
    duration: e.duration || null,
    views: e.view_count ?? null,
    uploaded: d ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : (e.timestamp ? new Date(e.timestamp * 1000).toISOString().slice(0, 10) : null),
    addedAt: new Date().toISOString(),
  };
}

// #region youtube
// Metadata only: yt-dlp -J never downloads media. Falls back to YouTube oEmbed.
async function fetchYouTube(url) {
  try {
    const info = JSON.parse(await run('yt-dlp', ['-J', '--flat-playlist', '--skip-download', '--no-warnings', url], 60000));
    const entries = info.entries ? info.entries.filter((e) => e && e.id && e.id.length === 11) : [info];
    return entries.map((e) => ytCard({ ...e, channel: e.channel || info.channel || info.uploader }));
  } catch {
    const id = ytId(url);
    if (!id) throw new Error('That does not look like a YouTube video link.');
    const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent('https://www.youtube.com/watch?v=' + id)}`);
    if (!res.ok) throw new Error('YouTube did not recognise that video. Is it private or deleted?');
    const o = await res.json();
    return [ytCard({ id, title: o.title, channel: o.author_name })];
  }
}
// #endregion

// ---------- local videos ----------

let localIndex = null; // Map id -> {id, file, title, folder, size, mtime, duration}

async function walk(dir, depth, out) {
  if (depth > MAX_DEPTH || out.length >= MAX_FILES) return;
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const ent of entries) {
    if (ent.name.startsWith('.') || out.length >= MAX_FILES) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (!SKIP_DIRS.has(ent.name) && !full.startsWith(ROOT)) await walk(full, depth + 1, out);
    } else if (VIDEO_EXT.has(path.extname(ent.name).toLowerCase())) {
      out.push(full);
    }
  }
}

async function probeDuration(file) {
  try {
    const out = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], 15000);
    return Math.round(Number(out)) || null;
  } catch { return null; }
}

// #region local
// Walks the folders from config.json and remembers every video it finds (id -> file).
async function scanLocal() {
  const files = [];
  for (const f of config.folders) await walk(expandHome(f), 0, files);
  const index = new Map();
  // probe 8 at a time so a big folder does not spawn hundreds of ffprobe processes
  for (let i = 0; i < files.length; i += 8) {
    await Promise.all(files.slice(i, i + 8).map(async (file) => {
      let st;
      try { st = await fsp.stat(file); } catch { return; }
      const id = shortId(file + st.mtimeMs);
      index.set(id, {
        id, file,
        title: path.basename(file, path.extname(file)).replace(/[_]+/g, ' '),
        folder: path.dirname(file).replace(os.homedir(), '~'),
        ext: path.extname(file).slice(1).toLowerCase(),
        size: st.size, mtime: st.mtime.toISOString(),
        duration: await probeDuration(file),
      });
    }));
  }
  localIndex = index;
  return index;
}
// #endregion

function publicLocal(v) {
  const { file, ...rest } = v; // never send absolute paths to the browser
  return rest;
}

async function thumbFor(v) {
  const out = path.join(THUMBS, v.id + '.jpg');
  if (fs.existsSync(out)) return out;
  fs.mkdirSync(THUMBS, { recursive: true });
  const at = v.duration && v.duration > 6 ? '3' : '0';
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-ss', at, '-i', v.file, '-frames:v', '1', '-vf', 'scale=640:-2', out], 20000);
  return out;
}

// ---------- HTTP plumbing ----------

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('Bad JSON')); } });
    req.on('error', reject);
  });
}

// #region media
// Sends a video in pieces (HTTP Range) so the player can seek without loading the whole file.
function streamFile(req, res, file, size) {
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  if (!req.headers.range) {
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes' });
    return fs.createReadStream(file).pipe(res);
  }
  const r = parseRange(req.headers.range, size);
  if (!r) {
    res.writeHead(416, { 'Content-Range': `bytes */${size}` });
    return res.end();
  }
  res.writeHead(206, {
    'Content-Type': type, 'Accept-Ranges': 'bytes',
    'Content-Range': `bytes ${r.start}-${r.end}/${size}`, 'Content-Length': r.end - r.start + 1,
  });
  fs.createReadStream(file, { start: r.start, end: r.end }).pipe(res);
}
// #endregion

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean);
  const method = req.method;

  // #region shelves
  // --- YouTube shelves: stored in data/shelves.json ---
  if (url.pathname === '/api/shelves' && method === 'GET') return send(res, 200, loadShelves());

  if (url.pathname === '/api/shelves' && method === 'POST') {
    const { title, subtitle } = await readJson(req);
    if (!title || !String(title).trim()) return send(res, 400, { error: 'Give the shelf a name.' });
    const shelves = loadShelves();
    const shelf = { id: shortId(title + Date.now()), title: String(title).trim().slice(0, 80), subtitle: String(subtitle || '').trim().slice(0, 140), videos: [] };
    shelves.push(shelf);
    saveShelves(shelves);
    return send(res, 201, shelf);
  }
  // #endregion

  if (parts[0] === 'api' && parts[1] === 'shelves' && parts[2]) {
    const shelves = loadShelves();
    const shelf = shelves.find((s) => s.id === parts[2]);
    if (!shelf) return send(res, 404, { error: 'Shelf not found.' });

    if (parts.length === 3 && method === 'DELETE') {
      saveShelves(shelves.filter((s) => s !== shelf));
      return send(res, 200, { ok: true });
    }
    if (parts[3] === 'youtube' && method === 'POST') {
      const { url: link } = await readJson(req);
      if (!link || !/youtu\.?be/.test(link)) return send(res, 400, { error: 'Paste a youtube.com or youtu.be link.' });
      let cards;
      try { cards = await fetchYouTube(link); } catch (e) { return send(res, 422, { error: e.message }); }
      const known = new Set(shelf.videos.map((v) => v.id));
      const fresh = cards.filter((c) => !known.has(c.id));
      shelf.videos.unshift(...fresh);
      saveShelves(shelves);
      return send(res, 200, { added: fresh.length, skipped: cards.length - fresh.length, shelf });
    }
    if (parts[3] === 'videos' && parts[4] && method === 'DELETE') {
      shelf.videos = shelf.videos.filter((v) => v.id !== parts[4]);
      saveShelves(shelves);
      return send(res, 200, shelf);
    }
  }

  // --- local videos ---
  if (url.pathname === '/api/local' && method === 'GET') {
    if (!localIndex || url.searchParams.has('rescan')) await scanLocal();
    const list = [...localIndex.values()].map(publicLocal);
    if (url.searchParams.has('shuffle')) {
      for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
    } else {
      list.sort((a, b) => b.mtime.localeCompare(a.mtime));
    }
    return send(res, 200, { folders: config.folders, videos: list });
  }

  // Only ids produced by the scan are served, so the browser can never ask for an arbitrary path.
  if ((parts[0] === 'media' || parts[0] === 'thumb') && parts[1] && method === 'GET') {
    if (!localIndex) await scanLocal();
    const v = localIndex.get(parts[1]);
    if (!v) return send(res, 404, { error: 'Unknown video.' });
    if (parts[0] === 'thumb') {
      try {
        const file = await thumbFor(v);
        return send(res, 200, await fsp.readFile(file), 'image/jpeg');
      } catch { return send(res, 404, { error: 'No thumbnail.' }); }
    }
    let st;
    try { st = await fsp.stat(v.file); } catch { return send(res, 410, { error: 'File moved or deleted. Rescan.' }); }
    return streamFile(req, res, v.file, st.size);
  }

  // The Inspector shows this file's code; only this one file is exposed, nothing else outside public/.
  if (url.pathname === '/source/server.js' && method === 'GET') {
    return send(res, 200, await fsp.readFile(__filename, 'utf8'), 'text/plain; charset=utf-8');
  }

  // --- static frontend ---
  if (method !== 'GET') return send(res, 405, { error: 'Method not allowed.' });
  const file = path.join(PUBLIC, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));
  if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, 'Forbidden', 'text/plain');
  try {
    const body = await fsp.readFile(file);
    return send(res, 200, body, MIME[path.extname(file)] || 'application/octet-stream');
  } catch { return send(res, 404, 'Not found', 'text/plain'); }
}

if (require.main === module) {
  const port = Number(process.env.PORT) || config.port || 3000;
  http.createServer((req, res) => handle(req, res).catch((e) => {
    console.error(e);
    if (!res.headersSent) send(res, 500, { error: 'Something broke on the server.' });
  })).listen(port, '127.0.0.1', () => {
    console.log(`pov is playing at http://localhost:${port}`);
    console.log(`scanning: ${config.folders.join(', ')}`);
  });
}

module.exports = { ytId, parseRange, ytCard };
