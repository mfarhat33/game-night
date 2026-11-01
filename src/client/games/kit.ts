// Small pieces shared by the party games (Trivia, Charades, Taboo).
import { h } from '../dom';
import type { ViewCtx } from './types';

/** A score list. Rows are shown in the order given; the row for this player is highlighted. */
export function scoreList(c: ViewCtx, rows: { pid: string; score: number; gain?: number }[], testid?: string): HTMLElement {
  return h(
    'ol',
    { class: 'scores', 'data-testid': testid },
    rows.map((r) =>
      h(
        'li',
        { class: r.pid === c.me ? 'me' : '', 'data-name': c.name(r.pid) },
        h('span', null, c.name(r.pid)),
        h('b', null, r.gain ? h('small', { class: 'gain' }, `+${r.gain} `) : null, String(r.score)),
      ),
    ),
  );
}

/** The bottom of a finished game: host buttons, or a waiting note for everyone else. */
export function finale(c: ViewCtx, waitKey: string): HTMLElement | null {
  return c.isHost ? c.hostControls() : c.isScreen ? null : h('p', { class: 'muted center' }, c.g(waitKey));
}
