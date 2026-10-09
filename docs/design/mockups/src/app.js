// Whim mockups: the review page. Views are routed by a bare #anchor: (none) overview, s-<id> one screen,
// components, tokens, motion.

const PG = { platform: 'ios', scheme: 'both' };
try { const saved = JSON.parse(localStorage.getItem('whim-mockups') || '{}'); Object.assign(PG, saved); } catch (e) { /* storage blocked */ }
const save = () => { try { localStorage.setItem('whim-mockups', JSON.stringify(PG)); } catch (e) { /* storage blocked */ } };

const GROUPS = ['Your apps', 'Making an app', 'Using an app', 'History and settings', 'Inside apps (SDK)'];
const GROUP_NOTES = {
  'Your apps': 'Glyph tiles in four columns, Whim’s ember for anything being made, and one composer to start.',
  'Making an app': 'One sheet, four pages: describe, plan with the questions inline, making, ready. Honest about time.',
  'Using an app': 'Apps open from their tile and own the screen. Whim is a small ember; changing an app never closes it.',
  'History and settings': 'Undo instead of “are you sure”, neutral kinds, settings with diagnostics one level down.',
  'Inside apps (SDK)': 'The style gallery as a generated app sees it: same system as the shell, the app’s tint as its accent.',
};

const dims = (p) => (p === 'ios' ? { W: 390, H: 844 } : { W: 412, H: 915 });
function frameHTML(screen, c, scale) {
  const { W, H } = dims(c.p);
  return `<div class="fw" style="width:${Math.round(W * scale)}px;height:${Math.round(H * scale)}px"><div style="transform:scale(${scale});transform-origin:top left;width:${W}px;height:${H}px;border-radius:${c.p === 'ios' ? 54 : 40}px">${screen.render(c)}</div></div>`;
}
const schemes = () => (PG.scheme === 'both' ? ['light', 'dark'] : [PG.scheme]);
const contentWidth = () => Math.min(1320, document.documentElement.clientWidth) - 40;

// ── Overview ────────────────────────────────────────────────────────────────
function viewOverview() {
  const cw = contentWidth(), { W } = dims(PG.platform), n = schemes().length;
  const narrow = cw < 720;
  const scale = narrow ? Math.min(.62, (cw - (n - 1) * 12) / (n * W)) : (cw >= 1200 ? .5 : .46);
  const hero = `<section class="pg-hero"><div><div class="pg-flabel" style="color:var(--pg-accent)">Design system v1 · for review</div><h1>Whim, made calm, honest and yours</h1>
<p class="lead">One system for the shell and every app Whim makes. System type, light and dark, an ember that only glows while Whim is working, and apps that wear their own colour. Tap any screen to see it on both platforms, in both themes.</p>
<ul class="pg-moves">
<li><b>One system, two renderers</b>The launcher and the apps share type, space, shape and motion.</li>
<li><b>Hue says who</b>Ember is Whim at work, a tint is an app, ink is you and the system.</li>
<li><b>System fonts, light and dark</b>SF on iPhone, Roboto on Android, following the phone.</li>
<li><b>Glyph tiles</b>Each app picks a tint and an icon by name. No monograms, no generated art.</li>
<li><b>Honest light</b>The wisp’s glow follows the real stream. Stuck looks stuck.</li>
<li><b>Springs and gestures</b>Six springs, everything interruptible, back by swipe on both platforms.</li>
<li><b>Fewer steps</b>Questions live on the plan; changing an app never closes it.</li>
<li><b>Plain words</b>One name per thing. The maker says “I”.</li>
</ul></div>
<div class="pg-hero-art">${frameHTML(SCREENS.find((s) => s.id === 'home'), { p: PG.platform, s: 'light' }, narrow ? .5 : .5)}${narrow ? '' : frameHTML(SCREENS.find((s) => s.id === 'making'), { p: PG.platform, s: 'dark' }, .5)}</div></section>`;
  const story = (title, sub, steps) => {
    const nf = steps.length, sc = narrow ? Math.min(.42, (cw - 20) / (2 * W)) : Math.min(.36, (cw - 44 - (nf - 1) * 96) / (nf * W));
    const items = steps.map(([id, label], i) => `${i ? `<div class="pg-arrow"><span>→</span><small>${esc(label)}</small></div>` : ''}<a href="#s-${id}" class="pg-storyframe">${frameHTML(SCREENS.find((s) => s.id === id), { p: PG.platform, s: PG.scheme === 'dark' ? 'dark' : 'light' }, sc)}</a>`).join('');
    return `<div class="pg-story"><h3>${esc(title)}</h3><p>${esc(sub)}</p><div class="pg-storyrow">${items}</div></div>`;
  };
  const flows = `<section class="pg-section"><h2>The two flows</h2><p class="sub">Making an app and changing one, frame by frame. The labels name the motion between frames (05-motion.md).</p>
${story('Make an app', 'From the composer to the running app: four taps, one sheet, the wisp at work in the middle.', [['home', ''], ['describe', 'M6 the composer grows into the sheet'], ['plan', 'M7 push; questions land first'], ['making', 'M9 the wisp moves to the centre'], ['ready', 'M10 flare, the tile rises out of it'], ['app-timer', 'M2 the app grows out of its tile']])}
${story('Change an app while using it', 'The app never closes. The change is made in the background and offered with Reload.', [['app-timer', ''], ['whim-sheet', 'M21 the Whim sheet rises from the orb'], ['whim-plan', 'M11 the sheet grows; the plan for the change'], ['app-changing', 'M5 back into the orb, which glows while it works']])}</section>`;
  const groups = GROUPS.map((g) => {
    const cards = SCREENS.filter((s) => s.group === g).map((s) => `<article class="pg-card" style="--note-w:${Math.round(W * scale * n + (n - 1) * 12)}px"><h3><a href="#s-${s.id}">${esc(s.title)}</a></h3><a href="#s-${s.id}" aria-label="Open ${esc(s.title)}" class="pg-frames" style="text-decoration:none">${schemes().map((sc) => frameHTML(s, { p: PG.platform, s: sc }, scale)).join('')}</a><p>${esc(s.note)}</p></article>`).join('');
    return `<section class="pg-section" id="g-${g.replace(/\W+/g, '-').toLowerCase()}"><h2>${esc(g)}</h2><p class="sub">${esc(GROUP_NOTES[g])}</p><div class="pg-cards">${cards}</div></section>`;
  }).join('');
  return hero + flows + groups;
}

// ── One screen, every variant ───────────────────────────────────────────────
function viewScreen(id) {
  const i = SCREENS.findIndex((s) => s.id === id);
  if (i < 0) return viewOverview();
  const s = SCREENS[i], prev = SCREENS[(i - 1 + SCREENS.length) % SCREENS.length], next = SCREENS[(i + 1) % SCREENS.length];
  const variants = [['ios', 'light', 'iPhone · light'], ['ios', 'dark', 'iPhone · dark'], ['android', 'light', 'Android · light'], ['android', 'dark', 'Android · dark']];
  const cw = contentWidth(), scale = cw < 720 ? Math.min(.8, cw / 412) : .8;
  return `<div class="pg-focus-head"><div><div class="pg-flabel">${esc(s.group)}</div><h2>${esc(s.title)}</h2><p>${esc(s.note)}</p></div><div class="pg-row"><a class="pg-btn" href="#s-${prev.id}">← ${esc(prev.title)}</a><a class="pg-btn dark" href="#s-${next.id}">${esc(next.title)} →</a></div></div>
<div class="pg-scroll"><div class="pg-frames">${variants.map(([p, sc, label]) => `<div><div class="pg-flabel">${label} · ${p === 'ios' ? '390 × 844' : '412 × 915'}</div>${frameHTML(s, { p, s: sc }, scale)}</div>`).join('')}</div></div>`;
}

// ── Components ──────────────────────────────────────────────────────────────
function board(sc, inner) {
  return `<div class="phone" data-platform="${PG.platform}" data-scheme="${sc}" style="--pw:100%;--ph:auto;height:auto;border-radius:24px;padding:24px;overflow:visible">${inner}</div>`;
}
function viewComponents() {
  const c = { p: PG.platform, s: 'light' };
  const spec = (sc) => board(sc, `
<div class="t-footnote t-sec t-semibold">Buttons, by who acts</div>
<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px;margin-top:10px">${btn('Make it', 'ember')}${btn('Agree and continue', 'ink')}<div class="tint-cocoa">${btn('Open Pour Timer', 'tint')}</div>${btn('Back to your apps', 'secondary')}${btn('Not now', 'plain')}${btn('Delete', 'plain-danger')}${btn('Sending…', 'disabled')}</div>
<div style="display:flex;gap:10px;margin-top:10px;flex-wrap:wrap">${btn('Change it', 'ember', { size: 'md', block: false })}${btn('Save', 'ink', { size: 'sm', block: false })}${btn('Cancel', 'plain', { size: 'sm', block: false })}${iconBtn('settings', 'Settings', { size: 22 })}${iconBtn('x', 'Close', { filled: true, size: 18 })}</div>
<div class="t-footnote t-sec t-semibold" style="margin-top:24px">Chips</div>
<div class="w-chips" style="margin-top:10px">${chip('Just today')}${chip('A few weeks', { sel: true })}${chip('I’ll decide', { decide: true })}${chip('I’ll decide', { decide: true, sel: true })}${chip('A dice roller for game night', { idea: true })}</div>
<div class="t-footnote t-sec t-semibold" style="margin-top:24px">Fields</div>
<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px;margin-top:10px"><div><div class="w-label">Server address</div>${field('https://api.whim.app')}</div><div><div class="w-label">Focused</div>${field('Lunch walk', { focus: true, caret: true })}</div><div>${field('', { ph: 'What should change?', send: true, sendOn: false })}</div><div>${field('Add a weekly chart', { send: true })}</div></div>
<div class="t-footnote t-sec t-semibold" style="margin-top:24px">Grouped list</div>
<div style="margin-top:10px;max-width:420px">${list([row({ icon: 'message-square', title: 'AI features', trail: 'On', chev: true }), row({ icon: 'history', title: 'History', chev: true }), row({ title: 'Send error details', sw: true }), row({ title: 'Privacy policy', ext: true }), row({ title: 'Delete', danger: true })], { icons: true })}</div>
<div class="t-footnote t-sec t-semibold" style="margin-top:24px">Status, steps, notices, badges</div>
<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:18px;margin-top:10px;align-items:start"><div style="display:flex;flex-direction:column;gap:12px">${statusLine('Writing the plan…', '0:02', { wispSize: 28 })}${statusLine('Making it', '1:04')}${statusLine('No word from the server for 40 s', '', { stuck: true })}</div>${steps([['Reading your plan', 'done', '0:03'], ['Writing the app', 'now', '0:41'], ['Checking it runs safely', 'todo']])}<div style="display:flex;flex-direction:column;gap:10px"><div class="w-notice">${icon('info', 20, 2)}<span>Offline. Your apps still work; making new ones needs a connection.</span></div><div class="w-notice danger">${icon('circle-alert', 20, 2)}<span>Whim is busy. Try again in <span class="t-num">0:42</span>.</span></div><div style="display:flex;gap:6px;flex-wrap:wrap"><span class="w-badge">${icon('plus', 12, 2.4)}Added</span><span class="w-badge ink">Current</span><span class="w-badge ember">Making</span></div></div></div>
<div class="t-footnote t-sec t-semibold" style="margin-top:24px">Tiles</div>
<div style="display:flex;gap:18px;flex-wrap:wrap;margin-top:10px;--tile:64px">${['ready', 'making', 'queued', 'failed', 'stopped', 'update', 'changing', 'change-failed'].map((st) => tile(st === 'ready' ? APPS.water : { name: st === 'changing' || st === 'change-failed' ? 'Pour Timer' : 'Pomodoro timer', tint: 'cocoa', icon: 'timer' }, { state: st })).join('')}</div>
<div class="t-footnote t-sec t-semibold" style="margin-top:24px">Orb, composer, toast</div>
<div style="position:relative;height:150px;margin-top:10px"><div class="w-orb" style="bottom:auto;top:8px;right:auto;left:0">${wisp({ size: 22, eyes: false, activity: .35 })}</div><div class="w-orb" style="bottom:auto;top:8px;right:auto;left:64px">${wisp({ size: 22, eyes: false, activity: .35 })}<span class="dot"></span></div><div class="w-composer" style="left:0;right:auto;width:300px;top:72px">${wisp({ size: 22, eyes: false, activity: .5 })}<span>Make an app…</span></div><div class="w-toast" style="left:auto;right:0;transform:none;top:8px"><span>Back on version 3</span><button class="ta">Undo</button></div></div>`);
  const sdk = SCREENS.filter((s) => s.group === 'Inside apps (SDK)');
  const ncw = contentWidth(), nn = schemes().length, sdkScale = Math.min(.5, (ncw - (nn - 1) * 12) / (nn * dims(PG.platform).W));
  return `<div class="pg-focus-head"><div><div class="pg-flabel">Components</div><h2>The parts, in both themes</h2><p>Launcher components first. The SDK’s components follow as the style gallery shows them; the gallery must show every component and variant, always.</p></div></div>
<div class="pg-grid2">${schemes().map((sc) => spec(sc)).join('')}</div>
<section class="pg-section"><h2>SDK components</h2><p class="sub">What a generated app is built from. Its tint becomes its primary colour; everything else is the shared system.</p><div class="pg-cards">${sdk.map((s) => `<article class="pg-card"><h3><a href="#s-${s.id}">${esc(s.title)}</a></h3><div class="pg-frames">${schemes().map((sc) => frameHTML(s, { p: PG.platform, s: sc }, sdkScale)).join('')}</div></article>`).join('')}</div></section>`;
}

// ── Tokens ──────────────────────────────────────────────────────────────────
const ROLES = [
  ['bg', '#F6F4F1', '#100E0D', 'Canvas'], ['surface', '#FFFFFF', '#1B1917', 'Cards, lists, inputs'], ['raised', '#FFFFFF', '#252220', 'Sheets, menus, toasts'],
  ['fill', '#EBE9E6', '#2E2B28', 'Secondary buttons, chips'], ['fill-strong', '#E0DDDA', '#3C3936', 'Pressed, skeletons'], ['separator', '#E2DFDB', '#34312F', 'Hairlines'],
  ['border', '#908B86', '#6E6862', 'Input edges, 3:1'], ['text', '#1A1614', '#F2F0EC', 'Primary text'], ['text-2', '#6D6660', '#ADA8A3', 'Secondary text'], ['text-3', '#908B86', '#78746E', 'Placeholder, disabled'],
  ['ink', '#1A1614', '#F2F0EC', 'The system’s prominent fill'], ['ember', '#C14900', '#F99549', 'Whim at work'], ['ember-text', '#B14200', '#F99549', 'Whim’s text and icons'], ['ember-soft', '#FDEBDA', '#3F2313', 'Whim’s washes'],
  ['positive', '#1E8347', '#5BCC80', 'It worked'], ['danger', '#C9292F', '#F66C6D', 'Danger'], ['warning', '#F3BA25', '#ECBD3A', 'Caution'],
];
const TINTS = [['red', '#CA322E'], ['pink', '#C63170'], ['grape', '#A03FA7'], ['violet', '#764EC7'], ['indigo', '#4B53C2'], ['blue', '#136ED0'], ['sky', '#007EB0'], ['teal', '#00807B'], ['green', '#278445'], ['lime', '#A8E051'], ['yellow', '#F8CC2F'], ['cocoa', '#846047'], ['graphite', '#51565B']];
const TYPE = [['display', 'Display', '40/44 · 700 · −0.020em'], ['large', 'Large title', '34/40 · 700 · −0.016em'], ['title1', 'Title 1', '28/34 · 700 · −0.012em'], ['title2', 'Title 2', '22/28 · 700 · −0.008em'], ['title3', 'Title 3', '20/25 · 600 · −0.004em'], ['headline', 'Headline', '17/22 · 600'], ['body', 'Body', '17/24 · 400'], ['callout', 'Callout', '15/20 · 400 · +0.004em'], ['footnote', 'Footnote', '13/18 · 400 · +0.008em'], ['caption', 'Caption', '12/16 · 500 · +0.012em']];
const GLYPHS = Object.keys(ICONS).slice(0, 145);

function viewTokens() {
  const swatches = ROLES.map(([n, l, d, u]) => `<div class="pg-sw"><div class="chipc"><span style="background:${l}"></span><span style="background:${d}"></span></div><div class="meta"><b>${n}</b>${u}<br><code>${l} · ${d}</code></div></div>`).join('');
  const tints = TINTS.map(([n, hex]) => `<div class="pg-sw"><div class="chipc tint-${n}" style="align-items:center;justify-content:center;background:${hex}"><span style="flex:none;color:var(--t-on)">${icon('star', 22, 2)}</span></div><div class="meta"><b>${n}</b><code>${hex}</code></div></div>`).join('');
  const typeRows = (p) => `<div class="phone" data-platform="${p}" data-scheme="light" style="--pw:100%;--ph:auto;height:auto;border-radius:20px;padding:20px 22px;background:var(--w-surface)">${TYPE.map(([k, n, spec]) => `<div style="display:flex;align-items:baseline;gap:16px;padding:6px 0;border-bottom:.5px solid var(--w-sep)"><span class="t-${k}" style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${k === 'display' ? '42' : n}</span><span class="t-caption t-sec" style="white-space:nowrap">${spec}</span></div>`).join('')}</div>`;
  const spaces = [4, 8, 12, 16, 20, 24, 32, 40, 48, 64].map((v) => `<div style="display:flex;align-items:center;gap:12px;font-size:13px"><span class="pg-mono" style="width:32px">${v}</span><span style="height:12px;width:${v * 3}px;border-radius:3px;background:var(--pg-accent);opacity:.8"></span></div>`).join('');
  const radii = [['r-xs', 6], ['r-sm', 10], ['r-md', 14], ['r-lg', 20], ['r-xl', 28], ['r-full', 999]].map(([n, r]) => `<div style="display:flex;flex-direction:column;align-items:center;gap:6px;font-size:12px"><span style="width:64px;height:48px;border-radius:${r === 999 ? '24px' : r + 'px'};background:var(--pg-raised);border:1px solid var(--pg-line)"></span><span>${n}</span><span class="pg-mono">${r === 999 ? 'full' : r}</span></div>`).join('');
  const glyphs = GLYPHS.map((n) => `<div class="pg-icon glyph">${icon(n, 26, 2)}<span>${n}</span></div>`).join('');
  const shell = Object.keys(ICONS).slice(145).map((n) => `<div class="pg-icon">${icon(n, 24, 2)}<span>${n}</span></div>`).join('');
  const poses = ['listening', 'thinking', 'making', 'stuck', 'failed', 'done', 'asleep'];
  const wisps = (sc) => `<div class="phone" data-platform="ios" data-scheme="${sc}" style="--pw:100%;--ph:auto;height:auto;border-radius:20px;padding:22px"><div style="display:flex;flex-wrap:wrap;gap:22px;align-items:flex-end">${poses.map((p) => `<div style="display:flex;flex-direction:column;align-items:center;gap:8px">${wisp({ size: 88, pose: p })}<span class="t-caption t-sec">${p}</span></div>`).join('')}</div><div style="display:flex;gap:18px;align-items:flex-end;margin-top:18px">${[16, 20, 24, 32, 48, 64].map((z) => `<div style="display:flex;flex-direction:column;align-items:center;gap:6px">${wisp({ size: z })}<span class="t-caption t-sec">${z}</span></div>`).join('')}<div style="display:flex;flex-direction:column;align-items:center;gap:6px">${wisp({ size: 40, mode: 'grey', eyes: false })}<span class="t-caption t-sec">light out</span></div></div></div>`;
  const springs = Object.entries(SPRINGS).map(([n, s]) => { const { k, c } = springConsts(s); const lin = linearEasing(s); return `<tr><td><b>${n}</b></td><td class="pg-mono">${s.response} · ${s.damping.toFixed(2)}</td><td class="pg-mono">${k.toFixed(1)} · ${c.toFixed(2)}</td><td class="pg-mono">${lin.ms} ms</td><td>${s.use}</td></tr>`; }).join('');
  const shadows = [['shadow-raised', 'var(--w-shadow-raised)'], ['shadow-floating', 'var(--w-shadow-float)']].map(([n, v]) => `<div style="display:flex;flex-direction:column;align-items:center;gap:10px"><span style="width:120px;height:72px;border-radius:20px;background:var(--w-raised);box-shadow:${v}"></span><span class="t-caption t-sec">${n}</span></div>`).join('');
  return `<div class="pg-focus-head"><div><div class="pg-flabel">Tokens</div><h2>The values</h2><p>Every colour pair was checked against WCAG 2.2. Light on the left of each swatch, dark on the right.</p></div></div>
<section class="pg-section" style="margin-top:12px"><h2>Colour roles</h2><p class="sub">Warm, low-chroma neutrals; ember for Whim; status kept apart from both.</p><div class="pg-swatches">${swatches}</div></section>
<section class="pg-section"><h2>App tints</h2><p class="sub">Thirteen names an app can pick. The fill is the tile and the app’s primary; orange is reserved for Whim.</p><div class="pg-swatches">${tints}</div></section>
<section class="pg-section"><h2>Type</h2><p class="sub">The system face on each platform, one scale. SF on iPhone (left), Roboto on Android (right).</p><div class="pg-grid2">${typeRows('ios')}${typeRows('android')}</div></section>
<section class="pg-section"><h2>Space, shape, depth</h2><div class="pg-grid2"><div class="pg-board"><div class="pg-flabel">4-point grid</div><div style="display:flex;flex-direction:column;gap:8px">${spaces}</div></div><div class="pg-board"><div class="pg-flabel">Radii</div><div style="display:flex;gap:16px;flex-wrap:wrap">${radii}</div><div class="pg-flabel" style="margin-top:22px">Shadows</div><div class="phone" data-platform="ios" data-scheme="light" style="--pw:100%;--ph:auto;height:auto;border-radius:16px;padding:24px;display:flex;gap:24px;justify-content:center">${shadows}</div></div></div></section>
<section class="pg-section"><h2>The wisp</h2><p class="sub">Seven poses made by moving the same parts. Eyes appear from 48 px; below that it is the ember. With the light out, it marks an attempt that didn’t work.</p><div class="pg-grid2">${schemes().map(wisps).join('')}</div></section>
<section class="pg-section"><h2>Springs</h2><p class="sub">Response and damping ratio, the mass-1 stiffness and damping Reanimated takes, and the settled duration of the CSS <code>linear()</code> curve the SDK plays.</p><div class="pg-board pg-tablewrap"><table class="pg-table"><thead><tr><th>Spring</th><th>Response · ζ</th><th>Stiffness · damping</th><th>Settles</th><th>Use</th></tr></thead><tbody>${springs}</tbody></table></div></section>
<section class="pg-section"><h2>App glyphs</h2><p class="sub">The 145 glyphs an app can pick for its tile and use with <code>Icon</code>. From Lucide (ISC).</p><div class="pg-board"><div class="pg-icons">${glyphs}</div></div></section>
<section class="pg-section"><h2>Shell icons</h2><div class="pg-board"><div class="pg-icons">${shell}</div></div></section>`;
}

// ── Motion lab ──────────────────────────────────────────────────────────────
function viewMotion() {
  const sc = document.documentElement.getAttribute('data-theme') || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const stage = (inner, w = 320, h = 560, extra = '') => `<div class="pg-stage"><div class="phone" data-platform="${PG.platform}" data-scheme="${sc}" style="--pw:${w}px;--ph:${h}px;border-radius:32px;${extra}">${inner}</div></div>`;
  const springRows = Object.entries(SPRINGS).map(([n, s]) => `<div class="pg-spring"><div><b>${n}</b><div class="pg-mono">${s.response} · ${s.damping}</div></div><canvas data-spring="${n}" width="560" height="128" aria-label="${n} step response"></canvas><div class="pg-track" data-track="${n}" role="button" tabindex="0" aria-label="Play ${n}"><span class="ball"></span></div></div>`).join('');
  return `<div class="pg-focus-head"><div><div class="pg-flabel">Motion</div><h2>Play with it</h2><p>Real springs, interruptible. Tap mid-flight to reverse; drag the sheets and screens. Reduce Motion switches every demo to its calmer version.</p></div><div class="pg-row"><button class="pg-btn" id="rm-toggle" aria-pressed="false">Reduce Motion: off</button></div></div>
<div class="pg-demos">
<div class="pg-demo" style="grid-column:1/-1"><h3>The six springs</h3><p>Step response over 1.2 s. Tap a track to send the ball across; tap again before it lands to reverse it from where it is.</p><div>${springRows}</div></div>
<div class="pg-demo"><h3>Press</h3><p>Touch-down: <b>instant</b> to 0.97. Release: <b>snappy</b> back. Drag off to cancel.</p>${stage(`<div class="w-screen" style="padding:56px 24px;gap:28px;align-items:center;justify-content:flex-start">${btn('Make it', 'ember')}<div style="display:flex;gap:18px" data-press-tiles>${tile(APPS.pour, { size: 72 })}${tile(APPS.water, { size: 72 })}${tile(APPS.dice, { size: 72 })}</div>${btn('Back to your apps', 'secondary')}</div>`, 320, 420)}</div>
<div class="pg-demo"><h3>Sheet</h3><p>Drag it. Release projects your momentum (d = 0.998) and hands the velocity to <b>fling</b>; above the top it rubber-bands.</p>${stage(`<div class="w-screen" data-sheet-demo><div style="padding:60px 20px 0">${list([row({ title: 'History', chev: true, icon: 'history' }), row({ title: 'Report a problem', chev: true, icon: 'flag' })], { icons: true })}<div style="margin-top:16px">${btn('Open sheet', 'ink', { size: 'md' })}</div></div><div class="w-scrim" style="opacity:0;pointer-events:none"></div><div class="w-sheet" style="height:330px;touch-action:none;cursor:grab"><div class="w-grabber"></div><div class="w-sheet-head"><span class="t-title2">Drag me</span></div><div class="w-pad t-callout t-sec">Flick down to dismiss. A slow drag past halfway also dismisses; less springs back.</div></div></div>`)}</div>
<div class="pg-demo"><h3>Open and close an app</h3><p>Tap a tile: the app grows out of it with <b>morph</b>. Tap the open app to close it with <b>smooth</b>. Tap during either to reverse.</p>${stage(`<div class="w-screen" data-morph-demo style="padding-top:64px"><div class="w-grid" style="--tile:60px">${[APPS.pour, APPS.water, APPS.dice, APPS.plant].map((a) => tile(a, { size: 60 })).join('')}</div><div class="w-grid" style="--tile:60px;margin-top:18px">${[APPS.read, APPS.focus, APPS.budget, APPS.habit].map((a) => tile(a, { size: 60 })).join('')}</div><div class="morph-layer" style="position:absolute;left:0;top:0;width:100%;height:100%;display:none;z-index:9;cursor:pointer"><div class="ml-bg" style="position:absolute;inset:0"></div><div class="ml-glyph" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center"></div><div class="ml-app" style="position:absolute;inset:0;opacity:0;padding:70px 20px;color:var(--t-on)"><div class="t-title1">App</div><div class="t-callout" style="opacity:.85;margin-top:6px">Tap to close into the tile</div></div></div></div>`)}</div>
<div class="pg-demo"><h3>Ghost becomes tile</h3><p>The ember tile flares (<b>spark</b>), the tint fills from the centre and the glyph settles (<b>morph</b>).</p>${stage(`<div class="w-screen" data-transmute style="align-items:center;justify-content:center;gap:26px"><div class="tm-tile" style="position:relative;width:96px;height:96px"></div><div class="pg-row" style="justify-content:center">${btn('Deliver', 'ember', { size: 'md', block: false })}${btn('Reset', 'secondary', { size: 'md', block: false })}</div></div>`, 320, 360)}</div>
<div class="pg-demo"><h3>Honest light</h3><p>The glow follows tokens per second. Nothing arrives, nothing moves; after a stall the wisp dims and holds still.</p>${stage(`<div class="w-screen" data-honest style="align-items:center;padding-top:60px;gap:18px"><div class="hl-wisp"></div><div class="t-headline hl-label">Making Pour Timer</div><div class="t-callout t-sec hl-line">Usually about a minute.</div></div>`, 320, 380)}<label class="pg-row" style="font-size:14px">Tokens per second <input type="range" id="hl-rate" class="pg-range" min="0" max="60" value="28" style="flex:1"></label><div class="pg-row"><button class="pg-btn" id="hl-stall">Stall the stream</button></div></div>
<div class="pg-demo"><h3>Controls</h3><p>Toggles, segments, chips and steppers use <b>snappy</b>, retargeting if you tap quickly.</p>${stage(`<div class="w-screen s-app tint-sky" data-controls style="padding:40px 20px;gap:18px"><div class="s-list"><div class="s-item" data-switch><div class="i-main">Remind me</div><span class="s-switch" style="transition:background-color 150ms"><span class="knob"></span></span></div></div><div class="s-seg" data-seg style="position:relative"><i class="thumb" style="position:absolute;top:2px;bottom:2px;left:2px;border-radius:16px;background:var(--w-surface);box-shadow:var(--w-shadow-raised)"></i><span style="position:relative">Easy</span><span style="position:relative">Steady</span><span style="position:relative">Fast</span></div><div class="w-chips" data-chips>${chip('Just today')}${chip('A few weeks')}${chip('Everything')}</div><div class="s-card" style="padding:14px 16px 14px 20px"><div class="s-stepper"><span>Glasses</span><span class="grp"><button data-step="-1">${icon('minus', 20, 2.2)}</button><span class="val" data-val style="overflow:hidden;height:28px;display:inline-block;position:relative">5</span><button data-step="1">${icon('plus', 20, 2.2)}</button></span></div></div></div>`, 320, 440)}</div>
<div class="pg-demo"><h3>Back by swipe (iOS)</h3><p>Drag from the left edge. The screen tracks your finger, the one underneath slides in from −30%; release commits past half or on a fast flick.</p>${stage(`<div class="w-screen" data-swipe><div class="sw-under" style="position:absolute;inset:0;background:var(--w-bg);padding:64px 20px 0"><div class="t-large">Settings</div><div style="margin-top:18px">${list([row({ title: 'AI features', trail: 'On', chev: true }), row({ title: 'Advanced', chev: true })])}</div><div class="sw-dim" style="position:absolute;inset:0;background:#000;opacity:.12;pointer-events:none"></div></div><div class="sw-top" style="position:absolute;inset:0;background:var(--w-bg);padding:64px 20px 0;box-shadow:-8px 0 24px rgba(0,0,0,.12);touch-action:none"><div class="t-title1">Advanced</div><div style="margin-top:18px">${list([row({ title: 'Send error details', sw: true }), row({ title: 'Phone ID', sub: 'ec815211-2b6c…' })])}</div><div class="t-footnote t-sec" style="margin-top:14px">Drag from the left edge →</div><div class="sw-again" style="position:absolute;left:20px;right:20px;bottom:40px;display:none">${btn('Push it again', 'ink', { size: 'md' })}</div></div></div>`)}</div>
</div>`;
}

// ── Motion wiring ───────────────────────────────────────────────────────────
function cssColor(name, el) { return getComputedStyle(el || document.documentElement).getPropertyValue(name).trim(); }

function wireMotion(root) {
  const rmBtn = root.querySelector('#rm-toggle');
  const setRM = (on) => { REDUCED = on; rmBtn.textContent = `Reduce Motion: ${on ? 'on' : 'off'}`; rmBtn.setAttribute('aria-pressed', String(on)); };
  setRM(REDUCED);
  rmBtn.addEventListener('click', () => setRM(!REDUCED));

  // Spring curves and tracks
  const accent = cssColor('--pg-accent'), line = cssColor('--pg-line'), text2 = cssColor('--pg-text2');
  root.querySelectorAll('canvas[data-spring]').forEach((cv) => {
    const s = SPRINGS[cv.dataset.spring], ctx = cv.getContext('2d'), W = cv.width, H = cv.height;
    const { k, c } = springConsts(s); let x = 0, v = 0; const pts = [];
    for (let i = 0; i <= 240; i++) { for (let j = 0; j < 8; j++) { const a = -k * (x - 1) - c * v; v += a * (1.2 / 240 / 8); x += v * (1.2 / 240 / 8); } pts.push(x); }
    const y = (val) => H - 14 - val * (H - 40);
    ctx.clearRect(0, 0, W, H); ctx.strokeStyle = line; ctx.lineWidth = 2; ctx.setLineDash([6, 6]); ctx.beginPath(); ctx.moveTo(0, y(1)); ctx.lineTo(W, y(1)); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = accent; ctx.lineWidth = 4; ctx.beginPath(); pts.forEach((p, i) => { const px = (i / 240) * W; if (i) ctx.lineTo(px, y(p)); else ctx.moveTo(px, y(p)); }); ctx.stroke();
    ctx.fillStyle = text2; ctx.font = '20px system-ui'; ctx.fillText('1.2 s', W - 52, H - 2);
  });
  root.querySelectorAll('[data-track]').forEach((tr) => {
    const ball = tr.querySelector('.ball'), cfg = SPRINGS[tr.dataset.track];
    const span = () => tr.clientWidth - 28;
    const sv = new SpringValue(0, (p) => { ball.style.transform = `translateX(${p * span()}px)`; });
    const go = () => { if (REDUCED) { sv.set(sv.target > .5 ? 0 : 1); return; } sv.to(sv.target > .5 ? 0 : 1, cfg); };
    tr.addEventListener('click', go);
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });

  // Press
  root.querySelectorAll('.pg-demo .w-btn, [data-press-tiles] .w-tile').forEach((el) => {
    const sv = new SpringValue(1, (s) => { if (REDUCED) { el.style.transform = ''; el.style.opacity = String(1 - (1 - s) * 10 * .3); } else { el.style.transform = `scale(${s})`; el.style.opacity = ''; } });
    const target = el.classList.contains('w-tile') ? .96 : .97;
    let down = false;
    el.addEventListener('pointerdown', () => { down = true; sv.to(target, SPRINGS.instant); });
    const up = () => { if (!down) return; down = false; sv.to(1, SPRINGS.snappy); };
    el.addEventListener('pointerup', up); el.addEventListener('pointerleave', up); el.addEventListener('pointercancel', up);
  });

  // Sheet
  const sd = root.querySelector('[data-sheet-demo]');
  if (sd) {
    const sheet = sd.querySelector('.w-sheet'), scrim = sd.querySelector('.w-scrim'), H = 330;
    const apply = (y) => { if (REDUCED && !dragging) { sheet.style.transform = `translateY(${y > H / 2 ? H + 20 : 0}px)`; sheet.style.opacity = String(Math.max(0, 1 - y / H)); } else { sheet.style.transform = `translateY(${y}px)`; sheet.style.opacity = ''; } scrim.style.opacity = String(Math.max(0, Math.min(1, 1 - y / H))); };
    let dragging = false, startY = 0, startPos = 0; const vt = new VelocityTracker();
    const sv = new SpringValue(0, apply, { precision: .3 });
    sheet.addEventListener('pointerdown', (e) => { dragging = true; sv.stop(); startY = e.clientY; startPos = sv.x; vt.reset(); vt.add(e.clientY); sheet.setPointerCapture(e.pointerId); sheet.style.cursor = 'grabbing'; });
    sheet.addEventListener('pointermove', (e) => { if (!dragging) return; let y = startPos + (e.clientY - startY); if (y < 0) y = rubberband(y, H); sv.x = y; apply(y); vt.add(e.clientY); });
    const release = () => {
      if (!dragging) return; dragging = false; sheet.style.cursor = 'grab';
      const v = vt.velocity(), end = sv.x + project(v), close = end > H / 2;
      if (REDUCED) { sv.set(close ? H + 20 : 0); return; }
      sv.to(close ? H + 20 : 0, SPRINGS.fling, v);
    };
    sheet.addEventListener('pointerup', release); sheet.addEventListener('pointercancel', release);
    sd.querySelector('.w-btn').addEventListener('click', () => { if (REDUCED) sv.set(0); else sv.to(0, SPRINGS.smooth); });
  }

  // Morph: tile to app and back
  const md = root.querySelector('[data-morph-demo]');
  if (md) {
    const layer = md.querySelector('.morph-layer'), bg = layer.querySelector('.ml-bg'), gl = layer.querySelector('.ml-glyph'), appC = layer.querySelector('.ml-app');
    let from = null, opening = false; const SW = 320, SH = 560;
    const draw = (p) => {
      if (!from) return;
      if (REDUCED) { layer.style.transform = ''; layer.style.borderRadius = '32px'; layer.style.opacity = String(Math.min(1, p)); gl.style.opacity = '0'; appC.style.opacity = String(p); return; }
      layer.style.opacity = '1';
      const x = from.x * (1 - p), yy = from.y * (1 - p), w = from.w + (SW - from.w) * p, h = from.h + (SH - from.h) * p;
      const sx = w / SW, sy = h / SH, r = from.w * .225 * (1 - p) + 32 * p;
      layer.style.transform = `translate(${x}px,${yy}px) scale(${sx},${sy})`;
      layer.style.borderRadius = `${r / sx}px / ${r / sy}px`;
      gl.style.transform = `scale(${(from.w / SW) / sx * (1 + p * .4)},${(from.w / SW) / sx * (1 + p * .4) * (sx / sy)})`;
      gl.style.opacity = String(Math.max(0, 1 - p * 1.4));
      appC.style.opacity = String(Math.max(0, (p - .75) / .25));
      appC.style.transform = `scale(${1 / sx},${1 / sy})`; appC.style.transformOrigin = 'top left';
    };
    const sv = new SpringValue(0, draw, { precision: .002 });
    sv.onRest = () => { if (sv.x === 0) { layer.style.display = 'none'; md.querySelectorAll('.w-tile').forEach((t) => { t.style.visibility = ''; }); } };
    md.querySelectorAll('.w-cell').forEach((cell) => cell.addEventListener('click', () => {
      const t = cell.querySelector('.w-tile'), r = t.getBoundingClientRect(), base = md.getBoundingClientRect();
      const k = base.width / SW;
      from = { x: (r.left - base.left) / k, y: (r.top - base.top) / k, w: r.width / k, h: r.height / k };
      const tint = [...cell.classList].find((cl) => cl.startsWith('tint-'));
      layer.className = `morph-layer ${tint}`; bg.style.background = 'var(--t-fill)';
      gl.innerHTML = t.querySelector('.glyph').innerHTML; gl.style.color = 'var(--t-on)';
      appC.querySelector('.t-title1').textContent = cell.querySelector('.nm').textContent;
      md.querySelectorAll('.w-tile').forEach((tt) => { tt.style.visibility = ''; }); t.style.visibility = 'hidden';
      layer.style.display = 'block'; layer.style.transformOrigin = 'top left'; opening = true;
      if (REDUCED) { sv.set(0); sv.to(1, { response: .16, damping: 1 }); return; }
      sv.set(0); sv.to(1, SPRINGS.morph);
    }));
    layer.addEventListener('click', () => { opening = !opening; const target = opening ? 1 : 0; if (REDUCED) { sv.to(target, { response: .16, damping: 1 }); return; } sv.to(target, opening ? SPRINGS.morph : SPRINGS.smooth); });
  }

  // Ghost to tile
  const tm = root.querySelector('[data-transmute]');
  if (tm) {
    const holder = tm.querySelector('.tm-tile');
    const build = () => {
      holder.innerHTML = `<svg viewBox="0 0 100 100" style="position:absolute;inset:0;width:100%;height:100%"><path d="${SQUIRCLE}" style="fill:var(--w-ember-soft)"/></svg><div class="tm-fill tint-cocoa" style="position:absolute;inset:0;clip-path:circle(0% at 50% 50%)"><svg viewBox="0 0 100 100" style="position:absolute;inset:0;width:100%;height:100%"><path d="${SQUIRCLE}" style="fill:var(--t-fill)"/></svg><div class="tm-glyph" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--t-on);opacity:0">${icon('timer', 48, 2)}</div></div><div class="tm-ember" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center">${wisp({ size: 54, pose: 'making', eyes: false, activity: 1 })}</div>`;
    };
    build();
    const fill = () => holder.querySelector('.tm-fill'), glyph = () => holder.querySelector('.tm-glyph'), ember = () => holder.querySelector('.tm-ember');
    const m = new SpringValue(0, (p) => { fill().style.clipPath = `circle(${(p * 72).toFixed(1)}% at 50% 50%)`; glyph().style.opacity = String(p); glyph().style.transform = `scale(${.9 + .1 * p})`; ember().style.opacity = String(1 - p); });
    const g = new SpringValue(1, (s) => { ember().style.transform = `scale(${s})`; });
    const [deliver, reset] = tm.querySelectorAll('.w-btn');
    deliver.addEventListener('click', () => {
      if (REDUCED) { m.set(1); return; }
      g.set(1); g.to(1.35, SPRINGS.spark); setTimeout(() => { g.to(1, SPRINGS.spark); m.to(1, SPRINGS.morph); }, 140);
    });
    reset.addEventListener('click', () => { m.stop(); g.stop(); build(); m.set(0); g.set(1); });
  }

  // Honest light
  const hl = root.querySelector('[data-honest]');
  if (hl) {
    const holder = hl.querySelector('.hl-wisp'), line = hl.querySelector('.hl-line'), rate = root.querySelector('#hl-rate'), stallBtn = root.querySelector('#hl-stall');
    let pose = 'making', stalled = false, last = performance.now(), lastArrival = performance.now(), flick = 0, alive = true;
    const render = () => { holder.innerHTML = wisp({ size: 140, pose, activity: 1 }); };
    render();
    const act = new SpringValue(.6, () => {}, { precision: .0005 }); act.cfg = { response: .6, damping: 1 };
    stallBtn.addEventListener('click', () => { stalled = !stalled; stallBtn.textContent = stalled ? 'Resume the stream' : 'Stall the stream'; });
    const tick = (t) => {
      if (!alive || !holder.isConnected) return;
      const dt = (t - last) / 1000; last = t;
      const r = stalled ? 0 : +rate.value;
      if (Math.random() < r * dt) { lastArrival = t; flick += .07 * act.x; }
      flick *= Math.exp(-dt / .12);
      const since = (t - lastArrival) / 1000;
      const targetA = stalled && since > 2 ? .15 : Math.min(1, r / 40);
      act.to(targetA, { response: .6, damping: 1 });
      const newPose = stalled && since > 2 ? 'stuck' : r === 0 ? 'listening' : 'making';
      if (newPose !== pose) { pose = newPose; render(); line.textContent = pose === 'stuck' ? 'No word from the server for 40 s. Still waiting.' : 'Usually about a minute.'; }
      const I = Math.min(1.15, .55 + .45 * act.x + (REDUCED ? 0 : flick));
      const halo = holder.querySelector('circle'); const body = holder.querySelector('g');
      if (halo) { halo.setAttribute('opacity', String((pose === 'stuck' ? .25 : .9) * I)); halo.setAttribute('r', String(22 + 6 * I)); }
      if (body) body.style.filter = `brightness(${(.82 + .22 * I).toFixed(3)})`;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // Controls
  const ctl = root.querySelector('[data-controls]');
  if (ctl) {
    const sw = ctl.querySelector('.s-switch'); let on = false;
    sw.style.setProperty('position', 'relative');
    const knobSv = new SpringValue(0, (p) => { sw.style.setProperty('--k', p); sw.classList.toggle('on', p > .5); });
    sw.style.cssText += ';';
    const styleKnob = document.createElement('style');
    styleKnob.textContent = '[data-controls] .s-switch::after{left:calc(2px + var(--k,0) * 20px)!important}';
    ctl.appendChild(styleKnob);
    ctl.querySelector('[data-switch]').addEventListener('click', () => { on = !on; if (REDUCED) knobSv.set(on ? 1 : 0); else knobSv.to(on ? 1 : 0, SPRINGS.snappy); sw.classList.toggle('on', on); });
    const seg = ctl.querySelector('[data-seg]'), thumb = seg.querySelector('.thumb'), opts = [...seg.querySelectorAll('span')];
    const segW = () => (seg.clientWidth - 4) / 3;
    const segSv = new SpringValue(1, (i) => { thumb.style.width = `${segW()}px`; thumb.style.transform = `translateX(${i * segW()}px)`; });
    segSv.set(1);
    opts.forEach((o, i) => o.addEventListener('click', () => { if (REDUCED) segSv.set(i); else segSv.to(i, SPRINGS.snappy); }));
    ctl.querySelectorAll('[data-chips] .w-chip').forEach((ch) => ch.addEventListener('click', () => {
      ctl.querySelectorAll('[data-chips] .w-chip').forEach((x) => { x.classList.remove('sel'); x.innerHTML = x.textContent; });
      ch.classList.add('sel'); ch.innerHTML = icon('check', 16, 2.6) + ch.textContent;
    }));
    const val = ctl.querySelector('[data-val]'); let n = 5;
    ctl.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => {
      const d = +b.dataset.step; if (n + d < 0) return; n += d;
      if (REDUCED) { val.textContent = String(n); return; }
      const out = document.createElement('span'); out.textContent = val.textContent; out.style.cssText = 'position:absolute;left:0;right:0;top:0';
      val.textContent = String(n); val.appendChild(out);
      const p = new SpringValue(0, (x) => { out.style.transform = `translateY(${-d * 14 * x}px)`; out.style.opacity = String(1 - x); val.firstChild.parentElement.style.setProperty('--y', String(d * 14 * (1 - x))); });
      p.onRest = () => out.remove(); p.to(1, SPRINGS.snappy);
    }));
  }

  // Back swipe
  const swd = root.querySelector('[data-swipe]');
  if (swd) {
    const topEl = swd.querySelector('.sw-top'), under = swd.querySelector('.sw-under'), dim = swd.querySelector('.sw-dim'), again = swd.querySelector('.sw-again');
    const W = 320; let dragging = false, sx = 0, start = 0; const vt = new VelocityTracker();
    const apply = (x) => { const p = Math.min(1, Math.max(0, x / W)); topEl.style.transform = `translateX(${x}px)`; under.style.transform = `translateX(${-.3 * W * (1 - p)}px)`; dim.style.opacity = String(.12 * (1 - p)); };
    const sv = new SpringValue(0, apply, { precision: .3 });
    apply(0);
    topEl.addEventListener('pointerdown', (e) => { const r = topEl.getBoundingClientRect(); if (e.clientX - r.left > 28 && sv.x === 0) return; dragging = true; sv.stop(); sx = e.clientX; start = sv.x; vt.reset(); vt.add(e.clientX); topEl.setPointerCapture(e.pointerId); });
    topEl.addEventListener('pointermove', (e) => { if (!dragging) return; const x = Math.max(0, start + e.clientX - sx); sv.x = x; apply(x); vt.add(e.clientX); });
    const rel = () => {
      if (!dragging) return; dragging = false;
      const v = vt.velocity(), end = sv.x + project(v), commit = end > W / 2 || v > 500;
      if (REDUCED) { sv.set(commit ? W : 0); }
      else sv.to(commit ? W : 0, SPRINGS.fling, v);
      again.style.display = commit ? 'block' : 'none';
    };
    topEl.addEventListener('pointerup', rel); topEl.addEventListener('pointercancel', rel);
    swd.addEventListener('click', (e) => { if (e.target.closest('.sw-again') || (sv.target === W && e.target.closest('.sw-under'))) { if (REDUCED) sv.set(0); else sv.to(0, SPRINGS.smooth); again.style.display = 'none'; } });
  }
}

// ── Shell ───────────────────────────────────────────────────────────────────
function navHTML(route) {
  const link = (h, label) => `<a href="#${h}" class="${(route === h || (h === '' && (route === '' || route.startsWith('s-')))) ? 'on' : ''}">${label}</a>`;
  const seg = (key, opts) => `<div class="pg-seg" role="group" aria-label="${key}">${opts.map(([v, l]) => `<button data-${key}="${v}" class="${PG[key] === v ? 'on' : ''}" aria-pressed="${PG[key] === v}">${l}</button>`).join('')}</div>`;
  return `<div class="pg-bar-in"><a class="pg-brand" href="#">${wispMini()}Whim · system v1</a><nav class="pg-nav">${link('', 'Screens')}${link('components', 'Components')}${link('tokens', 'Tokens')}${link('motion', 'Motion')}</nav><div class="pg-tools">${seg('platform', [['ios', 'iPhone'], ['android', 'Android']])}${seg('scheme', [['both', 'Both'], ['light', 'Light'], ['dark', 'Dark']])}</div></div>`;
}
function wispMini() { return `<span class="phone" data-scheme="light" data-platform="ios" style="--pw:26px;--ph:26px;border-radius:0;background:none;display:inline-flex;overflow:visible">${wisp({ size: 26, eyes: false, activity: .8 })}</span>`; }

function render() {
  const route = (location.hash || '').replace(/^#/, '');
  document.getElementById('pg-bar').innerHTML = navHTML(route);
  let html;
  if (route.startsWith('s-')) html = viewScreen(route.slice(2));
  else if (route === 'components') html = viewComponents();
  else if (route === 'tokens') html = viewTokens();
  else if (route === 'motion') html = viewMotion();
  else html = viewOverview();
  const main = document.getElementById('pg-main');
  main.innerHTML = html;
  if (route === 'motion') wireMotion(main);
  document.querySelectorAll('[data-platform]').forEach((b) => { if (b.tagName === 'BUTTON') b.addEventListener('click', () => { PG.platform = b.dataset.platform; save(); render(); }); });
  document.querySelectorAll('[data-scheme]').forEach((b) => { if (b.tagName === 'BUTTON') b.addEventListener('click', () => { PG.scheme = b.dataset.scheme; save(); render(); }); });
}

document.body.insertAdjacentHTML('afterbegin', WISP_DEFS);
window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });
let rT = 0; window.addEventListener('resize', () => { clearTimeout(rT); rT = setTimeout(() => { if (!location.hash.includes('motion')) render(); }, 200); });
render();
