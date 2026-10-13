// The striped song table (REFERENCE §Track table): a sticky 22 px header whose cells sort (▲ / ▼; again
// reverses, a third time back to the source's order), 20 px rows in white and #F2F5F9 with the stripes
// running on below the last row, the speaker on the playing row, a click selects, a double-click or
// Enter plays, ↑ / ↓ walk, more pages load as the end scrolls into view. iTunes DJ's rows also drag
// to a new place and leave with Delete. src/ui's ListTable has neither sorting, keys nor dragging, so
// this is the skin's own table over the same Track rows.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react';
import { mss, type Track } from '../../../model';
import { cx } from '../../../ui';
import { Icon } from './icons';
import s from './itunes.module.css';

export interface TrackColumn {
  key: string;
  header: string;
  cell: (t: Track, i: number) => string;
  /** px, or a share of what is left (`'2fr'`) */
  width: number | string;
  right?: boolean;
  /** what the column sorts by (absent: not sortable) */
  sort?: (t: Track) => string | number;
}

const text = (v: string | undefined) => (v ?? '').toLocaleLowerCase();
export const COLUMNS: Record<'num' | 'name' | 'time' | 'artist' | 'album' | 'plays' | 'date', TrackColumn> = {
  num: { key: 'num', header: '#', cell: (t, i) => String(t.trackNumber ?? i + 1), width: 34, right: true, sort: (t) => (t.discNumber ?? 1) * 1000 + (t.trackNumber ?? 0) },
  name: { key: 'name', header: 'Name', cell: (t) => t.title, width: '2.2fr', sort: (t) => text(t.title) },
  time: { key: 'time', header: 'Time', cell: (t) => (t.duration ? mss(t.duration) : ''), width: 50, right: true, sort: (t) => t.duration },
  artist: { key: 'artist', header: 'Artist', cell: (t) => t.artist, width: '1.5fr', sort: (t) => text(t.artist) },
  album: { key: 'album', header: 'Album', cell: (t) => t.album ?? '', width: '1.5fr', sort: (t) => text(t.album) },
  plays: { key: 'plays', header: 'Plays', cell: (t) => (t.playcount ? t.playcount.toLocaleString('en-US') : ''), width: 104, right: true, sort: (t) => t.playcount ?? 0 },
  date: { key: 'date', header: 'Release Date', cell: (t) => t.releaseDate ?? '', width: 96, sort: (t) => t.releaseDate ?? '' },
};
/** iTunes 10's List view columns for these rows (Plays only where Spotify counts them). */
export const listColumns = (rows: readonly Track[]): TrackColumn[] =>
  [COLUMNS.name, COLUMNS.time, COLUMNS.artist, COLUMNS.album, ...(rows.some((t) => t.playcount) ? [COLUMNS.plays] : [])];

type Sort = { key: string; dir: 1 | -1 } | null;

/** The rows as shown under a sort: [row, its index in `rows`]. Stable (ties keep the source's order). */
export function sorted(rows: readonly Track[], columns: readonly TrackColumn[], sort: Sort): [Track, number][] {
  const out = rows.map((t, i) => [t, i] as [Track, number]), c = sort && columns.find((x) => x.key === sort.key);
  if (!c?.sort || !sort) return out;
  const f = c.sort;
  return out.sort((a, b) => { const x = f(a[0]), y = f(b[0]); return (x < y ? -1 : x > y ? 1 : a[1] - b[1]) * sort.dir; });
}

export interface TrackTableProps {
  rows: Track[];
  columns?: TrackColumn[];
  /** the playing track's uri, and whether it plays (the speaker's waves) */
  now: string | null;
  playing?: boolean;
  onPlay: (t: Track, index: number) => void;
  /** a row selected (a click, the keys) */
  onSelect?: (t: Track, index: number) => void;
  /** the next page: asked as the last rows scroll into view */
  more?: (() => void) | null;
  /** scrolls back to the top and drops the selection and the sort when it changes */
  resetKey?: unknown;
  /** iTunes DJ: a row dragged to `to` (an index in `rows`), Delete removes the selected row */
  queue?: { move: (from: number, to: number) => void; remove: (i: number) => void };
  onContextMenu?: (t: Track, index: number, e: MouseEvent) => void;
  /** select this row (by index in `rows`) and show it ("show the current song") */
  reveal?: number | null;
  empty?: string;
  className?: string;
  id?: string;
  /** a row's height in px (20: Windows; the phone may want more) */
  row?: number;
}

export function TrackTable({ rows, columns = listColumns(rows), now, playing, onPlay, onSelect, more, resetKey, queue, onContextMenu, reveal, empty, className, id, row = 20 }: TrackTableProps) {
  const [sel, setSel] = useState<number | null>(null), [sort, setSort] = useState<Sort>(null), [drag, setDrag] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const shown = sorted(rows, columns, queue ? null : sort);
  useLayoutEffect(() => {
    if (box.current) box.current.scrollTop = 0;
    setSel(null); setSort(null); // eslint-disable-line react-hooks/set-state-in-effect -- a new list starts unselected and unsorted
  }, [resetKey]);
  useEffect(() => { if (reveal != null && reveal >= 0) setSel(reveal); }, [reveal]); // eslint-disable-line react-hooks/set-state-in-effect -- an outside "show the current song"
  // the selected row kept in view (keys, "show the current song")
  useEffect(() => {
    if (sel == null) return;
    box.current?.querySelector<HTMLElement>(`tr[data-i="${sel}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [sel]);
  const pick = (i: number) => { setSel(i); const t = rows[i]; if (t) onSelect?.(t, i); };
  const nearEnd = () => {
    const b = box.current;
    if (more && b && b.scrollTop + b.clientHeight > b.scrollHeight - row * 10) more();
  };
  useEffect(nearEnd, [rows.length]); // eslint-disable-line react-hooks/exhaustive-deps -- a short first page asks for the next at once
  const onKey = (e: KeyboardEvent) => {
    const at = shown.findIndex(([, i]) => i === sel);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = shown[Math.max(0, Math.min(shown.length - 1, at < 0 ? 0 : at + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (n) pick(n[1]);
    } else if (e.key === 'Enter' && sel != null && rows[sel]) { e.preventDefault(); onPlay(rows[sel], sel); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && queue && sel != null) { e.preventDefault(); queue.remove(sel); setSel(null); }
    else if (e.key === 'Escape' && sel != null) { e.stopPropagation(); setSel(null); }
  };
  const fr = (w: number | string) => (typeof w === 'number' ? w + 'px' : undefined);
  const head = (c: TrackColumn) => (
    <th key={c.key} scope="col" aria-sort={sort?.key === c.key ? (sort.dir > 0 ? 'ascending' : 'descending') : undefined}
        className={cx('sticky top-0 z-1 h-22 p-0 bg-itunes-head border-b border-itunes-rule font-normal text-11 text-black text-left', !queue && c.sort && 'cursor-default active:bg-[#D8D8D8]')}
        onClick={!queue && c.sort ? () => setSort((o) => (o?.key !== c.key ? { key: c.key, dir: 1 } : o.dir > 0 ? { key: c.key, dir: -1 } : null)) : undefined}>
      <span className={cx('flex items-center gap-4 h-full px-5 border-r border-itunes-col shadow-[inset_0_-1px_0_#FFFFFF] truncate', c.right && 'justify-end')}>
        <span className="truncate">{c.header}</span>
        {sort?.key === c.key && <span className="flex-none text-[9px] text-itunes-dim" aria-hidden="true">{sort.dir > 0 ? '▲' : '▼'}</span>}
      </span>
    </th>
  );
  return (
    <div ref={box} id={id} tabIndex={0} onKeyDown={onKey} onScroll={nearEnd}
         className={cx(s.stripes, 'group/tt relative min-h-0 overflow-auto outline-none bg-white text-12 select-none', className)}
         style={{ '--row': row + 'px', '--head': '23px' } as CSSProperties}>
      <table className="w-full table-fixed border-separate [border-spacing:0] font-itunes text-12 leading-[1.3]">
        <colgroup>
          <col style={{ width: 22 }} />
          {columns.map((c) => <col key={c.key} style={{ width: fr(c.width) }} />)}
        </colgroup>
        <thead><tr>
          <th aria-label="Playing" className="sticky top-0 z-1 h-22 p-0 bg-itunes-head border-b border-itunes-rule"><span className="block h-full border-r border-itunes-col shadow-[inset_0_-1px_0_#FFFFFF]" /></th>
          {columns.map(head)}
        </tr></thead>
        <tbody>
          {shown.map(([t, i]) => {
            const isNow = !!now && t.uri === now;
            return (
              // index in the key: a playlist can hold the same track twice (same uri)
              <tr key={i + ':' + t.uri} data-i={i} data-sel={sel === i || undefined} data-now={isNow || undefined}
                  data-drop={drag !== null && drag !== i ? '' : undefined} style={{ height: row }}
                  className="group/r cursor-default data-sel:bg-itunes-sel-dim data-sel:group-focus/tt:bg-itunes-sel data-sel:group-focus/tt:text-white"
                  onMouseDown={() => pick(i)} onDoubleClick={() => onPlay(t, i)}
                  onContextMenu={onContextMenu && ((e) => { e.preventDefault(); pick(i); onContextMenu(t, i, e); })}
                  draggable={!!queue} onDragStart={queue && (() => setDrag(i))} onDragEnd={queue && (() => setDrag(null))}
                  onDragOver={queue && ((e) => e.preventDefault())}
                  onDrop={queue && ((e) => { e.preventDefault(); if (drag !== null && drag !== i) queue.move(drag, i); setDrag(null); })}>
                <td className="p-0 text-center text-itunes-glyph group-data-sel/r:group-focus/tt:text-white">
                  {isNow && <Icon name={playing ? 'playing' : 'vol-low'} size={12} className="inline-block align-middle" title={playing ? 'Playing' : 'Paused'} />}
                </td>
                {columns.map((c) => {
                  const v = c.cell(t, i);
                  return <td key={c.key} title={v} className={cx('px-5 truncate', c.right && 'text-right [font-variant-numeric:tabular-nums]')}>{v}</td>;
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      {!rows.length && empty && <div className="absolute inset-x-0 top-60 text-center text-12 text-itunes-dim px-20">{empty}</div>}
    </div>
  );
}
