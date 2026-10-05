// The toolbar's left end: the three round glossy buttons (Previous ⌀31, Play ⌀37, Next ⌀31; no Stop,
// as iTunes had none; Play shows ❚❚ while playing) and the volume slider between its two speakers.
// What they do is src/ui's TransportButton and VolumeSlider; this is the look (REFERENCE §Transport).
import { cx, TransportButton, VolumeSlider } from '../../../ui';
import { Icon } from './icons';
import s from './itunes.module.css';

const ROUND = 'flex-none grid place-items-center p-0 rounded-full border border-itunes-rim-dark bg-itunes-btn text-itunes-glyph shadow-[inset_0_1px_0_#FFFFFF,0_1px_0_rgba(255,255,255,.5)] active:bg-itunes-btn-down disabled:text-itunes-glyph/45 disabled:active:bg-itunes-btn';

/** Previous, Play / Pause, Next. `compact`: the phone's smaller set. */
export function TransportCluster({ className, compact }: { className?: string; compact?: boolean }) {
  const side = compact ? 'w-26 h-26' : 'w-31 h-31', mid = compact ? 'w-31 h-31' : 'w-37 h-37';
  return (
    <div className={cx('flex items-center gap-3', className)} id="transport">
      <TransportButton action="prev" id="bprev" className={cx(ROUND, side)}><Icon name="prev" size={compact ? 11 : 13} /></TransportButton>
      <TransportButton action="play" id="bplay" className={cx(ROUND, mid)}>
        {(on) => <Icon name={on ? 'pause' : 'play'} size={compact ? 13 : 16} className={on ? '' : 'ml-2'} />}
      </TransportButton>
      <TransportButton action="next" id="bnext" className={cx(ROUND, side)}><Icon name="next" size={compact ? 11 : 13} /></TransportButton>
    </div>
  );
}

/** The volume: the quiet speaker, the slider (#vol), the loud speaker. A click on a speaker is
 *  silence / full, as in iTunes. */
export function Volume({ className, sliderClassName }: { className?: string; sliderClassName?: string }) {
  return (
    <div className={cx('flex items-center gap-4 text-itunes-glyph', className)}>
      <TransportButton action="mute" className="flex-none p-0 border-0 bg-transparent text-inherit data-on:text-itunes-lit"><Icon name="vol-low" size={12} /></TransportButton>
      <VolumeSlider id="vol" className={cx(s.vol, 'flex-auto min-w-0 w-98', sliderClassName)} />
      <Icon name="vol-high" size={14} className="flex-none" />
    </div>
  );
}
