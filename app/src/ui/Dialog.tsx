// The dialog layer: one dialog at a time (store ui.dialog), over a backdrop portalled into the
// shell's container. The frame (title bar, ✕, the button row) and its behaviour are shared: the
// first control takes focus, Escape / ✕ / a click on the backdrop closes. Bodies are the skin's.
// Radix Dialog runs non-modal: its focus trap and aria-hiding judge focus by document.activeElement,
// which inside the Spotify shadow root is always the host, so the backdrop is ours instead.
import * as RD from '@radix-ui/react-dialog';
import type { ComponentType, CSSProperties, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useApp, useShell } from './shell';

// The last input was a key (true) or a pointer: a dialog opened from the keyboard shows its focus
// ring, one opened with the mouse does not. (Radix's menus cancel pointerdown to keep the trigger
// from taking focus, so the browser's own heuristic takes the next scripted focus for keyboard.)
let keyboard = false;
if (typeof document !== 'undefined') {
  document.addEventListener('keydown', () => { keyboard = true; }, true);
  document.addEventListener('pointerdown', () => { keyboard = false; }, true);
}

export function useCloseDialog() {
  const sh = useShell();
  return () => sh.store.getState().actions.setUi({ dialog: null });
}

/** The backdrop and whichever of `dialogs` ui.dialog names (hidden when none). */
export function DialogHost({ dialogs, id, className }: {
  dialogs: Record<string, ComponentType>; id?: string; className?: string;
}) {
  const sh = useShell(), dialog = useApp((s) => s.ui.dialog), close = useCloseDialog();
  const Body = dialog ? dialogs[dialog] : undefined;
  return createPortal(
    <div className={className} id={id} data-ui-root="" hidden={!Body} onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      {Body && <Body />}
    </div>,
    sh.portal,
  );
}

export interface DialogClasses { title: string; titleText: string; close: string; buttons: string; button: string }

export function Dialog({ id, title, label, className, style, classes, buttons, children }: {
  id: string; title: string; label: string; className?: string; style?: CSSProperties; classes: DialogClasses;
  /** [text, onClick, id?] left to right */
  buttons: [string, () => void, string?][]; children: ReactNode;
}) {
  const close = useCloseDialog();
  return (
    <RD.Root open modal={false} onOpenChange={(o) => { if (!o) close(); }}>
      <RD.Content className={className} id={id} aria-modal="true" aria-label={label} aria-describedby={undefined} style={style}
                  onOpenAutoFocus={(e) => {
                    e.preventDefault();
                    (e.currentTarget as HTMLElement).querySelector<HTMLElement>('button, input, select')?.focus({ focusVisible: keyboard } as FocusOptions);
                  }}
                  onCloseAutoFocus={(e) => e.preventDefault()}>
        <div className={classes.title}>
          <RD.Title asChild><span className={classes.titleText}>{title}</span></RD.Title>
          <button type="button" className={classes.close} title="Close" onClick={close}>&#10005;</button>
        </div>
        {children}
        <div className={classes.buttons}>
          {buttons.map(([t, f, bid]) => <button key={t} type="button" className={classes.button} id={bid} onClick={f}>{t}</button>)}
        </div>
      </RD.Content>
    </RD.Root>
  );
}
