// Grid view (REFERENCE §Grid): covers on white, the name bold black and the artist grey under each,
// centred; a click selects, a double-click (or Enter) opens, the round ▶ over a cover (on hover, and
// always on the playing one) plays it where it stands. src/ui's TileGrid is the behaviour.
import { useState } from 'react';
import { cx, TileGrid, usePlayingContext, type TileItem, type TileSection } from '../../../ui';
import { Icon } from './icons';

export function AlbumGrid({ sections, onOpen, onPlay, more, className, id, size = 'normal' }: {
  sections: TileSection[];
  /** a double-click, Enter: open the tile's page (or play a track tile) */
  onOpen: (it: TileItem) => void;
  onPlay: (it: TileItem) => void;
  more?: { label: string; load: () => void } | null;
  className?: string; id?: string;
  /** the phone's smaller covers */
  size?: 'normal' | 'small';
}) {
  const [sel, setSel] = useState<string | null>(null), current = usePlayingContext(), small = size === 'small';
  const cover = small ? 'w-96 h-96' : 'w-124 h-124';
  return (
    <TileGrid sections={sections} selected={sel} current={current} more={more} id={id}
      className={cx('min-h-0 overflow-auto bg-white pt-12 pb-20 select-none', className)}
      onClick={(it, keyboard) => { setSel(it.uri); if (keyboard) onOpen(it); }}
      onDoubleClick={onOpen} onPlay={onPlay} onEscape={() => setSel(null)}
      cover={(it) => (
        <span className={cx(cover, 'grid place-items-center bg-[linear-gradient(180deg,#F4F4F4,#DADADA)] border border-[#C8C8C8] text-[#9A9A9A]')}>
          <Icon name={it.uri.startsWith('spotify:show:') ? 'podcast' : 'music'} size={small ? 30 : 40} />
        </span>
      )}
      classes={{
        section: 'mb-16',
        heading: 'mx-14 mb-8 pb-3 border-b border-[#D5D5D5] text-13 font-bold text-[#3B3B3B]',
        row: cx('grid gap-y-12 gap-x-4 px-10', small ? 'grid-cols-[repeat(auto-fill,minmax(110px,1fr))]' : 'grid-cols-[repeat(auto-fill,minmax(146px,1fr))]'),
        tile: 'group/tile relative flex flex-col items-center min-w-0 p-6 rounded-md border-0 bg-transparent text-center cursor-default outline-none data-sel:bg-[#DCE4EF] focus-visible:bg-[#DCE4EF]',
        img: cx(cover, 'block object-cover bg-itunes-side shadow-[0_2px_5px_rgba(0,0,0,.38)]'),
        name: 'mt-7 w-full truncate text-11 leading-[14px] font-bold text-black',
        sub: 'w-full truncate text-11 leading-[14px] text-itunes-dim empty:hidden',
        play: cx('absolute left-1/2 -translate-x-1/2 -translate-y-1/2 grid place-items-center w-32 h-32 rounded-full border-2 border-white/85 bg-black/55 text-white text-12 leading-none opacity-0 shadow-[0_1px_4px_rgba(0,0,0,.5)] group-hover/tile:opacity-100 group-focus-visible/tile:opacity-100 data-current:opacity-100 hover:bg-black/75',
                 small ? 'top-[54px]' : 'top-[68px]'),
        more: cx(cover, 'self-start mt-6 justify-self-center rounded-md border border-[#C8C8C8] bg-[#F4F4F4] text-12 text-itunes-dim hover:bg-[#EAEAEA]'),
      }} />
  );
}
