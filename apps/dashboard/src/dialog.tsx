import { useEffect, useRef, useState } from 'react';

/**
 * dialog — theme-matching replacements for the browser's native alert / confirm / prompt (which
 * render as an ugly black system popup on GitHub Pages). Imperative + promise-based so any call site
 * can `await uiConfirm(...)` without threading a hook through the tree. Mount <DialogHost/> ONCE at the
 * app root; the exported functions drive it.
 */

type DialogKind = 'alert' | 'confirm' | 'prompt';
interface DialogOpts {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}
interface DialogReq extends DialogOpts {
  kind: DialogKind;
  message: string;
  defaultValue?: string;
  resolve: (v: unknown) => void;
}

let enqueue: ((req: DialogReq) => void) | null = null;

/** A centered, theme-styled OK dialog. Resolves when dismissed. */
export function uiAlert(message: string, opts: DialogOpts = {}): Promise<void> {
  return new Promise((resolve) => {
    if (enqueue) enqueue({ kind: 'alert', message, ...opts, resolve: () => resolve() });
    else resolve();
  });
}
/** A centered confirm. Resolves true (confirm) / false (cancel or backdrop). */
export function uiConfirm(message: string, opts: DialogOpts = {}): Promise<boolean> {
  return new Promise((resolve) => {
    if (enqueue) enqueue({ kind: 'confirm', message, ...opts, resolve: (v) => resolve(Boolean(v)) });
    else resolve(false);
  });
}
/** A centered prompt. Resolves the entered string, or null on cancel. */
export function uiPrompt(message: string, defaultValue = '', opts: DialogOpts = {}): Promise<string | null> {
  return new Promise((resolve) => {
    if (enqueue)
      enqueue({ kind: 'prompt', message, defaultValue, ...opts, resolve: (v) => resolve(v as string | null) });
    else resolve(null);
  });
}

/** Mount once at the app root. Renders the active dialog (one at a time, queued). */
export function DialogHost() {
  const [queue, setQueue] = useState<DialogReq[]>([]);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    enqueue = (req) => {
      setQueue((q) => [...q, req]);
      if (req.kind === 'prompt') setValue(req.defaultValue ?? '');
    };
    return () => {
      enqueue = null;
    };
  }, []);

  const current = queue[0];
  useEffect(() => {
    if (current?.kind === 'prompt') setTimeout(() => inputRef.current?.focus(), 0);
  }, [current]);

  if (!current) return null;

  const finish = (result: unknown) => {
    current.resolve(result);
    setQueue((q) => q.slice(1));
    setValue('');
  };
  const onConfirm = () => finish(current.kind === 'prompt' ? value : true);
  const onCancel = () => finish(current.kind === 'prompt' ? null : false);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click-to-dismiss; keyboard handled on the dialog
    <div className="ui-dialog-backdrop" onClick={onCancel}>
      {/* biome-ignore lint/a11y/useSemanticElements: a portal-less custom modal, not a native <dialog> */}
      <div
        className="ui-dialog"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel();
          if (e.key === 'Enter' && current.kind !== 'alert') onConfirm();
        }}
      >
        {current.title && <h3 className="ui-dialog-title">{current.title}</h3>}
        <p className="ui-dialog-msg">{current.message}</p>
        {current.kind === 'prompt' && (
          <div className="field ui-dialog-field">
            <input
              ref={inputRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </div>
        )}
        <div className="ui-dialog-actions">
          {current.kind !== 'alert' && (
            <button type="button" className="btn ghost" onClick={onCancel}>
              {current.cancelLabel ?? 'Cancel'}
            </button>
          )}
          <button
            type="button"
            className={`btn${current.danger ? ' danger' : ''}`}
            onClick={onConfirm}
          >
            {current.confirmLabel ?? (current.kind === 'alert' ? 'OK' : 'Confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
