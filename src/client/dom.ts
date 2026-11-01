// A tiny DOM helper. No framework: views are rebuilt on every state update, which is cheap at this size.
type Child = Node | string | number | null | undefined | false | Child[];
type Props = Record<string, unknown> | null | undefined;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      else if (k === 'class') el.className = String(v);
      else if (k === 'html') el.innerHTML = String(v);
      else if (k === 'value' && 'value' in el) (el as HTMLInputElement).value = String(v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

function append(el: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
  }
}

export function mount(root: HTMLElement, ...children: Child[]): void {
  root.textContent = '';
  append(root, children);
}

/** A big button. `kind` is "primary", "ghost", "danger" or "plain". */
export function button(label: Child, onClick: () => void, opts: { kind?: string; testid?: string; disabled?: boolean; class?: string } = {}) {
  return h(
    'button',
    {
      type: 'button',
      class: `btn ${opts.kind ?? 'primary'} ${opts.class ?? ''}`.trim(),
      'data-testid': opts.testid,
      disabled: opts.disabled,
      onclick: onClick,
    },
    label,
  );
}
