// Sahra client: home page, join, lobby and the game shell. Vanilla TypeScript, no framework.
import { type ClientMsg, type ConnKind, type Lang, type Mode, type RoomSnapshot, type ServerMsg } from '../shared/protocol';
import { button, h, mount } from './dom';
import { GAME_LIST, GAMES } from './games';
import type { GameClient, SettingSpec, ViewCtx } from './games/types';
import { getLang, preferredLang, registerStrings, setLang, t } from './i18n';
import { Link, type Status } from './net';
import { qrSvg } from './qr';

for (const g of GAME_LIST) registerStrings(g.id, g.strings);

const app = document.getElementById('app')!;
const modalRoot = document.getElementById('modal')!;
const toastRoot = document.getElementById('toast')!;

// ---- small utilities ---------------------------------------------------------

const store = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v);
    } catch {
      // storage blocked: reconnect after refresh will not work, but play still does
    }
  },
  del(k: string) {
    try {
      localStorage.removeItem(k);
    } catch {
      // ignore
    }
  },
};
const tokenKey = (code: string) => `sahra.t.${code}`;

let clockOffset = 0; // server time minus local time
const serverNow = () => Date.now() + clockOffset;

function fmt(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function timerEl(deadline: number): HTMLElement {
  const el = h('span', { class: 'timer', 'data-deadline': deadline, 'data-testid': 'timer' });
  tick(el);
  return el;
}
function tick(el: HTMLElement) {
  const left = Number(el.dataset.deadline) - serverNow();
  el.textContent = fmt(left);
  el.classList.toggle('low', left <= 10_000);
}
setInterval(() => document.querySelectorAll<HTMLElement>('[data-deadline]').forEach(tick), 250);

let toastTimer: number | undefined;
function toast(text: string) {
  mount(toastRoot, h('div', { class: 'toast' }, text));
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => mount(toastRoot), 3200);
}

function confirmBox(text: string, onYes: () => void) {
  const close = () => mount(modalRoot);
  mount(
    modalRoot,
    h(
      'div',
      { class: 'scrim', onclick: (e: Event) => e.target === e.currentTarget && close() },
      h(
        'div',
        { class: 'sheet', role: 'dialog', 'aria-modal': 'true' },
        h('p', { class: 'lead' }, text),
        h(
          'div',
          { class: 'row' },
          button(t('no'), close, { kind: 'ghost', testid: 'confirm-no' }),
          button(t('yes'), () => (close(), onYes()), { kind: 'danger', testid: 'confirm-yes' }),
        ),
      ),
    ),
  );
}

const LOGO = `<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="30" fill="#f6b443"/><path d="M40 14a20 20 0 1 0 10 30A16 16 0 1 1 40 14z" fill="#0e2a30"/><path d="M44 22l1.6 3.4 3.7.5-2.7 2.6.7 3.7L44 30.4l-3.3 1.8.7-3.7-2.7-2.6 3.7-.5z" fill="#0e2a30"/></svg>`;

function logo(big = false) {
  return h('div', { class: `logo ${big ? 'big' : ''}` }, h('span', { class: 'logo-mark', html: LOGO }), h('span', { class: 'logo-word' }, t('app.name')));
}

function langSwitch(onPick: (l: Lang) => void) {
  const cur = getLang();
  return h(
    'div',
    { class: 'seg small', role: 'group', 'aria-label': 'Language' },
    (['ar', 'en'] as Lang[]).map((l) =>
      h(
        'button',
        { type: 'button', class: l === cur ? 'on' : '', 'aria-pressed': l === cur ? 'true' : 'false', 'data-testid': `lang-${l}`, lang: l, onclick: () => onPick(l) },
        l === 'ar' ? 'عربي' : 'English',
      ),
    ),
  );
}

// ---- home ------------------------------------------------------------------

function homePage() {
  setLang(preferredLang());
  const draw = () => {
    const name = h('input', { id: 'name', class: 'input', maxlength: 20, autocomplete: 'nickname', placeholder: t('home.namePh'), value: store.get('sahra.name') ?? '' });
    const code = h('input', { id: 'code', class: 'input code-input', maxlength: 4, autocapitalize: 'characters', autocomplete: 'off', spellcheck: 'false', placeholder: t('home.codePh'), dir: 'ltr' });
    const needName = () => {
      const v = name.value.trim();
      if (!v) {
        toast(t('home.needName'));
        name.focus();
        return null;
      }
      store.set('sahra.name', v);
      return v;
    };
    const create = async (asTv: boolean) => {
      if (!asTv && !needName()) return;
      const res = await fetch('/api/rooms', { method: 'POST', body: JSON.stringify({ lang: getLang() }) }).catch(() => null);
      if (!res?.ok) return toast(t('err.generic'));
      const { code: c } = (await res.json()) as { code: string };
      if (!asTv) sessionStorage.setItem('sahra.auto', c);
      location.assign(`/${c}${asTv ? '?tv' : ''}`);
    };
    const join = () => {
      const c = code.value.trim().toUpperCase();
      if (!/^[A-Z]{4}$/.test(c)) return toast(t('home.needCode'));
      if (name.value.trim()) {
        store.set('sahra.name', name.value.trim());
        sessionStorage.setItem('sahra.auto', c);
      }
      location.assign(`/${c}`);
    };
    code.addEventListener('keydown', (e) => e.key === 'Enter' && join());
    mount(
      app,
      h(
        'header',
        { class: 'bar' },
        h('span'),
        langSwitch((l) => {
          store.set('sahra.lang', l);
          setLang(l);
          draw();
        }),
      ),
      h(
        'main',
        { class: 'home stack' },
        h('div', { class: 'hero' }, logo(true), h('p', { class: 'tagline' }, t('app.tagline'))),
        h('section', { class: 'panel stack' }, h('label', { for: 'name', class: 'label' }, t('home.name')), name, button(t('home.create'), () => create(false), { testid: 'create' })),
        h('section', { class: 'panel stack' }, h('label', { for: 'code', class: 'label' }, t('home.or')), h('div', { class: 'row' }, code, button(t('home.join'), join, { kind: 'ghost', testid: 'join' }))),
        button(t('home.tv'), () => create(true), { kind: 'plain', testid: 'create-tv' }),
      ),
    );
  };
  draw();
}

// ---- room ------------------------------------------------------------------

interface RoomUI {
  code: string;
  kind: ConnKind;
  me: string | null;
  token: string | null;
  room: RoomSnapshot | null;
  pub: unknown;
  priv: unknown;
  status: Status;
  ended: string | null;
}

async function roomPage(code: string, tv: boolean) {
  setLang(preferredLang());
  mount(app, h('main', { class: 'stack center pad' }, logo(true)));
  const info = await fetch(`/api/rooms/${code}`).catch(() => null);
  if (!info || info.status === 404) {
    return mount(app, h('main', { class: 'stack center pad' }, logo(true), h('p', { class: 'lead', 'data-testid': 'not-found' }, t('room.notFound')), button(t('room.home'), () => location.assign('/'))));
  }
  const token = store.get(tokenKey(code));
  if (tv) return connect(code, { t: 'join', kind: 'screen' });
  if (token) return connect(code, { t: 'join', kind: 'player', token });
  const name = store.get('sahra.name');
  if (sessionStorage.getItem('sahra.auto') === code && name) return connect(code, { t: 'join', kind: 'player', name });
  joinForm(code);
}

function joinForm(code: string) {
  const name = h('input', { id: 'join-name', class: 'input', maxlength: 20, autocomplete: 'nickname', placeholder: t('home.namePh'), value: store.get('sahra.name') ?? '' });
  const go = () => {
    const v = name.value.trim();
    if (!v) return toast(t('home.needName'));
    store.set('sahra.name', v);
    connect(code, { t: 'join', kind: 'player', name: v });
  };
  name.addEventListener('keydown', (e) => e.key === 'Enter' && go());
  mount(
    app,
    h(
      'main',
      { class: 'stack pad' },
      logo(true),
      h('section', { class: 'panel stack' }, h('h2', null, t('join.title', { code })), h('label', { for: 'join-name', class: 'label' }, t('home.name')), name, button(t('join.go'), go, { testid: 'join-go' })),
    ),
  );
  name.focus();
}

function connect(code: string, hello: ClientMsg) {
  const S: RoomUI = { code, kind: hello.t === 'join' ? hello.kind : 'player', me: null, token: null, room: null, pub: null, priv: null, status: 'connecting', ended: null };
  const link: Link = new Link(
    code,
    () => (S.token ? { t: 'join', kind: 'player', token: S.token } : hello),
    (m) => onMsg(m),
    (s) => {
      S.status = s;
      document.body.classList.toggle('offline', s !== 'open');
    },
  );
  const send = (m: ClientMsg) => link.send(m);

  function onMsg(m: ServerMsg) {
    if (m.t === 'welcome') {
      S.me = m.id;
      S.kind = m.kind;
      if (m.token) {
        S.token = m.token;
        store.set(tokenKey(code), m.token);
      }
      sessionStorage.removeItem('sahra.auto');
    } else if (m.t === 'state') {
      clockOffset = m.now - Date.now();
      S.room = m.room;
      S.pub = m.pub;
      S.priv = m.priv;
      if (m.room.lang !== getLang()) setLang(m.room.lang);
      draw();
    } else if (m.t === 'error') {
      if (m.code === 'bad_token' || m.code === 'not_found') {
        store.del(tokenKey(code));
        link.stop();
        return m.code === 'bad_token' ? joinForm(code) : roomPage(code, false);
      }
      if (!S.room) {
        link.stop();
        store.del(tokenKey(code));
        joinForm(code);
      }
      const detailKey = `err.${m.code}.${m.detail}`;
      toast(t(detailKey) !== detailKey ? t(detailKey) : t(`err.${m.code}`, { n: m.detail ?? '' }));
    } else if (m.t === 'bye') {
      link.stop();
      store.del(tokenKey(code));
      S.ended = m.reason;
      mount(modalRoot);
      mount(
        app,
        h('main', { class: 'stack center pad' }, logo(true), h('p', { class: 'lead', 'data-testid': 'bye' }, t(m.reason === 'kicked' ? 'room.kicked' : m.reason === 'left' ? 'room.left' : 'room.gone')), button(t('room.home'), () => location.assign('/'))),
      );
    }
  }

  function draw() {
    const room = S.room;
    if (!room || S.ended) return;
    const isHost = !!S.me && room.hostId === S.me;
    mount(
      app,
      h(
        'header',
        { class: 'bar' },
        logo(),
        h('span', { class: 'chip code', 'data-testid': 'room-code', dir: 'ltr' }, room.code),
        h('span', { class: 'grow' }),
        isHost ? langSwitch((l) => send({ t: 'lang', lang: l })) : null,
        h('span', { class: 'net-dot', title: t('net.reconnecting') }),
      ),
      h('div', { class: 'reconnecting' }, t('net.reconnecting')),
      h('main', { class: `room ${S.kind === 'screen' ? 'tv' : ''}` }, room.game ? gameView(room, isHost) : S.kind === 'screen' ? tvLobby(room) : lobby(room, isHost)),
    );
  }

  const joinUrl = () => `${location.origin}/${code}`;
  const tvUrl = () => `${location.origin}/${code}?tv`;
  const nameOf = (pid: string) => S.room?.players.find((p) => p.id === pid)?.name ?? '?';

  function shareBlock() {
    const share = async () => {
      try {
        if (navigator.share) return await navigator.share({ url: joinUrl(), title: t('app.name') });
        await navigator.clipboard.writeText(joinUrl());
        toast(t('room.copied'));
      } catch {
        // user cancelled
      }
    };
    return h(
      'section',
      { class: 'panel share' },
      h('div', { class: 'qr', 'data-testid': 'qr', html: qrSvg(joinUrl()) }),
      h('div', { class: 'stack' }, h('p', { class: 'label' }, t('room.code')), h('p', { class: 'big-code', dir: 'ltr' }, code), h('p', { class: 'muted small', dir: 'ltr' }, joinUrl().replace(/^https?:\/\//, '')), button(t('room.share'), share, { kind: 'ghost' })),
    );
  }

  function playerList(room: RoomSnapshot, isHost: boolean) {
    return h(
      'section',
      { class: 'panel' },
      h('h2', null, t('room.players', { n: room.players.length })),
      h(
        'ul',
        { class: 'players' },
        room.players.map((p) =>
          h(
            'li',
            { 'data-testid': 'player', 'data-name': p.name, class: p.connected ? '' : 'away' },
            h('span', { class: 'avatar', 'aria-hidden': 'true' }, [...p.name][0]?.toUpperCase() ?? '?'),
            h('span', { class: 'pname' }, p.name),
            p.id === room.hostId ? h('span', { class: 'tag host' }, t('room.host')) : null,
            p.id === S.me ? h('span', { class: 'tag' }, t('room.you')) : null,
            p.connected ? null : h('span', { class: 'tag dim' }, t('room.away')),
            p.score ? h('span', { class: 'score' }, `${p.score} ${t('room.points')}`) : null,
            isHost && p.id !== S.me
              ? h('button', { type: 'button', class: 'link-btn', 'data-testid': 'kick', onclick: () => confirmBox(t('room.removeQ', { name: p.name }), () => send({ t: 'kick', id: p.id })) }, t('room.remove'))
              : null,
          ),
        ),
      ),
    );
  }

  function settingControl(g: GameClient, spec: SettingSpec, value: unknown) {
    const label = h('label', { class: 'label', for: `set-${spec.key}` }, t(`${g.id}.set.${spec.key}`));
    const update = (v: unknown) => send({ t: 'select', settings: { ...S.room!.sel.settings, [spec.key]: v } });
    if (spec.kind === 'choice') {
      return h('div', { class: 'stack tight' }, label, h('div', { class: 'seg wrap' }, spec.options.map((o) => h('button', { type: 'button', class: o === value ? 'on' : '', 'aria-pressed': o === value ? 'true' : 'false', onclick: () => update(o) }, t(`${g.id}.opt.${spec.key}.${o}`)))));
    }
    const n = Number(value);
    return h(
      'div',
      { class: 'stack tight' },
      label,
      h(
        'div',
        { class: 'stepper', dir: 'ltr' },
        h('button', { type: 'button', class: 'btn ghost', 'aria-label': '-', onclick: () => update(Math.max(spec.min, n - spec.step)) }, '−'),
        h('output', { id: `set-${spec.key}` }, String(n)),
        h('button', { type: 'button', class: 'btn ghost', 'aria-label': '+', onclick: () => update(Math.min(spec.max, n + spec.step)) }, '+'),
      ),
    );
  }

  function lobby(room: RoomSnapshot, isHost: boolean) {
    const sel = room.sel;
    const g = GAMES[sel.game];
    const online = room.players.filter((p) => p.connected).length;
    const host = room.players.find((p) => p.id === room.hostId);
    const parts: Node[] = [shareBlock(), playerList(room, isHost)];
    if (isHost) {
      parts.push(
        h(
          'section',
          { class: 'panel stack' },
          h('h2', null, t('room.pick')),
          h(
            'div',
            { class: 'games' },
            GAME_LIST.map((x) =>
              h(
                'button',
                { type: 'button', class: `game-card ${x.id === sel.game ? 'on' : ''}`, 'aria-pressed': x.id === sel.game ? 'true' : 'false', 'data-testid': `game-${x.id}`, onclick: () => send({ t: 'select', game: x.id }) },
                h('span', { class: 'game-icon', html: x.icon }),
                h('b', null, t(`${x.id}.title`)),
                h('span', { class: 'muted small' }, t(`${x.id}.blurb`)),
              ),
            ),
          ),
        ),
      );
      if (g) {
        parts.push(
          h(
            'section',
            { class: 'panel stack' },
            h('h2', null, t('room.mode')),
            h('div', { class: 'seg' }, g.modes.map((m: Mode) => h('button', { type: 'button', class: m === sel.mode ? 'on' : '', 'aria-pressed': m === sel.mode ? 'true' : 'false', 'data-testid': `mode-${m}`, onclick: () => send({ t: 'select', mode: m }) }, t(`mode.${m}`)))),
            h('p', { class: 'muted small' }, t(sel.mode === 'screen' ? 'mode.screenHint' : 'mode.phonesHint')),
            sel.mode === 'screen'
              ? h('p', { class: 'small' }, `${t('room.tvLink')}: `, h('a', { href: tvUrl(), target: '_blank', dir: 'ltr', 'data-testid': 'tv-link' }, tvUrl().replace(/^https?:\/\//, '')), ' · ', t('mode.screens', { n: room.screens }))
              : null,
            g.settings?.length ? h('h3', null, t('room.settings')) : null,
            (g.settings ?? []).map((spec) => settingControl(g, spec, sel.settings[spec.key])),
          ),
        );
        const enough = online >= g.minPlayers;
        parts.push(
          h(
            'div',
            { class: 'stack sticky-cta' },
            !enough ? h('p', { class: 'muted center' }, t('room.needMore', { n: g.minPlayers })) : null,
            button(t('room.start'), () => send({ t: 'start' }), { testid: 'start', disabled: !enough }),
          ),
        );
      }
    } else {
      parts.push(
        h(
          'section',
          { class: 'panel stack center' },
          g ? h('div', { class: 'game-card on static' }, h('span', { class: 'game-icon', html: g.icon }), h('b', null, t(`${g.id}.title`)), h('span', { class: 'muted small' }, t(`${g.id}.blurb`))) : null,
          h('p', { class: 'lead', 'data-testid': 'wait-host' }, t('room.waitHost', { name: host?.name ?? '' })),
        ),
      );
    }
    parts.push(button(t('room.leave'), () => confirmBox(t('room.leaveQ'), () => send({ t: 'leave' })), { kind: 'plain', testid: 'leave' }));
    return h('div', { class: 'stack' }, parts);
  }

  function tvLobby(room: RoomSnapshot) {
    const g = GAMES[room.sel.game];
    return h(
      'div',
      { class: 'tv-lobby' },
      h('div', { class: 'qr big', html: qrSvg(joinUrl()) }),
      h(
        'div',
        { class: 'stack' },
        h('p', { class: 'label' }, t('room.scan')),
        h('p', { class: 'big-code', dir: 'ltr', 'data-testid': 'tv-code' }, code),
        h('p', { class: 'lead', dir: 'ltr' }, joinUrl().replace(/^https?:\/\//, '')),
        h('ul', { class: 'chips big' }, room.players.map((p) => h('li', { class: p.connected ? '' : 'away' }, p.name))),
        g ? h('p', { class: 'lead' }, `${t(`${g.id}.title`)} · ${t(`mode.${room.sel.mode}`)}`) : null,
        h('p', { class: 'muted' }, t('tv.waiting')),
      ),
    );
  }

  function gameView(room: RoomSnapshot, isHost: boolean) {
    const run = room.game!;
    const g = GAMES[run.id];
    const playing = !!S.me && run.playing.includes(S.me);
    const isScreen = S.kind === 'screen';
    const ctx: ViewCtx = {
      lang: getLang(),
      t,
      g: (k, v) => t(`${run.id}.${k}`, v),
      mode: run.mode,
      isScreen,
      me: S.me,
      isHost,
      room,
      pub: S.pub,
      priv: S.priv,
      name: nameOf,
      send: (a) => send({ t: 'act', a }),
      timer: timerEl,
      hostControls: () =>
        isHost
          ? h('div', { class: 'stack' }, button(t('room.again'), () => send({ t: 'again' }), { testid: 'again' }), button(t('room.end'), () => send({ t: 'end' }), { kind: 'ghost', testid: 'to-lobby' }))
          : h('div'),
    };
    const body = !g ? h('p', null, t('err.generic')) : isScreen || playing ? g.render(ctx) : h('p', { class: 'lead center', 'data-testid': 'spectate' }, t('room.spectate'));
    return h(
      'div',
      { class: 'stack' },
      body,
      isHost && !isScreen ? button(t('room.end'), () => confirmBox(t('room.endQ'), () => send({ t: 'end' })), { kind: 'plain', testid: 'end-game' }) : null,
      isScreen ? h('p', { class: 'muted center small' }, `${t('tv.join')} `, h('bdi', { dir: 'ltr' }, joinUrl().replace(/^https?:\/\//, ''))) : null,
    );
  }

  link.open();
}

// ---- router ----------------------------------------------------------------

const m = /^\/([A-Za-z]{4})\/?$/.exec(location.pathname);
if (m) {
  const code = m[1].toUpperCase();
  if (m[1] !== code) history.replaceState(null, '', `/${code}${location.search}`);
  roomPage(code, new URLSearchParams(location.search).has('tv'));
} else {
  homePage();
}
