// Trivia, browser side. The TV shows the question; phones are four big coloured answer buttons.
import { button, h } from '../dom';
import { finale, scoreList } from './kit';
import type { GameClient, ViewCtx } from './types';

interface Pub {
  phase: 'question' | 'reveal' | 'end';
  i: number;
  n: number;
  q: string | null;
  options: string[] | null;
  deadline: number;
  answered: number;
  players: number;
  answer: number | null;
  counts: number[] | null;
  board: { pid: string; score: number; gain: number }[];
}
interface Priv {
  choice: number | null;
  correct: boolean | null;
  gain: number | null;
}
type C = ViewCtx<Pub, Priv | null>;

const MARKS = ['▲', '◆', '●', '■'];
const LETTERS = ['A', 'B', 'C', 'D'];

function head(c: C): HTMLElement {
  const p = c.pub;
  return h('div', { class: 'row-between' }, h('span', { class: 'muted' }, c.g('qOf', { i: p.i + 1, n: p.n })), h('span', { class: 'small-timer' }, p.phase === 'question' ? c.timer(p.deadline) : null));
}

/** The option tiles. `asButtons` makes them tappable (phones). `textless` shows only the mark (phone as controller). */
function options(c: C, asButtons: boolean, textless: boolean): HTMLElement {
  const p = c.pub;
  const mine = c.priv?.choice ?? null;
  const locked = mine !== null || p.phase !== 'question';
  return h(
    'div',
    { class: `trivia-opts ${textless ? 'compact' : ''}` },
    p.options!.map((o, k) => {
      const state = p.answer === null ? (mine === k ? 'picked' : '') : k === p.answer ? 'right' : mine === k ? 'wrong' : 'dim';
      const label = [h('span', { class: 'mark', 'aria-hidden': 'true' }, MARKS[k]), h('span', { class: 'txt' }, textless ? LETTERS[k] : o)];
      const cls = `trivia-opt opt${k} ${state}`;
      if (!asButtons) return h('div', { class: cls, 'data-testid': `trivia-opt-${k}` }, label, p.counts ? h('small', null, String(p.counts[k])) : null);
      return h('button', { type: 'button', class: cls, disabled: locked, 'aria-label': `${LETTERS[k]}: ${o}`, 'data-testid': 'trivia-answer', 'data-k': k, onclick: () => c.send({ type: 'answer', choice: k }) }, label);
    }),
  );
}

function reveal(c: C, phone: boolean): HTMLElement[] {
  const me = c.priv;
  return [
    phone && me && me.choice !== null
      ? h('p', { class: `badge ${me.correct ? 'good' : 'warn'}`, 'data-testid': 'trivia-verdict' }, me.correct ? c.g('right', { n: me.gain ?? 0 }) : c.g('wrong'))
      : phone
        ? h('p', { class: 'badge warn', 'data-testid': 'trivia-verdict' }, c.g('noAnswer'))
        : null,
    scoreList(c, c.pub.board, 'trivia-board'),
    c.isHost && !c.isScreen ? button(c.g('next'), () => c.send({ type: 'next' }), { testid: 'trivia-next' }) : null,
  ].filter(Boolean) as HTMLElement[];
}

function final(c: C): HTMLElement {
  const top = c.pub.board[0];
  return h(
    'section',
    { class: 'stack center', 'data-testid': 'trivia-result' },
    h('h2', null, c.g('final')),
    top ? h('p', { class: 'lead' }, c.g('winner', { name: c.name(top.pid) })) : null,
    scoreList(c, c.pub.board, 'trivia-board'),
    finale(c, 'waitNext'),
  );
}

function board(c: C): HTMLElement {
  const p = c.pub;
  if (p.phase === 'end') return h('div', { class: 'stack center board' }, final(c));
  return h(
    'div',
    { class: 'stack board' },
    head(c),
    h('h2', { class: 'trivia-q', 'data-testid': 'trivia-question' }, p.q),
    options(c, false, false),
    p.phase === 'question' ? h('p', { class: 'muted center' }, c.g('answered', { n: p.answered, total: p.players })) : reveal(c, false),
  );
}

function phone(c: C): HTMLElement {
  const p = c.pub;
  if (p.phase === 'end') return final(c);
  const full = c.mode === 'phones';
  return h(
    'div',
    { class: 'stack' },
    head(c),
    full ? h('h2', { class: 'trivia-q', 'data-testid': 'trivia-question' }, p.q) : null,
    options(c, p.phase === 'question', !full),
    p.phase === 'question'
      ? h('p', { class: 'muted center' }, c.priv?.choice !== null ? c.g('locked', { n: p.answered, total: p.players }) : full ? c.g('pick') : c.g('lookTv'))
      : reveal(c, true),
  );
}

const ICON = `<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="19" fill="none" stroke="currentColor" stroke-width="4"/><path d="M18 19c0-4 3-6 6-6s6 2 6 5.5c0 4-6 4.5-6 9" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><circle cx="24" cy="35" r="2.6" fill="currentColor"/></svg>`;

export const triviaClient: GameClient = {
  id: 'trivia',
  icon: ICON,
  minPlayers: 2,
  modes: ['screen', 'phones'],
  settings: [
    { key: 'topic', kind: 'choice', options: ['mixed', 'lbkw', 'sport', 'histgeo', 'science'] },
    { key: 'difficulty', kind: 'choice', options: ['mixed', '1', '2', '3'] },
    { key: 'count', kind: 'number', min: 5, max: 30, step: 5 },
    { key: 'seconds', kind: 'number', min: 5, max: 60, step: 5 },
  ],
  render: (c) => (c.isScreen ? board(c as C) : phone(c as C)),
  strings: {
    en: {
      title: 'Trivia',
      blurb: 'Quick questions, four answers. The faster you get it right, the more points.',
      'set.topic': 'Topic',
      'set.difficulty': 'Difficulty',
      'set.count': 'Questions',
      'set.seconds': 'Seconds per question',
      'opt.topic.mixed': 'Mixed',
      'opt.topic.lbkw': 'Lebanon & Kuwait',
      'opt.topic.sport': 'Sport',
      'opt.topic.histgeo': 'History & places',
      'opt.topic.science': 'Science',
      'opt.difficulty.mixed': 'Mixed',
      'opt.difficulty.1': 'Easy',
      'opt.difficulty.2': 'Medium',
      'opt.difficulty.3': 'Hard',
      qOf: 'Question {i} of {n}',
      pick: 'Pick your answer',
      lookTv: 'Look at the screen and tap your answer',
      locked: 'Locked in. Waiting for the others ({n}/{total})',
      answered: 'Answers in: {n}/{total}',
      right: 'Correct! +{n}',
      wrong: 'Wrong answer',
      noAnswer: 'Too slow!',
      next: 'Next question',
      final: 'Final scores',
      winner: '{name} wins the round!',
      waitNext: 'Waiting for the host to start the next round',
    },
    ar: {
      title: 'أسئلة وأجوبة',
      blurb: 'أسئلة سريعة وأربع أجوبة. كل ما كنت أسرع بالجواب الصح، كل ما أخدت نقاط أكتر.',
      'set.topic': 'الموضوع',
      'set.difficulty': 'الصعوبة',
      'set.count': 'عدد الأسئلة',
      'set.seconds': 'ثواني لكل سؤال',
      'opt.topic.mixed': 'منوّع',
      'opt.topic.lbkw': 'لبنان والكويت',
      'opt.topic.sport': 'رياضة',
      'opt.topic.histgeo': 'تاريخ وجغرافيا',
      'opt.topic.science': 'علوم',
      'opt.difficulty.mixed': 'منوّع',
      'opt.difficulty.1': 'سهل',
      'opt.difficulty.2': 'نص نص',
      'opt.difficulty.3': 'صعب',
      qOf: 'السؤال {i} من {n}',
      pick: 'اختار جوابك',
      lookTv: 'طلّ عالشاشة ودوس على جوابك',
      locked: 'تسجّل جوابك. ناطرين الباقيين ({n}/{total})',
      answered: 'جاوبو لهلّق: {n}/{total}',
      right: 'برافو! +{n}',
      wrong: 'جواب غلط',
      noAnswer: 'تأخّرت!',
      next: 'السؤال الجاي',
      final: 'النتيجة النهائية',
      winner: '{name} ربح الجولة!',
      waitNext: 'ناطرين صاحب السهرة يبلّش الجولة الجاية',
    },
  },
};
