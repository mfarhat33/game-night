// Charades (heads up), browser side. The holder puts the phone on their forehead: tilt down = correct,
// tilt up = pass. Without a working tilt sensor (or if iOS permission is denied) on-screen buttons take over.
import { button, h } from '../dom';
import { finale, scoreList } from './kit';
import type { GameClient, ViewCtx } from './types';

interface Pub {
  phase: 'ready' | 'count' | 'play' | 'turnend' | 'end';
  holder: string | null;
  turn: number;
  turns: number;
  deadline: number;
  score: Record<string, number>;
  teams: Record<string, number> | null;
  right: string[] | null;
  passed: string[] | null;
  players: string[];
}
interface Priv {
  holder: boolean;
  word: string | null;
  n: number;
}
type C = ViewCtx<Pub, Priv | null>;

// ---- tilt sensor (UI-only state, kept between renders) -----------------------------------------------
type Tilt = 'off' | 'on' | 'denied' | 'none';
let tilt: Tilt = 'off';
let active = false; // true once the sensor has really delivered a reading
let armed = false;
let live: { play: boolean; n: number; send: (a: unknown) => void } = { play: false, n: 0, send: () => undefined };
let lastKey = '';

const rad = (d: number) => (d * Math.PI) / 180;

function onOrient(e: DeviceOrientationEvent): void {
  if (e.beta === null || e.gamma === null) return;
  if (!active) {
    active = true;
    document.querySelectorAll<HTMLElement>('[data-fallback]').forEach((el) => (el.style.display = 'none'));
  }
  // Vertical part of the direction the screen faces: +1 face up, -1 face down, 0 on the forehead.
  const v = Math.cos(rad(e.beta)) * Math.cos(rad(e.gamma));
  if (!live.play) return;
  if (!armed) {
    if (Math.abs(v) < 0.3) armed = true;
    return;
  }
  if (v < -0.6 || v > 0.6) {
    armed = false;
    live.send({ type: v < 0 ? 'correct' : 'pass', n: live.n });
    try {
      navigator.vibrate?.(60);
    } catch {
      /* not supported */
    }
  }
}

async function enableTilt(): Promise<void> {
  const D = (window as unknown as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } }).DeviceOrientationEvent;
  if (!D) {
    tilt = 'none';
    return;
  }
  try {
    if (typeof D.requestPermission === 'function' && (await D.requestPermission()) !== 'granted') {
      tilt = 'denied';
      return;
    }
    window.addEventListener('deviceorientation', onOrient);
    tilt = 'on';
  } catch {
    tilt = 'denied';
  }
}

function tiltBox(c: C): HTMLElement {
  const needsTap = typeof (window as unknown as { DeviceOrientationEvent?: { requestPermission?: unknown } }).DeviceOrientationEvent?.requestPermission === 'function';
  if (tilt === 'off' && !needsTap) void enableTilt(); // Android and desktop need no permission
  const box = h('div', { class: 'stack tight', 'data-testid': 'cha-tilt' });
  const paint = () => {
    box.textContent = '';
    if (tilt === 'off') box.append(button(c.g('enableTilt'), () => void enableTilt().then(paint), { kind: 'plain', testid: 'cha-enable' }));
    else box.append(h('p', { class: 'muted center small' }, c.g(`tilt.${tilt}`)));
  };
  paint();
  return box;
}

// ---- views -------------------------------------------------------------------------------------------
function teamTotals(c: C): HTMLElement | null {
  const p = c.pub;
  if (!p.teams) return null;
  const sum = [0, 1].map((t) => p.players.filter((x) => p.teams![x] === t).reduce((a, x) => a + (p.score[x] ?? 0), 0));
  return h('p', { class: 'lead center', 'data-testid': 'cha-teams' }, `${c.g('teamA')}: ${sum[0]}  ·  ${c.g('teamB')}: ${sum[1]}`);
}

function scores(c: C): HTMLElement {
  const rows = c.pub.players.map((pid) => ({ pid, score: c.pub.score[pid] ?? 0 })).sort((a, b) => b.score - a.score);
  return h('div', { class: 'stack' }, teamTotals(c), scoreList(c, rows, 'cha-scores'));
}

function holderView(c: C): HTMLElement {
  const p = c.pub;
  const me = c.priv!;
  if (p.phase === 'ready') {
    return h('div', { class: 'stack center' }, h('h2', null, c.g('yourTurn')), h('p', { class: 'lead' }, c.g('howto')), tiltBox(c), button(c.g('start'), () => c.send({ type: 'start' }), { testid: 'cha-start' }));
  }
  if (p.phase === 'count') return h('div', { class: 'stack center' }, h('h2', null, c.g('foreheadUp')), h('div', { class: 'big-timer' }, c.timer(p.deadline)));
  // play
  const fallback = h(
    'div',
    { class: 'grid2', 'data-fallback': '', style: active ? 'display:none' : null },
    button(c.g('correct'), () => c.send({ type: 'correct', n: me.n }), { testid: 'cha-correct' }),
    button(c.g('pass'), () => c.send({ type: 'pass', n: me.n }), { kind: 'plain', testid: 'cha-pass' }),
  );
  return h('div', { class: 'stack center cha-holder' }, h('div', { class: 'small-timer' }, c.timer(p.deadline)), h('div', { class: 'cha-word', 'data-testid': 'cha-word' }, me.word), fallback, h('p', { class: 'muted small' }, c.g('score', { n: p.score[c.me!] ?? 0 })));
}

function summary(c: C): HTMLElement {
  const p = c.pub;
  const list = (title: string, words: string[]) => (words.length ? h('div', null, h('h3', null, title), h('ul', { class: 'chips' }, words.map((w) => h('li', null, w)))) : null);
  return h(
    'section',
    { class: 'stack center', 'data-testid': 'cha-summary' },
    h('h2', null, c.g('turnDone', { name: c.name(p.holder!), n: p.right!.length })),
    list(c.g('gotIt'), p.right!),
    list(c.g('passed'), p.passed!),
    scores(c),
    c.isHost || c.me === p.holder ? (c.isScreen ? null : button(c.g('next'), () => c.send({ type: 'next' }), { testid: 'cha-next' })) : null,
  );
}

function final(c: C): HTMLElement {
  return h('section', { class: 'stack center', 'data-testid': 'cha-result' }, h('h2', null, c.g('final')), scores(c), finale(c, 'waitNext'));
}

function watcher(c: C, big: boolean): HTMLElement {
  const p = c.pub;
  const who = c.name(p.holder!);
  const head = p.phase === 'ready' ? h('p', { class: 'lead' }, c.g('upNext', { name: who })) : h('p', { class: 'lead' }, c.g('actFor', { name: who }));
  return h(
    'div',
    { class: 'stack center' },
    h('p', { class: 'muted' }, c.g('turnOf', { i: p.turn, n: p.turns })),
    head,
    p.phase === 'ready' ? null : h('div', { class: big ? 'big-timer' : 'small-timer' }, c.timer(p.deadline)),
    scores(c),
    p.phase === 'ready' && c.isHost && !c.isScreen ? button(c.g('skip'), () => c.send({ type: 'next' }), { kind: 'ghost', testid: 'cha-skip' }) : null,
  );
}

function render(c: C): HTMLElement {
  const p = c.pub;
  const key = `${p.turn}:${p.phase}`;
  if (key !== lastKey) {
    lastKey = key;
    armed = false; // wait for the phone to settle on the forehead before a tilt counts
  }
  live = { play: p.phase === 'play' && !!c.priv?.holder, n: c.priv?.n ?? 0, send: c.send };
  if (p.phase === 'end') return h('div', { class: 'stack center board' }, final(c));
  if (p.phase === 'turnend') return h('div', { class: 'stack center board' }, summary(c));
  if (!c.isScreen && c.priv?.holder) return holderView(c);
  return h('div', { class: c.isScreen ? 'board stack center' : 'stack center' }, watcher(c, c.isScreen));
}

const ICON = `<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="14" y="4" width="20" height="34" rx="4" fill="none" stroke="currentColor" stroke-width="3.5"/><path d="M24 14v12m0 0-5-5m5 5 5-5" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 44h28" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/></svg>`;

export const charadesClient: GameClient = {
  id: 'charades',
  icon: ICON,
  minPlayers: 2,
  modes: ['phones', 'screen'],
  settings: [
    { key: 'seconds', kind: 'number', min: 10, max: 120, step: 10 },
    { key: 'rounds', kind: 'number', min: 1, max: 3, step: 1 },
    { key: 'teams', kind: 'choice', options: ['off', 'on'] },
  ],
  render: (c) => render(c as C),
  strings: {
    en: {
      title: 'Charades',
      blurb: 'Hold the phone on your forehead. Everyone else acts the word out. Tilt down when you get it.',
      'set.seconds': 'Seconds per turn',
      'set.rounds': 'Turns each',
      'set.teams': 'Teams',
      'opt.teams.off': 'Every player alone',
      'opt.teams.on': 'Two teams',
      teamA: 'Team A',
      teamB: 'Team B',
      yourTurn: 'Your turn!',
      howto: 'Tap start, then hold the phone on your forehead facing the others. Tilt down for correct, up to pass.',
      enableTilt: 'Enable tilt',
      'tilt.on': 'Tilt is on. The buttons stay as a backup.',
      'tilt.denied': 'Tilt is blocked. Use the buttons instead.',
      'tilt.none': 'No tilt sensor here. Use the buttons instead.',
      start: 'Start',
      foreheadUp: 'Phone on your forehead!',
      correct: 'Correct',
      pass: 'Pass',
      score: 'Your score: {n}',
      upNext: '{name} is up next',
      actFor: 'Act it out for {name}!',
      turnOf: 'Turn {i} of {n}',
      skip: 'Skip this player',
      turnDone: "{name}'s turn is over: {n} right",
      gotIt: 'Got it',
      passed: 'Passed',
      next: 'Continue',
      final: 'Final scores',
      waitNext: 'Waiting for the host to start the next round',
    },
    ar: {
      title: 'مثّل ولا تحكي',
      blurb: 'حط التلفون عجبينك وغيرك بيمثّل الكلمة. نزّل التلفون لما تحزرها.',
      'set.seconds': 'ثواني لكل دور',
      'set.rounds': 'كم دور لكل واحد',
      'set.teams': 'الفِرَق',
      'opt.teams.off': 'كل واحد لحالو',
      'opt.teams.on': 'فريقين',
      teamA: 'الفريق أ',
      teamB: 'الفريق ب',
      yourTurn: 'دورك!',
      howto: 'دوس ابدأ، وبعدين حط التلفون عجبينك والشاشة لقدام. نزّلو لتحزر، وطلّعو لتعدّي.',
      enableTilt: 'فعّل الميلان',
      'tilt.on': 'الميلان شغّال. الأزرار بتضل احتياط.',
      'tilt.denied': 'الميلان مقفول. استعمل الأزرار.',
      'tilt.none': 'ما في حسّاس ميلان. استعمل الأزرار.',
      start: 'ابدأ',
      foreheadUp: 'التلفون عجبينك!',
      correct: 'صح',
      pass: 'عدّي',
      score: 'نقاطك: {n}',
      upNext: 'الدور الجاي لـ{name}',
      actFor: 'مثّلو الكلمة لـ{name}!',
      turnOf: 'الدور {i} من {n}',
      skip: 'عدّي هالدور',
      turnDone: 'خلص دور {name}: {n} صح',
      gotIt: 'حزرها',
      passed: 'عدّاها',
      next: 'كمّل',
      final: 'النتيجة النهائية',
      waitNext: 'ناطرين صاحب السهرة يبلّش الجولة الجاية',
    },
  },
};
