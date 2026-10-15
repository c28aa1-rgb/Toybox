import { useEffect, useRef, useState } from 'react';
import { ACTIONS, DEFAULT_BINDINGS, getBindings, inputCode, isHoldAction, keyName, parseBindings, saveBindings, setControlsEditing, validCode, type Action } from '../game/bindings';
import '../theme/controls.css';

export function ControlsButton() {
  const [open, setOpen] = useState(false);
  return <><button type="button" className="controls-open" onClick={() => setOpen(true)}>Customize controls</button>{open && <ControlsEditor onClose={() => setOpen(false)} />}</>;
}

function ControlsEditor({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(() => parseBindings(getBindings()));
  const [capture, setCapture] = useState<{action: Action; index: number} | null>(null);
  const [message, setMessage] = useState('');
  useEffect(() => {
    setControlsEditing(true);
    dialog.current?.showModal();
    return () => { setControlsEditing(false); };
  }, []);
  useEffect(() => {
    if (!capture) return;
    const bind = (event: Event) => {
      const e = event as KeyboardEvent | MouseEvent | WheelEvent;
      if ((e.target as HTMLElement)?.closest('[data-cancel-capture]')) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if ('repeat' in e && e.repeat) return;
      const code = inputCode(e);
      if (!validCode(code) || (code.startsWith('Wheel') && isHoldAction(capture.action))) {
        setMessage('Choose a key or mouse button for a held action.'); return;
      }
      const conflict = (Object.keys(ACTIONS) as Action[]).find(action =>
        draft[action].includes(code) && !(action === capture.action && draft[action][capture.index] === code) &&
        !(['chat', 'respawn'].includes(action) && ['chat', 'respawn'].includes(capture.action)));
      if (conflict) { setMessage(`${keyName(code)} is assigned to ${ACTIONS[conflict]}. Remove that binding first.`); return; }
      const next = [...draft[capture.action]];
      next[capture.index] = code;
      if ('button' in e && e.button === 0) {
        window.addEventListener('click', click => { click.preventDefault(); click.stopImmediatePropagation(); }, {capture:true, once:true});
      }
      setDraft({ ...draft, [capture.action]: next });
      setCapture(null);
      setMessage('');
    };
    for (const name of ['keydown', 'mousedown', 'wheel']) window.addEventListener(name, bind, {capture:true, passive:false});
    return () => { for (const name of ['keydown', 'mousedown', 'wheel']) window.removeEventListener(name, bind, true); };
  }, [capture, draft]);
  return <dialog ref={dialog} className="controls-editor" aria-labelledby="controls-title" onContextMenu={e => e.preventDefault()} onCancel={e => {e.preventDefault(); if (!capture) onClose();}}>
    <header><h2 id="controls-title">Your controls</h2><button type="button" data-cancel-capture onClick={onClose} aria-label="Close controls editor">×</button></header>
    <p>Choose a binding, then press a key, mouse button, or scroll. Mouse movement always aims.</p>
    <div className="controls-editor__status" role="status">{message || (capture ? `Assigning: ${ACTIONS[capture.action]}` : 'Changes apply when you save.')}{capture && <button type="button" data-cancel-capture onClick={() => {setCapture(null);setMessage('');}}>Cancel binding</button>}</div>
    <div className="controls-editor__rows">
      {(Object.keys(ACTIONS) as Action[]).map(action => <div className="controls-editor__row" key={action}>
        <span>{ACTIONS[action]}</span><div>{draft[action].map((code,index) => <span className="controls-editor__binding" key={index}>
          <button type="button" onClick={() => {setMessage('');setCapture({action,index});}} aria-label={`Change ${ACTIONS[action]}: ${keyName(code)}`}>{capture?.action === action && capture.index === index ? 'Press…' : keyName(code)}</button>
          <button type="button" onClick={() => setDraft({...draft,[action]:draft[action].filter((_,i) => i !== index)})} aria-label={`Remove ${keyName(code)} from ${ACTIONS[action]}`}>×</button>
        </span>)}{draft[action].length < 4 && <button type="button" onClick={() => {setMessage('');setCapture({action,index:draft[action].length});}} aria-label={`Add binding for ${ACTIONS[action]}`}>+</button>}</div>
      </div>)}
    </div>
    <footer><button type="button" disabled={!!capture} onClick={() => {setDraft(parseBindings(DEFAULT_BINDINGS));setMessage('Defaults restored. Save to apply.');}}>Reset defaults</button>
      <button type="button" disabled={!!capture} onClick={() => {if(saveBindings(draft)) onClose(); else setMessage('Applied for this session, but browser storage is unavailable.');}}>Save controls</button></footer>
  </dialog>;
}
