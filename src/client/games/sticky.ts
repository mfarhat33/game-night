// Small helpers for game views. The whole page is rebuilt on every state update, so anything the
// player is typing into must live outside the render and be put back in each time.

/** Add a <style> block once (game specific CSS lives next to the game, not in the shared sheet). */
export function injectCss(id: string, css: string): void {
  if (document.getElementById(id)) return;
  const el = document.createElement('style');
  el.id = id;
  el.textContent = css;
  document.head.appendChild(el);
}

/** Create a text input that survives re-renders. Call `keepFocus(input)` at the start of render. */
export function textInput(opts: { testid: string; placeholder?: string; max?: number }): HTMLInputElement {
  const el = document.createElement('input');
  el.type = 'text';
  el.className = 'input';
  el.dir = 'auto';
  el.autocomplete = 'off';
  el.autocapitalize = 'off';
  el.spellcheck = false;
  el.enterKeyHint = 'send';
  el.maxLength = opts.max ?? 40;
  el.setAttribute('data-testid', opts.testid);
  if (opts.placeholder) el.placeholder = opts.placeholder;
  return el;
}

/** Remember whether `el` has focus now; call the result after the new DOM is built to restore it. */
export function keepFocus(el: HTMLElement): () => void {
  const had = document.activeElement === el;
  return () => {
    if (had) setTimeout(() => el.focus(), 0);
  };
}
