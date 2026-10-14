/** Keyboard and mouse state for the game canvas. */
export class Input {
  private keys = new Set<string>();
  mouseX = 0;
  mouseY = 0;
  fireHeld = false;
  scopeHeld = false;
  /** Held G: aiming a throw. Releasing it throws. */
  throwHeld = false;
  private throwReleased = false;
  /** 1 or 2 from the number keys, or 'toggle' from the mouse wheel. */
  private slotQueued: 1 | 2 | 'toggle' | null = null;
  private abilityQueued = false;
  private pickupQueued = false;
  scoreboardHeld = false;
  private cleanup: (() => void)[] = [];

  constructor(private el: HTMLElement) {
    const on = <K extends keyof WindowEventMap>(type: K, fn: (e: WindowEventMap[K]) => void, target: EventTarget = window) => {
      target.addEventListener(type, fn as EventListener);
      this.cleanup.push(() => target.removeEventListener(type, fn as EventListener));
    };
    on('keydown', (e) => {
      if (isTyping(e)) return;
      const k = e.code;
      if (k === 'Space' || k === 'Tab') e.preventDefault();
      if (!e.repeat) {
        if (k === 'Space' || k === 'KeyQ') this.abilityQueued = true;
        if (k === 'KeyC') this.scopeHeld = !this.scopeHeld; // keyboard toggle for trackpads
        if (k === 'KeyE' || k === 'KeyF') this.pickupQueued = true;
        if (k === 'Digit1') this.slotQueued = 1;
        if (k === 'Digit2') this.slotQueued = 2;
        if (k === 'KeyG') this.throwHeld = true;
      }
      if (k === 'Tab') this.scoreboardHeld = true;
      if (k === 'ShiftLeft') this.scopeHeld = true; // hold to scope
      this.keys.add(k);
    });
    on('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'Tab') this.scoreboardHeld = false;
      if (e.code === 'ShiftLeft') this.scopeHeld = false;
      if (e.code === 'KeyG' && this.throwHeld) {
        this.throwHeld = false;
        this.throwReleased = true;
      }
    });
    on('blur', () => {
      this.clear();
    });
    on('mousemove', (e) => {
      const r = this.el.getBoundingClientRect();
      this.mouseX = e.clientX - r.left;
      this.mouseY = e.clientY - r.top;
    });
    on('mousedown', (e) => {
      if (e.target !== this.el) return;
      if (e.button === 0) this.fireHeld = true;
      if (e.button === 2) this.scopeHeld = true;
    });
    on('mouseup', (e) => {
      if (e.button === 0) this.fireHeld = false;
      if (e.button === 2) this.scopeHeld = false;
    });
    on('wheel', (e) => {
      if (e.target === this.el && Math.abs(e.deltaY) > 4) this.slotQueued = 'toggle';
    });
    on('contextmenu', (e) => {
      if (e.target === this.el) e.preventDefault();
    });
  }

  /** Drop held keys and buttons, e.g. when the chat box opens. */
  clear(): void {
    this.keys.clear();
    this.fireHeld = false;
    this.scopeHeld = false;
    this.throwHeld = false;
  }

  takeSlot(): 1 | 2 | 'toggle' | null {
    const v = this.slotQueued;
    this.slotQueued = null;
    return v;
  }

  takeThrow(): boolean {
    const v = this.throwReleased;
    this.throwReleased = false;
    return v;
  }

  move(): { mx: number; my: number } {
    const k = this.keys;
    const mx = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const my = (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0);
    return { mx, my };
  }

  takeAbility(): boolean {
    const v = this.abilityQueued;
    this.abilityQueued = false;
    return v;
  }

  takePickup(): boolean {
    const v = this.pickupQueued;
    this.pickupQueued = false;
    return v;
  }

  dispose(): void {
    for (const c of this.cleanup) c();
  }
}

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}
