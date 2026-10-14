/** Keyboard and mouse state for the game canvas. */
export class Input {
  private keys = new Set<string>();
  mouseX = 0;
  mouseY = 0;
  fireHeld = false;
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
        if (k === 'Space' || k === 'KeyQ' || k === 'ShiftLeft') this.abilityQueued = true;
        if (k === 'KeyE' || k === 'KeyF') this.pickupQueued = true;
      }
      if (k === 'Tab') this.scoreboardHeld = true;
      this.keys.add(k);
    });
    on('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'Tab') this.scoreboardHeld = false;
    });
    on('blur', () => {
      this.keys.clear();
      this.fireHeld = false;
    });
    on('mousemove', (e) => {
      const r = this.el.getBoundingClientRect();
      this.mouseX = e.clientX - r.left;
      this.mouseY = e.clientY - r.top;
    });
    on('mousedown', (e) => {
      if (e.target !== this.el) return;
      if (e.button === 0) this.fireHeld = true;
      if (e.button === 2) this.abilityQueued = true;
    });
    on('mouseup', (e) => {
      if (e.button === 0) this.fireHeld = false;
    });
    on('contextmenu', (e) => {
      if (e.target === this.el) e.preventDefault();
    });
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
