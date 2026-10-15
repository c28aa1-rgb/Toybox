import { getBindings, listenActions, matches } from './bindings';

/** Keyboard, mouse and wheel intents, using the current saved bindings. */
export class Input {
  private keys = new Set<string>();
  private blocked = false;
  private scopeToggled = false;
  mouseX = 0;
  mouseY = 0;
  throwHeld = false;
  private throwReleased = false;
  /** Set when the grenade key goes down; drinkables use it instead of waiting for release. */
  private throwPressed = false;
  private slotQueued: 1 | 2 | 'toggle' | null = null;
  private abilityQueued = false;
  private pickupQueued = false;
  private reloadQueued = false;
  private cleanup: (() => void)[] = [];

  get fireHeld() { return getBindings().fire.some(k => this.keys.has(k)); }
  get scopeHeld() { return this.scopeToggled || getBindings().scope.some(k => this.keys.has(k)); }

  constructor(private el: HTMLElement) {
    const on = (type: string, fn: EventListener) => {
      window.addEventListener(type, fn);
      this.cleanup.push(() => window.removeEventListener(type, fn));
    };
    this.cleanup.push(listenActions((code, e) => {
      if (this.blocked) return;
      if (Object.values(getBindings()).some(keys => keys.includes(code))) e.preventDefault();
      if (!code.startsWith('Wheel')) this.keys.add(code);
      if (matches('ability', code)) this.abilityQueued = true;
      if (matches('scopeToggle', code)) this.scopeToggled = !this.scopeToggled;
      if (matches('pickup', code)) this.pickupQueued = true;
      if (matches('reload', code)) this.reloadQueued = true;
      if (matches('swap', code)) this.slotQueued = 'toggle';
      if (matches('primary', code)) this.slotQueued = 1;
      if (matches('secondary', code)) this.slotQueued = 2;
      if (matches('grenade', code)) {
        this.throwHeld = true;
        this.throwPressed = true;
      }
      if (matches('cancelGrenade', code)) {
        this.throwHeld = false;
        this.throwReleased = false;
      }
    }));
    const release = (code: string) => {
      this.keys.delete(code);
      if (matches('grenade', code) && this.throwHeld && !getBindings().grenade.some(k => this.keys.has(k))) {
        this.throwHeld = false;
        this.throwReleased = true;
      }
    };
    on('keyup', e => release((e as KeyboardEvent).code));
    on('mouseup', e => release('Mouse' + (e as MouseEvent).button));
    on('blur', () => this.clear());
    on('gg:input-reset', () => this.clear());
    on('mousemove', e => {
      const r = this.el.getBoundingClientRect();
      this.mouseX = (e as MouseEvent).clientX - r.left;
      this.mouseY = (e as MouseEvent).clientY - r.top;
    });
    on('contextmenu', e => { if (e.target === this.el) e.preventDefault(); });
  }

  setBlocked(blocked: boolean) { this.blocked = blocked; this.clear(); }
  clear(): void {
    this.keys.clear();
    this.scopeToggled = this.throwHeld = this.throwReleased = false;
    this.abilityQueued = this.pickupQueued = this.reloadQueued = false;
    this.slotQueued = null;
  }
  reload(): void { if (!this.blocked) this.reloadQueued = true; }
  swapWeapon(): void { if (!this.blocked) this.slotQueued = 'toggle'; }
  takeReload() { const v = this.reloadQueued; this.reloadQueued = false; return v; }
  takeSlot() { const v = this.slotQueued; this.slotQueued = null; return v; }
  takeThrow() { const v = this.throwReleased; this.throwReleased = false; this.throwPressed = false; return v; }
  /** Instant use on key down. Clears the hold so releasing the key doesn't fire a second time. */
  takeThrowPress() {
    const v = this.throwPressed;
    this.throwPressed = false;
    if (v) this.throwHeld = this.throwReleased = false;
    return v;
  }
  takeAbility() { const v = this.abilityQueued; this.abilityQueued = false; return v; }
  takePickup() { const v = this.pickupQueued; this.pickupQueued = false; return v; }
  move(): { mx: number; my: number } {
    const held = (action: 'up' | 'down' | 'left' | 'right') => Number(getBindings()[action].some(k => this.keys.has(k)));
    return { mx: held('right') - held('left'), my: held('down') - held('up') };
  }
  dispose() { this.cleanup.forEach(fn => fn()); }
}
