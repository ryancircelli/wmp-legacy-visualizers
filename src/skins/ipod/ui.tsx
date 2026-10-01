// What the chrome gives the screens (screens/contract.ts ChromeModule): the wheel-driven list, the
// status row, the progress bar, the hold-centre popup, the spinner, and the hooks.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { hasMedia } from '../../model';
import { cx, isPlaying, useApp } from '../../ui';
import { useHostGlobal } from './host';
import type { Chrome } from './screens/contract';
import { useClockPrefs } from './screens';
import s from './ipod.module.css';
import { useWheel } from './wheel';
export { useNav, useWheel } from './wheel';
export { useIpodSettings } from './settings';

const clamp01 = (v: number) => Math.max(0, Math.min(1, v || 0));

/** The list the wheel scrolls. Selection is the caller's when `selected` is given, else its own. A
 *  row draws a chevron only when it says so (`chevron: true`): the chrome cannot tell a row that
 *  pushes a screen from one that acts. */
export const MenuScreen: Chrome['MenuScreen'] = ({ items, selected, onSelectedChange, preview, loading, empty }) => {
  const [own, setOwn] = useState(0), list = useRef<HTMLDivElement>(null);
  const sel = Math.max(0, Math.min(selected ?? own, items.length - 1));
  const item = items[sel];
  const live = !loading && item && !item.disabled ? item : undefined;
  useWheel({
    onTick: (d) => {
      const i = Math.max(0, Math.min(items.length - 1, sel + d));
      if (i !== sel) { setOwn(i); onSelectedChange?.(i); }
    },
    onCenter: () => live?.onSelect?.(),
    // only while the row has a hold, so a plain row's long press stays a press
    onHoldCenter: live?.onHold ? () => live.onHold?.() : undefined,
  });
  // keep the selected row in view, scrolling the list only (never the page around it)
  useLayoutEffect(() => {
    const l = list.current, row = l?.children[sel] as HTMLElement | undefined;
    if (!l || !row) return;
    if (row.offsetTop < l.scrollTop) l.scrollTop = row.offsetTop;
    else if (row.offsetTop + row.offsetHeight > l.scrollTop + l.clientHeight) l.scrollTop = row.offsetTop + row.offsetHeight - l.clientHeight;
  }, [sel, items.length]);
  return (
    <div className="flex flex-col h-full min-h-0">
      {loading ? <div className="flex-auto grid place-items-center"><Spinner /></div>
        : !items.length ? <div className={cx(s.empty, 'flex-auto grid place-items-center text-center')}>{empty}</div>
        : <div ref={list} className={cx(preview != null ? s.split : 'flex-auto min-h-0', 'relative overflow-hidden')} role="listbox">
            {items.map((it, i) => (
              <div key={it.id} className={s.row} role="option" aria-selected={i === sel} aria-disabled={it.disabled || undefined}
                   data-sel={i === sel || undefined} data-disabled={it.disabled || undefined}>
                <span className="flex-auto min-w-0 truncate">{it.label}</span>
                {it.right != null && <span className="flex-none">{it.right}</span>}
                {it.chevron && <svg className={s.chevron} viewBox="0 0 6 10" aria-hidden="true"><path d="M1 1l4 4-4 4" /></svg>}
              </div>
            ))}
          </div>}
      {preview != null && <div className={s.preview}>{preview}</div>}
    </div>
  );
};

/** The time now, as the iPod writes it, re-rendered on the minute. */
export function useTime(h24: boolean): string {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setTimeout(() => setNow(Date.now()), 60_000 - (now % 60_000));
    return () => clearTimeout(t);
  }, [now]);
  return new Date(now).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: !h24 });
}

/** The title row: shuffle at the left, the title centred (the time instead, with Time in Title),
 *  play / pause and the battery at the right (the phone's, when the iOS app reports it). */
export const StatusRow: Chrome['StatusRow'] = ({ title }) => {
  const st = useApp((x) => ({ media: hasMedia(x), playing: isPlaying(x), shuffle: x.playback.shuffle }));
  const prefs = useClockPrefs(), time = useTime(prefs.twentyFourHour);
  const bat = useHostGlobal('__wmpBattery', 'wmp-battery');
  const level = bat && bat.level >= 0 ? bat.level / 100 : 1;
  return (
    <div className={s.status}>
      <span className="flex items-center">
        {st.shuffle && <svg className={s.glyph} viewBox="0 0 12 10" aria-label="Shuffle">
          <path d="M0 2h3l5 6h2M0 8h3l5-6h2" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M10 0v4l2-2zM10 6v4l2-2z" /></svg>}
      </span>
      <span className="min-w-0 truncate text-center">{prefs.timeInTitle ? time : title}</span>
      <span className="flex items-center justify-end gap-[calc(var(--unit)*4)]">
        {st.media && <svg className={s.glyph} viewBox="0 0 10 10" aria-label={st.playing ? 'Playing' : 'Paused'}>
          <path d={st.playing ? 'M1 0v10l8-5z' : 'M1 0h3v10H1zM6 0h3v10H6z'} /></svg>}
        <span className={s.battery} style={{ '--v': clamp01(level) } as CSSProperties} data-charging={bat?.charging || undefined}
              aria-label={bat && bat.level >= 0 ? 'Battery ' + bat.level + '%' : 'Battery'} />
      </span>
    </div>
  );
};

/** The iPod's blue progress bar. */
export const Bar: Chrome['Bar'] = ({ value, className }) => (
  <div className={cx(s.bar, className)} style={{ '--v': clamp01(value) } as CSSProperties}
       role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(clamp01(value) * 100)} />
);

/** A modal list over the screen: it takes the wheel while open; MENU or a choice closes it. */
export const Popup: Chrome['Popup'] = ({ items, onClose }) => {
  useWheel({ onMenu: () => { onClose(); return true; }, onHoldCenter: () => {} });
  const closing = items.map((it) => ({ ...it, onSelect: () => { onClose(); it.onSelect?.(); } }));
  return (
    <div className={s.popup}>
      <div className={s.sheet}><MenuScreen items={closing} /></div>
    </div>
  );
};

export const Spinner: Chrome['Spinner'] = () => <div className={s.spinner} role="progressbar" aria-label="Loading" />;
