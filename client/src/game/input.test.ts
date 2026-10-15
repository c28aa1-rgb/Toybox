import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Input } from './input';
import { DEFAULT_BINDINGS, getBindings, parseBindings, saveBindings, setControlsEditing } from './bindings';

let input: Input;
const canvas = { tagName: 'CANVAS', closest: () => null, getBoundingClientRect: () => ({left:0,top:0}) } as unknown as HTMLElement;
function key(type: 'keydown' | 'keyup', code: string, repeat = false) {
  const event = Object.assign(new Event(type, {cancelable:true}), {code, repeat});
  Object.defineProperty(event, 'target', {value:canvas});
  window.dispatchEvent(event);
}
function mouse(type: 'mousedown' | 'mouseup', button: number) {
  const event = Object.assign(new Event(type, {cancelable:true}), {button});
  Object.defineProperty(event, 'target', {value:canvas});
  window.dispatchEvent(event);
}
beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('localStorage', {setItem:vi.fn(),getItem:vi.fn()});
  saveBindings(DEFAULT_BINDINGS);
  setControlsEditing(false);
  input = new Input(canvas);
});
afterEach(() => { input.dispose(); vi.unstubAllGlobals(); });

describe('custom controls and cancellation', () => {
  it('cancels an aimed grenade without throwing when G is released', () => {
    key('keydown','KeyG');
    expect(input.throwHeld).toBe(true);
    key('keydown','KeyX');
    key('keydown','KeyG',true);
    key('keyup','KeyG');
    expect(input.throwHeld).toBe(false);
    expect(input.takeThrow()).toBe(false);
    key('keydown','KeyG');
    key('keyup','KeyG');
    expect(input.takeThrow()).toBe(true);
  });
  it('does not cancel a grenade on right click', () => {
    key('keydown','KeyG');
    mouse('mousedown',2);
    expect(input.throwHeld).toBe(true);
    key('keyup','KeyG');
    expect(input.takeThrow()).toBe(true);
  });
  it('applies remapped movement, fire, grenade and cancel keys', () => {
    saveBindings({...getBindings(),right:['KeyL'],fire:['KeyJ'],grenade:['Mouse1'],cancelGrenade:['KeyV']});
    key('keydown','KeyD');
    expect(input.move().mx).toBe(0);
    key('keydown','KeyL');
    key('keydown','KeyJ');
    expect(input.move().mx).toBe(1);
    expect(input.fireHeld).toBe(true);
    mouse('mousedown',1);
    expect(input.throwHeld).toBe(true);
    key('keydown','KeyV');
    mouse('mouseup',1);
    expect(input.takeThrow()).toBe(false);
  });
  it('freezes movement and clears queued actions during leave confirmation', () => {
    key('keydown','KeyW'); key('keydown','KeyG'); key('keydown','KeyQ'); mouse('mousedown',0);
    input.setBlocked(true);
    key('keydown','KeyD'); key('keydown','KeyR'); key('keyup','KeyG');
    expect(input.move()).toEqual({mx:0,my:0});
    expect(input.fireHeld).toBe(false);
    expect(input.takeThrow()).toBe(false);
    expect(input.takeAbility()).toBe(false);
    expect(input.takeReload()).toBe(false);
    input.setBlocked(false);
    expect(input.move()).toEqual({mx:0,my:0});
    key('keydown','KeyD');
    expect(input.move().mx).toBe(1);
  });
  it('does not send captured editor inputs to gameplay', () => {
    key('keydown','KeyW');
    setControlsEditing(true);
    key('keydown','KeyG'); key('keydown','KeyR'); mouse('mousedown',0);
    expect(input.move()).toEqual({mx:0,my:0});
    expect(input.throwHeld).toBe(false);
    expect(input.fireHeld).toBe(false);
    expect(input.takeReload()).toBe(false);
    setControlsEditing(false);
  });
  it('validates saved bindings and preserves intentional unbound actions', () => {
    const parsed = parseBindings({up:['WheelUp'],fire:['bogus'],reload:['KeyT'],ability:[]});
    expect(parsed.up).toEqual(DEFAULT_BINDINGS.up);
    expect(parsed.fire).toEqual(DEFAULT_BINDINGS.fire);
    expect(parsed.reload).toEqual(['KeyT']);
    expect(parsed.ability).toEqual([]);
    saveBindings(parsed);
    expect(localStorage.setItem).toHaveBeenCalledWith('gg.bindings.v1', JSON.stringify(parsed));
  });
});
