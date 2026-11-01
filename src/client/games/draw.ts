// Draw and guess, browser side. One persistent canvas is moved into each freshly built view, because the
// page is rebuilt on every update. The drawer paints locally at once and sends throttled point batches;
// everyone else paints new points from the server's stroke log as it grows (and all of it after a reload).
import { button, h } from '../dom';
import { injectCss, keepFocus, textInput } from './sticky';
import type { GameClient, ViewCtx } from './types';

interface Stroke {
  c: number;
  w: number;
  p: number[];
}
interface Pub {
  phase: 'choose' | 'draw' | 'reveal' | 'end';
  turn: number;
  stamp: number;
  turns: number;
  drawer: string;
  deadline: number;
  hint: number[] | null;
  word: string | null;
  strokes: Stroke[];
  feed: { p: string; t: string; ok: boolean }[];
  correct: string[];
  gain: Record<string, number> | null;
  tot: Record<string, number>;
}
interface Priv {
  drawer: boolean;
  correct: boolean;
  options: string[] | null;
  word: string | null;
}
type C = ViewCtx<Pub, Priv | null>;

const PAPER = '#fffaf0';
const COLORS = ['#13282c', '#d9432f', '#2a6fdb'];
const WIDTHS = [6, 16];
const SEND_MS = 50;
const SIDE = 800;

// ---- the canvas (lives for the whole page) ------------------------------------

const canvas = document.createElement('canvas');
canvas.width = SIDE;
canvas.height = SIDE;
canvas.className = 'dg-canvas';
canvas.setAttribute('data-testid', 'draw-canvas');
const pen = canvas.getContext('2d')!;
let tool = { c: 0, w: 0 };
let sendFn: (a: unknown) => void = () => undefined;
let canDraw = false;
let key = '';
let local: Stroke[] = [];
let painted: number[] = [];
let adopted = false;
let active: Stroke | null = null;
let pend: number[] = [];
let pendNew = false;
let timer = 0;

function wipe(): void {
  pen.fillStyle = PAPER;
  pen.fillRect(0, 0, SIDE, SIDE);
  painted = [];
}

function run(s: Stroke, from: number): void {
  const k = SIDE / 1000;
  pen.strokeStyle = pen.fillStyle = COLORS[s.c] ?? COLORS[0];
  pen.lineWidth = (WIDTHS[s.w] ?? WIDTHS[0]) * k;
  pen.lineCap = pen.lineJoin = 'round';
  const n = s.p.length / 2;
  if (n === 1) {
    pen.beginPath();
    pen.arc(s.p[0] * k, s.p[1] * k, pen.lineWidth / 2, 0, Math.PI * 2);
    pen.fill();
    return;
  }
  pen.beginPath();
  const start = Math.max(0, from / 2 - 1);
  pen.moveTo(s.p[start * 2] * k, s.p[start * 2 + 1] * k);
  for (let i = start + 1; i < n; i++) pen.lineTo(s.p[i * 2] * k, s.p[i * 2 + 1] * k);
  pen.stroke();
}

/** Paint whatever of `strokes` is not on the canvas yet; start over if strokes were removed. */
function paint(strokes: Stroke[]): void {
  if (strokes.length < painted.length || painted.some((n, i) => n > strokes[i].p.length)) wipe();
  strokes.forEach((s, i) => {
    const from = painted[i] ?? 0;
    if (s.p.length > from) run(s, from);
    painted[i] = s.p.length;
  });
}

function flush(): void {
  clearTimeout(timer);
  timer = 0;
  while (pend.length) {
    const p = pend.splice(0, 200);
    sendFn({ type: 'pts', c: pendStyle.c, w: pendStyle.w, n: pendNew, p });
    pendNew = false;
  }
}
let pendStyle = { c: 0, w: 0 };

function at(e: PointerEvent): [number, number] {
  const r = canvas.getBoundingClientRect();
  const f = (v: number, o: number, size: number) => Math.min(1000, Math.max(0, Math.round(((v - o) / size) * 1000)));
  return [f(e.clientX, r.left, r.width), f(e.clientY, r.top, r.height)];
}

function add(s: Stroke, x: number, y: number): void {
  const n = s.p.length;
  if (n >= 2 && Math.abs(s.p[n - 2] - x) + Math.abs(s.p[n - 1] - y) < 3) return;
  s.p.push(x, y);
  pend.push(x, y);
  painted[local.length - 1] = s.p.length;
  if (n >= 2) run(s, n - 2);
  if (!timer) timer = window.setTimeout(flush, SEND_MS);
}

canvas.addEventListener('pointerdown', (e) => {
  if (!canDraw) return;
  e.preventDefault();
  flush();
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {
    // capture is optional
  }
  active = { c: tool.c, w: tool.w, p: [] };
  local.push(active);
  pendStyle = { c: tool.c, w: tool.w };
  pendNew = true;
  const [x, y] = at(e);
  active.p.push(x, y);
  pend.push(x, y);
  painted[local.length - 1] = 2;
  run(active, 0);
  timer = window.setTimeout(flush, SEND_MS);
});
canvas.addEventListener('pointermove', (e) => {
  if (!active || !canDraw) return;
  e.preventDefault();
  // The page is rebuilt while drawing, which can drop pointer capture. Take it back.
  if (!canvas.hasPointerCapture?.(e.pointerId)) {
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  }
  for (const ev of e.getCoalescedEvents?.() ?? [e]) {
    const [x, y] = at(ev);
    add(active, x, y);
  }
});
const stop = () => {
  if (!active) return;
  flush();
  active = null;
  sendFn({ type: 'end' });
};
canvas.addEventListener('pointerup', stop);
canvas.addEventListener('pointercancel', stop);

function undo(): void {
  stop();
  local.pop();
  wipe();
  paint(local);
  sendFn({ type: 'undo' });
}
function clearAll(): void {
  stop();
  local = [];
  wipe();
  sendFn({ type: 'clear' });
}

/** Bring the canvas in line with the server view for this turn. */
function sync(c: C): void {
  const p = c.pub;
  const k = `${p.stamp}:${p.turn}`;
  if (k !== key) {
    key = k;
    local = [];
    adopted = false;
    active = null;
    pend = [];
    wipe();
  }
  canDraw = !!c.priv?.drawer && p.phase === 'draw';
  sendFn = c.send;
  if (canDraw) {
    if (!adopted) {
      local = p.strokes.map((s) => ({ ...s, p: [...s.p] }));
      wipe();
      paint(local);
      adopted = true;
    }
  } else {
    view = p.strokes;
    paint(view);
  }
}

/** The stroke log being watched (the server's, kept current by deltas between full views). */
let view: Stroke[] = [];

/** New points from the drawer arrive as small events, without a re-render. */
function onEvent(ev: unknown): void {
  const e = ev as { type?: string; n?: boolean; c: number; w: number; p: number[] };
  if (!e || e.type !== 'pts' || canDraw || !key) return;
  const last = view[view.length - 1];
  if (e.n || !last) view.push({ c: e.c, w: e.w, p: [...e.p] });
  else last.p.push(...e.p);
  paint(view);
}

// ---- the view -----------------------------------------------------------------

const guess = textInput({ testid: 'draw-guess', max: 40 });

function paper(c: C): HTMLElement {
  sync(c);
  return h('div', { class: 'dg-paper' }, canvas);
}

function tools(c: C): HTMLElement {
  return h(
    'div',
    { class: 'dg-tools' },
    COLORS.map((col, i) =>
      h('button', { type: 'button', class: 'dg-swatch', style: `background:${col}`, 'aria-label': c.g(`color.${i}`), 'aria-pressed': tool.c === i ? 'true' : 'false', 'data-testid': `draw-color-${i}`, onclick: (e: Event) => pick(e, 'c', i) }),
    ),
    WIDTHS.map((w, i) =>
      h('button', { type: 'button', class: 'dg-swatch dg-width', 'aria-label': c.g(`width.${i}`), 'aria-pressed': tool.w === i ? 'true' : 'false', 'data-testid': `draw-width-${i}`, onclick: (e: Event) => pick(e, 'w', i) }, h('i', { style: `width:${6 + i * 10}px;height:${6 + i * 10}px` })),
    ),
    h('button', { type: 'button', class: 'dg-act', 'data-testid': 'draw-undo', onclick: undo }, c.g('undo')),
    h('button', { type: 'button', class: 'dg-act', 'data-testid': 'draw-clear', onclick: clearAll }, c.g('clear')),
  );
}

function pick(e: Event, what: 'c' | 'w', i: number): void {
  tool = { ...tool, [what]: i };
  const bar = (e.currentTarget as HTMLElement).parentElement!;
  const sel = what === 'c' ? '.dg-swatch:not(.dg-width)' : '.dg-width';
  bar.querySelectorAll(sel).forEach((b, j) => b.setAttribute('aria-pressed', j === i ? 'true' : 'false'));
}

function hint(c: C): HTMLElement {
  return h(
    'div',
    { class: 'dg-hint', dir: 'ltr', 'data-testid': 'draw-hint', 'aria-label': c.g('hintLabel', { n: (c.pub.hint ?? []).reduce((a, b) => a + b, 0) }) },
    (c.pub.hint ?? []).map((n) => h('span', { class: 'dg-word' }, Array.from({ length: n }, () => h('i', null)))),
  );
}

function feed(c: C, max: number): HTMLElement {
  const items = c.pub.feed.slice(-max);
  return h(
    'ul',
    { class: 'dg-feed', 'data-testid': 'draw-feed' },
    items.map((e) => h('li', { class: e.ok ? 'ok' : '' }, e.ok ? c.g('feedOk', { name: c.name(e.p) }) : [h('b', null, `${c.name(e.p)}: `), e.t])),
  );
}

function scores(c: C, list: Record<string, number>): HTMLElement {
  return h(
    'ul',
    { class: 'scores' },
    Object.entries(list)
      .sort((a, b) => b[1] - a[1])
      .map(([pid, n]) => h('li', null, h('span', null, c.name(pid)), h('b', null, `+${n}`))),
  );
}

function guessBox(c: C): HTMLElement {
  const restore = keepFocus(guess);
  const form = h(
    'form',
    {
      class: 'dg-form',
      onsubmit: (e: Event) => {
        e.preventDefault();
        const text = guess.value.trim();
        if (!text) return;
        guess.value = '';
        c.send({ type: 'guess', text });
      },
    },
    guess,
    h('button', { type: 'submit', class: 'btn primary', 'data-testid': 'draw-send' }, c.g('send')),
  );
  guess.placeholder = c.g('placeholder');
  restore();
  return form;
}

function reveal(c: C): HTMLElement[] {
  const p = c.pub;
  const gain = p.gain ?? {};
  return [
    h('p', { class: 'lead', 'data-testid': 'draw-reveal' }, c.g('wasWord', { word: p.word ?? '' })),
    Object.keys(gain).length ? scores(c, gain) : h('p', { class: 'muted' }, c.g('nobody')),
  ];
}

function result(c: C): HTMLElement {
  return h(
    'section',
    { class: 'stack center', 'data-testid': 'draw-result' },
    h('h2', null, c.g('final')),
    Object.keys(c.pub.tot).length ? scores(c, c.pub.tot) : h('p', { class: 'muted' }, c.g('nobody')),
    c.isHost ? c.hostControls() : c.isScreen ? null : h('p', { class: 'muted' }, c.g('waitNext')),
  );
}

function head(c: C): HTMLElement {
  const p = c.pub;
  return h(
    'div',
    { class: 'dg-head' },
    h('span', { class: 'muted' }, c.g('turnOf', { n: Math.min(p.turn + 1, p.turns), total: p.turns })),
    p.deadline ? h('span', { class: 'dg-clock' }, c.timer(p.deadline)) : null,
  );
}

function tv(c: C): HTMLElement {
  const p = c.pub;
  if (p.phase === 'end') return h('div', { class: 'stack center board' }, h('h1', { class: 'game-title' }, c.g('title')), result(c));
  const status =
    p.phase === 'choose'
      ? h('p', { class: 'lead' }, c.g('choosing', { name: c.name(p.drawer) }))
      : p.phase === 'draw'
        ? [h('p', { class: 'lead' }, c.g('drawing', { name: c.name(p.drawer) })), hint(c)]
        : reveal(c);
  return h(
    'div',
    { class: 'dg-tv' },
    h('div', { class: 'stack center' }, head(c), status, p.phase !== 'choose' ? scores(c, p.tot) : null),
    p.phase === 'choose' ? h('div', { class: 'dg-paper' }) : paper(c),
    h('div', { class: 'stack' }, h('h3', null, c.g('guesses')), feed(c, 14)),
  );
}

function phone(c: C): HTMLElement {
  const p = c.pub;
  const me = c.priv!;
  const full = c.mode === 'phones';
  if (p.phase === 'end') return result(c);
  if (p.phase === 'choose') {
    return me.drawer
      ? h('div', { class: 'stack' }, head(c), h('h2', null, c.g('choose')), (me.options ?? []).map((w, i) => button(w, () => c.send({ type: 'pick', i }), { kind: 'plain', testid: 'draw-opt' })))
      : h('div', { class: 'stack center' }, head(c), h('p', { class: 'lead' }, c.g('choosing', { name: c.name(p.drawer) })));
  }
  if (p.phase === 'reveal') return h('div', { class: 'stack center' }, head(c), reveal(c), full ? paper(c) : null);
  if (me.drawer) {
    return h('div', { class: 'stack' }, head(c), h('p', { class: 'lead center', 'data-testid': 'draw-word' }, c.g('youDraw', { word: me.word ?? '' })), paper(c), tools(c), full ? feed(c, 4) : null);
  }
  return h(
    'div',
    { class: 'stack' },
    head(c),
    h('p', { class: 'center muted' }, c.g('drawing', { name: c.name(p.drawer) })),
    me.correct ? h('p', { class: 'badge good center', 'data-testid': 'draw-correct' }, c.g('gotIt', { word: me.word ?? '' })) : hint(c),
    full ? paper(c) : null,
    me.correct ? null : guessBox(c),
    feed(c, full ? 5 : 8),
  );
}

const CSS = `
.dg-paper{width:100%;max-width:560px;margin:0 auto;border-radius:18px;overflow:hidden;background:${PAPER};box-shadow:0 0 0 3px var(--line);touch-action:none;min-height:40px}
.dg-tv .dg-paper{width:min(100%,70vh);max-width:none}
.dg-canvas{display:block;width:100%;height:auto;touch-action:none;cursor:crosshair;-webkit-user-select:none;user-select:none}
.dg-head{display:flex;justify-content:space-between;align-items:center;gap:12px}
.dg-clock{font-size:1.5rem}
.dg-tools{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;align-items:center}
.dg-swatch{width:52px;height:52px;border-radius:50%;border:3px solid var(--line);display:grid;place-items:center;cursor:pointer;padding:0;background:var(--card-2)}
.dg-swatch[aria-pressed=true]{border-color:var(--amber);box-shadow:0 0 0 3px var(--amber)}
.dg-width i{display:block;border-radius:50%;background:var(--ink)}
.dg-act{min-height:52px;padding:0 16px;border-radius:26px;border:2px solid var(--line);background:var(--card-2);font-weight:700;cursor:pointer}
.dg-hint{display:flex;flex-wrap:wrap;gap:18px;justify-content:center}
.dg-word{display:flex;gap:6px}
.dg-word i{display:block;width:22px;height:5px;margin-top:20px;border-radius:3px;background:var(--amber)}
.dg-form{display:flex;gap:10px}
.dg-form .input{flex:1;min-width:0}
.dg-form .btn{width:auto;flex:none}
.dg-feed{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px;max-height:40vh;overflow:hidden}
.dg-feed li{padding:6px 12px;border-radius:12px;background:var(--bg-2);overflow-wrap:anywhere}
.dg-feed li.ok{background:var(--mint);color:#08241c;font-weight:700}
.dg-tv{display:grid;grid-template-columns:1fr minmax(0,auto) 1fr;gap:24px;align-items:start}
@media (max-width:900px){.dg-tv{grid-template-columns:1fr}}
`;

const ICON = `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M8 40l3-11L33 7l8 8-22 22z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><path d="M28 12l8 8M11 29l8 8" stroke="currentColor" stroke-width="3"/><path d="M6 43h14" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>`;

export const drawClient: GameClient = {
  id: 'draw',
  icon: ICON,
  minPlayers: 2,
  modes: ['phones', 'screen'],
  settings: [
    { key: 'seconds', kind: 'number', min: 30, max: 180, step: 15 },
    { key: 'rounds', kind: 'number', min: 1, max: 3, step: 1 },
  ],
  onEvent,
  render(c) {
    injectCss('dg-css', CSS);
    return c.isScreen ? tv(c as C) : phone(c as C);
  },
  strings: {
    en: {
      title: 'Draw and Guess',
      blurb: 'One draws, everyone else guesses. The faster you guess, the more you score.',
      'set.seconds': 'Seconds per drawing',
      'set.rounds': 'Turns each',
      turnOf: 'Drawing {n} of {total}',
      choose: 'Pick a word to draw',
      choosing: '{name} is picking a word...',
      drawing: '{name} is drawing',
      youDraw: 'Draw: {word}',
      hintLabel: 'A word with {n} letters',
      placeholder: 'Type your guess',
      send: 'Guess',
      gotIt: 'You got it! The word is {word}',
      feedOk: '{name} got it!',
      guesses: 'Guesses',
      undo: 'Undo',
      clear: 'Clear',
      'color.0': 'Dark ink',
      'color.1': 'Red',
      'color.2': 'Blue',
      'width.0': 'Thin line',
      'width.1': 'Thick line',
      wasWord: 'The word was: {word}',
      nobody: 'Nobody scored this time',
      final: 'Final scores',
      waitNext: 'Waiting for the host to start the next round',
    },
    ar: {
      title: 'ارسم وحزّر',
      blurb: 'واحد بيرسم والباقي بيحزّروا شو رسم. كل ما حزرت أسرع كل ما أخدت نقاط أكتر.',
      'set.seconds': 'ثواني لكل رسمة',
      'set.rounds': 'كم دور لكل واحد',
      turnOf: 'الرسمة {n} من {total}',
      choose: 'اختار كلمة لترسمها',
      choosing: '{name} عم يختار كلمة...',
      drawing: '{name} عم يرسم',
      youDraw: 'ارسم: {word}',
      hintLabel: 'كلمة من {n} حروف',
      placeholder: 'اكتب حزورتك',
      send: 'حزّر',
      gotIt: 'برافو، حزرتها! الكلمة {word}',
      feedOk: '{name} حزرها!',
      guesses: 'التحزيرات',
      undo: 'رجّع',
      clear: 'امسح',
      'color.0': 'حبر غامق',
      'color.1': 'أحمر',
      'color.2': 'أزرق',
      'width.0': 'خط رفيع',
      'width.1': 'خط تخين',
      wasWord: 'الكلمة كانت: {word}',
      nobody: 'ما حدا إخد نقاط هالمرّة',
      final: 'النتيجة النهائية',
      waitNext: 'ناطرين صاحب السهرة يبلّش الجولة الجاية',
    },
  },
};
