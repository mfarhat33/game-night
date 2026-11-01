// Spy, browser side. The server decides everything; this file only draws views and sends taps.
import { button, h } from '../dom';
import type { GameClient, ViewCtx } from './types';

interface Pub {
  phase: 'play' | 'vote' | 'guess' | 'result';
  deadline: number;
  first: string;
  options: string[];
  ready: number;
  need: number;
  voted: number;
  total: number;
  spy: string | null;
  place: string | null;
  votes: Record<string, string> | null;
  accused: string | null;
  guess: string | null;
  outcome: 'escaped' | 'caught' | 'stole' | 'left' | null;
  points: Record<string, number> | null;
}
interface Priv {
  spy: boolean;
  place: string | null;
  role: string | null;
  ready: boolean;
  vote: string | null;
}
type C = ViewCtx<Pub, Priv | null>;

let shown = false;
let listOpen = false;
let roundKey = '';

function card(c: C): HTMLElement {
  const me = c.priv!;
  const key = c.pub.options.join('|');
  if (key !== roundKey) {
    roundKey = key;
    shown = false;
  }
  const face = !shown
    ? h('div', { class: 'card-back' }, h('div', { class: 'card-mark', html: ICON }), h('p', null, c.g('tapReveal')))
    : me.spy
      ? h('div', { class: 'card-face spy-face' }, h('p', { class: 'eyebrow' }, c.g('secret')), h('h2', { 'data-testid': 'spy-place' }, c.g('youSpy')), h('p', null, c.g('spyHint')))
      : h(
          'div',
          { class: 'card-face' },
          h('p', { class: 'eyebrow' }, c.g('place')),
          h('h2', { 'data-testid': 'spy-place' }, me.place),
          h('p', { class: 'eyebrow' }, c.g('role')),
          h('p', { class: 'role', 'data-testid': 'spy-role' }, me.role),
        );
  return h(
    'button',
    {
      type: 'button',
      class: `spy-card ${shown ? 'open' : ''} ${shown && me.spy ? 'is-spy' : ''}`,
      'data-testid': 'spy-card',
      'aria-pressed': shown ? 'true' : 'false',
      onclick: (e: Event) => {
        shown = !shown;
        const el = e.currentTarget as HTMLElement;
        el.replaceWith(card(c));
      },
    },
    face,
    shown ? h('span', { class: 'card-hint' }, c.g('tapHide')) : null,
  );
}

function places(c: C, open: boolean): HTMLElement {
  const list = h('ul', { class: 'chips' }, c.pub.options.map((o) => h('li', null, o)));
  return open ? h('section', { class: 'panel' }, h('h3', null, c.g('places')), list) : h('details', { class: 'panel', open: listOpen, ontoggle: (e: Event) => (listOpen = (e.currentTarget as HTMLDetailsElement).open) }, h('summary', null, c.g('places')), list);
}

function playStatus(c: C): HTMLElement[] {
  return [
    h('div', { class: 'big-timer' }, c.timer(c.pub.deadline)),
    h('p', { class: 'lead' }, c.g('first', { name: c.name(c.pub.first) })),
  ];
}

function result(c: C): HTMLElement {
  const p = c.pub;
  const pts = p.points ?? {};
  return h(
    'section',
    { class: 'stack center', 'data-testid': 'spy-result', 'data-outcome': p.outcome },
    h('p', { class: `badge ${p.outcome === 'caught' ? 'good' : 'warn'}` }, c.g(`outcome.${p.outcome}`)),
    h('h2', null, c.g('reveal.spy', { name: c.name(p.spy!) })),
    h('p', { class: 'lead' }, c.g('reveal.place', { place: p.place ?? '' })),
    p.guess ? h('p', null, c.g('reveal.guess', { place: p.guess })) : null,
    Object.keys(pts).length
      ? h('ul', { class: 'scores' }, Object.entries(pts).map(([pid, n]) => h('li', null, h('span', null, c.name(pid)), h('b', null, `+${n}`))))
      : null,
    c.isHost ? c.hostControls() : c.isScreen ? null : h('p', { class: 'muted' }, c.g('waitNext')),
  );
}

function board(c: C): HTMLElement {
  const p = c.pub;
  const body =
    p.phase === 'play'
      ? [...playStatus(c), h('p', { class: 'muted' }, c.g('howto')), places(c, true), h('p', { class: 'muted' }, c.g('readyCount', { n: p.ready, need: p.need }))]
      : p.phase === 'vote'
        ? [h('h2', null, c.g('vote')), h('div', { class: 'big-timer' }, c.timer(p.deadline)), h('p', { class: 'lead' }, c.g('voting', { n: p.voted, total: p.total }))]
        : p.phase === 'guess'
          ? [h('h2', null, c.g('guessing', { name: c.name(p.spy!) })), h('div', { class: 'big-timer' }, c.timer(p.deadline)), places(c, true)]
          : [result(c)];
  return h('div', { class: 'stack center board' }, h('h1', { class: 'game-title' }, c.g('title')), body);
}

function phone(c: C): HTMLElement {
  const p = c.pub;
  const me = c.priv!;
  const full = c.mode === 'phones';
  if (p.phase === 'play') {
    return h(
      'div',
      { class: 'stack' },
      full ? playStatus(c) : h('div', { class: 'small-timer' }, c.timer(p.deadline)),
      card(c),
      button(me.ready ? c.g('unready') : c.g('ready'), () => c.send({ type: 'ready' }), { kind: me.ready ? 'ghost' : 'primary', testid: 'spy-ready' }),
      h('p', { class: 'muted center' }, c.g('readyCount', { n: p.ready, need: p.need })),
      full || me.spy ? places(c, me.spy) : null,
    );
  }
  if (p.phase === 'vote') {
    const others = c.room.game!.playing.filter((pid) => pid !== c.me);
    return h(
      'div',
      { class: 'stack' },
      h('h2', null, c.g('vote')),
      h('div', { class: 'small-timer' }, c.timer(p.deadline)),
      me.vote
        ? h('p', { class: 'lead', 'data-testid': 'spy-voted' }, c.g('voted', { n: p.voted, total: p.total }))
        : h(
            'div',
            { class: 'grid2' },
            others.map((pid) => button(c.name(pid), () => c.send({ type: 'vote', target: pid }), { kind: 'plain', class: 'vote', testid: 'spy-vote' })),
          ),
    );
  }
  if (p.phase === 'guess') {
    if (me.spy) {
      return h(
        'div',
        { class: 'stack' },
        h('h2', null, c.g('guessNow')),
        h('div', { class: 'small-timer' }, c.timer(p.deadline)),
        h(
          'div',
          { class: 'grid2' },
          p.options.map((o) => button(o, () => c.send({ type: 'guess', place: o }), { kind: 'plain', testid: 'spy-guess' })),
        ),
      );
    }
    return h('div', { class: 'stack center' }, h('h2', null, c.g('guessing', { name: c.name(p.spy!) })), h('div', { class: 'big-timer' }, c.timer(p.deadline)));
  }
  return result(c);
}

const ICON = `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M6 22c4-9 11-13 18-13s14 4 18 13H6z" fill="currentColor" opacity=".9"/><rect x="4" y="21" width="40" height="4" rx="2" fill="currentColor"/><circle cx="16" cy="33" r="6" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="32" cy="33" r="6" fill="none" stroke="currentColor" stroke-width="3"/><path d="M22 33h4" stroke="currentColor" stroke-width="3"/></svg>`;

export const spyClient: GameClient = {
  id: 'spy',
  icon: ICON,
  minPlayers: 3,
  modes: ['phones', 'screen'],
  settings: [
    { key: 'pack', kind: 'choice', options: ['all', 'lebanon', 'kuwait', 'general'] },
    { key: 'minutes', kind: 'number', min: 2, max: 12, step: 1 },
  ],
  render: (c) => (c.isScreen ? board(c as C) : phone(c as C)),
  strings: {
    en: {
      title: 'Spy',
      blurb: 'Everyone knows the place except the spy. Ask sharp questions and catch them.',
      'set.pack': 'Places',
      'set.minutes': 'Minutes per round',
      'opt.pack.all': 'All places',
      'opt.pack.lebanon': 'Lebanon',
      'opt.pack.kuwait': 'Kuwait',
      'opt.pack.general': 'Anywhere',
      tapReveal: 'Tap to see your card. Keep it to yourself!',
      tapHide: 'Tap to hide',
      secret: 'Shh...',
      youSpy: 'You are the spy!',
      spyHint: 'Listen closely, work out the place, and blend in.',
      place: 'The place',
      role: 'Your role',
      first: '{name} asks the first question',
      howto: 'Take turns asking each other about the place. Answer just enough to prove you know it, without giving it away.',
      places: 'Possible places',
      ready: "I'm ready to vote",
      unready: 'Wait, not yet',
      readyCount: '{n} of {need} ready to vote',
      vote: 'Who is the spy?',
      voted: 'Vote in. Waiting for the others ({n}/{total})',
      voting: 'Votes in: {n}/{total}',
      guessing: '{name} is the spy! One last chance to guess the place...',
      guessNow: "You've been caught! Name the place to steal the round.",
      'outcome.escaped': 'The spy got away!',
      'outcome.caught': 'Spy caught!',
      'outcome.stole': 'Caught, but the spy guessed the place and stole the round!',
      'outcome.left': 'The spy left the game.',
      'reveal.spy': 'The spy was {name}',
      'reveal.place': 'The place was: {place}',
      'reveal.guess': "The spy's guess: {place}",
      waitNext: 'Waiting for the host to start the next round',
    },
    ar: {
      title: 'الجاسوس',
      blurb: 'كلّن بيعرفو وين نحنا إلا الجاسوس. اسألو أسئلة ذكية واكشفوه.',
      'set.pack': 'الأماكن',
      'set.minutes': 'دقايق كل جولة',
      'opt.pack.all': 'كل الأماكن',
      'opt.pack.lebanon': 'لبنان',
      'opt.pack.kuwait': 'الكويت',
      'opt.pack.general': 'من كل مكان',
      tapReveal: 'دوس لتشوف ورقتك، وما تفرجيها لحدا!',
      tapHide: 'دوس لتخبّيها',
      secret: 'هسّ...',
      youSpy: 'إنت الجاسوس!',
      spyHint: 'سمّع منيح، حاول تعرف وين نحنا، وما تنكشف.',
      place: 'المحل',
      role: 'دورك',
      first: '{name} بيسأل أوّل سؤال',
      howto: 'كل واحد بيسأل التاني سؤال عن المحل. جاوبو بشي بيبيّن إنكن بتعرفو، بس ما يفضح المحل للجاسوس.',
      places: 'الأماكن الممكنة',
      ready: 'جاهز صوّت',
      unready: 'لحظة، مش بعد',
      readyCount: '{n} من {need} جاهزين يصوّتو',
      vote: 'مين الجاسوس؟',
      voted: 'صوّتت. ناطرين الباقيين ({n}/{total})',
      voting: 'صوّتو لهلّق: {n}/{total}',
      guessing: '{name} هو الجاسوس! عندو فرصة أخيرة يحزر المحل...',
      guessNow: 'انكشفت! احزر المحل وبتسرق الجولة.',
      'outcome.escaped': 'الجاسوس فلت منكن!',
      'outcome.caught': 'مسكتو الجاسوس!',
      'outcome.stole': 'انمسك، بس حزر المحل وسرق الجولة!',
      'outcome.left': 'الجاسوس فلّ من اللعبة.',
      'reveal.spy': 'الجاسوس كان {name}',
      'reveal.place': 'المحل كان: {place}',
      'reveal.guess': 'الجاسوس حزر: {place}',
      waitNext: 'ناطرين صاحب السهرة يبلّش الجولة الجاية',
    },
  },
};
