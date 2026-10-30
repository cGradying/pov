// Inspect mode ("X-ray"): press I or the Inspect button, hover anything to see its box and
// attributes, click it to read its HTML, CSS rules, data, and the code that built it.
(() => {
  const $ = (sel) => document.querySelector(sel);
  const drawer = $('#inspector');
  const out = $('#xr-out');
  const note = $('#xr-note');
  const btn = $('#xray-btn');

  // Overlay pieces (fixed, ignore the mouse): margin band, padding band, content box, label.
  const layer = document.createElement('div');
  layer.className = 'xr-layer xr-ui';
  layer.innerHTML = '<div class="xr-margin"></div><div class="xr-padding"></div><div class="xr-content"></div><div class="xr-tag"></div>';
  const scan = document.createElement('div');
  scan.className = 'xr-scan xr-ui';
  document.body.append(layer, scan);
  const [mBox, pBox, cBox, tag] = layer.children;

  let on = false;
  let picked = null;
  let tab = 'html';
  const sources = {}; // file name -> source text, fetched once

  // ---------- helpers ----------

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const isUi = (node) => node.closest && node.closest('.xr-ui');

  function selectorOf(node) {
    let s = node.tagName.toLowerCase();
    if (node.id) s += `#${node.id}`;
    const cls = [...node.classList].filter((c) => !c.startsWith('is-')).slice(0, 2);
    if (cls.length) s += `.${cls.join('.')}`;
    return s;
  }

  // One-pass highlighter: comments, strings, keywords, numbers. Text is escaped piece by piece.
  const TOKENS = /(\/\/.*$|\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->)|('(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`)|\b(const|let|var|function|async|await|return|if|else|for|of|in|new|try|catch|throw|true|false|null|undefined|while|break|continue)\b|\b(\d+(?:\.\d+)?)\b/gm;
  function highlight(code) {
    let html = '';
    let last = 0;
    code.replace(TOKENS, (m, comment, str, kw, num, at) => {
      html += esc(code.slice(last, at));
      const kind = comment ? 'c' : str ? 's' : kw ? 'k' : 'n';
      html += `<span class="t-${kind}">${esc(m)}</span>`;
      last = at + m.length;
      return m;
    });
    return html + esc(code.slice(last));
  }

  function withLineNumbers(code, start = 1) {
    return code.split('\n').map((line, i) =>
      `<span class="ln">${String(start + i).padStart(3, ' ')}</span>${highlight(line)}`).join('\n');
  }

  // Indent markup by nesting depth so a one-line outerHTML becomes readable.
  const VOID = /^<(area|br|col|embed|hr|img|input|link|meta|source|track|wbr|use|path|circle)\b/i;
  function prettyHTML(html, maxLines = 70) {
    const parts = html.replace(/>\s+</g, '><').split(/(<[^>]+>)/).map((p) => p.trim()).filter(Boolean);
    const lines = [];
    let depth = 0;
    for (const p of parts) {
      if (p.startsWith('</')) depth = Math.max(0, depth - 1);
      lines.push('  '.repeat(depth) + (p.length > 160 ? p.slice(0, 157) + '…' : p));
      if (p.startsWith('<') && !p.startsWith('</') && !p.endsWith('/>') && !VOID.test(p) && !p.startsWith('<!')) depth++;
    }
    const cut = lines.length > maxLines;
    return lines.slice(0, maxLines).join('\n') + (cut ? `\n  … ${lines.length - maxLines} more lines` : '');
  }

  async function source(file) {
    if (!sources[file]) {
      const res = await fetch(file === 'server.js' ? '/source/server.js' : `/${file}`);
      sources[file] = await res.text();
    }
    return sources[file];
  }

  // Cut out the code between "#region name" and the matching "#endregion" marker.
  async function region(ref) {
    const [file, name] = ref.split('#');
    const lines = (await source(file)).split('\n');
    const start = lines.findIndex((l) => l.includes(`#region ${name}`));
    if (start < 0) return null;
    const end = lines.findIndex((l, i) => i > start && l.includes('#endregion'));
    return { file, start: start + 1, code: lines.slice(start, end < 0 ? undefined : end + 1).join('\n') };
  }

  // ---------- hover overlay ----------

  function px(v) { return parseFloat(v) || 0; }
  function place(box, x, y, w, h) {
    box.style.transform = `translate(${x}px, ${y}px)`;
    box.style.width = `${Math.max(0, w)}px`;
    box.style.height = `${Math.max(0, h)}px`;
  }

  function show(node) {
    const r = node.getBoundingClientRect();
    const cs = getComputedStyle(node);
    const m = { t: px(cs.marginTop), r: px(cs.marginRight), b: px(cs.marginBottom), l: px(cs.marginLeft) };
    const p = { t: px(cs.paddingTop), r: px(cs.paddingRight), b: px(cs.paddingBottom), l: px(cs.paddingLeft) };
    place(mBox, r.left - m.l, r.top - m.t, r.width + m.l + m.r, r.height + m.t + m.b);
    place(pBox, r.left, r.top, r.width, r.height);
    place(cBox, r.left + p.l, r.top + p.t, r.width - p.l - p.r, r.height - p.t - p.b);

    const attrs = [...node.attributes]
      .filter((a) => /^(data-|aria-|id$|href$|type$|role$)/.test(a.name) && a.name !== 'aria-hidden')
      .slice(0, 4)
      .map((a) => `<span class="xr-attr"><b>${esc(a.name)}</b>="${esc(a.value.slice(0, 40))}"</span>`).join('');
    const font = `${cs.fontFamily.split(',')[0].replace(/"/g, '')} ${cs.fontWeight} ${Math.round(px(cs.fontSize))}px`;
    tag.innerHTML = `
      <span class="xr-name">${esc(selectorOf(node))}</span>
      <span class="xr-size">${Math.round(r.width)} × ${Math.round(r.height)}</span>
      <span class="xr-font"><i style="background:${cs.color}"></i>${esc(font)}</span>
      ${attrs}`;
    // keep the label on screen: above the box, or below when there is no room
    const tagH = tag.offsetHeight || 60;
    const top = r.top - tagH - 8 > 8 ? r.top - tagH - 8 : Math.min(r.bottom + 8, innerHeight - tagH - 8);
    const left = Math.min(Math.max(8, r.left), innerWidth - tag.offsetWidth - 8);
    tag.style.transform = `translate(${left}px, ${top}px)`;
    layer.classList.add('is-visible');
  }

  document.addEventListener('pointermove', (e) => {
    if (!on || isUi(e.target)) return;
    show(e.target);
  });

  // ---------- drawer ----------

  const owner = (node) => node.closest('[data-src]');

  async function render() {
    if (!picked) return;
    const own = owner(picked);
    let html = '';
    let msg = '';

    if (tab === 'html') {
      msg = 'The live HTML of this element, as the browser has it right now.';
      html = highlight(prettyHTML(picked.outerHTML));
    }

    if (tab === 'styles') {
      msg = 'Every CSS rule in style.css that applies to this element, in source order.';
      const rules = [];
      const visit = (list) => {
        for (const rule of list) {
          if (rule.cssRules && rule.media) { if (matchMedia(rule.media.mediaText).matches) visit(rule.cssRules); continue; }
          if (!rule.selectorText) continue;
          try { if (picked.matches(rule.selectorText)) rules.push(rule); } catch { /* pseudo-element selectors */ }
        }
      };
      for (const sheet of document.styleSheets) {
        try { visit(sheet.cssRules); } catch { /* font CSS from another site cannot be read */ }
      }
      html = rules.length
        ? rules.map((r) => `<span class="t-sel">${esc(r.selectorText)}</span> {\n${
            r.style.cssText.split(/;\s*/).filter(Boolean).map((d) => {
            const at = d.indexOf(':'); // cssText keeps shorthands (margin: 0) the way style.css wrote them
            return `  <span class="t-prop">${esc(d.slice(0, at))}</span>:${esc(d.slice(at + 1))};`;
          }).join('\n')}\n}`).join('\n\n')
        : 'No rules in style.css target this element directly; it inherits from its parents.';
    }

    if (tab === 'data') {
      const holder = own && own.__data ? own : null;
      msg = holder
        ? 'The JavaScript object this element was built from. It came from the server as JSON.'
        : 'This part of the page is plain HTML, so there is no data object behind it.';
      html = holder ? highlight(JSON.stringify(holder.__data, null, 2)) : '';
    }

    if (tab === 'code' || tab === 'api') {
      const ref = own && (tab === 'code' ? own.dataset.src : own.dataset.apiSrc);
      const r = ref && await region(ref);
      if (!r) {
        msg = tab === 'code' ? 'No source region is linked to this element.' : 'This part of the page does not call the server.';
      } else {
        msg = tab === 'code'
          ? `${r.file}, from line ${r.start}: the code that builds this element.`
          : `${own.dataset.api} → handled in ${r.file}, from line ${r.start}.`;
        html = withLineNumbers(r.code, r.start);
      }
    }

    note.textContent = msg;
    out.innerHTML = html;
    out.scrollTop = 0;
  }

  function pick(node) {
    picked = node;
    $('#xr-sel').textContent = selectorOf(node);
    const own = owner(node);
    $('#xr-src').textContent = own ? `part of ${selectorOf(own)} · ${own.dataset.src}` : 'static page markup';
    drawer.hidden = false;
    requestAnimationFrame(() => drawer.classList.add('is-open'));
    render();
  }

  $('#xr-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    tab = b.dataset.tab;
    $('#xr-tabs').querySelectorAll('[data-tab]').forEach((t) => t.setAttribute('aria-selected', String(t === b)));
    render();
  });

  function closeDrawer() {
    drawer.classList.remove('is-open');
    picked = null;
    setTimeout(() => { if (!picked) drawer.hidden = true; }, 350);
  }
  $('#xr-close').addEventListener('click', closeDrawer);

  // While inspecting, clicks select elements instead of using them.
  document.addEventListener('click', (e) => {
    if (!on || isUi(e.target) || e.target.closest('#xray-btn')) return;
    e.preventDefault();
    e.stopPropagation();
    show(e.target);
    pick(e.target);
  }, true);

  // ---------- on / off ----------

  function toggle(force) {
    on = force ?? !on;
    document.body.classList.toggle('xray', on);
    btn.setAttribute('aria-pressed', String(on));
    if (on) {
      scan.classList.remove('is-run');
      void scan.offsetWidth; // restart the sweep animation
      scan.classList.add('is-run');
    } else {
      layer.classList.remove('is-visible');
      closeDrawer();
    }
  }
  btn.addEventListener('click', () => toggle());

  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
    if (e.key.toLowerCase() === 'i' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey && !document.querySelector('dialog[open]')) toggle();
    if (e.key === 'Escape' && on) picked ? closeDrawer() : toggle(false);
  });
  addEventListener('scroll', () => { if (on) layer.classList.remove('is-visible'); }, { passive: true });
})();
