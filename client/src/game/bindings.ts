import { useSyncExternalStore } from 'react';

export const ACTIONS = {
  up: 'Move up', down: 'Move down', left: 'Move left', right: 'Move right',
  fire: 'Shoot (hold)', scope: 'Scope (hold)', scopeToggle: 'Toggle scope',
  ability: 'Ability', pickup: 'Pick up', reload: 'Reload', swap: 'Swap weapons',
  primary: 'Primary weapon', secondary: 'Secondary weapon', grenade: 'Use utility (hold to aim throws)',
  cancelGrenade: 'Cancel grenade', chat: 'Open chat', respawn: 'Respawn', leave: 'Leave confirmation',
};
export type Action = keyof typeof ACTIONS;
export type Bindings = Record<Action, string[]>;
export const DEFAULT_BINDINGS: Bindings = {
  up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  fire: ['Mouse0'], scope: ['Mouse2', 'ShiftLeft'], scopeToggle: ['KeyC'], ability: ['Space', 'KeyQ'],
  pickup: ['KeyE'], reload: ['KeyR'], swap: ['KeyF', 'WheelUp', 'WheelDown'], primary: ['Digit1'],
  secondary: ['Digit2'], grenade: ['KeyG'], cancelGrenade: ['KeyX'], chat: ['Enter'], respawn: ['Enter'], leave: ['Escape'],
};
const STORAGE = 'gg.bindings.v1';
const listeners = new Set<() => void>();
export const isHoldAction = (action: Action) => ['up', 'down', 'left', 'right', 'fire', 'scope', 'grenade'].includes(action);
export const validCode = (code: unknown): code is string => typeof code === 'string' &&
  /^(Key[A-Z]|Digit[0-9]|Arrow(Up|Down|Left|Right)|F([1-9]|1[0-2])|Numpad([0-9]|Add|Subtract|Multiply|Divide|Decimal|Enter)|Shift(Left|Right)|Control(Left|Right)|Alt(Left|Right)|Space|Enter|Escape|Tab|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Backquote|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash|CapsLock|Mouse[0-4]|WheelUp|WheelDown)$/.test(code);
export function parseBindings(raw: unknown): Bindings {
  const source = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  return Object.fromEntries(Object.keys(ACTIONS).map((key) => {
    const action = key as Action;
    const value = source[action];
    const codes = Array.isArray(value) && value.length <= 4 && value.every(c => validCode(c) && !(isHoldAction(action) && c.startsWith('Wheel')))
      ? [...new Set(value)] : [...DEFAULT_BINDINGS[action]];
    return [action, codes];
  })) as Bindings;
}
let bindings = parseBindings(null);
try { bindings = parseBindings(JSON.parse(localStorage.getItem(STORAGE) ?? 'null')); } catch { /* Defaults work without storage. */ }
let editing = false;
export const isControlsEditing = () => editing;
export function setControlsEditing(value: boolean) {
  editing = value;
  window.dispatchEvent(new Event('gg:input-reset'));
}
export function saveBindings(next: Bindings): boolean {
  bindings = parseBindings(next);
  let saved = true;
  try { localStorage.setItem(STORAGE, JSON.stringify(bindings)); } catch { saved = false; }
  window.dispatchEvent(new Event('gg:input-reset'));
  listeners.forEach(fn => fn());
  return saved;
}
export const getBindings = () => bindings;
export function useBindings() {
  return useSyncExternalStore((fn) => { listeners.add(fn); return () => listeners.delete(fn); }, getBindings);
}
export const matches = (action: Action, code: string) => bindings[action].includes(code);
export function keyName(code: string): string {
  const names: Record<string, string> = { Mouse0: 'LMB', Mouse1: 'MMB', Mouse2: 'RMB', Mouse3: 'Mouse 4', Mouse4: 'Mouse 5', WheelUp: 'Wheel ↑', WheelDown: 'Wheel ↓', Escape: 'Esc', ShiftLeft: 'L Shift', ShiftRight: 'R Shift', ControlLeft: 'L Ctrl', ControlRight: 'R Ctrl', AltLeft: 'L Alt', AltRight: 'R Alt', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' };
  return names[code] ?? code.replace(/^Key|^Digit/, '').replace('Numpad', 'Num ');
}
export const bindingLabel = (action: Action) => bindings[action].map(keyName).join(' / ') || 'Unbound';
export const firstKey = (action: Action) => bindings[action][0] ? keyName(bindings[action][0]) : '—';
export function inputCode(e: KeyboardEvent | MouseEvent | WheelEvent) {
  if ('code' in e) return e.code;
  if ('deltaY' in e) return e.deltaY < 0 ? 'WheelUp' : 'WheelDown';
  return 'Mouse' + e.button;
}
export function acceptsInput(e: KeyboardEvent | MouseEvent | WheelEvent): boolean {
  const target = e.target as HTMLElement | null;
  if (editing || target?.closest('input, textarea, select, [contenteditable="true"], dialog')) return false;
  if ('code' in e) return !e.repeat && !(target?.closest('button') && ['Space', 'Enter'].includes(e.code));
  return target?.tagName === 'CANVAS';
}
export function listenActions(fn: (code: string, e: KeyboardEvent | MouseEvent | WheelEvent) => void): () => void {
  const handler = (event: Event) => {
    const e = event as KeyboardEvent | MouseEvent | WheelEvent;
    if (acceptsInput(e)) fn(inputCode(e), e);
  };
  for (const type of ['keydown', 'mousedown', 'wheel']) window.addEventListener(type, handler, { passive: false });
  return () => { for (const type of ['keydown', 'mousedown', 'wheel']) window.removeEventListener(type, handler); };
}
