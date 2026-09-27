// Menus on Radix (menubar + dropdown), data-driven: a skin passes MenuEntry[] builders (built when
// a menu opens, from the store as it is then) and class names. Which menu is open is the store's
// ui.menu, so the page's Escape, the burger list and every opener agree on one owner:
//   'top:<name>' / 'side:<name>' a menubar menu (side = the narrow-width list, menus cascade right),
//   'burger' the narrow-width list itself, or any owner string a Dropdown names ('pill', 'picker').
// Content portals into the shell's container; `data-depth` counts the cascade from 0.
import * as MB from '@radix-ui/react-menubar';
import * as DM from '@radix-ui/react-dropdown-menu';
import { useEffect, type FocusEvent as ReactFocusEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactElement, type ReactNode } from 'react';
import { useMenus } from './hooks';
import { useShell } from './shell';

export interface MenuItem {
  label: string;
  accel?: string;
  check?: boolean;
  sub?: MenuEntry[];
  act?: () => void;
  /** greyed, not choosable */
  disabled?: boolean;
  /** a class for a small icon before the label */
  icon?: string;
  /** one of a set (role menuitemradio); a `check` without it is a toggle (menuitemcheckbox) */
  radio?: boolean;
  /** a submenu opened (load what it lists) */
  onOpen?: () => void;
  sep?: false;
}
export type MenuEntry = MenuItem | { sep: true };

/** Class names for a menu's parts. Items carry Radix's data-highlighted (hover or keyboard focus). */
export interface MenuClasses {
  content: string;
  item: string;
  check: string;
  label: string;
  accel: string;
  sep: string;
}

/** A press on an opener (data-menuzone: the menu buttons, the burger, the picker) is that opener's
 *  to handle, not a press outside to dismiss on: the burger closes the lot, the picker toggles.
 *  Read from composedPath() because in the Spotify shadow root the document sees every press
 *  retargeted to the host. (Switching between menu-bar menus needs no help: useMenus().close
 *  ignores a late close from the menu being switched away from.) */
type Outside = { detail: { originalEvent: Event }; preventDefault(): void };
const keepForOpeners = (e: Outside) => {
  const t = e.detail.originalEvent.composedPath?.()[0] as Element | undefined;
  if (t?.closest?.('[data-menuzone]')) e.preventDefault();
};
const noFocusReturn = (e: Event) => e.preventDefault();

// Arrow / Home / End inside a menu, done here rather than by Radix: its focus helper watches
// `document.activeElement`, which inside an open shadow root is always the host element, so it
// walks to the last item and stops there (measured in the Spotify overlay). The root's own
// activeElement is the truth in both hosts.
export function menuItems(menu: HTMLElement): HTMLElement[] {
  return Array.from(menu.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([data-disabled])'))
    .filter((el) => el.closest('[data-menuzone]') === menu);
}
export function activeIn(menu: HTMLElement): Element | null {
  const root = menu.getRootNode() as Document | ShadowRoot;
  return root.activeElement;
}
export function navigateMenu(menu: HTMLElement, key: string): boolean {
  const items = menuItems(menu);
  if (!items.length) return false;
  const cur = items.indexOf(activeIn(menu) as HTMLElement);
  let next: number;
  if (key === 'ArrowDown') next = cur < 0 ? 0 : (cur + 1) % items.length;
  else if (key === 'ArrowUp') next = cur < 0 ? items.length - 1 : (cur - 1 + items.length) % items.length;
  else if (key === 'Home') next = 0;
  else if (key === 'End') next = items.length - 1;
  else return false;
  items[next]?.focus();
  return true;
}
// Capture phase, so the item's own Radix handler never sees the key: it would otherwise queue its
// focus helper, which (same bug) re-walks the candidates after ours and lands back on the item it
// started from. Only for keys aimed at this menu: a submenu's keys bubble through its portal here.
const navKeys = (e: ReactKeyboardEvent<HTMLElement>) => {
  if ((e.target as HTMLElement).closest('[data-menuzone]') !== e.currentTarget) return;
  if (navigateMenu(e.currentTarget, e.key)) { e.preventDefault(); e.stopPropagation(); }
};
// Entry focus: Radix focuses the content, then its roving group tries the items in turn and, in a
// shadow root, ends on the last one (see above). Its handlers run after ours, so the correction
// waits a microtask and moves a last-item landing back to the first item; in a plain document the
// first item is already focused and nothing happens.
const fixEntryFocus = (e: ReactFocusEvent<HTMLElement>) => {
  if (e.target !== e.currentTarget) return;
  const menu = e.currentTarget;
  queueMicrotask(() => {
    const items = menuItems(menu);
    if (items.length > 1 && activeIn(menu) === items[items.length - 1]) items[0]?.focus();
  });
};

type Parts = typeof MB | typeof DM;

function Entries({ P, items, depth, cls }: { P: Parts; items: MenuEntry[]; depth: number; cls: MenuClasses }) {
  const portal = useShell().portal;
  const spans = (it: MenuItem, right: string) => (
    <>
      <span className={cls.check}>{it.check ? '✓' : ''}</span>
      <span className={cls.label}>{it.icon && <span className={it.icon} aria-hidden="true" />}{it.label}</span>
      <span className={cls.accel}>{right}</span>
    </>
  );
  const one = (it: MenuItem, k: number) => it.sub ? (
    <P.Sub key={k} onOpenChange={(o) => { if (o) it.onOpen?.(); }}>
      <P.SubTrigger className={cls.item} data-sub="1" disabled={it.disabled}>{spans(it, '▶')}</P.SubTrigger>
      <P.Portal container={portal}>
        <P.SubContent className={cls.content} data-depth={depth + 1} data-menuzone="" data-ui-root="" loop
                      sideOffset={-3} alignOffset={-2} collisionPadding={2} onInteractOutside={keepForOpeners}
                      onKeyDownCapture={navKeys} onFocus={fixEntryFocus}>
          <Entries P={P} items={it.sub} depth={depth + 1} cls={cls} />
        </P.SubContent>
      </P.Portal>
    </P.Sub>
  ) : it.radio ? (
    <P.RadioItem key={k} value={String(k)} className={cls.item} disabled={it.disabled} onSelect={() => it.act?.()}>{spans(it, it.accel ?? '')}</P.RadioItem>
  ) : it.check !== undefined ? (
    <P.CheckboxItem key={k} checked={it.check} className={cls.item} disabled={it.disabled} onSelect={() => it.act?.()}>
      {spans(it, it.accel ?? '')}
    </P.CheckboxItem>
  ) : (
    <P.Item key={k} className={cls.item} disabled={it.disabled} onSelect={() => it.act?.()}>{spans(it, it.accel ?? '')}</P.Item>
  );
  // consecutive radio entries are one group (aria-checked on the checked one)
  const out: ReactNode[] = [];
  for (let k = 0; k < items.length; k++) {
    const it = items[k]!;
    if (it.sep) { out.push(<P.Separator key={k} className={cls.sep} />); continue; }
    if (!it.radio || it.sub) { out.push(one(it, k)); continue; }
    const start = k, run: ReactNode[] = [];
    let value = '';
    for (; k < items.length && !items[k]!.sep && (items[k] as MenuItem).radio && !(items[k] as MenuItem).sub; k++) {
      const r = items[k] as MenuItem;
      if (r.check) value = String(k);
      run.push(one(r, k));
    }
    k--;
    out.push(<P.RadioGroup key={'g' + start} value={value}>{run}</P.RadioGroup>);
  }
  return out;
}

export interface MenuBarProps {
  /** [name, label, items]: items() is called as the menu opens */
  menus: readonly (readonly [string, string, () => MenuEntry[]])[];
  classes: MenuClasses;
  id?: string;
  className?: string;
  /** the top-level list (role=menubar) and its buttons */
  listId?: string;
  listClassName?: string;
  triggerClassName?: string;
  /** the narrow-width ☰ that shows the list as a dropdown of its own */
  burger?: { id?: string; className?: string };
}

/** File / View / Play / Tools / Help: click toggles, hover switches while one is open, the arrows
 *  walk (Left/Right between menus, Right/Left into and out of submenus), Escape closes. */
export function MenuBar({ menus, classes, id, className, listId, listClassName, triggerClassName, burger }: MenuBarProps) {
  const portal = useShell().portal, m = useMenus();
  const side = m.open === 'burger' || !!m.open?.startsWith('side:');
  const value = m.open?.startsWith('top:') || m.open?.startsWith('side:') ? m.open : '';
  // the burger list closes on a click anywhere but a menu, a menu button or the burger
  useEffect(() => {
    if (m.open !== 'burger') return;
    const f = (e: MouseEvent) => {
      const t = (e.composedPath?.()[0] ?? e.target) as Element;
      if (!t.closest?.('[data-menuzone]')) m.close('burger');
    };
    document.addEventListener('click', f);
    return () => document.removeEventListener('click', f);
  }, [m]);
  return (
    <div className={className} id={id} data-open={side || undefined}>
      {burger && (
        <button className={burger.className} id={burger.id} data-menuzone="" aria-haspopup="true" aria-expanded={side}
                data-state={side ? 'open' : 'closed'} title="Menu" onClick={() => m.set(side ? null : 'burger')}>
          &#9776;
        </button>
      )}
      <MB.Root className={listClassName} id={listId} value={value} loop
               onValueChange={(v) => (v ? m.set(v) : value && m.close(value))}>
        {menus.map(([name, label, items]) => {
          const owner = (side ? 'side:' : 'top:') + name;
          return (
            <MB.Menu key={name} value={owner}>
              <MB.Trigger className={triggerClassName} data-menu={name} data-menuzone=""
                          onPointerDown={(e) => {
                            // a press on the open menu's own button closes it (Radix would keep it)
                            if (e.button === 0 && !e.ctrlKey && value === owner) { e.preventDefault(); m.set(null); }
                          }}>
                {label}
              </MB.Trigger>
              <MB.Portal container={portal}>
                <MB.Content className={classes.content} data-depth={0} data-menuzone="" data-ui-root="" loop
                            side={side ? 'right' : 'bottom'} align="start" sideOffset={side ? -3 : 0} alignOffset={side ? -2 : 0}
                            collisionPadding={2} onInteractOutside={keepForOpeners} onCloseAutoFocus={noFocusReturn}
                            onKeyDownCapture={navKeys} onFocus={fixEntryFocus}>
                  <Entries P={MB} items={items()} depth={0} cls={classes} />
                </MB.Content>
              </MB.Portal>
            </MB.Menu>
          );
        })}
      </MB.Root>
    </div>
  );
}

/** A menu opened by one button (the view pill, the visualization picker): `trigger` is the skin's
 *  own element (Radix asChild); anything else can open it with useMenus().set(owner). */
export function Dropdown({ owner, items, classes, children }: {
  owner: string; items: () => MenuEntry[]; classes: MenuClasses; children: ReactElement;
}): ReactNode {
  const portal = useShell().portal, m = useMenus();
  return (
    <DM.Root modal={false} open={m.open === owner} onOpenChange={(o) => (o ? m.set(owner) : m.close(owner))}>
      <DM.Trigger asChild>{children}</DM.Trigger>
      <DM.Portal container={portal}>
        <DM.Content className={classes.content} data-depth={0} data-menuzone="" data-ui-root="" loop
                    side="bottom" align="start" collisionPadding={2}
                    onInteractOutside={keepForOpeners} onCloseAutoFocus={noFocusReturn}
                    onKeyDownCapture={navKeys} onFocus={fixEntryFocus}>
          <Entries P={DM} items={items()} depth={0} cls={classes} />
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}
