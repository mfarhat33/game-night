// Shabakeh (شبكة), browser side. Everyone sees the public grid; only a team's Guide gets the secret key
// (from the private view). The server checks every clue and tap.
import { button, h } from '../dom';
import { injectCss, keepFocus, textInput } from './sticky';
import type { GameClient, ViewCtx } from './types';

interface Tile {
  w: string;
  up: boolean;
  k: number | null;
}
interface Pub {
  phase: 'clue' | 'guess' | 'over';
  tiles: Tile[];
  teams: [string[], string[]];
  guide: [string, string];
  turn: 0 | 1;
  clue: { word: string; num: number } | null;
  left: number;
  picks: number;
  todo: [number, number];
  winner: 0 | 1 | null;
  reason: 'found' | 'trap' | 'forfeit' | null;
  last: { team: 0 | 1; i: number } | null;
}
interface Priv {
  team: 0 | 1 | null;
  guide: boolean;
  key: number[] | null;
}
type C = ViewCtx<Pub, Priv | null>;

const MARK = ['●', '◆', '–', '✕'];
const clueBox = textInput({ testid: 'wg-clue-input', max: 24 });
let num = 2;
let problem = '';

function tile(c: C, t: Tile, i: number, key: number[] | null, tap: boolean): HTMLElement {
  const k = t.k ?? -1;
  const hint = !t.up && key ? key[i] : -1;
  const attrs = {
    class: `wg-t ${t.up || t.k !== null ? `k${k}` : ''} ${t.up ? 'up' : ''} ${hint >= 0 ? `hint h${hint}` : ''} ${tap ? 'tap' : ''} ${c.pub.last?.i === i ? 'last' : ''}`,
    'data-testid': 'wg-tile',
    'data-i': i,
    'data-up': t.up ? '1' : '0',
    'data-key': key ? key[i] : null,
    'data-kind': t.k,
  };
  const inner = [h('span', { class: 'wg-w' }, t.w), h('span', { class: 'wg-m', 'aria-hidden': 'true' }, t.k !== null ? MARK[t.k] : hint >= 0 ? MARK[hint] : '')];
  return tap ? h('button', { type: 'button', ...attrs, onclick: () => c.send({ type: 'pick', i }) }, inner) : h('div', attrs, inner);
}

function grid(c: C, key: number[] | null, tap: boolean): HTMLElement {
  return h('div', { class: 'wg-grid', 'data-testid': 'wg-grid' }, c.pub.tiles.map((t, i) => tile(c, t, i, key, tap && !t.up)));
}

function scoreBar(c: C): HTMLElement {
  const p = c.pub;
  return h(
    'div',
    { class: 'wg-teams' },
    ([0, 1] as const).map((t) =>
      h(
        'div',
        { class: `wg-team tm${t} ${p.phase !== 'over' && p.turn === t ? 'now' : ''}`, 'data-testid': 'wg-team', 'data-team': t },
        h('b', null, `${MARK[t]} ${c.g(`team.${t}`)}`),
        h('span', { class: 'wg-left' }, c.g('toFind', { n: p.todo[t] })),
        h('small', { class: 'muted' }, p.teams[t].map((id) => (id === p.guide[t] ? `★ ${c.name(id)}` : c.name(id))).join(' · ')),
      ),
    ),
  );
}

function status(c: C): HTMLElement {
  const p = c.pub;
  if (p.phase === 'over') return h('div');
  const team = c.g(`team.${p.turn}`);
  if (p.phase === 'clue') return h('p', { class: 'lead center', 'data-testid': 'wg-turn', 'data-team': p.turn, 'data-phase': 'clue' }, c.g('waitClue', { team, name: c.name(p.guide[p.turn]) }));
  return h(
    'div',
    { class: 'stack tight center', 'data-testid': 'wg-turn', 'data-team': p.turn, 'data-phase': 'guess' },
    h('p', { class: 'wg-clue', 'data-testid': 'wg-clue' }, h('b', null, p.clue!.word), ` · ${p.clue!.num}`),
    h('p', { class: 'muted' }, c.g('guessing', { team, n: p.left })),
  );
}

function clueForm(c: C): HTMLElement {
  const restore = keepFocus(clueBox);
  clueBox.placeholder = c.g('cluePh');
  const submit = () => {
    const word = clueBox.value.trim();
    const norm = word.toLowerCase();
    problem = !word || /\s/.test(word) ? c.g('oneWord') : c.pub.tiles.some((t) => !t.up && t.w.toLowerCase() === norm) ? c.g('onBoard') : '';
    if (problem) return void (document.querySelector<HTMLElement>('[data-testid=wg-error]')!.textContent = problem);
    clueBox.value = '';
    c.send({ type: 'clue', word, num });
  };
  const form = h(
    'form',
    { class: 'stack', onsubmit: (e: Event) => (e.preventDefault(), submit()) },
    h('p', { class: 'muted center' }, c.g('yourTurnGuide')),
    clueBox,
    h(
      'div',
      { class: 'wg-nums', role: 'group', 'aria-label': c.g('number') },
      Array.from({ length: 9 }, (_, i) =>
        h(
          'button',
          {
            type: 'button',
            class: 'wg-num',
            'aria-pressed': num === i + 1 ? 'true' : 'false',
            'data-testid': 'wg-num',
            onclick: (e: Event) => {
              num = i + 1;
              (e.currentTarget as HTMLElement).parentElement!.childNodes.forEach((b, j) => (b as HTMLElement).setAttribute('aria-pressed', j === i ? 'true' : 'false'));
            },
          },
          i + 1,
        ),
      ),
    ),
    h('p', { class: 'wg-error', 'data-testid': 'wg-error', role: 'alert' }, problem),
    h('button', { type: 'submit', class: 'btn primary', 'data-testid': 'wg-send' }, c.g('sendClue')),
  );
  restore();
  return form;
}

function result(c: C): HTMLElement {
  const p = c.pub;
  const w = p.winner!;
  return h(
    'section',
    { class: `stack center wg-result tm${w}`, 'data-testid': 'wg-result', 'data-winner': w },
    h('p', { class: 'badge good' }, c.g('wins', { team: c.g(`team.${w}`) })),
    h('p', { class: 'lead' }, c.g(`reason.${p.reason}`, { team: c.g(`team.${1 - w}`) })),
    h('p', { class: 'muted' }, c.g('winPts')),
    c.isHost ? c.hostControls() : c.isScreen ? null : h('p', { class: 'muted' }, c.g('waitNext')),
  );
}

function tv(c: C): HTMLElement {
  const p = c.pub;
  return h('div', { class: 'stack center board wg-board' }, h('h1', { class: 'game-title' }, c.g('title')), scoreBar(c), status(c), grid(c, null, false), p.phase === 'over' ? result(c) : null);
}

function phone(c: C): HTMLElement {
  const p = c.pub;
  const me = c.priv!;
  const mine = me.team === p.turn;
  const guide = me.guide;
  const full = c.mode === 'phones';
  const role = me.team === null ? '' : `${MARK[me.team]} ${c.g(`team.${me.team}`)} · ${c.g(guide ? 'roleGuide' : 'roleTeam')}`;
  const showGrid = p.phase === 'over' || full || guide || (mine && p.phase === 'guess');
  const canTap = !guide && mine && p.phase === 'guess';
  return h(
    'div',
    { class: 'stack' },
    h('p', { class: `wg-me center tm${me.team}`, 'data-testid': 'wg-me', 'data-team': me.team, 'data-guide': guide ? '1' : '0' }, role),
    full || !showGrid ? scoreBar(c) : h('div', { class: 'wg-mini muted center' }, c.g('toFindBoth', { a: p.todo[0], b: p.todo[1] })),
    status(c),
    guide && p.phase === 'clue' && mine ? clueForm(c) : null,
    guide && p.phase !== 'over' ? h('p', { class: 'muted center small' }, c.g('keyHint')) : null,
    showGrid ? grid(c, me.key, canTap) : null,
    canTap && p.picks > 0 ? button(c.g('endTurn'), () => c.send({ type: 'pass' }), { kind: 'ghost', testid: 'wg-pass' }) : null,
    !guide && mine && p.phase === 'clue' ? h('p', { class: 'muted center' }, c.g('waitingGuide')) : null,
    !mine && p.phase !== 'over' ? h('p', { class: 'muted center' }, c.g('otherTurn', { team: c.g(`team.${p.turn}`) })) : null,
    p.phase === 'over' ? result(c) : null,
  );
}

const CSS = `
.wg-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:6px;width:100%;max-width:560px;margin:0 auto}
.board .wg-grid{max-width:min(100%,1000px);gap:10px}
.wg-t{position:relative;display:flex;align-items:center;justify-content:center;min-height:60px;padding:6px 3px;border-radius:12px;border:3px solid transparent;background:#f3e9d2;color:#1b2b2e;font-weight:700;font-size:clamp(.66rem,3.3vw,1rem);text-align:center;overflow-wrap:anywhere;line-height:1.15;cursor:default}
.board .wg-t{min-height:min(13vh,110px);font-size:clamp(1rem,2.1vw,1.7rem)}
.wg-t.tap{cursor:pointer;box-shadow:0 3px 0 #b9ab8a}
.wg-t.tap:active{transform:translateY(2px);box-shadow:none}
.wg-m{position:absolute;top:1px;inset-inline-end:5px;font-size:.7rem;opacity:.9}
.wg-t.hint{border-width:4px}
.wg-t.h0{border-color:#ef6f5e}.wg-t.h1{border-color:#5aa9ef}.wg-t.h2{border-color:#9d927a}.wg-t.h3{border-color:#111;background:#c9bda3}
.wg-t.up{opacity:1;box-shadow:none}
.wg-t.k0{background:#ef6f5e;color:#2a0b06}.wg-t.k1{background:#5aa9ef;color:#05182b}.wg-t.k2{background:#8f866f;color:#1d1a12}.wg-t.k3{background:#111;color:#f6b443;border-color:#f6b443}
.wg-t.last{outline:3px solid var(--amber);outline-offset:1px}
.wg-teams{display:grid;grid-template-columns:1fr 1fr;gap:10px;width:100%}
.wg-team{display:flex;flex-direction:column;gap:2px;padding:10px 12px;border-radius:14px;background:var(--card);border:3px solid transparent;text-align:start}
.wg-team.tm0{border-inline-start-color:#ef6f5e}.wg-team.tm1{border-inline-start-color:#5aa9ef}
.wg-team.now{border-color:var(--amber)}
.wg-left{font-size:.95rem}
.wg-me{font-weight:700;padding:6px 14px;border-radius:999px;background:var(--card);align-self:center}
.wg-me.tm0{color:#ef6f5e}.wg-me.tm1{color:#5aa9ef}
.wg-clue{font-size:2.2rem;line-height:1.2}
.wg-nums{display:grid;grid-template-columns:repeat(9,1fr);gap:5px}
.wg-num{min-height:48px;border-radius:12px;border:2px solid var(--line);background:var(--card-2);font-weight:700;font-size:1.1rem;cursor:pointer;padding:0}
.wg-num[aria-pressed=true]{background:var(--amber);color:var(--amber-ink);border-color:var(--amber)}
.wg-error{color:var(--coral);min-height:1.2em;margin:0;text-align:center}
.wg-result{padding:14px;border-radius:18px;background:var(--card)}
`;

const ICON = `<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="5" y="5" width="12" height="12" rx="3" fill="currentColor"/><rect x="18" y="5" width="12" height="12" rx="3" fill="none" stroke="currentColor" stroke-width="3"/><rect x="31" y="5" width="12" height="12" rx="3" fill="none" stroke="currentColor" stroke-width="3"/><rect x="5" y="18" width="12" height="12" rx="3" fill="none" stroke="currentColor" stroke-width="3"/><rect x="18" y="18" width="12" height="12" rx="3" fill="currentColor"/><rect x="31" y="18" width="12" height="12" rx="3" fill="none" stroke="currentColor" stroke-width="3"/><rect x="5" y="31" width="12" height="12" rx="3" fill="none" stroke="currentColor" stroke-width="3"/><rect x="18" y="31" width="12" height="12" rx="3" fill="none" stroke="currentColor" stroke-width="3"/><rect x="31" y="31" width="12" height="12" rx="3" fill="currentColor"/></svg>`;

export const wordgridClient: GameClient = {
  id: 'wordgrid',
  icon: ICON,
  minPlayers: 4,
  modes: ['phones', 'screen'],
  render(c) {
    injectCss('wg-css', CSS);
    return c.isScreen ? tv(c as C) : phone(c as C);
  },
  strings: {
    en: {
      title: 'Shabakeh',
      blurb: 'Two teams, one secret key. Give one-word clues and find your words, but stay away from the trap.',
      'team.0': 'Coral team',
      'team.1': 'Sky team',
      toFind: '{n} to find',
      toFindBoth: 'Left to find: Coral {a} · Sky {b}',
      roleGuide: 'Guide',
      roleTeam: 'Guesser',
      keyHint: 'The coloured edges are the secret key. Only Guides can see it.',
      waitClue: '{name}, the {team} Guide, is thinking of a clue...',
      guessing: '{team}: {n} taps left',
      yourTurnGuide: 'Give your team one word and a number: how many tiles it points to.',
      cluePh: 'One word',
      number: 'How many tiles',
      sendClue: 'Send clue',
      oneWord: 'Use a single word that is not on the grid.',
      onBoard: 'That word is on the grid. Pick another.',
      endTurn: 'Stop here',
      waitingGuide: 'Waiting for your Guide...',
      otherTurn: "{team}'s turn. Sit tight!",
      wins: '{team} wins!',
      'reason.found': 'They found every one of their tiles.',
      'reason.trap': 'The other team tapped the trap tile.',
      'reason.forfeit': 'The other team does not have enough players left.',
      winPts: 'Everyone on the winning team scores 3 points.',
      waitNext: 'Waiting for the host to start the next round',
    },
    ar: {
      title: 'شبكة',
      blurb: 'فريقين وسرّ واحد. الدليل بيعطي كلمة وحدة، وفريقو بيلاقي كلماتو من دون ما يوقع بالفخّ.',
      'team.0': 'فريق المرجان',
      'team.1': 'فريق السما',
      toFind: 'ضايل {n}',
      toFindBoth: 'ضايل: المرجان {a} · السما {b}',
      roleGuide: 'الدليل',
      roleTeam: 'محزّر',
      keyHint: 'الحواف الملوّنة هي المفتاح السرّي، وبس الأدلاء بيشوفوه.',
      waitClue: '{name}، دليل {team}، عم يفكّر بكلمة...',
      guessing: '{team}: ضايل {n} دوسات',
      yourTurnGuide: 'عطي فريقك كلمة وحدة ورقم: كم كلمة بتشير عليها.',
      cluePh: 'كلمة وحدة',
      number: 'كم كلمة',
      sendClue: 'ابعت التلميح',
      oneWord: 'اكتب كلمة وحدة مش موجودة بالشبكة.',
      onBoard: 'هاي الكلمة موجودة بالشبكة. جرّب غيرها.',
      endTurn: 'وقّف هون',
      waitingGuide: 'ناطرين الدليل...',
      otherTurn: 'دور {team}. اتطمّنو واستنو!',
      wins: 'ربح {team}!',
      'reason.found': 'لاقو كل كلماتن.',
      'reason.trap': 'الفريق التاني داس عالفخّ.',
      'reason.forfeit': 'الفريق التاني ما ضلّ فيه لاعبين كفاية.',
      winPts: 'كل واحد بالفريق الرابح بياخد 3 نقاط.',
      waitNext: 'ناطرين صاحب السهرة يبلّش الجولة الجاية',
    },
  },
};
