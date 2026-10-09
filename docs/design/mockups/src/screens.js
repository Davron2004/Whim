// Whim mockups: every screen and state. Each entry renders one frame for c = { p, s }.

const APPS = {
  pour: { name: 'Pour Timer', tint: 'cocoa', icon: 'timer' },
  water: { name: 'Water Counter', tint: 'sky', icon: 'glass-water' },
  tip: { name: 'Tip Splitter', tint: 'green', icon: 'receipt' },
  plant: { name: 'Plant Care', tint: 'lime', icon: 'sprout' },
  dice: { name: 'Dice Night', tint: 'red', icon: 'dice-5' },
  dough: { name: 'Sourdough', tint: 'yellow', icon: 'wheat' },
  read: { name: 'Reading List', tint: 'indigo', icon: 'book-open' },
  focus: { name: 'Focus', tint: 'violet', icon: 'hourglass' },
  budget: { name: 'Budget Check', tint: 'teal', icon: 'wallet' },
  coin: { name: 'Coin Flip', tint: 'graphite', icon: 'coins' },
  habit: { name: 'Habit Streaks', tint: 'pink', icon: 'calendar-check' },
  gallery: { name: 'Style Gallery', tint: 'grape', icon: 'palette' },
};
const HOME_SET = ['pour', 'water', 'tip', 'plant', 'dice', 'dough', 'read', 'focus', 'budget', 'coin', 'habit', 'gallery'];

const G = (c) => ({
  W: c.p === 'ios' ? 390 : 412,
  H: c.p === 'ios' ? 844 : 915,
  status: c.p === 'ios' ? 54 : 40,
  safe: c.p === 'ios' ? 34 : 24,
  tile: c.p === 'ios' ? 64 : 68,
});

// ── Home pieces ─────────────────────────────────────────────────────────────
function homeGrid(c, cells) { return `<div class="w-grid" style="--tile:${G(c).tile}px">${cells.join('')}</div>`; }

function homeBody(c, cells, { notice = '', composer = true } = {}) {
  const g = G(c);
  return `<div class="w-screen">${topSpace(c)}${header(c, { back: false, right: iconBtn('settings', 'Settings', { size: 24 }) })}
<div class="w-titleblock"><div class="t-large">Your apps</div></div>
${notice ? `<div class="w-pad" style="margin-top:14px">${notice}</div>` : ''}
<div style="height:22px"></div>${homeGrid(c, cells)}
${composer ? `<div class="w-edgefade bottom" style="bottom:${g.safe}px;height:80px"></div><div class="w-composer" style="bottom:${g.safe + 12}px">${wisp({ size: 22, eyes: false, activity: .5 })}<span>Make an app…</span></div>` : ''}</div>`;
}

const readyCells = (c, keys) => keys.map((k) => tile(APPS[k], { size: G(c).tile }));

// Position of a home grid cell, for overlays (context menu).
function cellRect(c, index) {
  const g = G(c), colW = (g.W - 40) / 4, row = Math.floor(index / 4), col = index % 4;
  const top = g.status + 44 + 44 + 22 + row * (g.tile + 22 + 20);
  const cx = 20 + col * colW + colW / 2;
  return { cx, top, left: cx - g.tile / 2 };
}

// ── In-app pieces (what the SDK draws) ──────────────────────────────────────
function appFrame(c, app, inner, { orb = true, orbState = '', overlay = '', back = false, title = '', action = '' } = {}) {
  const g = G(c);
  const orbHtml = orb ? `<div class="w-orb" style="bottom:${g.safe + 16}px">${orbState === 'glow' ? '<span class="ring" style="position:absolute;inset:-4px;border-radius:50%;box-shadow:0 0 0 2px var(--w-glow-mid),0 0 16px 3px color-mix(in srgb,var(--w-glow-mid) 60%,transparent)"></span>' : ''}${wisp({ size: 22, eyes: false, activity: orbState === 'glow' ? 1 : .35 })}${orbState === 'dot' ? '<span class="dot"></span>' : ''}</div>` : '';
  const head = title ? `${header(c, { back, right: action })}<div class="s-header"><div class="s-title">${esc(title)}</div></div>` : '';
  const body = `<div class="w-screen s-app tint-${app.tint}">${topSpace(c)}${head}<div class="w-scroll" style="padding:16px 20px 0">${inner}</div>${orbHtml}</div>`;
  return frame(c, body, { overlay });
}

const sCard = (inner, style = '') => `<div class="s-card" style="${style}">${inner}</div>`;
const sBtn = (label, v = '', ic = '') => `<button class="s-btn ${v}">${ic ? icon(ic, 20, 2.2) : ''}${esc(label)}</button>`;
const sItem = (title, sub, trail, ic) => `<div class="s-item">${ic ? `<span style="color:var(--w-text2)">${icon(ic, 20, 2)}</span>` : ''}<div class="i-main"><div>${title}</div>${sub ? `<div class="i-sub">${sub}</div>` : ''}</div>${trail ? `<span class="i-trail">${trail}</span>` : ''}</div>`;

function ring(value, size, label, sub, stroke = 10) {
  const r = (size - stroke) / 2, C = 2 * Math.PI * r;
  return `<div style="position:relative;width:${size}px;height:${size}px;margin:0 auto"><svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="transform:rotate(-90deg)"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" style="stroke:var(--w-fill-strong)" stroke-width="${stroke}"/><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" style="stroke:var(--a-fill)" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${(C * (1 - value)).toFixed(1)}"/></svg><div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center"><div class="t-display">${label}</div>${sub ? `<div class="t-callout t-sec">${sub}</div>` : ''}</div></div>`;
}

function timerApp(c) {
  return `<div class="s-stack" style="gap:20px">
<div class="s-seg"><span class="on">V60</span><span>Chemex</span><span>AeroPress</span></div>
${sCard(`${ring(.38, 208, '2:30', 'Bloom')}<div style="display:flex;justify-content:center;margin-top:14px"><span class="s-badge">Step 2 of 4</span></div>`)}
<div class="s-row">${sBtn('Pause', '', 'pause').replace('s-btn', 's-btn" style="flex:1')}${sBtn('Reset', 'secondary').replace('s-btn secondary', 's-btn secondary" style="flex:1')}</div>
<div class="s-list">${sItem('Bloom', '50 g of water', '0:30')}${sItem('First pour', 'Up to 150 g', '1:00')}${sItem('Second pour', 'Up to 250 g', '1:30')}</div></div>`;
}

function waterApp(c) {
  return `<div class="s-stack" style="gap:16px">
${sCard(`${ring(5 / 8, 168, '5', 'of 8 glasses', 12)}`)}
${sCard(`<div class="s-stepper"><span>Glasses today</span><span class="grp"><button>${icon('minus', 20, 2.2)}</button><span class="val">5</span><button>${icon('plus', 20, 2.2)}</button></span></div>`, 'padding:14px 16px 14px 20px')}
<div class="t-footnote t-sec t-semibold" style="margin:6px 0 -6px 4px">Today</div>
<div class="s-list">${sItem('Glass of water', '', '8:10', 'glass-water')}${sItem('Glass of water', '', '10:45', 'glass-water')}${sItem('Glass of water', '', '13:20', 'glass-water')}</div></div>`;
}

// ── Making-flow pieces ──────────────────────────────────────────────────────
function flowSheet(c, inner, { actions = '', head = '' } = {}) {
  const g = G(c);
  return `<div class="w-scrim"></div><div class="w-sheet large"><div class="w-grabber"></div>${head}<div class="w-sheet-body">${inner}</div>${actions ? `<div class="w-actions">${actions}</div>` : ''}<div style="height:${g.safe + 12}px;flex:none"></div></div>`;
}
const closeBtn = () => `<button class="w-iconbtn filled" aria-label="Close"><span>${icon('x', 18, 2.4)}</span></button>`;
const sheetHead = (c, { back = false, right = '' } = {}) => `<div class="w-sheet-head" style="padding-left:${back ? 8 : 20}px">${back ? `<button class="w-iconbtn" aria-label="Back">${icon(c.p === 'ios' ? 'chevron-left' : 'arrow-left', c.p === 'ios' ? 28 : 24, 2.2)}</button>` : '<span></span>'}<span style="display:flex;align-items:center">${right}${closeBtn()}</span></div>`;

function homeUnder(c, keys = HOME_SET) { return homeBody(c, readyCells(c, keys)); }

function question(q, opts, hint = '') {
  return `<div class="w-q"><div class="q-text">${esc(q)}</div>${hint ? `<div class="q-hint">${esc(hint)}</div>` : ''}<div class="w-chips">${opts.join('')}</div></div>`;
}
function planRow(label, text, { edited = false } = {}) {
  return `<div class="w-planrow"><div class="p-label"><span>${esc(label)}</span>${edited ? '<span class="w-badge">Edited</span>' : `<span class="t-ter">${icon('pencil', 15, 2)}</span>`}</div><div class="p-text">${text}</div></div>`;
}
const youSaid = (t) => `<div class="t-body t-quote" style="margin-top:6px">“${esc(t)}”</div>`;

const POUR_QUESTIONS = (answered) => [
  question('Which brewer do you use?', [chip('V60', { sel: answered }), chip('Chemex'), chip('AeroPress'), chip('I’ll decide', { decide: true, sel: !answered })]),
  question('Anything when a step ends?', [chip('A chime'), chip('Vibrate only'), chip('I’ll decide', { decide: true, sel: true })]),
];
const POUR_PLAN = [
  planRow('What it is', 'A step-by-step timer for a pour-over, with the water amount for each pour.'),
  planRow('Main screen', 'A big countdown for the current step, the next pour underneath, and Start and Reset.'),
  planRow('Steps', 'Bloom 30 s with 50 g, then three pours up to 250 g, about 3 minutes in all.'),
  planRow('What it remembers', 'Your brewer and your last recipe.'),
];

// ── Screens ─────────────────────────────────────────────────────────────────
const SCREENS = [
  // Home
  { id: 'home', group: 'Your apps', title: 'Your apps', note: 'Four-column glyph tiles, a direct title, the composer as the way in. Brand lives in the ember, not a wordmark.',
    render: (c) => frame(c, homeUnder(c)) },
  { id: 'home-states', group: 'Your apps', title: 'Making, failed, changing', note: 'An app being made is Whim’s ember in its tile. A failed attempt keeps Whim’s mark with the light out. A change in flight rings the app’s own tile.',
    render: (c) => {
      const cells = [tile({ name: 'Pomodoro', tint: 'sky' }, { size: G(c).tile, state: 'making' }), tile({ name: 'Recipe scaler', tint: 'teal' }, { size: G(c).tile, state: 'failed' }), tile(APPS.pour, { size: G(c).tile, state: 'changing' }), tile({ ...APPS.water, tint: 'blue' }, { size: G(c).tile, second: 'Copy' }), ...readyCells(c, ['water', 'tip', 'plant', 'dice', 'dough', 'read', 'focus', 'budget'])];
      return frame(c, homeBody(c, cells));
    } },
  { id: 'home-menu', group: 'Your apps', title: 'Tile menu', note: 'Long-press lifts the tile and grows a menu from it. Six rows instead of eight; Delete stands apart.',
    render: (c) => {
      const g = G(c), r = cellRect(c, 1);
      const lifted = `<div style="position:absolute;z-index:22;left:${r.left}px;top:${r.top}px;transform:scale(1.06);transform-origin:center;filter:drop-shadow(0 10px 18px rgba(0,0,0,.22))">${tile(APPS.water, { size: g.tile, label: false })}</div>`;
      const mLeft = Math.min(Math.max(r.cx - 124, 16), g.W - 16 - 248), mTop = r.top + g.tile + 14;
      const menu = `<div class="w-menu" style="left:${mLeft}px;top:${mTop}px"><div class="m-row">${icon('play', 20, 2)}Open</div><div class="m-row">${icon('square-pen', 20, 2)}<span class="t-ember">Change it</span></div><div class="m-row">${icon('history', 20, 2)}History</div><div class="m-row">${icon('copy', 20, 2)}Make a copy</div><div class="m-row">${icon('share', 20, 2)}Share link</div><div class="m-sep"></div><div class="m-row danger">${icon('trash-2', 20, 2)}Delete</div></div>`;
      return frame(c, homeUnder(c), { overlay: `<div class="w-scrim"></div>${lifted}${menu}` });
    } },
  { id: 'delete-confirm', group: 'Your apps', title: 'Delete', note: 'The app’s own confirm sheet replaces the system alert. The safe choice is the big button.',
    render: (c) => frame(c, homeUnder(c), { overlay: `<div class="w-scrim"></div><div class="w-sheet"><div class="w-grabber"></div><div style="padding:20px 20px 0"><div class="t-title2">Delete Water Counter?</div><div class="t-body t-sec" style="margin-top:8px">It and everything saved in it will be removed from this phone. This can’t be undone.</div></div><div class="w-actions" style="padding-top:24px">${btn('Keep it', 'ink')}${btn('Delete', 'plain-danger')}</div><div style="height:${G(c).safe + 8}px"></div></div>` }) },
  { id: 'home-empty', group: 'Your apps', title: 'No apps yet', note: 'The only time the wisp sits on the home screen: when there is nothing else to look at.',
    render: (c) => frame(c, `<div class="w-screen">${topSpace(c)}${header(c, { back: false, right: iconBtn('settings', 'Settings', { size: 24 }) })}<div class="w-titleblock"><div class="t-large">Your apps</div></div>
<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0 32px 120px;text-align:center">${wisp({ size: 104, pose: 'listening' })}<div class="t-title2" style="margin-top:18px">Make your first app</div><div class="t-body t-sec" style="margin-top:8px">Say what you need in plain words. A timer, a tracker, a game for tonight.</div>
<div class="w-chips" style="justify-content:center;margin-top:22px">${chip('A timer for my pour-over', { idea: true })}${chip('How often I water the plants', { idea: true })}${chip('Dice for game night', { idea: true })}</div></div>
<div class="w-composer" style="bottom:${G(c).safe + 12}px">${wisp({ size: 22, eyes: false, activity: .5 })}<span>Make an app…</span></div></div>`) },

  // Making
  { id: 'consent', group: 'Making an app', title: 'First run', note: 'One sheet instead of Terms and Consent screens. Two separate acts kept on purpose: tick the terms, then agree to the data use.',
    render: (c) => frame(c, homeUnder(c), { overlay: flowSheet(c, `<div class="w-pad"><div class="t-title1">Before Whim makes apps for you</div><div class="t-body t-sec" style="margin-top:10px">To make an app, Whim sends what you ask for to our server, and AI companies that work for us write the code.</div></div>
<div class="w-group" style="margin-top:18px">${list([row({ icon: 'upload', title: 'What’s sent', sub: 'Your description, answers and plan. When you change an app, its code and data layout, never your data.' }), row({ icon: 'shield-check', title: 'What stays on your phone', sub: 'Everything you save in your apps.' }), row({ icon: 'eye', title: 'What we never do', sub: 'Ads, selling your data, tracking you.' })], { icons: true })}</div>
<div class="w-group" style="margin-top:12px">${list([row({ title: 'Privacy policy', ext: true }), row({ title: 'Full details', chev: true })])}</div><div style="height:12px"></div>
`,
      { head: sheetHead(c, { right: '<button class="w-textbtn" style="font-weight:500">Français</button>' }), actions: `<div class="w-row" style="padding:4px 2px 12px;min-height:0"><span class="s-check on" style="--a-fill:var(--w-ink);--a-on:var(--w-on-ink)">${icon('check', 16, 3)}</span><div class="r-main"><div class="r-title">I accept the <u>Terms of use</u></div></div></div>` + btn('Agree and continue', 'ink') + btn('Not now', 'plain') }) }) },
  { id: 'describe', group: 'Making an app', title: 'Describe', note: 'The composer grows into this sheet. The person types at 17pt; “I’ll ask” replaces “Whim will ask”.',
    render: (c) => {
      const g = G(c), kb = KBD_HEIGHT_SUGG[c.p];
      return frame(c, homeUnder(c), { overlay: `<div class="w-scrim"></div><div class="w-sheet large" style="bottom:${kb}px;border-radius:28px 28px 0 0"><div class="w-grabber"></div>${sheetHead(c)}<div class="w-sheet-body"><div class="w-pad"><div class="t-title1">What should it do?</div><div style="margin-top:16px">${field('A timer for my pour-over recipe', { area: true, focus: true, caret: true })}</div><div class="w-helper">Plain words are enough. I’ll ask if anything’s unclear.</div></div></div><div class="w-actions" style="padding-bottom:12px">${btn('Continue', 'ember')}</div></div>${keyboard(c, { sugg: ['recipe', 'recipes', 'routine'] })}` });
    } },
  { id: 'describe-change', group: 'Making an app', title: 'Describe a change', note: 'Change mode names the app with its own tile, so editing never reads like making something new.',
    render: (c) => frame(c, homeUnder(c), { overlay: flowSheet(c, `<div class="w-pad"><div style="display:flex;align-items:center;gap:8px">${tile(APPS.water, { size: 22, label: false })}<span class="t-footnote t-semibold t-sec">Changing Water Counter</span></div><div class="t-title1" style="margin-top:8px">What should change?</div><div style="margin-top:16px">${field('Add a weekly chart of how much I drank', { area: true })}</div><div class="w-helper">Plain words are enough. I’ll ask if anything’s unclear.</div></div>`,
      { head: sheetHead(c), actions: btn('Continue', 'ember') }) }) },
  { id: 'plan-thinking', group: 'Making an app', title: 'Plan, arriving', note: 'Questions land first (about 1.8 s) so answering starts while the plan is still being written.',
    render: (c) => frame(c, homeUnder(c), { overlay: flowSheet(c, `<div class="w-pad"><div class="t-title1">Here’s the plan</div>${youSaid('A timer for my pour-over recipe')}<div style="margin-top:14px">${statusLine('Writing the plan…', '0:02', { wispSize: 28 })}</div></div>
<div class="w-sec-h">A few choices</div><div class="w-group">${list(POUR_QUESTIONS(false))}</div>
<div class="w-sec-h">What I’ll make</div><div class="w-group"><div class="w-list" style="padding:16px">${['86%', '64%', '92%'].map((w, i) => `<div class="w-skel" style="height:12px;width:28%;margin-top:${i ? 22 : 0}px"></div><div class="w-skel" style="height:16px;width:${w};margin-top:8px"></div>`).join('')}</div></div>`,
      { head: sheetHead(c, { back: true }) }) }) },
  { id: 'plan', group: 'Making an app', title: 'Plan', note: 'Questions and plan on one page. “I’ll decide” is chosen by default, so making without touching a chip is the normal path.',
    render: (c) => frame(c, homeUnder(c), { overlay: flowSheet(c, `<div class="w-pad"><div class="t-title1">Here’s the plan</div>${youSaid('A timer for my pour-over recipe')}</div>
<div class="w-sec-h">A few choices</div><div class="w-group">${list(POUR_QUESTIONS(true))}</div>
<div class="w-sec-h">What I’ll make <span class="t-ter" style="font-weight:400">· tap a line to change it</span></div><div class="w-group">${list(POUR_PLAN)}</div>`,
      { head: sheetHead(c, { back: true }), actions: btn('Make it', 'ember') }) }) },
  { id: 'plan-edit', group: 'Making an app', title: 'Editing a line', note: 'A line edits in place. The person’s words show as typed and the line says “Edited”.',
    render: (c) => {
      const kb = KBD_HEIGHT[c.p];
      const editing = `<div class="w-planrow"><div class="p-label"><span>Steps</span></div><div style="margin-top:8px">${field('Bloom 45 s with 60 g, then three pours up to 300 g', { area: true, focus: true, caret: true })}</div><div style="display:flex;justify-content:flex-end;gap:8px;margin-top:10px">${btn('Cancel', 'plain', { size: 'sm', block: false })}${btn('Save', 'ink', { size: 'sm', block: false })}</div></div>`;
      return frame(c, homeUnder(c), { overlay: `<div class="w-scrim"></div><div class="w-sheet large" style="bottom:${kb}px"><div class="w-grabber"></div>${sheetHead(c, { back: true })}<div class="w-sheet-body"><div class="w-sec-h" style="margin-top:4px">What I’ll make</div><div class="w-group">${list([POUR_PLAN[0], editing])}</div></div></div>${keyboard(c)}` });
    } },
  { id: 'plan-limit', group: 'Making an app', title: 'Can’t make as asked', note: 'Say why, offer what can be made, and let the person choose. Plain words: apps, not mini-apps.',
    render: (c) => frame(c, homeUnder(c), { overlay: flowSheet(c, `<div class="w-pad"><div class="t-title1">I can’t make this as asked</div>${youSaid('Show me today’s weather')}<div class="t-body t-sec" style="margin-top:14px">Apps here can’t reach the internet, so this one couldn’t fetch a forecast.</div>
<div class="w-list" style="padding:16px;margin-top:20px"><div class="t-footnote t-semibold t-sec">I could make this instead</div><div class="t-body" style="margin-top:4px">A weather diary where you note what each day was like, with a monthly view.</div></div></div>`,
      { head: sheetHead(c, { back: true }), actions: btn('Make that instead', 'ember') + btn('Change my idea', 'plain') }) }) },
  { id: 'making', group: 'Making an app', title: 'Making', note: 'The wisp’s glow follows the stream. Steps say where the work is; time is honest and measured.',
    render: (c) => frame(c, homeUnder(c), { overlay: flowSheet(c, `<div style="display:flex;flex-direction:column;align-items:center;padding:12px 20px 0;text-align:center">${wisp({ size: 128, pose: 'making', activity: .95 })}<div class="t-title1" style="margin-top:14px">Making Pour Timer</div><div class="t-callout t-sec" style="margin-top:6px">Usually about a minute. You can leave; it keeps going.</div></div>
<div class="w-pad" style="margin-top:28px">${steps([['Reading your plan', 'done', '0:03'], ['Writing the app', 'now', '0:41'], ['Checking it runs safely', 'todo'], ['Putting it on your home screen', 'todo']])}</div>`,
      { head: sheetHead(c), actions: btn('Back to your apps', 'secondary') + btn('Details', 'plain') }) }) },
  { id: 'making-stuck', group: 'Making an app', title: 'Stuck', note: 'When nothing arrives for 40 s the light dims and the line says so. Movement would be the lie.',
    render: (c) => frame(c, homeUnder(c), { overlay: flowSheet(c, `<div style="display:flex;flex-direction:column;align-items:center;padding:12px 20px 0;text-align:center">${wisp({ size: 128, pose: 'stuck', activity: .2 })}<div class="t-title1" style="margin-top:14px">Making Pour Timer</div><div class="t-callout t-sec" style="margin-top:6px">No word from the server for 40 s. Still waiting.</div></div>
<div class="w-pad" style="margin-top:28px">${steps([['Reading your plan', 'done', '0:03'], ['Writing the app', 'now', '2:12'], ['Checking it runs safely', 'todo'], ['Putting it on your home screen', 'todo']])}</div>`,
      { head: sheetHead(c), actions: btn('Back to your apps', 'secondary') + btn('Details', 'plain') }) }) },
  { id: 'making-queued', group: 'Making an app', title: 'Waiting in line', note: 'Asleep, not stuck: the wisp waits with its eyes closed. Stopping is offered while nothing has started.',
    render: (c) => frame(c, homeUnder(c), { overlay: flowSheet(c, `<div style="display:flex;flex-direction:column;align-items:center;padding:12px 20px 0;text-align:center">${wisp({ size: 128, pose: 'asleep', activity: .3 })}<div class="t-title1" style="margin-top:14px">Waiting for a free spot</div><div class="t-callout t-sec" style="margin-top:6px">You’re next. It starts on its own.</div></div>
<div class="w-pad" style="margin-top:28px">${steps([['Reading your plan', 'todo'], ['Writing the app', 'todo'], ['Checking it runs safely', 'todo'], ['Putting it on your home screen', 'todo']])}</div>`,
      { head: sheetHead(c), actions: btn('Back to your apps', 'secondary') + btn('Stop making', 'plain-danger') }) }) },
  { id: 'ready', group: 'Making an app', title: 'Ready', note: 'The wisp flares and hands over the tile. “Open” wears the app’s own tint: you are about to enter its world.',
    render: (c) => frame(c, homeUnder(c), { overlay: flowSheet(c, `<div style="display:flex;flex-direction:column;align-items:center;padding:44px 20px 0;text-align:center"><div style="position:relative">${tile(APPS.pour, { size: 112, label: false })}<span style="position:absolute;right:-50px;top:-46px">${wisp({ size: 76, pose: 'done', activity: 1 })}</span></div><div class="t-title1" style="margin-top:28px">Pour Timer is ready</div><div class="t-callout t-sec" style="margin-top:6px">It’s on your home screen.</div></div>`,
      { head: sheetHead(c), actions: `<div class="tint-cocoa">${btn('Open Pour Timer', 'tint')}</div>` + btn('Done', 'plain') }) }) },
  { id: 'failure', group: 'Making an app', title: 'Didn’t work', note: 'What happened, what’s safe, one next step. No red title, no three stacked buttons; Discard sits in the header with Undo after.',
    render: (c) => frame(c, homeUnder(c), { overlay: flowSheet(c, `<div style="display:flex;flex-direction:column;align-items:center;padding:12px 24px 0;text-align:center">${wisp({ size: 96, pose: 'failed', activity: .2 })}<div class="t-title1" style="margin-top:14px">Couldn’t make this</div><div class="t-body t-sec" style="margin-top:8px">I tried 3 times and couldn’t get it to run. Describing it differently often helps.</div></div>
<div class="w-group" style="margin-top:24px">${list([row({ icon: 'circle-check', title: 'Your other apps are untouched' }), row({ icon: 'history', title: 'What happened', chev: true })], { icons: true })}</div>`,
      { head: sheetHead(c, { right: '<button class="w-textbtn danger">Discard</button>' }), actions: btn('Change the description', 'ink') + btn('Try again as it is', 'plain') }) }) },

  // Using apps
  { id: 'app-opening', group: 'Using an app', title: 'Opening', note: 'The app grows out of its tile in its own tint and shows its glyph until it paints. “Opening…” only appears after 1.5 s.',
    render: (c) => frame(c, `<div class="w-screen tint-cocoa" style="background:var(--t-fill);align-items:center;justify-content:center;color:var(--t-on)">${icon('timer', 72, 1.6)}</div>`, { statusOnDark: true }) },
  { id: 'app-timer', group: 'Using an app', title: 'An app: Pour Timer', note: 'Inside an app everything is the app’s: its tint on the primary button, segments and ring. Whim is the small ember in the corner.',
    render: (c) => appFrame(c, APPS.pour, timerApp(c), { title: 'Pour Timer', action: iconBtn('settings', 'Recipe settings', { size: 22 }) }) },
  { id: 'app-water', group: 'Using an app', title: 'An app: Water Counter', note: 'New SDK pieces at work: a ring with a number, a Stepper, a List with icons. The generator asked for none of the motion.',
    render: (c) => appFrame(c, APPS.water, waterApp(c), { title: 'Today', action: iconBtn('chart-column', 'This week', { size: 22 }) }) },
  { id: 'whim-sheet', group: 'Using an app', title: 'Whim sheet', note: 'Tapping the ember opens this. Changing the app starts right here, and the app stays open.',
    render: (c) => {
      const g = G(c);
      const sheet = `<div class="w-scrim"></div><div class="w-sheet"><div class="w-grabber"></div><div class="w-sheet-head"><span style="display:flex;align-items:center;gap:12px">${tile(APPS.pour, { size: 40, label: false })}<span><span class="t-headline" style="display:block">Pour Timer</span><span class="t-footnote t-sec t-num">Version 3 · changed 2 days ago</span></span></span>${closeBtn()}</div>
<div class="w-pad" style="margin-top:14px">${field('', { ph: 'What should change?', send: true, sendOn: false })}</div>
<div class="w-group" style="margin-top:14px">${list([row({ icon: 'history', title: 'History', chev: true }), row({ icon: 'flag', title: 'Report a problem', chev: true }), row({ icon: 'layout-grid', title: 'Your apps' })], { icons: true })}</div><div style="height:${g.safe + 12}px"></div></div>`;
      return appFrame(c, APPS.pour, timerApp(c), { title: 'Pour Timer', action: iconBtn('settings', 'Recipe settings', { size: 22 }), overlay: sheet });
    } },
  { id: 'whim-plan', group: 'Using an app', title: 'Plan for a change', note: 'Typed into the Whim sheet, the change gets its plan in the same sheet, with its own questions. Make the change, and the sheet folds back into the orb.',
    render: (c) => appFrame(c, APPS.pour, timerApp(c), { title: 'Pour Timer', action: iconBtn('settings', 'Recipe settings', { size: 22 }), overlay: flowSheet(c, `<div class="w-pad"><div style="display:flex;align-items:center;gap:8px">${tile(APPS.pour, { size: 22, label: false })}<span class="t-footnote t-semibold t-sec">Changing Pour Timer</span></div><div class="t-title1" style="margin-top:8px">Here’s the change</div>${youSaid('Add a chime when each step ends')}</div>
<div class="w-sec-h">A few choices</div><div class="w-group">${list([question('Which sound?', [chip('A chime'), chip('A soft bell'), chip('I’ll decide', { decide: true, sel: true })])])}</div>
<div class="w-sec-h">What I’ll change</div><div class="w-group">${list([planRow('Sound', 'A short chime when a step ends, and a longer one when the brew is done.'), planRow('Settings', 'A switch to turn the sound off.')])}</div>`,
      { head: sheetHead(c, { back: true }), actions: btn('Make the change', 'ember') }) }) },
  { id: 'app-changing', group: 'Using an app', title: 'Changing while you use it', note: 'The ember glows while the change is made; the app keeps working. When it lands, a toast offers Reload. Nothing reloads by itself.',
    render: (c) => {
      const g = G(c);
      const toast = `<div class="w-toast" style="bottom:${g.safe + 72}px"><span>Pour Timer changed</span><button class="ta ember">Reload</button></div>`;
      return appFrame(c, APPS.pour, timerApp(c), { title: 'Pour Timer', action: iconBtn('settings', 'Recipe settings', { size: 22 }), orbState: 'glow', overlay: toast });
    } },
  { id: 'app-error', group: 'Using an app', title: 'An app crashed', note: 'A crash becomes a change request: “Ask Whim to fix it” opens the change field, prefilled.',
    render: (c) => frame(c, `<div class="w-screen">${topSpace(c)}<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0 32px;text-align:center"><div style="width:72px;height:72px;border-radius:36px;background:var(--w-fill);display:flex;align-items:center;justify-content:center;color:var(--w-text2)">${icon('circle-alert', 32, 2)}</div><div class="t-title2" style="margin-top:18px">Pour Timer ran into a problem</div><div class="t-body t-sec" style="margin-top:8px">It stopped and can’t carry on right now. Your saved data is safe.</div></div><div class="w-actions">${btn('Reload', 'ink')}${btn('Ask Whim to fix it', 'plain-ember')}</div>${bottomSafe(c)}<div style="height:12px"></div></div>`) },

  // History and settings
  { id: 'history', group: 'History and settings', title: 'History', note: 'Your words lead each version, Whim’s summary follows. Kinds are neutral; only “Current” is marked.',
    render: (c) => frame(c, historyBody(c, { expanded: 1 })) },
  { id: 'history-undo', group: 'History and settings', title: 'Gone back, with Undo', note: 'Going back happens at once; Undo is the safety net instead of a confirm sheet.',
    render: (c) => frame(c, historyBody(c, { currentIndex: 1 }), { overlay: `<div class="w-toast" style="bottom:${G(c).safe + 16}px"><span>Back on version 3</span><button class="ta">Undo</button></div>` }) },
  { id: 'settings', group: 'History and settings', title: 'Settings', note: 'Common things first, in one grouped list. Highlighting is gone; the phone ID moved under Advanced.',
    render: (c) => frame(c, `<div class="w-screen">${topSpace(c)}${header(c)}<div class="w-titleblock"><div class="t-large">Settings</div></div>
<div class="w-group" style="margin-top:20px">${list([row({ icon: 'message-square', title: 'AI features', trail: 'On', chev: true })], { icons: true })}</div>
<div class="w-sec-h">About</div><div class="w-group">${list([row({ title: 'Privacy policy', ext: true }), row({ title: 'Terms of use', ext: true }), row({ title: 'Support', ext: true }), row({ title: 'Version', trail: '<span class="t-num">1.0 (42)</span>' })])}</div>
<div class="w-group" style="margin-top:24px">${list([row({ icon: 'wrench', title: 'Advanced', chev: true })], { icons: true })}</div></div>`) },
  { id: 'settings-advanced', group: 'History and settings', title: 'Advanced', note: 'Diagnostics one level down, as the owner asked: error details, this phone’s ID, and the server.',
    render: (c) => frame(c, `<div class="w-screen">${topSpace(c)}${header(c, { title: '' })}<div class="w-titleblock"><div class="t-title1">Advanced</div></div>
<div class="w-group" style="margin-top:20px">${list([row({ title: 'Send error details', sw: true })])}</div><div class="w-sec-f">When something goes wrong, Whim sends technical details so we can fix it. Never what you typed or saved.</div>
<div class="w-sec-h">This phone</div><div class="w-group">${list([row({ title: 'Phone ID', sub: '<span class="t-num">ec815211-2b6c-4ffb-94a1…</span>', trail: icon('copy', 18, 2) }), row({ title: '<span style="font-weight:600">Make a new ID</span>' })])}</div><div class="w-sec-f">Include the ID if you ask us about your data.</div>
<div class="w-sec-h">Server</div><div class="w-group">${list([row({ title: 'Whim’s server', trail: `<span style="color:var(--w-text)">${icon('check', 20, 2.4)}</span>` }), row({ title: 'Your own server', chev: true })])}</div></div>`) },
  { id: 'report', group: 'History and settings', title: 'Report a problem', note: 'One chip style, the code preview tucked behind “What gets sent”.',
    render: (c) => appFrame(c, APPS.pour, timerApp(c), { title: 'Pour Timer', action: iconBtn('settings', 'Recipe settings', { size: 22 }), overlay: flowSheet(c, `<div class="w-pad"><div class="t-title2">Report a problem</div><div class="w-label" style="margin-top:18px">What went wrong?</div><div class="w-chips">${chip('Doesn’t work', { sel: true })}${chip('Wrong result')}${chip('Hard to use')}${chip('Unsafe')}${chip('Offensive')}${chip('Something else')}</div><div style="margin-top:16px">${field('', { ph: 'Add a note (optional)', area: true })}</div></div>
<div class="w-group" style="margin-top:16px">${list([row({ title: 'Include what I asked for', sw: true }), row({ title: 'What gets sent', trail: icon('chevron-down', 18, 2) })])}</div><div class="w-sec-f">This phone’s Whim ID goes with your report, to AnyCognition, the company that makes Whim.</div>`,
      { head: sheetHead(c), actions: btn('Send report', 'ink') + btn('Cancel', 'plain') }) }) },
  { id: 'update', group: 'History and settings', title: 'Update needed', note: 'A system screen: no wisp, ink button, the way out underneath.',
    render: (c) => frame(c, `<div class="w-screen">${topSpace(c)}<div style="height:44px"></div><div class="w-titleblock"><div class="t-title1">Whim needs an update</div><div class="t-body t-sec" style="margin-top:8px">Making and changing apps needs the latest Whim. The apps you have keep working.</div></div><div style="flex:1"></div><div class="w-actions">${btn('Update Whim', 'ink')}${btn('Not now', 'plain')}</div>${bottomSafe(c)}<div style="height:12px"></div></div>`) },
  { id: 'launch', group: 'History and settings', title: 'Launch', note: 'The wisp on the canvas colour, still. The app icon is the same wisp on warm dark.',
    render: (c) => frame(c, `<div class="w-screen" style="align-items:center;justify-content:center">${wisp({ size: 112, pose: 'listening', activity: .6 })}</div>`) },

  // SDK
  { id: 'gallery-type', group: 'Inside apps (SDK)', title: 'Gallery: text and buttons', note: 'The style gallery mirrors the SDK: every component, every variant. Type is the system face, sized like the shell.',
    render: (c) => appFrame(c, APPS.gallery, `<div class="s-stack" style="gap:14px"><div class="t-display">42</div><div class="t-title1">Title</div><div class="t-title3">Subtitle</div><div class="t-body">Body text reads at 17 on both platforms.</div><div class="t-footnote t-sec">Caption, for small print and labels.</div>
<div style="height:6px"></div>${sBtn('Primary', '', 'plus')}${sBtn('Secondary', 'secondary')}${sBtn('Ghost', 'ghost')}${sBtn('Danger', 'danger')}${sBtn('Disabled', 'disabled')}</div>`, { title: 'Style gallery' }) },
  { id: 'gallery-controls', group: 'Inside apps (SDK)', title: 'Gallery: controls', note: 'New: Stepper, DateInput, Picker. Labels are body text, not muted captions.',
    render: (c) => appFrame(c, APPS.gallery, `<div class="s-stack" style="gap:14px">
<div><div class="w-label">Name</div>${field('Morning walk')}</div>
<div style="display:flex;gap:12px"><div style="flex:1"><div class="w-label">Date</div>${field(`<span style="display:flex;gap:8px;align-items:center">${icon('calendar', 18, 2)}Oct 9</span>`)}</div><div style="flex:1"><div class="w-label">Kind</div>${field(`<span style="display:flex;justify-content:space-between;width:100%;align-items:center">Walk ${icon('chevron-down', 18, 2)}</span>`)}</div></div>
${sCard(`<div class="s-stepper"><span>Laps</span><span class="grp"><button>${icon('minus', 20, 2.2)}</button><span class="val">3</span><button>${icon('plus', 20, 2.2)}</button></span></div>`, 'padding:14px 16px 14px 20px')}
<div class="s-list"><div class="s-item"><div class="i-main">Remind me</div><span class="s-switch on"></span></div><div class="s-item"><span class="s-check on">${icon('check', 16, 3)}</span><div class="i-main">Stretch first</div></div><div class="s-item"><span class="s-check"></span><div class="i-main">Bring water</div></div></div>
${sCard(`<div style="display:flex;justify-content:space-between"><span>Pace</span><span class="t-num t-sec">6:30 /km</span></div><div class="s-slider" style="margin-top:10px"><div class="tr"></div><div class="fi" style="width:58%"></div><div class="th" style="left:58%"></div></div>`, 'padding:16px 20px')}
<div class="s-seg"><span>Easy</span><span class="on">Steady</span><span>Fast</span></div></div>`, { title: 'Controls', back: true }) },
  { id: 'gallery-surfaces', group: 'Inside apps (SDK)', title: 'Gallery: surfaces', note: 'Cards and lists without borders, badges in soft fills (warning is yellow now), the ring variant of ProgressBar.',
    render: (c) => appFrame(c, APPS.gallery, `<div class="s-stack" style="gap:14px">
${sCard(`<div style="display:flex;gap:6px;flex-wrap:wrap"><span class="s-badge neutral">Neutral</span><span class="s-badge">Primary</span><span class="s-badge positive">Positive</span><span class="s-badge warning">Warning</span><span class="s-badge danger">Danger</span></div><div class="s-bar" style="margin-top:16px"><span style="width:62%"></span></div>`, 'padding:16px 20px')}
<div style="display:flex;gap:14px">${sCard(ring(.7, 112, '7', '', 9), 'flex:1;padding:16px')}${sCard(`<div style="display:flex;align-items:flex-end;gap:7px;height:112px">${[40, 64, 52, 88, 70, 98, 60].map((h) => `<span style="flex:1;height:${h}%;border-radius:4px 4px 0 0;background:var(--a-fill)"></span>`).join('')}</div>`, 'flex:1;padding:16px')}</div>
<div class="s-list">${sItem('Morning walk', 'Oct 9 · 3 laps', '', 'footprints').replace('</div></div>', '</div></div>')}${sItem('Evening run', 'Oct 8 · 5 km', icon('chevron-right', 18, 2), 'activity')}</div>
${sCard(`<div class="s-empty" style="padding:12px 8px"><span class="e-icon">${icon('inbox', 28, 2)}</span><div class="t-title3">Nothing yet</div><div class="t-callout t-sec">Your walks show up here.</div></div>`)}</div>`, { title: 'Surfaces', back: true }) },
  { id: 'gallery-modal', group: 'Inside apps (SDK)', title: 'Gallery: modal and toast', note: 'Modal is a real sheet now: grabber, title, a close button, drag to dismiss. toast() for quick feedback.',
    render: (c) => {
      const g = G(c);
      const sheet = `<div class="w-scrim"></div><div class="w-sheet tint-grape s-app"><div class="w-grabber"></div><div class="w-sheet-head"><span class="t-title2">Add a walk</span>${closeBtn()}</div><div class="w-pad" style="margin-top:10px"><div class="w-label">Name</div>${field('Lunch walk', { focus: true })}<div style="margin-top:14px">${sCard(`<div class="s-stepper"><span>Laps</span><span class="grp"><button>${icon('minus', 20, 2.2)}</button><span class="val">2</span><button>${icon('plus', 20, 2.2)}</button></span></div>`, 'padding:14px 16px 14px 20px;background:var(--w-fill)')}</div><div style="margin-top:18px">${sBtn('Save')}</div></div><div style="height:${g.safe + 12}px"></div></div>`;
      return appFrame(c, APPS.gallery, `<div class="s-list">${sItem('Morning walk', 'Oct 9 · 3 laps', '', 'footprints')}${sItem('Evening run', 'Oct 8 · 5 km', '', 'activity')}</div>`, { title: 'Walks', overlay: sheet });
    } },
];

function historyBody(c, { expanded = -1, currentIndex = 0 } = {}) {
  const versions = [
    { v: 4, when: '2 days ago', kind: ['plus', 'Added'], said: 'Add a chime when each step ends', sum: 'Plays a short chime at the end of every step.' },
    { v: 3, when: '5 days ago', kind: ['pencil', 'Changed'], said: 'Let me pick V60 or Chemex', sum: 'Adds a brewer choice; each has its own pours.' },
    { v: 2, when: 'Sep 30', kind: ['palette', 'Look'], said: 'Make the countdown bigger', sum: 'The countdown fills the top half of the screen.' },
    { v: 1, when: 'Sep 28', kind: ['flag', 'Start'], said: 'A timer for my pour-over recipe', sum: 'Where this app began.' },
  ];
  const rows = versions.map((x, i) => {
    const cur = i === currentIndex;
    const actions = i === expanded ? `<div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">${cur ? btn('Change it', 'ember', { size: 'md', block: false }) : btn('Go back to this version', 'secondary', { size: 'md', block: false }) + btn('Make a copy', 'plain', { size: 'md', block: false })}</div>` : '';
    return `<div class="w-tl-row${cur ? ' current' : ''}"><span class="dot"></span><div class="${i === expanded ? 'w-tl-card' : ''}" style="${i === expanded ? '' : 'padding:2px 0'}"><div class="t-body t-quote">“${esc(x.said)}”</div><div class="t-callout t-sec" style="margin-top:4px">${esc(x.sum)}</div><div class="meta"><span>v${x.v} · ${x.when}</span><span class="w-badge">${icon(x.kind[0], 12, 2.4)}${x.kind[1]}</span>${cur ? '<span class="w-badge ink">Current</span>' : ''}</div>${actions}</div></div>`;
  }).join('');
  return `<div class="w-screen">${topSpace(c)}${header(c, { right: iconBtn('ellipsis', 'More', { size: 24 }) })}<div class="w-titleblock"><div class="t-title1">History</div><div class="w-sub" style="display:flex;align-items:center;gap:8px;margin-top:6px">${tile(APPS.pour, { size: 22, label: false })}<span class="t-callout tint-cocoa t-tint t-semibold">Pour Timer</span><span class="t-callout t-sec">· 4 versions</span></div></div><div style="height:22px"></div><div class="w-tl">${rows}</div></div>`;
}
