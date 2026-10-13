// The seek bar (the transport panel's top lip) and the transport: play/stop, prev/next, mute,
// volume, the status line, the clock, the shuffle and lyrics discs and the resize grip.
import {
  Clock, cx, Dropdown, SeekBar, TransportButton, useDevices, usePlayback, useWindowControls, VolumeSlider, type DeviceKind,
} from '../../../ui';
import { MENU } from './Chrome';
import s from '../wmp9.module.css';

export function WmpSeekBar() {
  return (
    <SeekBar id="seekrow" className={cx(s.seekrow, 'col-start-2 row-start-2 flex items-center gap-6 h-14 px-8 bare:hidden')}
             pillClassName="flex-none w-29 h-11 rounded-lg grid place-items-center border border-spill-edge bg-spill shadow-[inset_0_1px_0_rgba(255,255,255,.9)] spotify:cursor-pointer"
             track={{ id: 'seektrack', thumbId: 'seekthumb', inset: 10.5,
                      className: "flex-auto relative h-13 min-w-20 not-data-disabled:cursor-pointer before:content-[''] before:absolute before:left-0 before:right-0 before:top-4 before:h-4 before:rounded-xs before:bg-[linear-gradient(180deg,#BEC6D8_0_2px,#E8ECF4_2px)]",
                      thumbClassName: cx(s.seekthumb, 'absolute top-0 left-[calc((100%-21px)*var(--seek,0))] w-21 h-13 rounded-xs border border-thumb-edge shadow-[inset_0_1px_0_rgba(255,255,255,.55)]') }}
             rewind={<svg className="fill-spill-ink" width="13" height="6" viewBox="0 0 13 6"><polygon points="6,0.4 6,5.6 2.6,3"/><polygon points="10.4,0.4 10.4,5.6 7,3"/></svg>}
             forward={<svg className="fill-spill-ink" width="13" height="6" viewBox="0 0 13 6"><polygon points="2.6,0.4 2.6,5.6 6,3"/><polygon points="7,0.4 7,5.6 10.4,3"/></svg>} />
  );
}

/** the silver discs' rim, highlight and drop. A disc with nothing to act on keeps its silver but
 *  draws its glyph pale grey-blue with a white lower edge, as WMP 9 does (its mute glyph, enabled,
 *  is near-black beside the pale disabled ones in the reference capture) */
const DISC = cx(s.disc, 'p-0 rounded-full border border-disc-edge leading-[0] shadow-[inset_0_1px_0_rgba(255,255,255,.95),inset_0_-1px_2px_rgba(90,110,140,.3),0_0_0_1px_rgba(255,255,255,.6),0_1px_2px_rgba(40,56,90,.4)] not-data-disabled:hover:[filter:brightness(1.06)] data-disabled:cursor-default data-disabled:[&_svg]:fill-glyph-off data-disabled:[&_svg]:[filter:drop-shadow(0_1px_0_#FFFFFF)]');
const TBTN = cx(DISC, 'w-22 h-22');
/** the small shuffle / lyrics discs: lit blue while on */
const SBTN = (on: boolean) => cx(s.sbtn, on && s.lit, 'w-20 h-20 flex-none rounded-full grid place-items-center border border-sbtn-edge data-on:border-lit-edge shadow-[inset_0_0_0_1px_rgba(255,255,255,.7)] relative z-1');
/** every control sits over the lozenge drawing */
const UP = 'relative z-1';

/** menu icons for the device kinds: a monitor, a phone, a TV, a speaker */
const DEV_ICON: Record<DeviceKind, string> = {
  pc: 'inline-block align-[-2px] w-14 h-11 mr-6 border-2 border-b-3 border-slate rounded-xs bg-luna-lo',
  phone: 'inline-block align-[-2px] w-8 h-12 mx-3 mr-9 border-2 border-slate rounded-xs bg-luna-lo',
  tv: 'inline-block align-[-2px] w-14 h-11 mr-6 border-2 border-slate rounded-xs bg-disc-ink',
  speaker: 'inline-block align-[-2px] w-10 h-12 mx-2 mr-8 rounded-xs bg-[radial-gradient(circle_at_50%_62%,var(--color-luna-lo)_2px,var(--color-slate)_3px)]',
};

/** Play on Device (Spotify): a disc lit while another device plays; its menu moves playback. */
function DeviceDisc() {
  const d = useDevices((k) => DEV_ICON[k]), { spotify } = usePlayback();
  if (!spotify) return null;
  return (
    <Dropdown owner="devices" items={d.items} classes={MENU}>
      <button type="button" className={cx(SBTN(d.elsewhere), 'p-0')} id="bdevice" title={d.title} data-on={d.elsewhere || undefined} data-menuzone="">
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <rect x=".7" y="1.2" width="7.2" height="5.4" rx=".6" fill="none" stroke="#22315B" strokeWidth="1.2"/>
          <path d="M2.5 9h3.6M4.3 6.8V9" stroke="#22315B" strokeWidth="1.2" fill="none"/>
          <rect x="8.6" y="3.4" width="2.9" height="7.4" rx=".6" fill="#22315B"/>
          <circle cx="10.05" cy="8.6" r=".8" fill="#FFFFFF"/>
        </svg>
      </button>
    </Dropdown>
  );
}

export function Transport() {
  const { status } = usePlayback(), w = useWindowControls();
  return (
    <div className={cx(s.transport, 'col-start-2 row-start-3 relative h-47 flex items-center gap-5 pt-0 pl-8 pr-20 pb-1 text-tr-ink bare:hidden')} id="transport">
      {/* the raised lozenge: a large-radius curved top-left, a highlight sweep, an S-curve right end —
          the well holds the volume slider (its S-curve ends past the knob at full volume) */}
      <svg className="absolute left-0 top-0 z-0 pointer-events-none" id="trbg" width="340" height="47" viewBox="0 0 340 47" aria-hidden="true">
        <defs>
          <linearGradient id="gloz" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#FFFFFF" stopOpacity="0"/>
            <stop offset=".24" stopColor="#FFFFFF" stopOpacity="0"/>
            <stop offset=".40" stopColor="#FFFFFF" stopOpacity=".5"/>
            <stop offset=".58" stopColor="#F2F6FD" stopOpacity=".92"/>
            <stop offset=".63" stopColor="#FCFDFF"/><stop offset=".72" stopColor="#E4EFFA"/>
            <stop offset=".86" stopColor="#C5DDF7"/><stop offset="1" stopColor="#ABB7D6"/>
          </linearGradient>
          <radialGradient id="gsweep" cx=".18" cy="1" r=".95">
            <stop offset="0" stopColor="#FFFFFF" stopOpacity=".95"/>
            <stop offset=".45" stopColor="#FFFFFF" stopOpacity=".45"/>
            <stop offset="1" stopColor="#FFFFFF" stopOpacity="0"/>
          </radialGradient>
        </defs>
        <path id="lozpath" d="M0 0 H312 C304 12 290 22 280 32 C273 40 268 44 259 47 H16 C6 47 0 41 0 32 Z" fill="url(#gloz)"/>
        <path d="M312 0 C304 12 290 22 280 32 C273 40 268 44 259 47" fill="none" stroke="#FFFFFF" strokeWidth="1.2" opacity=".85"/>
        <path d="M0 0 H312 C304 12 290 22 280 32 C273 40 268 44 259 47 H16 C6 47 0 41 0 32 Z" fill="url(#gsweep)"/>
        <path d="M4 44 C40 36 170 34 254 30" fill="none" stroke="#FFFFFF" strokeWidth="1.6" opacity=".55"/>
      </svg>

      <div className={cx(UP, 'flex-none flex items-center gap-4')} id="tbtns">
        <TransportButton action="play" id="bplay" className={cx(DISC, 'relative w-30 h-30')}>
          {/* dark, as the other working buttons' glyphs (it was always the pale, disabled grey-blue) */}
          {(playing) => playing ? (
            <svg className="mx-auto fill-disc-glyph" id="icpause" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <rect x="4.5" y="3.2" width="2.8" height="9.6" rx=".4"/>
              <rect x="8.9" y="3.2" width="2.8" height="9.6" rx=".4"/>
            </svg>
          ) : (
            <svg className="mx-auto fill-disc-glyph" id="icplay" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <polygon points="4.9,3 12.6,8 4.9,13" strokeLinejoin="round"/>
            </svg>
          )}
        </TransportButton>
        <TransportButton action="stop" id="bstop" className={TBTN}>
          <svg className="mx-auto fill-stop-glyph" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><rect x="2" y="2" width="6" height="6" rx="1"/></svg>
        </TransportButton>
        <span className="w-14"></span>
        {/* prev + next share one rounded well, the way the skin groups them */}
        <span className="flex items-center gap-4 py-2 px-3 rounded-[14px] bg-tgroup shadow-[inset_0_1px_0_rgba(255,255,255,.8),0_1px_1px_rgba(60,76,115,.16)]" id="tgroup">
          <TransportButton action="prev" id="bprev" className={TBTN}>
            <svg className="mx-auto fill-disc-glyph" width="12" height="11" viewBox="0 0 12 11" aria-hidden="true"><rect x="2" y="2" width="1.8" height="7"/><polygon points="10,2 10,9 4.6,5.5"/></svg>
          </TransportButton>
          <TransportButton action="next" id="bnext" className={TBTN}>
            <svg className="mx-auto fill-disc-glyph" width="12" height="11" viewBox="0 0 12 11" aria-hidden="true"><rect x="8.2" y="2" width="1.8" height="7"/><polygon points="2,2 2,9 7.4,5.5"/></svg>
          </TransportButton>
        </span>
        <span className="w-14"></span>
        <TransportButton action="mute" id="bmute" className={(muted) => cx(TBTN, muted && s.muted)}>
          {(muted) => (
            <svg className="mx-auto fill-disc-glyph" width="15" height="12" viewBox="0 0 15 12" aria-hidden="true">
              <polygon points="1,4 4,4 7,1 7,11 4,8 1,8"/>
              {muted
                ? <path id="icslash" d="M9 3.4 L13.6 8.6 M13.6 3.4 L9 8.6" stroke="#22315B" strokeWidth="1.4"/>
                : <path id="icwave" d="M9 3.4a3.6 3.6 0 0 1 0 5.2 M11.2 2a5.6 5.6 0 0 1 0 8" fill="none" stroke="#22315B" strokeWidth="1.2"/>}
            </svg>
          )}
        </TransportButton>
      </div>

      {/* the volume slider: a hairline groove, a wedge to its right, a green pill thumb */}
      <span className={cx(UP, "flex-none w-76 h-22 max-440:w-52 before:content-[''] before:absolute before:left-[46%] before:right-0 before:top-3 before:h-6 before:z-1 before:bg-[linear-gradient(180deg,#FFFFFF_0_2px,#DDE3EF_2px)] before:[clip-path:polygon(0_100%,100%_0,100%_100%)]")} id="volwrap">
        <VolumeSlider className={s.vol} id="vol" />
      </span>

      <div className={cx(UP, 'flex-[1_1_100px] min-w-0 ml-40 text-status-ink truncate max-440:hidden')} id="status">{status}</div>
      <Clock className={cx(UP, 'flex-none text-tr-ink font-bold tracking-[.06em] min-w-40 text-right spotify:cursor-pointer')} id="time" />
      <TransportButton action="shuffle" id="bshuffle" className={(on) => cx(SBTN(on), 'spotify:cursor-pointer')}>
        <svg className="fill-disc-ink" width="12" height="12" viewBox="0 0 12 12">
          <path d="M1 3 h2.5 L8 9 h2.5 M1 9 h2.5 L5.2 6.6 M7 4.4 L8 3 h2.5" fill="none" stroke="#22315B" strokeWidth="1.2"/>
          <polygon points="9.4,1.4 11.6,3 9.4,4.6"/><polygon points="9.4,7.4 11.6,9 9.4,10.6"/>
        </svg>
      </TransportButton>
      {/* the repeat disc (the EQ disc's place): Off -> Playlist -> Track, lit for both, a "1" on Track */}
      <TransportButton action="repeat" id="brepeat" className={(on) => cx(SBTN(on), 'group/rep spotify:cursor-pointer')}>
        <svg className="fill-disc-ink" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2 6.5V5a2 2 0 0 1 2-2h5.5 M10 5.5V7a2 2 0 0 1-2 2H2.5" fill="none" stroke="#22315B" strokeWidth="1.2"/>
          <polygon points="8.6,1.2 10.8,3 8.6,4.8"/><polygon points="3.4,7.2 1.2,9 3.4,10.8"/>
        </svg>
        <span className="absolute -right-2 -bottom-2 hidden min-w-9 h-9 px-1 rounded-full bg-lit-edge text-white text-[7px] leading-[9px] font-bold text-center group-data-[repeat=track]/rep:block" aria-hidden="true">1</span>
      </TransportButton>
      <DeviceDisc />
      {/* Decorative in a browser; under the host the window's resize corner (its thick frame is
          outside the client area, where nothing in the page can be clicked). */}
      {/* In the bar's bottom-right corner, as the original skin placed it (absolute, not in the row:
          the shared 'relative' made it the row's last item, pressed against the last disc) */}
      <span className={cx('absolute z-2 right-5 bottom-3 leading-[0]', w.host ? 'pointer-events-auto cursor-nwse-resize' : 'pointer-events-none')}
            id="grip" aria-hidden="true" onMouseDown={w.onGripMouseDown}>
        <svg className="fill-grip-ink" width="12" height="12" viewBox="0 0 12 12">
          <g fill="#F2F5FC"><rect x="8" y="2" width="2" height="2"/><rect x="8" y="6" width="2" height="2"/><rect x="4" y="6" width="2" height="2"/><rect x="8" y="10" width="2" height="2"/><rect x="4" y="10" width="2" height="2"/><rect x="0" y="10" width="2" height="2"/></g>
          <g fill="#5E6B8C"><rect x="7" y="1" width="2" height="2"/><rect x="7" y="5" width="2" height="2"/><rect x="3" y="5" width="2" height="2"/><rect x="7" y="9" width="2" height="2"/><rect x="3" y="9" width="2" height="2"/><rect x="-1" y="9" width="2" height="2"/></g>
        </svg>
      </span>
    </div>
  );
}
