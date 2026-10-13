// The sidebar's list (REFERENCE §Sidebar): bold grey section headers, 20 px rows with a grey
// monochrome icon, the selection a full-width bar (blue-grey; blue while the list has focus) with the
// label bold white, count pills and the playing device's speaker at the right. ↑ / ↓ walk it.
import type { KeyboardEvent, ReactNode } from 'react';
import { cx, useWarm } from '../../../ui';
import { Icon } from './icons';
import type { Source, SourceSection } from './sources';

export function SourceList({ sections, selected, onSelect, className, children }: {
  sections: SourceSection[]; selected: string; onSelect: (id: string) => void; className?: string;
  /** after the last row (the desktop's new playlist's name field, at the end of PLAYLISTS) */
  children?: ReactNode;
}) {
  const warm = useWarm(); // a resting pointer loads the playlist before the click
  const flat = sections.flatMap((s) => s.items);
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const i = flat.findIndex((x) => x.id === selected), n = flat[Math.max(0, Math.min(flat.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
    if (n) onSelect(n.id);
  };
  return (
    <div className={cx('group/side outline-none select-none', className)} id="sources" role="tree" aria-label="Sources" tabIndex={0} onKeyDown={onKey}>
      {sections.map((sec) => (
        <div key={sec.id} role="group" aria-label={sec.title}>
          <div className="h-23 pt-8 pl-9 text-11 leading-[15px] font-bold tracking-[.02em] text-itunes-side-head [text-shadow:0_1px_0_rgba(255,255,255,.7)]">{sec.title}</div>
          {sec.items.map((x) => <Row key={x.id} x={x} on={x.id === selected} onSelect={onSelect} warm={warm} />)}
        </div>
      ))}
      {children}
    </div>
  );
}

function Row({ x, on, onSelect, warm }: { x: Source; on: boolean; onSelect: (id: string) => void; warm: (uri?: string) => void }) {
  return (
    <div role="treeitem" aria-selected={on} data-source={x.id} data-on={on || undefined} title={x.label}
         className="group/row flex items-center gap-6 h-20 pl-18 pr-8 text-12 text-black cursor-default data-on:bg-itunes-side-sel data-on:text-white data-on:font-bold data-on:shadow-[inset_0_1px_0_rgba(0,0,0,.08)] group-focus/side:data-on:bg-itunes-side-sel-on data-on:[text-shadow:0_1px_0_rgba(0,0,0,.25)]"
         onMouseDown={() => onSelect(x.id)} onPointerEnter={() => warm(x.uri)}>
      <Icon name={x.icon} className="flex-none text-itunes-side-icon [filter:drop-shadow(0_1px_0_rgba(255,255,255,.8))] group-data-on/row:text-white group-data-on/row:[filter:none]" />
      <span className="flex-auto min-w-0 truncate">{x.label}</span>
      {x.on && <Icon name="playing" size={12} className="flex-none text-itunes-side-icon group-data-on/row:text-white" title="Playing on this device" />}
      {x.badge && <span className="flex-none min-w-20 h-14 px-5 rounded-full bg-itunes-badge text-white text-11 leading-[14px] font-bold text-center [text-shadow:none] group-data-on/row:bg-white group-data-on/row:text-itunes-badge">{x.badge}</span>}
    </div>
  );
}
