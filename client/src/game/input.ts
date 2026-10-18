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
  /** When the grenade key went down, so a quick tap can be told from a hold. */
  private throwDownAt = 0;
  /** How long the grenade key was held, set on release (ms). */
  private throwReleasedAfter = 0;
  private slotQueued: 1 | 2 | 'toggle' | null = null;
  private abilityQueued = false;
  /** Aimable abilities aim while the key is held and fire on release. */
  abilityHeld = false;
  private abilityReleased = false;
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
      if (matches('ability', code)) {
        this.abilityQueued = true;
        this.abilityHeld = true;
      }
      if (matches('scopeToggle', code)) this.scopeToggled = !this.scopeToggled;
      if (matches('pickup', code)) this.pickupQueued = true;
      if (matches('reload', code)) this.reloadQueued = true;
      if (matches('swap', code)) this.slotQueued = 'toggle';
      if (matches('primary', code)) this.slotQueued = 1;
      if (matches('secondary', code)) this.slotQueued = 2;
      if (matches('grenade', code) && !this.throwHeld) {
        this.throwHeld = true;
        this.throwPressed = true;
        this.throwDownAt = performance.now();
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
        this.throwReleasedAfter = performance.now() - this.throwDownAt;
      }
      if (matches('ability', code) && this.abilityHeld && !getBindings().ability.some(k => this.keys.has(k))) {
        this.abilityHeld = false;
        this.abilityReleased = true;
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
    this.scopeToggled = this.throwHeld = this.throwReleased = this.abilityHeld = this.abilityReleased = false;
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
  takeAbility() { const v = this.abilityQueued; this.abilityQueued = false; this.abilityReleased = false; return v; }
  /** Aimable abilities: fire when the key comes back up. */
  takeAbilityRelease() { const v = this.abilityReleased; this.abilityReleased = false; this.abilityQueued = false; return v; }
  /** Milliseconds the grenade key has been held so far (0 when it isn't). */
  get throwHoldMs() { return this.throwHeld ? performance.now() - this.throwDownAt : 0; }
  /** Grenade key released: how long it was held (ms), or null if it wasn't released since last asked. */
  takeThrowRelease(): number | null {
    if (!this.throwReleased) return null;
    this.throwReleased = false;
    this.throwPressed = false;
    return this.throwReleasedAfter;
  }
  takePickup() { const v = this.pickupQueued; this.pickupQueued = false; return v; }
  move(): { mx: number; my: number } {
    const held = (action: 'up' | 'down' | 'left' | 'right') => Number(getBindings()[action].some(k => this.keys.has(k)));
    return { mx: held('right') - held('left'), my: held('down') - held('up') };
  }
  dispose() { this.cleanup.forEach(fn => fn()); }
}
