// The dialogs, in Windows 7's look as iTunes for Windows had them (a light frame, the pane tabs of
// iTunes' Preferences, push buttons): Preferences (with the host player's sound), the Equalizer, Get
// Info (a song's summary and, playing, its lyrics), About, Keyboard Shortcuts, Open Stream (a Spotify
// link), a playlist's Delete, and the update notes. The frame and closing are src/ui's Dialog / DialogHost.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { EQ_PRESETS, eqPreset, FPS_OPTS, lineAt, lyricsShown, mss, QUALITY_OPTS, SCALE_OPTS, type Scale, type Settings, type UpdateCheck } from '../../../model';
import {
  appDownload, artOk, canSave, cx, Dialog, DialogHost, LINKS, LYRICS_SOURCE, openLink, restartApp, shareUrl, useAlbumMeta, useApp, useCloseDialog, usePosition, useShell,
  useShortcuts, type DialogClasses,
} from '../../../ui';
import { isUnplayed } from '../shared/content';
import { Icon, type IconName } from '../shared/icons';
import { copyLink, deletePlaylist, doomedPlaylist, infoTrack, useSave } from './spotify';

const DLG: DialogClasses = {
  title: 'flex-none flex items-center gap-6 h-28 pl-10 pr-5 bg-itunes-dlg border-b border-[#B9B9B9] text-12 text-black',
  titleText: 'flex-auto',
  close: 'w-28 h-18 p-0 rounded-xs border border-[#8B2D24] bg-[linear-gradient(180deg,#E9A99C,#CF5747_48%,#BB3A2B_52%,#C9574A)] text-white text-[10px] leading-none hover:[filter:brightness(1.08)]',
  buttons: 'flex-none flex justify-end gap-8 px-12 pt-8 pb-12',
  button: 'min-w-75 h-23 px-12 rounded-[3px] border border-[#707070] bg-itunes-push text-12 text-black hover:border-[#3C7FB1] hover:bg-[linear-gradient(180deg,#EAF6FD,#D9F0FC_48%,#BEE6FD_52%,#A7D9F5)] active:bg-[linear-gradient(180deg,#E5F4FC,#C4E5F6_48%,#98D1EF_52%,#6DB6DF)]',
};
const FRAME = 'w-430 max-w-[calc(100vw-20px)] max-h-[calc(100vh-20px)] flex flex-col overflow-hidden rounded-md border border-[#5E5E5E] bg-itunes-menu shadow-[0_8px_28px_rgba(0,0,0,.45)] font-itunes text-12 leading-[1.45] text-black';
const BODY = 'flex-auto overflow-auto px-16 py-12';
const ROW = 'flex items-center gap-8 my-6';

function Dlg(p: { id: string; title: string; label: string; buttons: [string, () => void, string?][]; children: ReactNode; className?: string }) {
  return <Dialog {...p} className={cx(FRAME, p.className)} classes={DLG} />;
}

export function Dialogs() {
  return (
    <DialogHost id="modal" className="fixed inset-0 z-80 grid place-items-center bg-black/25"
                dialogs={{ options: Preferences, eq: Equalizer, info: GetInfo, about: About, keys: Shortcuts, link: OpenStream, update: UpdateAvailable, checkUpdates: CheckUpdates,
                         deletePlaylist: DeletePlaylist }} />
  );
}

const Check = ({ id, label, checked, disabled, onChange, title }: { id: string; label: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void; title?: string }) => (
  <label className={cx(ROW, disabled && 'text-itunes-menu-dim')} htmlFor={id} title={title}>
    <input id={id} type="checkbox" className="m-0 w-13 h-13" checked={checked} disabled={disabled} onChange={(e) => onChange(e.currentTarget.checked)} />{label}
  </label>
);

type Pane = 'general' | 'playback' | 'advanced';
/** Audio Quality's names by QUALITY_OPTS (Spotify's words, the iPod's and the phone's) */
const QUALITY_NAMES = ['Normal', 'High', 'Very High'];
const PANES: [Pane, string, IconName][] = [['general', 'General', 'smart'], ['playback', 'Playback', 'play'], ['advanced', 'Advanced', 'genius']];

/** Edit > Preferences: iTunes' pane bar (General, Playback, Advanced) over the app's settings, and the
 *  host's own player's sound where iTunes had its kin (auth.hostPlayer: Crossfade Songs, Sound Check and
 *  the audio quality in Playback, the audio cache in Advanced; the equalizer is View > Show Equalizer);
 *  Cancel puts back what was there when it opened. */
function Preferences() {
  const sh = useShell(), close = useCloseDialog(), [pane, setPane] = useState<Pane>('general');
  const { S, spotify, source, has, host } = useApp((s) => ({ S: s.settings, spotify: s.auth.engine === 'spotify', source: s.lyrics.source ?? null, has: s.lyrics.status !== 'none',
                                                          host: !!s.auth.hostPlayer }));
  const set = (p: Partial<Settings>) => sh.store.getState().actions.setSettings(p);
  const [snapshot] = useState(() => structuredClone(sh.store.getState().settings));
  const cancel = () => { const a = sh.store.getState().actions; a.setSettings(snapshot); a.setVis(snapshot.vis, snapshot.preset); close(); };
  const [nw, nh] = sh.nativeSize();
  const scaleLabel = (v: Scale) => (v === 'original' ? 'Original ' + nw + 'x' + nh : v === 'auto' ? 'Auto' : Math.round(v * 100) + '%');
  return (
    <Dlg id="dlgOptions" title="Preferences" label="Preferences" buttons={[['OK', close, 'optOK'], ['Cancel', cancel, 'optCancel']]}>
      <div className="flex-none flex justify-center gap-2 pt-6 pb-4 bg-[linear-gradient(180deg,#FDFDFD,#EDEDED)] border-b border-[#C9C9C9]" role="tablist">
        {PANES.map(([p, label, icon]) => (
          <button key={p} type="button" role="tab" aria-selected={pane === p} data-tab={p} onClick={() => setPane(p)}
                  className={cx('flex flex-col items-center gap-2 w-72 py-4 rounded-md border text-11', pane === p ? 'bg-[#DADADA] border-[#B5B5B5]' : 'bg-transparent border-transparent hover:bg-[#E8E8E8]')}>
            <Icon name={icon} size={22} className="text-[#555]" />{label}
          </button>
        ))}
      </div>
      <div className={BODY}>
        {pane === 'general' && <>
          <Check id="lyrics" label={spotify ? 'Show lyrics (Spotify’s, LRCLIB’s when it has none)' : 'Show lyrics (lrclib.net)'} checked={S.lyrics}
                 title="Sends the playing track's title, artist, album and length to lrclib.net" onChange={(v) => sh.store.getState().actions.setLyricsEnabled(v)} />
          <p className="m-0 ml-21 text-11 text-itunes-dim" id="lyricsource">{S.lyrics ? (has && source ? 'This song: ' + LYRICS_SOURCE[source] + '.' : 'This song: none found.') : ''}</p>
          <Check id="karaoke" label="Highlight the lyrics word by word" checked={S.karaoke !== false} disabled={!S.lyrics} onChange={(v) => sh.store.getState().actions.setKaraoke(v)} />
          <Check id="advanced" label="Show advanced settings" checked={S.advanced} onChange={(v) => set({ advanced: v })} />
        </>}
        {pane === 'playback' && <>
          <Check id="animate" label="Animate the visualizer when no audio plays" checked={S.animate} onChange={(v) => set({ animate: v })} />
          <label className={ROW} htmlFor="fps">Visualizer frame rate
            <select id="fps" className="ml-auto border border-[#ABADB3] bg-white px-2" value={S.fps} onChange={(e) => set({ fps: +e.currentTarget.value })}>
              {FPS_OPTS.map((f) => <option key={f} value={f}>{f} fps</option>)}
            </select></label>
          <label className={ROW} htmlFor="scale">Visualizer size
            <select id="scale" className="ml-auto border border-[#ABADB3] bg-white px-2" value={String(S.scale)}
                    onChange={(e) => { const v = e.currentTarget.value; set({ scale: v === 'original' || v === 'auto' ? v : (+v as Scale) }); }}>
              {SCALE_OPTS.map((v) => <option key={v} value={String(v)}>{scaleLabel(v)}</option>)}
            </select></label>
          {host && <>
            <hr className="my-8 border-0 border-t border-[#D5D5D5]" />
            <Check id="crossfade" label="Crossfade Songs" checked={S.crossfade > 0} onChange={(v) => set({ crossfade: v ? 6 : 0 })} />
            <label className={cx(ROW, 'ml-21', !S.crossfade && 'text-itunes-menu-dim')} htmlFor="fade">
              <span className="text-11">1</span>
              <input id="fade" type="range" min={1} max={12} step={1} className="flex-auto" value={S.crossfade || 6} disabled={!S.crossfade}
                     onChange={(e) => set({ crossfade: +e.currentTarget.value })} />
              <span className="text-11">12</span>
              <span className="w-62 text-right">{(S.crossfade || 6) + ' seconds'}</span>
            </label>
            <Check id="normalise" label="Sound Check" checked={S.normalise} onChange={(v) => set({ normalise: v })} />
            <p className="m-0 ml-21 text-11 text-itunes-dim">Automatically adjusts song playback volume to the same level.</p>
            <label className={ROW} htmlFor="quality">Audio quality
              <select id="quality" className="ml-auto border border-[#ABADB3] bg-white px-2" value={S.quality}
                      onChange={(e) => set({ quality: +e.currentTarget.value as Settings['quality'] })}>
                {QUALITY_OPTS.map((q, i) => <option key={q} value={q}>{QUALITY_NAMES[i] + ' (' + q + ' kbps)'}</option>)}
              </select></label>
          </>}
        </>}
        {pane === 'advanced' && <>
          <Check id="intended" label="Intended fixes (visualizers)" checked={S.intended} onChange={(v) => set({ intended: v })} />
          <Check id="smooth" label="Smooth the spectrum" title="WMP feeds unsmoothed FFT data; on = 0.8 smoothing" checked={S.smoothing > 0} onChange={(v) => set({ smoothing: v ? 0.8 : 0 })} />
          <Check id="debug" label="Debug overlay" checked={S.debug} disabled={!S.advanced} onChange={(v) => set({ debug: v })} />
          {host && <Check id="cache" label="Keep played songs on this computer (audio cache)" checked={S.audioCache} onChange={(v) => set({ audioCache: v })} />}
        </>}
      </div>
    </Dlg>
  );
}

/** iTunes' Equalizer bands (the host player's ten, src/model/eq.ts) */
const BANDS = ['32', '64', '125', '250', '500', '1K', '2K', '4K', '8K', '16K'];

/** View > Show Equalizer: iTunes' Equalizer window over the host's own player. On, the presets (applied
 *  at once, so each is heard as it is chosen), and the ten bands' sliders showing the preset's curve
 *  (+12 dB to -12 dB): the host takes presets, not bands of one's own, so the sliders do not move. */
function Equalizer() {
  const sh = useShell(), close = useCloseDialog(), p = eqPreset(useApp((s) => s.settings.eq)), on = p.id !== 'off';
  const set = (eq: string) => sh.store.getState().actions.setSettings({ eq });
  return (
    <Dlg id="dlgEq" title="Equalizer" label="Equalizer" buttons={[['OK', close]]} className="w-400">
      <div className={BODY}>
        <div className="flex items-center gap-8 mb-8">
          <Check id="eqon" label="On" checked={on} onChange={(v) => set(v ? 'flat' : 'off')} />
          <select id="eqpreset" aria-label="Preset" className="ml-auto border border-[#ABADB3] bg-white px-2 disabled:text-itunes-menu-dim" value={on ? p.id : 'flat'} disabled={!on}
                  onChange={(e) => set(e.currentTarget.value)}>
            {EQ_PRESETS.filter((x) => x.id !== 'off').map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </div>
        <div className={cx('flex h-140 pt-6 pb-2 px-6 rounded-sm border border-[#C9C9C9] bg-[linear-gradient(180deg,#FAFAFA,#E9E9E9)]', !on && 'opacity-55')} id="eqbands">
          <div className="flex flex-col justify-between pr-6 pb-17 text-10 text-itunes-dim text-right" aria-hidden="true"><span>+12 dB</span><span>0 dB</span><span>-12 dB</span></div>
          {BANDS.map((b, i) => {
            const g = p.gains[i] ?? 0;
            return (
              <div key={b} className="flex-1 flex flex-col items-center" role="meter" aria-label={b + ' Hz'} aria-valuemin={-12} aria-valuemax={12} aria-valuenow={g}>
                <div className="relative flex-auto w-4 rounded-full bg-[#B9B9B9] shadow-[inset_0_1px_1px_rgba(0,0,0,.35)]">
                  <span className="absolute left-1/2 w-15 h-7 -ml-7.5 -mt-3.5 rounded-[2px] border border-[#6E6E6E] bg-itunes-seg shadow-[0_1px_1px_rgba(0,0,0,.25)]"
                        style={{ top: ((12 - g) / 24) * 100 + '%' }} />
                </div>
                <span className="mt-5 text-10 leading-[12px]">{b}</span>
              </div>
            );
          })}
        </div>
      </div>
    </Dlg>
  );
}

type InfoTab = 'summary' | 'lyrics';
/** File > Get Info, a song's right-click Get Info: iTunes' Get Info as Spotify knows the song. Summary:
 *  the cover, the names, the length, release, track and disc, Spotify's play count, the album's label
 *  and copyright, ♥ (Like), Played (an episode: Mark as Played / Unplayed) and its link; Lyrics (the
 *  playing song only: lyrics are fetched for it): every line, the one sung now lit and kept in view, as
 *  Spotify's lyrics view. */
function GetInfo() {
  const close = useCloseDialog(), [t] = useState(infoTrack), [tab, setTab] = useState<InfoTab>('summary');
  const save = useSave(t && canSave(t.uri) ? t.uri : null), album = useAlbumMeta(t?.albumUri), sh = useShell();
  const playing = useApp((s) => !!t && s.playback.track?.uri === t.uri), marks = useApp((s) => s.played);
  const mark = useApp((s) => !!t?.uri.startsWith('spotify:episode:') && !!s.commands.markPlayed);
  if (!t) return null;
  const art = artOk(t.image ?? t.art), link = shareUrl(t.uri);
  const rows = ([['Time', t.duration ? mss(t.duration) : ''], ['Release Date', t.releaseDate ?? album?.releaseDate ?? ''],
    ['Track', t.trackNumber ? String(t.trackNumber) : ''], ['Disc', t.discNumber ? String(t.discNumber) : ''],
    ['Plays', t.playcount ? t.playcount.toLocaleString('en-US') : ''], ['Label', album?.label ?? ''], ['Copyright', album?.copyright ?? '']] as const).filter(([, v]) => v);
  return (
    <Dlg id="dlgInfo" title={t.title} label="Get Info" buttons={[['OK', close]]} className="w-460">
      <div className="flex-none flex justify-center pt-8 pb-6 bg-[linear-gradient(180deg,#FDFDFD,#EDEDED)] border-b border-[#C9C9C9]" role="tablist">
        {(['summary', 'lyrics'] as const).map((x, i) => (
          <button key={x} type="button" role="tab" aria-selected={tab === x} data-tab={x} onClick={() => setTab(x)}
                  className={cx('px-12 h-20 border border-[#9A9A9A] text-11', i ? 'rounded-r-sm border-l-0' : 'rounded-l-sm',
                                tab === x ? 'bg-itunes-seg-on text-white' : 'bg-itunes-seg text-black')}>{x === 'summary' ? 'Summary' : 'Lyrics'}</button>
        ))}
      </div>
      {tab === 'summary' ? (
        <div className={BODY} id="infosummary">
          <div className="flex gap-14 items-start mb-10">
            {art ? <img src={art} alt="" className="flex-none w-100 h-100 object-cover shadow-[0_2px_5px_rgba(0,0,0,.38)]" />
                 : <span className="flex-none grid place-items-center w-100 h-100 bg-itunes-side text-itunes-side-icon"><Icon name="music" size={40} /></span>}
            <div className="min-w-0">
              <p className="m-0 text-14 font-bold break-words">{t.title}</p>
              <p className="m-0">{t.artist}</p>
              {t.album && <p className="m-0 text-itunes-dim">{t.album}</p>}
              {t.explicit && <span className="inline-block mt-4 px-4 rounded-[2px] bg-[#8A8A8A] text-white text-[9px] leading-[13px] font-bold">EXPLICIT</span>}
            </div>
          </div>
          <table className="w-full border-collapse text-12"><tbody>
            {rows.map(([k, v]) => <tr key={k}><td className="py-1 pr-10 w-100 text-right text-itunes-dim align-top">{k}:</td><td className="py-1 break-words">{v}</td></tr>)}
          </tbody></table>
          {save.can && <Check id="infolike" label="♥ Liked" checked={!!save.saved} onChange={save.toggle} />}
          {mark && <Check id="infoplayed" label="Played" checked={!isUnplayed(t, marks)} onChange={(v) => void sh.store.getState().commands.markPlayed?.(t.uri, v)} />}
          {link && (
            <div className={ROW}>
              <span className="flex-auto min-w-0 truncate text-11 text-itunes-dim" title={link}>{link}</span>
              <button type="button" className={DLG.button} onClick={() => copyLink(sh, t.uri)}>Copy Link</button>
            </div>
          )}
        </div>
      ) : <LyricsTab playing={playing} />}
    </Dlg>
  );
}

/** Get Info's Lyrics: the synced lines, the one sung now lit and scrolled to the middle, or the plain text. */
function LyricsTab({ playing }: { playing: boolean }) {
  const l = useApp((s) => ({ shown: playing ? lyricsShown(s) : null, on: s.settings.lyrics, lines: s.lyrics.lines, plain: s.lyrics.plain }));
  const cur = usePosition((ms) => (l.shown === 'synced' && l.lines ? lineAt(l.lines, ms) : -1)), box = useRef<HTMLDivElement>(null);
  useEffect(() => { box.current?.querySelector('[data-on]')?.scrollIntoView?.({ block: 'center' }); }, [cur]);
  const note = !playing ? 'Lyrics show here for the song that is playing.' : !l.on ? 'Lyrics are off (View > Lyrics).' : !l.shown ? 'No lyrics for this song.' : '';
  return (
    <div ref={box} id="infolyrics" className="h-280 overflow-auto px-16 py-12 bg-white text-13 leading-[1.6]">
      {note ? <p className="m-0 text-itunes-dim">{note}</p>
        : l.shown === 'synced' && l.lines ? l.lines.map((x, i) => (
          <p key={i} data-on={i === cur || undefined} className={cx('m-0', i === cur ? 'font-bold text-[#1F5FBF]' : i < cur ? 'text-[#8C8C8C]' : 'text-black')}>{x.text || '♪'}</p>))
        : <p className="m-0 whitespace-pre-wrap">{l.plain}</p>}
    </div>
  );
}

function About() {
  const close = useCloseDialog(), spotify = useApp((s) => s.auth.engine === 'spotify'), web = useApp((s) => s.auth.engine !== 'spotify' && s.auth.mode === 'web');
  const a = (href: string, text: string) => <a className="text-[#0066CC] underline" href={href} target="_blank" rel="noopener">{text}</a>;
  return (
    <Dlg id="dlgAbout" title="About WMP Spotify" label="About" buttons={[['OK', close]]}>
      <div className={cx(BODY, 'flex gap-14 items-start')}>
        <span className="flex-none grid place-items-center w-64 h-64 rounded-full bg-[radial-gradient(circle_at_50%_35%,#9FD3FF,#2E7FD8_60%,#1B4F9C)] text-white shadow-[0_2px_6px_rgba(0,0,0,.35)]"><Icon name="note" size={34} /></span>
        <div>
          <p className="m-0 mb-6 text-17 font-bold" id="aboutname">{spotify ? 'WMP Spotify' : 'WMP Legacy Visualizers'}</p>
          <p className="m-0 mb-6">The iTunes 10 skin. Alchemy, Bars and Waves and Battery ported 1:1 from the decompiled Windows Media Player visualizers{spotify ? ', over Spotify.' : '.'}</p>
          {web && <p className="m-0 mb-6" id="aboutlinks">Windows apps: {a(LINKS.spotify, 'WMP Spotify')} · {a(LINKS.screensaver, 'Alchemy Screensaver')}<br />Source code on {a(LINKS.repo, 'GitHub')}</p>}
          <p className="m-0 text-11 text-itunes-dim">An independent project. Not affiliated with Apple, Microsoft{spotify ? ' or Spotify' : ''}. iTunes is a trademark of Apple Inc.</p>
        </div>
      </div>
    </Dlg>
  );
}

function Shortcuts() {
  const keys = useShortcuts(), close = useCloseDialog();
  return (
    <Dlg id="dlgKeys" title="Keyboard Shortcuts" label="Keyboard Shortcuts" buttons={[['OK', close]]}>
      <div className={BODY}>
        <table className="w-full border-collapse text-12" id="keystable"><tbody>
          {keys.map((k) => (
            <tr key={k.keys} className="even:bg-itunes-stripe">
              <td className="py-2 px-6 w-150 font-semibold whitespace-nowrap">{k.keys}</td>
              <td className="py-2 px-6">{k.label}</td>
            </tr>
          ))}
        </tbody></table>
      </div>
    </Dlg>
  );
}

/** Advanced > Open Stream, as a Spotify link (open.spotify.com/… or spotify:album:…). */
function OpenStream() {
  const sh = useShell(), close = useCloseDialog(), [q, setQ] = useState(''), [err, setErr] = useState('');
  const ok = () => { if (!sh.store.getState().commands.openLink(q)) { setErr('That is not a Spotify track, album, playlist or artist link.'); return; } close(); };
  return (
    <Dlg id="dlgLink" title="Open Stream" label="Open Spotify Link" buttons={[['OK', ok], ['Cancel', close]]}>
      <div className={BODY}>
        <label className="block mb-6" htmlFor="linkq">Spotify link (open.spotify.com/… or spotify:album:…):</label>
        <input id="linkq" type="text" className="w-full h-23 px-4 border border-[#ABADB3] bg-white text-black" value={q}
               onChange={(e) => setQ(e.currentTarget.value)} onKeyDown={(e) => { if (e.key === 'Enter') ok(); }} />
        <p className="m-0 mt-6 text-11 text-[#B0302A] min-h-16" id="linkerr">{err}</p>
      </div>
    </Dlg>
  );
}

/** A playlist's Delete, asked as iTunes asked it (the right-click's Delete in the source list). */
function DeletePlaylist() {
  const sh = useShell(), close = useCloseDialog(), [p] = useState(doomedPlaylist);
  if (!p) return null;
  return (
    <Dlg id="dlgDelete" title="iTunes" label="Delete Playlist" buttons={[['Delete', () => { close(); void deletePlaylist(sh, p.uri); }, 'delOK'], ['Cancel', close, 'delCancel']]}>
      <div className={cx(BODY, 'flex gap-14 items-start')}>
        <span className="flex-none grid place-items-center w-32 h-32 rounded-full bg-[#F2C94C] text-black text-20 font-bold shadow-[0_1px_2px_rgba(0,0,0,.3)]" aria-hidden="true">!</span>
        <div>
          <p className="m-0 mb-6 font-bold">Are you sure you want to delete the playlist “{p.name}”?</p>
          <p className="m-0 text-itunes-dim">It is deleted from your Spotify library.</p>
        </div>
      </div>
    </Dlg>
  );
}

/** A newer app is out (the host found one): the download, or later (Help has it too). */
function UpdateAvailable() {
  const close = useCloseDialog(), spotify = useApp((s) => s.auth.engine === 'spotify');
  return (
    <Dlg id="dlgUpdate" title="Update Available" label="Player Update" buttons={[['Download', () => { openLink(appDownload(spotify)); close(); }], ['Later', close]]}>
      <div className={BODY}><p className="m-0">A newer version of {spotify ? 'WMP Spotify' : 'the Alchemy screensaver'} is available. It needs the new download; Help has the link too.</p></div>
    </Dlg>
  );
}

/** Help > Check for Updates: asks now, then says what it found (a newer app: the download note). */
function CheckUpdates() {
  const sh = useShell(), close = useCloseDialog(), [r, setR] = useState<UpdateCheck | null>(null);
  const { spotify, web } = useApp((s) => ({ spotify: s.auth.engine === 'spotify', web: s.auth.mode === 'web' }));
  useEffect(() => {
    let live = true;
    void sh.store.getState().commands.checkForUpdates().then((x) => {
      if (!live) return;
      if (x.state !== 'app') { setR(x); return; }
      const a = sh.store.getState().actions;
      a.setAuth({ hostUpdate: true });
      a.setUi({ dialog: 'update' });
    });
    return () => { live = false; };
  }, [sh]);
  const name = spotify ? 'WMP Spotify' : web ? 'the player' : 'the Alchemy screensaver';
  const buttons: [string, () => void][] = r?.state === 'ready' ? [[web ? 'Reload' : 'Restart Now', restartApp], ['Later', close]] : [['OK', close]];
  return (
    <Dlg id="dlgCheck" title="Check for Updates" label="Check for Updates" buttons={buttons}>
      <div className={BODY} id="checkmsg">
        {!r && <p className="m-0">Checking for updates…</p>}
        {r?.state === 'latest' && <p className="m-0">You have the latest version of {name}.</p>}
        {r?.state === 'error' && <p className="m-0">Could not check for updates. {r.message}</p>}
        {r?.state === 'ready' && <p className="m-0">{web ? 'A newer version of the player is available. Reload the page to use it.' : 'An update has been downloaded. Restart ' + name + ' to use it.'}</p>}
      </div>
    </Dlg>
  );
}
