// Album List (iTunes 10's new view; REFERENCE §Album List, the Windows crop): the songs grouped by
// album, a left column with the album's cover (once the group is three rows tall) and its name in bold
// over the artist, the group's songs beside it in the stripes, a 1 px rule between albums. A click
// selects, a double-click or Enter plays, ↑ / ↓ walk; the speaker marks the playing row.
import { useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { mss, type Track } from '../../../model';
import { cx } from '../../../ui';
import { albumsOf } from './content';
import { Icon } from './icons';
import s from './itunes.module.css';

export function AlbumList({ rows, now, playing, onPlay, more, resetKey, empty, className, row = 20 }: {
  rows: Track[]; now: string | null; playing?: boolean; onPlay: (t: Track, index: number) => void;
  more?: (() => void) | null; resetKey?: unknown; empty?: string; className?: string; row?: number;
}) {
  const [sel, setSel] = useState<number | null>(null), box = useRef<HTMLDivElement>(null);
  const groups = albumsOf(rows), order = groups.flatMap((g) => g.index);
  useLayoutEffect(() => {
    if (box.current) box.current.scrollTop = 0;
    setSel(null); // eslint-disable-line react-hooks/set-state-in-effect -- a new list starts unselected
  }, [resetKey]);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const at = sel == null ? -1 : order.indexOf(sel), n = order[Math.max(0, Math.min(order.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (n !== undefined) setSel(n);
    } else if (e.key === 'Enter' && sel != null && rows[sel]) { e.preventDefault(); onPlay(rows[sel], sel); }
  };
  const nearEnd = () => { const b = box.current; if (more && b && b.scrollTop + b.clientHeight > b.scrollHeight - row * 10) more(); };
  const th = 'sticky top-0 z-1 h-22 p-0 bg-itunes-head border-b border-itunes-rule font-normal text-11 text-left';
  const cell = 'flex items-center h-full px-5 border-r border-itunes-col shadow-[inset_0_-1px_0_#FFFFFF]';
  return (
    <div ref={box} tabIndex={0} onKeyDown={onKey} onScroll={nearEnd} id="albumlist"
         className={cx(s.stripes, 'group/tt relative min-h-0 overflow-auto outline-none bg-white text-12 select-none', className)}
         style={{ '--row': row + 'px', '--head': '23px' } as CSSProperties}>
      <table className="w-full table-fixed border-separate [border-spacing:0] font-itunes text-12 leading-[1.3]">
        <colgroup><col style={{ width: 220 }} /><col style={{ width: 22 }} /><col style={{ width: 30 }} /><col /><col style={{ width: 50 }} /><col style={{ width: '32%' }} /></colgroup>
        <thead><tr>
          <th className={th}><span className={cell}>Album</span></th>
          <th className={th} aria-label="Playing"><span className={cell} /></th>
          <th className={th}><span className={cx(cell, 'justify-end')}>#</span></th>
          <th className={th}><span className={cell}>Name</span></th>
          <th className={th}><span className={cx(cell, 'justify-end')}>Time</span></th>
          <th className={th}><span className={cell}>Artist</span></th>
        </tr></thead>
        {groups.map((g) => (
          <tbody key={g.key} className="[&>tr:first-child>td]:shadow-[inset_0_1px_0_var(--color-itunes-group)]">
            {g.tracks.map((t, j) => {
              const i = g.index[j]!, isNow = !!now && t.uri === now;
              return (
                <tr key={i + ':' + t.uri} data-sel={sel === i || undefined} style={{ height: row }} data-i={i}
                    className="group/r cursor-default data-sel:[&>td.r]:bg-itunes-sel-dim group-focus/tt:data-sel:[&>td.r]:bg-itunes-sel group-focus/tt:data-sel:[&>td.r]:text-white"
                    onMouseDown={() => setSel(i)} onDoubleClick={() => onPlay(t, i)}>
                  {j === 0 && (
                    <td rowSpan={g.tracks.length} className="align-top bg-white px-6 py-0 overflow-hidden">
                      <div className="flex gap-8 items-start" style={{ maxHeight: g.tracks.length * row }}>
                        {g.tracks.length >= 3 && (g.img
                          ? <img src={g.img} alt="" loading="lazy" className="flex-none mt-3 aspect-square object-cover shadow-[0_1px_2px_rgba(0,0,0,.35)]" style={{ width: Math.min(64, g.tracks.length * row - 7) }} />
                          : <span className="flex-none mt-3 aspect-square bg-itunes-side grid place-items-center text-itunes-side-icon" style={{ width: Math.min(64, g.tracks.length * row - 7) }}><Icon name="music" size={24} /></span>)}
                        <div className="min-w-0">
                          <div className="font-bold truncate" style={{ lineHeight: row + 'px' }} title={g.name}>{g.name}</div>
                          {g.tracks.length >= 2 && <div className="truncate" style={{ lineHeight: row + 'px' }} title={g.artist}>{g.artist}</div>}
                        </div>
                      </div>
                    </td>
                  )}
                  <td className="r p-0 text-center text-itunes-glyph">{isNow && <Icon name={playing ? 'playing' : 'vol-low'} size={12} className="inline-block align-middle" />}</td>
                  <td className="r px-5 text-right [font-variant-numeric:tabular-nums]">{t.trackNumber ?? j + 1}</td>
                  <td className="r px-5 truncate" title={t.title}>{t.title}</td>
                  <td className="r px-5 text-right [font-variant-numeric:tabular-nums]">{t.duration ? mss(t.duration) : ''}</td>
                  <td className="r px-5 truncate" title={t.artist}>{t.artist}</td>
                </tr>
              );
            })}
          </tbody>
        ))}
      </table>
      {!rows.length && empty && <div className="absolute inset-x-0 top-60 text-center text-12 text-itunes-dim px-20">{empty}</div>}
    </div>
  );
}
