// Whim mockups: HTML helpers for the phone frames. Every helper returns a string.
// c = { p: 'ios' | 'android', s: 'light' | 'dark' } describes the frame being drawn.

const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function icon(name, size = 20, stroke = 2, extra = '') {
  const body = ICONS[name];
  if (!body) return '';
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${body}</svg>`;
}

// Superellipse (n = 5) on a 100 box: the tile shape on both platforms.
const SQUIRCLE = (() => {
  const n = 5, pts = [];
  for (let i = 0; i < 96; i++) {
    const t = (i / 96) * Math.PI * 2, c = Math.cos(t), s = Math.sin(t);
    const x = 50 + 50 * Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
    const y = 50 + 50 * Math.sign(s) * Math.pow(Math.abs(s), 2 / n);
    pts.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }
  return 'M' + pts.join('L') + 'Z';
})();

// ── The wisp ────────────────────────────────────────────────────────────────
const WISP_PATH = 'M28 4C35.7 4 42 10.3 42 18C42 25.5 36.5 31 30 32.6C24.5 34 21 36.6 18.2 40.2C15.8 43.3 12.5 45.6 8.6 45.2C6.2 45 4.6 43.4 5.6 42.1C9.6 41.8 12.6 39.2 13.9 35.5C15.1 32 14.3 28.7 14.1 25.5C14 23 14 20.5 14 18C14 10.3 20.3 4 28 4Z';

const WISP_DEFS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
<radialGradient id="wg-body" cx="38%" cy="30%" r="78%"><stop offset="0" stop-color="#FFD98A"/><stop offset=".38" stop-color="#FFB54F"/><stop offset=".72" stop-color="#FF8A2B"/><stop offset="1" stop-color="#F0561A"/></radialGradient>
<radialGradient id="wg-dim" cx="38%" cy="30%" r="78%"><stop offset="0" stop-color="#E9B98C"/><stop offset=".6" stop-color="#C9895A"/><stop offset="1" stop-color="#9C5E3C"/></radialGradient>
<radialGradient id="wg-halo" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#FF9127" stop-opacity=".75"/><stop offset=".55" stop-color="#FF9127" stop-opacity=".22"/><stop offset="1" stop-color="#FF9127" stop-opacity="0"/></radialGradient>
</defs></svg>`;

const POSES = {
  listening: { ex: 0, ey: 0, ry: 3.5, rot: 0, ty: 0, glow: .85, eyes: 'open' },
  thinking: { ex: 1.6, ey: -1.7, ry: 3.4, rot: -6, ty: 0, glow: .8, eyes: 'open' },
  making: { ex: -.4, ey: 1.7, ry: 3.0, rot: 4, ty: 0, glow: 1, eyes: 'open' },
  stuck: { ex: 0, ey: .8, ry: 1.3, rot: 0, ty: 1, glow: .35, eyes: 'open', dim: true },
  failed: { ex: 0, ey: 1.8, ry: 1.7, rot: 7, ty: 1.6, glow: .3, eyes: 'open', dim: true },
  done: { ex: 0, ey: -.4, ry: 3.4, rot: 0, ty: -1, glow: 1, eyes: 'arc' },
  asleep: { ex: 0, ey: .6, ry: 3.4, rot: 0, ty: .6, glow: .45, eyes: 'closed' },
};

function wispEyes(pose) {
  const p = POSES[pose] || POSES.listening;
  const L = 23.6 + p.ex, R = 32.4 + p.ex, Y = 17.6 + p.ey;
  if (p.eyes === 'arc') {
    return `<path d="M${L - 2.5} ${Y + .8}Q${L} ${Y - 2.6} ${L + 2.5} ${Y + .8}M${R - 2.5} ${Y + .8}Q${R} ${Y - 2.6} ${R + 2.5} ${Y + .8}" fill="none" stroke="#1A1614" stroke-width="1.7" stroke-linecap="round"/>`;
  }
  if (p.eyes === 'closed') {
    return `<path d="M${L - 2.3} ${Y}Q${L} ${Y + 1.6} ${L + 2.3} ${Y}M${R - 2.3} ${Y}Q${R} ${Y + 1.6} ${R + 2.3} ${Y}" fill="none" stroke="#1A1614" stroke-width="1.5" stroke-linecap="round"/>`;
  }
  const hl = p.ry > 2 ? `<circle cx="${L + .8}" cy="${Y - 1.3}" r=".85" fill="#fff"/><circle cx="${R + .8}" cy="${Y - 1.3}" r=".85" fill="#fff"/>` : '';
  return `<ellipse cx="${L}" cy="${Y}" rx="2.4" ry="${p.ry}" fill="#1A1614"/><ellipse cx="${R}" cy="${Y}" rx="2.4" ry="${p.ry}" fill="#1A1614"/>${hl}`;
}

// size in px. eyes are drawn at 48px and above unless forced off. mode: 'glow' | 'grey'.
function wisp({ size = 96, pose = 'listening', activity = .7, eyes, mode = 'glow', cls = '' } = {}) {
  const p = POSES[pose] || POSES.listening;
  const showEyes = eyes !== undefined ? eyes : size >= 48;
  const grey = mode === 'grey';
  const glow = grey ? 0 : Math.min(1, p.glow * (.55 + .45 * activity));
  const fill = grey ? 'style="fill:var(--w-text3)"' : `fill="url(#${p.dim ? 'wg-dim' : 'wg-body'})"`;
  const halo = glow > 0 ? `<circle cx="27" cy="21" r="26" fill="url(#wg-halo)" opacity="${glow.toFixed(2)}"/>` : '';
  return `<span class="w-wisp ${cls}" style="width:${size}px;height:${size}px" data-pose="${pose}"><svg width="${size}" height="${size}" viewBox="0 0 48 48" aria-hidden="true">${halo}<g transform="translate(0 ${p.ty}) rotate(${p.rot} 28 22)"><path d="${WISP_PATH}" ${fill}/>${showEyes && !grey ? wispEyes(pose) : ''}</g></svg></span>`;
}

// ── Tiles ───────────────────────────────────────────────────────────────────
// app = { name, tint, icon, letter? }. state: ready | making | queued | failed | stopped | update | changing | change-failed
function tile(app, { size = 64, state = 'ready', activity = .8, label = true, second } = {}) {
  let inner = '';
  const glyph = Math.round(size * .5);
  const stroke = size >= 56 ? 2 : size >= 32 ? 2.1 : 2.3;
  if (state === 'making' || state === 'queued') {
    inner = `<svg class="sq" viewBox="0 0 100 100"><path d="${SQUIRCLE}" style="fill:var(--w-ember-soft)"/></svg><span class="glyph">${wisp({ size: Math.round(size * .56), pose: state === 'queued' ? 'asleep' : 'making', activity: state === 'queued' ? .25 : activity, eyes: false })}</span>`;
  } else if (state === 'failed' || state === 'stopped' || state === 'update') {
    inner = `<svg class="sq" viewBox="0 0 100 100"><path d="${SQUIRCLE}" style="fill:var(--w-fill)"/></svg><span class="glyph">${wisp({ size: Math.round(size * .5), mode: 'grey', eyes: false })}</span>${state === 'failed' ? `<span class="badge">${icon('circle-alert', 14, 2.4)}</span>` : ''}`;
  } else {
    const content = app.icon ? `<span class="glyph" style="color:var(--t-on)">${icon(app.icon, glyph, stroke)}</span>` : `<span class="glyph t-title2" style="color:var(--t-on)">${esc(app.name[0])}</span>`;
    inner = `${state === 'changing' ? '<span class="ring"></span>' : ''}<svg class="sq" viewBox="0 0 100 100"><path d="${SQUIRCLE}" style="fill:var(--t-fill)"/></svg>${content}${state === 'change-failed' ? `<span class="badge">${icon('circle-alert', 14, 2.4)}</span>` : ''}`;
  }
  const secondLine = {
    making: '<div class="st t-ember">Making…</div>', queued: '<div class="st t-sec">Waiting…</div>',
    failed: '<div class="st t-danger">Didn’t work</div>', stopped: '<div class="st t-sec">Stopped</div>',
    update: '<div class="st t-warn">Needs update</div>', changing: '<div class="st t-ember">Changing…</div>',
    'change-failed': '<div class="st t-danger">Change didn’t work</div>',
  }[state] || (second ? `<div class="st t-sec">${esc(second)}</div>` : '');
  const t = `<div class="w-tile tint-${app.tint || 'graphite'}" style="--tile:${size}px">${inner}</div>`;
  if (!label) return t;
  return `<div class="w-cell tint-${app.tint || 'graphite'}">${t}<div class="nm">${esc(app.name)}</div>${secondLine}</div>`;
}

// ── Frame pieces ────────────────────────────────────────────────────────────
function statusBar(c, { onDark = false } = {}) {
  if (c.p === 'ios') {
    return `<div class="w-island"></div><div class="w-statusbar${onDark ? ' on-dark' : ''}"><span class="t-num">9:41</span><span class="sb-icons">
<svg width="18" height="12" viewBox="0 0 18 12"><rect x="0" y="8" width="3" height="4" rx="1" fill="currentColor"/><rect x="5" y="5.5" width="3" height="6.5" rx="1" fill="currentColor"/><rect x="10" y="3" width="3" height="9" rx="1" fill="currentColor"/><rect x="15" y="0" width="3" height="12" rx="1" fill="currentColor"/></svg>
<svg width="16" height="12" viewBox="0 0 16 12"><path d="M8 2.3c2.3 0 4.4.9 6 2.4l1.1-1.1A10 10 0 0 0 8 .7 10 10 0 0 0 .9 3.6L2 4.7a8.4 8.4 0 0 1 6-2.4Zm0 3.2c1.4 0 2.7.5 3.7 1.5l1.1-1.1A6.8 6.8 0 0 0 8 3.9a6.8 6.8 0 0 0-4.8 2l1.1 1.1c1-1 2.3-1.5 3.7-1.5Zm0 3.2c.6 0 1.2.2 1.6.7L8 11 6.4 9.4c.4-.5 1-.7 1.6-.7Z" fill="currentColor"/></svg>
<svg width="27" height="13" viewBox="0 0 27 13"><rect x=".5" y=".5" width="23" height="12" rx="3.5" fill="none" stroke="currentColor" opacity=".4"/><rect x="2" y="2" width="20" height="9" rx="2" fill="currentColor"/><path d="M25 4.5v4c.8-.3 1.3-1.1 1.3-2s-.5-1.7-1.3-2Z" fill="currentColor" opacity=".45"/></svg></span></div>`;
  }
  return `<div class="w-punch"></div><div class="w-statusbar${onDark ? ' on-dark' : ''}"><span class="t-num">9:41</span><span class="sb-icons">
<svg width="16" height="16" viewBox="0 0 24 24"><path d="M12 20.5 1.5 8.4C4.3 5.9 8 4.5 12 4.5s7.7 1.4 10.5 3.9L12 20.5Z" fill="currentColor"/></svg>
<svg width="16" height="16" viewBox="0 0 24 24"><path d="M21 21H3L21 3v18Z" fill="currentColor"/></svg>
<svg width="16" height="16" viewBox="0 0 24 24"><rect x="7" y="3" width="10" height="19" rx="2" fill="currentColor"/><rect x="10" y="1.5" width="4" height="2" rx=".5" fill="currentColor"/></svg></span></div>`;
}

function topSpace(c) { return `<div class="w-top-${c.p}"></div>`; }
function bottomSafe(c) { return `<div class="w-bottom-safe-${c.p}"></div>`; }
const SAFE_BOTTOM = { ios: 34, android: 24 };

function header(c, { back = true, right = '', title = '' } = {}) {
  const b = back ? `<button class="w-iconbtn" aria-label="Back">${icon(c.p === 'ios' ? 'chevron-left' : 'arrow-left', c.p === 'ios' ? 28 : 24, 2.2)}</button>` : '<span></span>';
  return `<div class="w-header">${b}${title ? `<div class="w-inline-title">${esc(title)}</div>` : ''}<div class="h-right">${right}</div></div>`;
}

function iconBtn(name, label, { filled = false, size = 22 } = {}) {
  return `<button class="w-iconbtn${filled ? ' filled' : ''}" aria-label="${esc(label)}"><span>${icon(name, size, 2)}</span></button>`;
}

function btn(label, variant = 'ink', { size = '', block = true, iconName = '' } = {}) {
  return `<button class="w-btn ${variant} ${size}${block ? ' block' : ''}">${iconName ? icon(iconName, 20, 2.2) : ''}${esc(label)}</button>`;
}

function row({ icon: ic, title, sub, trail = '', chev = false, sw, danger = false, ext = false, pressed = false } = {}) {
  const t = [trail ? `<span>${trail}</span>` : '', sw !== undefined ? `<span class="w-switch${sw ? ' on' : ''}"></span>` : '', chev ? `<span class="r-chev">${icon('chevron-right', 18, 2)}</span>` : '', ext ? `<span class="r-chev">${icon('external-link', 17, 2)}</span>` : ''].join('');
  return `<div class="w-row${danger ? ' danger' : ''}${pressed ? ' pressed' : ''}">${ic ? `<span class="r-icon">${icon(ic, 20, 2)}</span>` : ''}<div class="r-main"><div class="r-title">${title}</div>${sub ? `<div class="r-sub">${sub}</div>` : ''}</div>${t ? `<div class="r-trail">${t}</div>` : ''}</div>`;
}

function list(rows, { icons = false } = {}) { return `<div class="w-list${icons ? ' icons' : ''}">${rows.join('')}</div>`; }

function chip(label, { sel = false, decide = false, idea = false } = {}) {
  const lead = sel ? icon('check', 16, 2.6) : decide ? wisp({ size: 16, eyes: false, activity: .5 }) : '';
  return `<span class="w-chip${sel ? ' sel' : ''}${decide ? ' decide' : ''}${idea ? ' idea' : ''}">${lead}${esc(label)}</span>`;
}

function field(content, { ph = '', focus = false, area = false, caret = false, send = false, sendOn = true } = {}) {
  const body = content ? `<span>${content}${caret ? '<span class="caret"></span>' : ''}</span>` : `<span class="ph">${caret ? '<span class="caret" style="margin:0 2px 0 0"></span>' : ''}${esc(ph)}</span>`;
  return `<div class="w-field${area ? ' area' : ''}${focus ? ' focus' : ''}${send ? ' send' : ''}">${body}${send ? `<span class="w-sendbtn${sendOn ? '' : ' off'}">${icon('arrow-up', 20, 2.4)}</span>` : ''}</div>`;
}

function keyboard(c, { sugg } = {}) {
  const rows = [['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'], ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'], ['z', 'x', 'c', 'v', 'b', 'n', 'm']];
  const k = (l, cls = '') => `<span class="k ${cls}">${l}</span>`;
  const r1 = `<div class="k-row">${rows[0].map((l) => k(l)).join('')}</div>`;
  const r2 = `<div class="k-row" style="padding:0 5%">${rows[1].map((l) => k(l)).join('')}</div>`;
  const r3 = `<div class="k-row">${k(icon('arrow-up', 20, 2), 'alt wide')}${rows[2].map((l) => k(l)).join('')}${k(icon('x', 18, 2), 'alt wide')}</div>`;
  const r4 = c.p === 'ios'
    ? `<div class="k-row">${k('123', 'alt wide')}${k('', 'space')}${k('return', 'alt wide')}</div>`
    : `<div class="k-row">${k('?123', 'alt wide')}${k(',', 'alt')}${k('', 'space')}${k('.', 'alt')}${k(icon('arrow-left', 18, 2), 'alt wide')}</div>`;
  const s = sugg ? `<div class="k-sugg">${sugg.map((x) => `<span>${esc(x)}</span>`).join('')}</div>` : '';
  const pad = c.p === 'ios' ? 46 : 30;
  return `<div class="w-kbd">${s}${r1}${r2}${r3}${r4}<div style="height:${pad}px"></div></div>`;
}
const KBD_HEIGHT = { ios: 291, android: 268 };
const KBD_HEIGHT_SUGG = { ios: 327, android: 304 };

function statusLine(text, time, { stuck = false, wispSize = 0, pose = 'thinking' } = {}) {
  const lead = wispSize ? wisp({ size: wispSize, pose, activity: .6 }) : `<span class="w-ember-dot"${stuck ? ' style="background:var(--w-text3);box-shadow:none"' : ''}></span>`;
  return `<div class="w-status">${lead}<span>${text}</span>${time ? `<span class="t-num" style="margin-left:auto">${time}</span>` : ''}</div>`;
}

function steps(items) {
  return `<div class="w-steps">${items.map(([label, state, time]) => {
    const mark = state === 'done' ? icon('circle-check', 22, 2) : state === 'now' ? '<span class="w-ember-dot"></span>' : '';
    return `<div class="w-step ${state}"><span class="s-ring">${mark}</span><span>${esc(label)}</span>${time ? `<span class="s-time">${time}</span>` : ''}</div>`;
  }).join('')}</div>`;
}

function homebar() { return '<div class="w-homebar"></div>'; }

// Wraps a screen body into a frame. opts.overlay is drawn above the screen (sheets, scrims, keyboards).
function frame(c, body, { overlay = '', statusOnDark = false, tintClass = '' } = {}) {
  const w = c.p === 'ios' ? 390 : 412, h = c.p === 'ios' ? 844 : 915;
  return `<div class="phone ${tintClass}${statusOnDark ? ' on-dark' : ''}" data-platform="${c.p}" data-scheme="${c.s}" style="--pw:${w}px;--ph:${h}px">${body}${overlay}${statusBar(c, { onDark: statusOnDark })}${homebar()}</div>`;
}
