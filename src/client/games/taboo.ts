// Taboo, browser side. The giver and the opposing team see the card; the giver's teammates only listen.
import { button, h } from '../dom';
import { finale } from './kit';
import type { GameClient, ViewCtx } from './types';

interface Pub {
  phase: 'teams' | 'ready' | 'play' | 'turnend' | 'end';
  teams: Record<string, number>;
  score: [number, number];
  turn: number;
  turns: number;
  team: number;
  giver: string | null;
  deadline: number;
  log: { w: string; m: 'ok' | 'skip' | 'buzz' }[] | null;
  winner: number | null;
}
interface Priv {
  team: number;
  role: 'none' | 'giver' | 'guesser' | 'watcher';
  card: { word: string; banned: string[] } | null;
  n: number;
}
type C = ViewCtx<Pub, Priv | null>;

const teamName = (c: C, t: number) => c.g(t === 0 ? 'teamA' : 'teamB');

function scoreBar(c: C): HTMLElement {
  const s = c.pub.score;
  return h(
    'div',
    { class: 'taboo-score', 'data-testid': 'taboo-score' },
    [0, 1].map((t) => h('div', { class: `team t${t} ${c.pub.phase !== 'teams' && c.pub.team === t && c.pub.phase !== 'end' ? 'turn' : ''}` }, h('span', null, teamName(c, t)), h('b', { 'data-testid': `taboo-score-${t}` }, String(s[t])))),
  );
}

function teamLists(c: C): HTMLElement {
  const p = c.pub;
  const canSwap = c.isHost && !c.isScreen && p.phase === 'teams';
  return h(
    'div',
    { class: 'taboo-teams' },
    [0, 1].map((t) =>
      h(
        'div',
        { class: `team t${t}`, 'data-testid': `taboo-team-${t}` },
        h('h3', null, teamName(c, t)),
        h(
          'ul',
          { class: 'scores' },
          Object.keys(p.teams)
            .filter((pid) => p.teams[pid] === t)
            .map((pid) => h('li', { 'data-name': c.name(pid) }, h('span', null, c.name(pid)), canSwap ? h('button', { type: 'button', class: 'link-btn', 'data-testid': 'taboo-swap', onclick: () => c.send({ type: 'swap', pid }) }, c.g('swap')) : null)),
        ),
      ),
    ),
  );
}

function card(c: C): HTMLElement {
  const k = c.priv!.card!;
  return h(
    'div',
    { class: 'taboo-card', 'data-testid': 'taboo-card' },
    h('div', { class: 'taboo-word', 'data-testid': 'taboo-word' }, k.word),
    h('ul', { class: 'taboo-banned' }, k.banned.map((b) => h('li', { 'data-testid': 'taboo-banned' }, b))),
  );
}

function teamsView(c: C): HTMLElement {
  return h(
    'div',
    { class: 'stack center' },
    h('h2', null, c.g('teams')),
    teamLists(c),
    c.isHost && !c.isScreen ? button(c.g('begin'), () => c.send({ type: 'begin' }), { testid: 'taboo-begin' }) : c.isScreen ? null : h('p', { class: 'muted' }, c.g('waitHost')),
  );
}

function turnView(c: C): HTMLElement {
  const p = c.pub;
  const me = c.priv;
  const role = c.isScreen || !me ? 'screen' : me.role;
  const timer = h('div', { class: c.isScreen ? 'big-timer' : 'small-timer' }, p.phase === 'ready' ? null : c.timer(p.deadline));
  const who = c.name(p.giver!);
  const tn = teamName(c, p.team);
  if (p.phase === 'ready') {
    return h(
      'div',
      { class: 'stack center' },
      scoreBar(c),
      role === 'giver'
        ? [h('h2', null, c.g('yourTurn')), h('p', { class: 'lead' }, c.g('giverHow')), button(c.g('start'), () => c.send({ type: 'start' }), { testid: 'taboo-start' })]
        : h('p', { class: 'lead' }, c.g('readyFor', { name: who, team: tn })),
      c.isHost && !c.isScreen && role !== 'giver' ? button(c.g('skipTurn'), () => c.send({ type: 'next' }), { kind: 'ghost', testid: 'taboo-skip-turn' }) : null,
    );
  }
  // play
  const parts: (HTMLElement | null)[] = [scoreBar(c), timer];
  if (role === 'giver') {
    parts.push(
      card(c),
      h('div', { class: 'grid2' }, button(c.g('correct'), () => c.send({ type: 'correct', n: me!.n }), { testid: 'taboo-correct' }), button(c.g('skip'), () => c.send({ type: 'skip', n: me!.n }), { kind: 'plain', testid: 'taboo-skip' })),
    );
  } else if (role === 'watcher') {
    parts.push(h('p', { class: 'muted center' }, c.g('watch', { name: who })), card(c), button(c.g('buzz'), () => c.send({ type: 'buzz', n: me!.n }), { kind: 'danger', class: 'taboo-buzz', testid: 'taboo-buzz' }));
  } else if (role === 'guesser') {
    parts.push(h('p', { class: 'lead center' }, c.g('guess', { name: who })));
  } else {
    parts.push(h('p', { class: 'lead center' }, c.g('giving', { name: who, team: tn })));
  }
  return h('div', { class: 'stack center' }, parts);
}

function turnEnd(c: C): HTMLElement {
  const p = c.pub;
  const mark = { ok: '✓', skip: '↷', buzz: '✗' };
  return h(
    'section',
    { class: 'stack center', 'data-testid': 'taboo-summary' },
    scoreBar(c),
    h('h2', null, c.g('turnOver', { team: teamName(c, p.team) })),
    h('ul', { class: 'scores' }, p.log!.map((e) => h('li', { class: `m-${e.m}` }, h('span', null, e.w), h('b', null, mark[e.m])))),
    !c.isScreen && (c.isHost || c.me === p.giver) ? button(c.g('next'), () => c.send({ type: 'next' }), { testid: 'taboo-next' }) : null,
  );
}

function final(c: C): HTMLElement {
  const w = c.pub.winner;
  return h(
    'section',
    { class: 'stack center', 'data-testid': 'taboo-result', 'data-winner': w },
    h('h2', null, w === -1 ? c.g('tie') : c.g('wins', { team: teamName(c, w!) })),
    scoreBar(c),
    teamLists(c),
    finale(c, 'waitNext'),
  );
}

function render(c: C): HTMLElement {
  const p = c.pub;
  const body = p.phase === 'teams' ? teamsView(c) : p.phase === 'end' ? final(c) : p.phase === 'turnend' ? turnEnd(c) : turnView(c);
  return h('div', { class: c.isScreen ? 'board stack center' : 'stack center' }, p.phase === 'end' ? null : h('p', { class: 'muted' }, p.phase === 'teams' ? null : c.g('turnOf', { i: p.turn, n: p.turns })), body);
}

const ICON = `<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="19" fill="none" stroke="currentColor" stroke-width="4"/><path d="M11 37 37 11" stroke="currentColor" stroke-width="4" stroke-linecap="round"/></svg>`;

export const tabooClient: GameClient = {
  id: 'taboo',
  icon: ICON,
  minPlayers: 4,
  modes: ['phones', 'screen'],
  settings: [
    { key: 'seconds', kind: 'number', min: 10, max: 120, step: 10 },
    { key: 'rounds', kind: 'number', min: 1, max: 5, step: 1 },
  ],
  render: (c) => render(c as C),
  strings: {
    en: {
      title: 'Taboo',
      blurb: 'Get your team to say the word without using the five banned words. The other team has a buzzer!',
      'set.seconds': 'Seconds per turn',
      'set.rounds': 'Rounds (each team plays once per round)',
      teamA: 'Team A',
      teamB: 'Team B',
      teams: 'The teams',
      swap: 'Switch team',
      begin: 'Start playing',
      waitHost: 'The host can still switch teams',
      turnOf: 'Turn {i} of {n}',
      yourTurn: 'You give the clues!',
      giverHow: 'Describe the word without saying it or any banned word. Your team guesses out loud.',
      readyFor: '{name} is giving clues for {team}',
      start: 'Start the clock',
      skipTurn: 'Skip this turn',
      correct: 'Correct',
      skip: 'Skip',
      watch: 'Watch {name}. If a banned word slips out, buzz!',
      buzz: 'BUZZ!',
      guess: 'Guess out loud! {name} is giving clues.',
      giving: '{name} is giving clues for {team}',
      turnOver: 'Time is up for {team}',
      next: 'Continue',
      tie: "It's a tie!",
      wins: '{team} wins!',
      waitNext: 'Waiting for the host to start the next round',
    },
    ar: {
      title: 'ممنوع الحكي',
      blurb: 'خلّي فريقك يقول الكلمة من دون الكلمات الخمس الممنوعة. والفريق التاني معو جرس!',
      'set.seconds': 'ثواني لكل دور',
      'set.rounds': 'الجولات (كل فريق بيلعب مرة بكل جولة)',
      teamA: 'الفريق أ',
      teamB: 'الفريق ب',
      teams: 'الفِرَق',
      swap: 'بدّل الفريق',
      begin: 'يلا نلعب',
      waitHost: 'صاحب السهرة لسا بيقدر يبدّل الفِرَق',
      turnOf: 'الدور {i} من {n}',
      yourTurn: 'إنت اللي بتعطي التلميحات!',
      giverHow: 'وصّف الكلمة من دون ما تقولها ولا أي كلمة ممنوعة. فريقك بيحزر بصوت عالي.',
      readyFor: '{name} رح يعطي تلميحات لـ{team}',
      start: 'شغّل الوقت',
      skipTurn: 'عدّي هالدور',
      correct: 'صح',
      skip: 'عدّي',
      watch: 'ركّز عـ{name}. إذا طلعت كلمة ممنوعة، دوس الجرس!',
      buzz: 'جرس!',
      guess: 'احزرو بصوت عالي! {name} عم يعطي تلميحات.',
      giving: '{name} عم يعطي تلميحات لـ{team}',
      turnOver: 'خلص الوقت لـ{team}',
      next: 'كمّل',
      tie: 'تعادل!',
      wins: '{team} ربح!',
      waitNext: 'ناطرين صاحب السهرة يبلّش الجولة الجاية',
    },
  },
};
