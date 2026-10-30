// pov frontend: renders shelves, adds YouTube links, plays videos.
const $ = (sel) => document.querySelector(sel);

let shelves = [];
let localVideos = [];
let justAdded = new Set();

// ---------- formatting ----------

function fmtDuration(sec) {
  if (!sec) return '';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function compact(n) {
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

function timeAgo(iso) {
  if (!iso) return '';
  const secs = (Date.now() - new Date(iso).getTime()) / 1000;
  const units = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [name, size] of units) {
    const n = Math.floor(secs / size);
    if (n >= 1) return `${n} ${name}${n > 1 ? 's' : ''} ago`;
  }
  return 'just now';
}

function fmtSize(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
  return `${bytes.toFixed(i > 1 ? 1 : 0)} ${units[i]}`;
}

// Tiny element builder. Text always goes through textContent, so titles can't inject HTML.
function el(tag, props = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  node.append(...kids.filter(Boolean));
  return node;
}
function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function setStatus(msg, isError = false) {
  const s = $('#status');
  s.textContent = msg;
  s.classList.toggle('is-error', isError);
}

// ---------- cards ----------

function genericThumb() {
  return el('div', { class: 'generic', 'aria-hidden': 'true' }, icon('play'));
}

// #region card
// Builds one video card. Same function for YouTube and local videos; `kind` picks the details.
function card(video, { kind, shelfId, index }) {
  const isYt = kind === 'yt';
  const thumbImg = el('img', {
    src: isYt ? `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg` : `/thumb/${video.id}`,
    alt: '', loading: 'lazy', decoding: 'async',
  });
  thumbImg.addEventListener('error', () => { thumbImg.replaceWith(genericThumb()); thumb.style.removeProperty('--thumb'); }, { once: true });

  const thumb = el('div', { class: 'card__thumb' },
    thumbImg,
    !isYt && el('span', { class: 'badge badge--ext', text: video.ext }),
    video.duration && el('span', { class: 'badge', text: fmtDuration(video.duration) }),
    el('span', { class: 'card__play', 'aria-hidden': 'true' }, el('span', {}, icon('play'))),
  );
  thumb.style.setProperty('--thumb', `url("${thumbImg.src}")`); // the glitch layers reuse the thumbnail

  const meta = isYt
    ? [video.views != null && `${compact(video.views)} views`, timeAgo(video.uploaded) || (video.addedAt && `added ${timeAgo(video.addedAt)}`)]
    : [fmtSize(video.size), timeAgo(video.mtime)];

  const more = el('button', {
    class: 'card__more', type: 'button', 'aria-label': `More options for ${video.title}`,
    'aria-haspopup': 'menu', 'aria-expanded': 'false',
  }, icon('dots'));
  more.addEventListener('click', (e) => { e.stopPropagation(); openMenu(more, video, kind, shelfId); });

  const li = el('li', {
    class: `card${justAdded.has(video.id) ? ' is-new' : ''}`,
    'data-src': 'app.js#card',
    'data-api': isYt ? 'POST /api/shelves/:id/youtube' : 'GET /api/local',
    'data-api-src': isYt ? 'server.js#youtube' : 'server.js#local',
  },
    el('button', { class: 'card__hit', type: 'button', 'aria-label': `Open ${video.title}`, onclick: () => play(video, kind) }, thumb),
    el('div', { class: 'card__body' },
      el('h3', { class: 'card__title', text: video.title, title: video.title }),
      more,
      el('p', { class: 'card__by' }, icon(isYt ? 'check' : 'folder'), el('span', { text: isYt ? (video.channel || 'YouTube') : video.folder })),
      el('p', { class: 'card__meta', text: meta.filter(Boolean).join(' • ') }),
    ),
  );
  if (justAdded.has(video.id)) li.style.animationDelay = `${Math.min(index, 8) * 70}ms`;
  li.__data = video; // the Inspector's Data tab reads this
  return li;
}
// #endregion

function closeMenus() {
  document.querySelectorAll('.menu').forEach((m) => m.remove());
  document.querySelectorAll('.card__more[aria-expanded="true"]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
}

function openMenu(button, video, kind, shelfId) {
  const wasOpen = button.getAttribute('aria-expanded') === 'true';
  closeMenus();
  if (wasOpen) return;
  const items = kind === 'yt'
    ? [
        el('li', {}, el('a', { href: `https://www.youtube.com/watch?v=${video.id}`, target: '_blank', rel: 'noopener', text: 'Open on YouTube' })),
        el('li', {}, el('button', { type: 'button', text: 'Remove from shelf', onclick: () => removeVideo(shelfId, video.id) })),
      ]
    : [el('li', {}, el('button', { type: 'button', text: 'Play', onclick: () => play(video, kind) }))];
  const menu = el('ul', { class: 'menu', role: 'menu' }, ...items);
  button.setAttribute('aria-expanded', 'true');
  button.closest('.card').append(menu);
  menu.querySelector('a, button').focus();
}
document.addEventListener('click', (e) => { if (!e.target.closest('.menu')) closeMenus(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenus(); });

// ---------- shelves ----------

function scrollButtons(row) {
  return [-1, 1].map((dir) => {
    const b = el('button', { class: 'nav-btn', type: 'button', 'aria-label': dir < 0 ? 'Scroll left' : 'Scroll right' }, icon('arrow'));
    if (dir < 0) b.firstChild.style.transform = 'scaleX(-1)';
    b.addEventListener('click', () => row.scrollBy({ left: dir * row.clientWidth * 0.9, behavior: 'smooth' }));
    return b;
  });
}

function emptyRow(note) {
  return el('div', { class: 'empty' },
    el('ul', { class: 'row', 'aria-hidden': 'true' }, ...[0, 1, 2, 3].map(() => el('li', { class: 'ghost' }))),
    el('p', { class: 'empty__note', text: note }),
  );
}

// #region renderShelves
// Draws every YouTube shelf from the `shelves` array the server sent.
function renderShelves() {
  const host = $('#yt-shelves');
  host.replaceChildren();

  if (!shelves.length) {
    host.append(el('section', { class: 'shelf', 'aria-labelledby': 'first-shelf' },
      el('div', { class: 'shelf__head' }, el('div', {},
        el('h2', { id: 'first-shelf', text: 'Your first shelf' }),
        el('p', { class: 'shelf__sub', text: 'YouTube links you paste up top show up here, no downloads' }))),
      emptyRow('paste a YouTube link up top :)'),
    ));
  }

  for (const shelf of shelves) {
    const row = el('ul', { class: 'row', 'aria-label': shelf.title });
    shelf.videos.forEach((v, i) => row.append(card(v, { kind: 'yt', shelfId: shelf.id, index: i })));
    const del = el('button', { class: 'pill-btn', type: 'button', text: 'Delete shelf', onclick: () => deleteShelf(shelf) });
    const section = el('section', {
      class: 'shelf', 'aria-label': shelf.title,
      'data-src': 'app.js#renderShelves', 'data-api': 'GET /api/shelves', 'data-api-src': 'server.js#shelves',
    },
      el('div', { class: 'shelf__head' },
        el('div', {},
          el('h2', { text: shelf.title }),
          shelf.subtitle && el('p', { class: 'shelf__sub', text: shelf.subtitle })),
        el('div', { class: 'shelf__tools' }, del, ...(shelf.videos.length > 4 ? scrollButtons(row) : []))),
      shelf.videos.length ? row : emptyRow('this shelf is waiting for a link'),
    );
    section.__data = shelf;
    host.append(section);
  }

  // shelf picker in the add pill
  const select = $('#add-shelf');
  const keep = select.value;
  select.replaceChildren(
    ...(shelves.length ? shelves.map((s) => el('option', { value: s.id, text: s.title })) : [el('option', { value: '', text: 'Watch later' })]),
    el('option', { value: '__new', text: '+ New shelf…' }),
  );
  if (shelves.some((s) => s.id === keep)) select.value = keep;
  updateCounts();
}
// #endregion

function renderLocal(folders) {
  const row = $('#local-row');
  row.replaceChildren();
  if (folders) $('#local-sub').textContent = `Clips found in ${folders.join(', ')}, played from where they live`;
  if (!localVideos.length) {
    row.append(el('li', { class: 'row__msg', text: 'No videos found in those folders. Add folders to config.json, then press Rescan.' }));
  }
  localVideos.forEach((v, i) => row.append(card(v, { kind: 'local', index: i })));
  updateCounts();
}

function updateCounts() {
  const yt = shelves.reduce((n, s) => n + s.videos.length, 0);
  $('#yt-count').textContent = yt;
  $('#local-count').textContent = localVideos.length;
  const total = yt + localVideos.length;
  $('#total-count').textContent = `${total} video${total === 1 ? '' : 's'}`;
}

async function loadShelves() {
  shelves = await api('/api/shelves');
  renderShelves();
}

// #region loadLocal
// Asks the server which videos it found in the folders from config.json.
async function loadLocal(query = '') {
  const row = $('#local-row');
  if (!localVideos.length) row.replaceChildren(el('li', { class: 'row__msg', text: 'Looking through your folders…' }));
  try {
    const data = await api(`/api/local${query}`);
    localVideos = data.videos;
    renderLocal(data.folders);
  } catch (e) {
    row.replaceChildren(el('li', { class: 'row__msg', text: `Could not scan folders: ${e.message}` }));
  }
}
// #endregion

// ---------- actions ----------

function askForShelf() {
  const dlg = $('#shelf-dialog');
  $('#shelf-form').reset();
  dlg.returnValue = '';
  dlg.showModal();
  return new Promise((resolve) => {
    dlg.addEventListener('close', async () => {
      if (dlg.returnValue !== 'create') return resolve(null);
      const form = $('#shelf-form');
      try {
        const shelf = await api('/api/shelves', { method: 'POST', body: { title: form.title.value, subtitle: form.subtitle.value } });
        shelves.push(shelf);
        renderShelves();
        resolve(shelf);
      } catch (e) { setStatus(e.message, true); resolve(null); }
    }, { once: true });
  });
}
$('#sheet-cancel').addEventListener('click', () => $('#shelf-dialog').close('cancel'));
$('#new-shelf-btn').addEventListener('click', askForShelf);
$('#add-shelf').addEventListener('change', async (e) => {
  if (e.target.value !== '__new') return;
  const shelf = await askForShelf();
  e.target.value = shelf ? shelf.id : (shelves[0]?.id || '');
});

// #region add
// Pick: send the pasted link to the server, which reads the video details from YouTube.
$('#add-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const url = form.url.value.trim();
  let shelfId = form.shelf.value;
  form.classList.add('is-busy');
  form.querySelector('button').disabled = true;
  setStatus('Reading the video details from YouTube…');
  try {
    if (!shelfId || shelfId === '__new') {
      const shelf = await api('/api/shelves', { method: 'POST', body: { title: 'Watch later', subtitle: 'Saved from YouTube, ready when you are' } });
      shelves.push(shelf);
      shelfId = shelf.id;
    }
    const res = await api(`/api/shelves/${shelfId}/youtube`, { method: 'POST', body: { url } });
    justAdded = new Set(res.shelf.videos.slice(0, res.added).map((v) => v.id));
    shelves = shelves.map((s) => (s.id === shelfId ? res.shelf : s));
    renderShelves();
    $('#add-shelf').value = shelfId;
    const where = res.shelf.title;
    setStatus(res.added
      ? `Added ${res.added} video${res.added > 1 ? 's' : ''} to ${where}${res.skipped ? ` (${res.skipped} already there)` : ''}.`
      : `Already on ${where}.`);
    form.url.value = '';
    document.querySelector('.card.is-new')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    form.classList.remove('is-busy');
    form.querySelector('button').disabled = false;
  }
});
// #endregion

async function removeVideo(shelfId, videoId) {
  closeMenus();
  const shelf = await api(`/api/shelves/${shelfId}/videos/${videoId}`, { method: 'DELETE' });
  justAdded = new Set();
  shelves = shelves.map((s) => (s.id === shelfId ? shelf : s));
  renderShelves();
}

async function deleteShelf(shelf) {
  if (shelf.videos.length && !confirm(`Delete "${shelf.title}" and its ${shelf.videos.length} links? Nothing on YouTube changes.`)) return;
  await api(`/api/shelves/${shelf.id}`, { method: 'DELETE' });
  shelves = shelves.filter((s) => s.id !== shelf.id);
  renderShelves();
}

async function withBusy(button, fn) {
  button.classList.add('is-busy');
  button.disabled = true;
  try { await fn(); } finally { button.classList.remove('is-busy'); button.disabled = false; }
}
$('#shuffle-btn').addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
  justAdded = new Set();
  await loadLocal('?shuffle=1');
}));
$('#rescan-btn').addEventListener('click', (e) => withBusy(e.currentTarget, () => loadLocal('?rescan=1')));
document.querySelectorAll('.shelf--local .nav-btn').forEach((b) =>
  b.addEventListener('click', () => { const row = $('#local-row'); row.scrollBy({ left: Number(b.dataset.dir) * row.clientWidth * 0.9, behavior: 'smooth' }); }));

// ---------- player ----------

// #region play
// Open + View: YouTube plays in its official embed; local files stream from /media/:id.
function play(video, kind) {
  closeMenus();
  const frame = $('#player-frame');
  if (kind === 'yt') {
    frame.replaceChildren(el('iframe', {
      src: `https://www.youtube-nocookie.com/embed/${video.id}?autoplay=1&rel=0`,
      title: video.title,
      allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen',
      allowfullscreen: '',
    }));
    $('#player-meta').textContent = [video.channel, video.views != null && `${compact(video.views)} views`].filter(Boolean).join(' • ');
  } else {
    const v = el('video', { src: `/media/${video.id}`, controls: '', autoplay: '', playsinline: '' });
    v.addEventListener('error', () => frame.replaceChildren(el('div', { class: 'player__error' },
      el('strong', { text: 'This browser cannot play this file' }),
      el('span', { text: `.${video.ext} files recorded on iPhone often use HEVC. Open the page in Safari, or convert the clip to .mp4.` }))));
    frame.replaceChildren(v);
    $('#player-meta').textContent = `${video.folder} • ${fmtSize(video.size)}`;
  }
  $('#player-title').textContent = video.title;
  $('#player').__data = video;
  $('#player').showModal();
}
// #endregion
$('#player-close').addEventListener('click', () => $('#player').close());
$('#player').addEventListener('close', () => $('#player-frame').replaceChildren()); // stops playback
$('#player').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });

// #region kinetic
// Splits each hero line into letters so they can rise in one after another.
function kineticTitle() {
  let i = 0;
  document.querySelectorAll('[data-kinetic]').forEach((line) => {
    const text = line.textContent;
    line.replaceChildren(...[...text].map((ch) => {
      const inner = el('span', { class: 'ch__in', text: ch });
      inner.style.animationDelay = `${120 + i++ * 45}ms`;
      return el('span', { class: 'ch', 'aria-hidden': 'true' }, inner);
    }));
  });
  document.body.classList.add('is-kinetic');
}
kineticTitle();
// #endregion

// ---------- start ----------
loadShelves().catch((e) => setStatus(`Server not reachable: ${e.message}`, true));
loadLocal();
