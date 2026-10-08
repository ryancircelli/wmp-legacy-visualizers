// The XP dialogs' bodies: Options, About, Keyboard Shortcuts, Open Spotify Link. The frame, the
// backdrop and closing are src/ui's Dialog / DialogHost.
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import emblemSpotify from '../assets/emblem-spotify.svg';
import emblemWmp from '../assets/emblem-wmp.svg';
import { FPS_OPTS, fpsLabel, fpsOf, SCALE_OPTS, type Scale, type Settings, type UpdateCheck } from '../../../model';
import { appDownload, cx, Dialog, DialogHost, LINKS, LYRICS_SOURCE, openLink, restartApp, useApp, useCloseDialog, useShell, useShortcuts, type DialogClasses } from '../../../ui';

const DLG: DialogClasses = {
  title: 'flex-none flex items-center gap-6 h-24 pr-3 pl-6 bg-dlg-title text-white font-bold [text-shadow:0_1px_1px_rgba(0,0,0,.45)]',
  titleText: 'flex-auto',
  close: 'w-19 h-17 p-0 border border-xp-navy rounded-xs bg-dlg-close text-white [font:bold_10px_Tahoma,sans-serif]',
  buttons: 'flex-none flex justify-end gap-6 pt-8 px-12 pb-10',
  button: 'min-w-75 h-23 py-0 px-10 bg-xp-face text-black border border-xp-edge rounded-sm shadow-[inset_1px_1px_0_#FFFFFF,inset_-1px_-1px_0_var(--color-xp-shade)] hover:bg-xp-face-hot hover:border-xp-navy active:shadow-[inset_1px_1px_0_var(--color-xp-shade),inset_-1px_-1px_0_#FFFFFF]',
};
const FRAME = 'w-372 max-w-[calc(100vw-20px)] max-h-[calc(100vh-20px)] flex flex-col bg-xp-face text-black border border-xp-navy shadow-dialog font-xp text-11 leading-[1.5]';
const BODY = 'flex-auto overflow-auto py-10 px-12 border-t border-xp-edge -mt-1';

function Dlg(p: { id: string; title: string; label: string; className?: string; style?: CSSProperties;
                  buttons: [string, () => void, string?][]; children: ReactNode }) {
  return <Dialog {...p} className={cx(FRAME, p.className)} classes={DLG} />;
}

export function Modal() {
  return (
    <DialogHost id="modal" className="fixed inset-0 z-80 grid place-items-center bg-[rgba(0,0,0,.34)]"
                dialogs={{ options: Options, about: About, keys: Shortcuts, link: OpenLink, update: UpdateAvailable, checkUpdates: CheckUpdates }} />
  );
}

const hex6 = (n: number) => '#' + ('000000' + ((n | 0) & 0xffffff).toString(16)).slice(-6);

const GRP = 'border border-xp-edge rounded-xs pt-8 px-10 pb-10 m-0 mb-10';
const LEGEND = 'py-0 px-4 text-xp-navy font-bold';
const ROW = 'flex items-center gap-8 my-5 mx-0';
const LABEL = 'flex-auto';
const CHECK = 'order-first flex-none w-13 h-13 m-0 mr-3';
const FIELD = 'bg-white border border-xp-field py-1 px-2';
const HINT = 'text-xp-hint m-0 mb-8';
const TAB = 'relative top-1 pt-3 px-10 pb-4 bg-xp-tab text-black border border-xp-edge border-b-0 rounded-t-sm data-on:top-0 data-on:pb-5 data-on:bg-xp-face data-on:[border-color:#FFFFFF_var(--color-xp-edge)_var(--color-xp-face)_#FFFFFF] data-on:font-bold';

export function Options() {
  const sh = useShell(), close = useCloseDialog();
  const { S, native, spotify, source, has } = useApp((st) => ({ S: st.settings, native: st.auth.mode !== 'web', spotify: st.auth.engine === 'spotify',
                                                               source: st.lyrics.source ?? null, has: st.lyrics.status !== 'none' }));
  const set = (p: Partial<Settings>) => sh.store.getState().actions.setSettings(p);
  const [snapshot] = useState(() => structuredClone(sh.store.getState().settings));
  const [tab, setTab] = useState<'player' | 'adv'>('player');
  const t = S.advanced ? tab : 'player';
  const [nw, nh] = sh.nativeSize();
  const scaleLabel = (v: Scale) => v === 'original' ? 'Original ' + nw + 'x' + nh : v === 'auto' ? 'Auto' : Math.round(v * 100) + '%';
  const cancel = () => {
    const a = sh.store.getState().actions;
    a.setSettings(snapshot);
    a.setVis(snapshot.vis, snapshot.preset);
    close();
  };
  const tabBtn = (name: 'player' | 'adv', label: string, id?: string) => (
    <button type="button" className={TAB} data-on={t === name || undefined} data-tab={name} id={id} role="tab"
            aria-selected={t === name} onClick={() => setTab(name)}>{label}</button>
  );
  return (
    <Dlg id="dlgOptions" title="Options" label="Options"
         buttons={[['OK', close, 'optOK'], ['Cancel', cancel, 'optCancel'], ['Apply', () => {}, 'optApply']]}>
      <div className="flex-none flex gap-2 pt-6 px-8 pb-0 bg-xp-face border-b border-white" role="tablist">
        {tabBtn('player', 'Player')}
        {S.advanced && tabBtn('adv', 'Advanced', 'tabAdv')}
      </div>
      <div className={BODY}>
        <section data-pane="player" hidden={t !== 'player'}>
          <fieldset className={GRP}><legend className={LEGEND}>Player settings</legend>
            {native
              ? <p className={HINT} id="hint-audio-native">Sound comes from your system audio automatically, and whatever is playing shows up as Now Playing.</p>
              : <p className={HINT} id="hint-audio-web">Sound comes from a screen share only: press Play, pick a tab or your screen, and tick <b>Share audio</b>.</p>}
            <p className={HINT}>Pick a visualization from the list in the Now Playing pane, or from View &rsaquo; Visualizations.</p>
            <div className={ROW}><label className={LABEL} htmlFor="bg">Background colour</label>
              <input className="w-46 h-19 p-0 bg-white border border-xp-field" id="bg" type="color" value={hex6(S.bg)} onChange={(e) => set({ bg: parseInt(e.currentTarget.value.slice(1), 16) | 0 })} /></div>
            <div className={ROW}><label className={LABEL} htmlFor="animate" title="Feed digital silence so the visualizers keep moving with no audio attached">Animate when no audio is playing</label>
              <input className={CHECK} id="animate" type="checkbox" checked={S.animate} onChange={(e) => set({ animate: e.currentTarget.checked })} /></div>
            <div className={ROW}><label className={LABEL} htmlFor="lyrics" title="Sends the playing track's title, artist, album and length to lrclib.net">Fetch lyrics (lrclib.net)</label>
              <input className={CHECK} id="lyrics" type="checkbox" checked={S.lyrics} onChange={(e) => sh.store.getState().actions.setLyricsEnabled(e.currentTarget.checked)} /></div>
            <p className={HINT + ' ml-16'} id="lyricsource">
              {(spotify ? 'Spotify\u2019s own lyrics first, LRCLIB when it has none. ' : 'From LRCLIB. ')
                + (S.lyrics && has && source ? 'This track: ' + LYRICS_SOURCE[source] + '.' : S.lyrics ? 'This track: none found.' : '')}
            </p>
            <div className={ROW + ' has-disabled:text-xp-disabled'}><label className={LABEL} htmlFor="karaoke" title="The current lyric line fills word by word as it is sung; off, it shows as one line">Karaoke word highlight</label>
              <input className={CHECK} id="karaoke" type="checkbox" checked={S.karaoke !== false} disabled={!S.lyrics}
                     onChange={(e) => sh.store.getState().actions.setKaraoke(e.currentTarget.checked)} /></div>
            <div className={ROW}><label className={LABEL} htmlFor="advanced">Show advanced settings</label>
              <input className={CHECK} id="advanced" type="checkbox" checked={S.advanced} onChange={(e) => set({ advanced: e.currentTarget.checked })} /></div>
          </fieldset>
        </section>
        {S.advanced && (
          <section data-pane="adv" hidden={t !== 'adv'}>
            <fieldset className={GRP}><legend className={LEGEND}>Rendering</legend>
              <div className={ROW}><label className={LABEL} htmlFor="fps">Frame rate</label>
                <select className={FIELD} id="fps" value={S.fps} onChange={(e) => set({ fps: fpsOf(e.currentTarget.value) })}>
                  {FPS_OPTS.map((f) => <option key={f} value={f}>{f === 'wmp' ? fpsLabel(f) : f}</option>)}
                </select></div>
              <div className={ROW}><label className={LABEL} htmlFor="scale">Render scale</label>
                <select className={FIELD} id="scale" value={String(S.scale)}
                        onChange={(e) => { const v = e.currentTarget.value; set({ scale: v === 'original' || v === 'auto' ? v : (+v as Scale) }); }}>
                  {SCALE_OPTS.map((v) => <option key={v} value={String(v)}>{scaleLabel(v)}</option>)}
                </select></div>
              <div className={ROW}><label className={LABEL} htmlFor="intended">Intended fixes</label>
                <input className={CHECK} id="intended" type="checkbox" checked={S.intended} onChange={(e) => set({ intended: e.currentTarget.checked })} /></div>
            </fieldset>
            <fieldset className={GRP}><legend className={LEGEND}>Analysis</legend>
              <div className={ROW}><label className={LABEL} htmlFor="smooth" title="WMP feeds unsmoothed FFT data; on = 0.8 smoothing">Smooth FFT</label>
                <input className={CHECK} id="smooth" type="checkbox" checked={S.smoothing > 0} onChange={(e) => set({ smoothing: e.currentTarget.checked ? 0.8 : 0 })} /></div>
              <div className={ROW}><label className={LABEL} htmlFor="debug">Debug overlay (D)</label>
                <input className={CHECK} id="debug" type="checkbox" checked={S.debug} onChange={(e) => set({ debug: e.currentTarget.checked })} /></div>
              <p className="text-xp-ro-ink bg-xp-ro border border-xp-edge py-3 px-5 m-0 mt-6" id="dbwin">Analyser: WMP's own (2048-point FFT, 80 dB, 30 snapshots a second)</p>
            </fieldset>
          </section>
        )}
      </div>
    </Dlg>
  );
}

export function About() {
  const close = useCloseDialog(), spotify = useApp((st) => st.auth.engine === 'spotify');
  const web = useApp((st) => st.auth.engine !== 'spotify' && st.auth.mode === 'web');
  const a = (href: string, text: string) => <a className="text-xp-link underline" href={href} target="_blank" rel="noopener">{text}</a>;
  return (
    <Dlg id="dlgAbout" title="About Windows Media Player" label="About" style={{ width: 340 }} buttons={[['OK', close]]}>
      <div className={cx(BODY, 'text-left')}>
        <img className="float-left w-48 h-48 mt-0 mr-10 mb-6 ml-0" id="aboutemblem" alt="" src={spotify ? emblemSpotify : emblemWmp} />
        <p className="m-0 mb-8 overflow-hidden"><b id="aboutname">{spotify ? 'WMP Spotify' : 'WMP Legacy Visualizers'}</b></p>
        <p className="m-0 mb-8 overflow-hidden">Alchemy, Bars and Waves and Battery ported 1:1 from the decompiled Windows Media Player visualizers{spotify ? ', over Spotify.' : '.'}</p>
        {web && <p className="m-0 mb-8 overflow-hidden" id="aboutlinks">Windows apps: {a(LINKS.spotify, 'WMP Spotify')} · {a(LINKS.screensaver, 'Alchemy Screensaver')}<br />Source code on {a(LINKS.repo, 'GitHub')}</p>}
        <p className="m-0 overflow-hidden text-xp-hint">Rendered in JavaScript from the original DLL semantics. Not affiliated with Microsoft{spotify ? ' or Spotify' : ''}.</p>
      </div>
    </Dlg>
  );
}

export function Shortcuts() {
  const keys = useShortcuts();
  const close = useCloseDialog();
  return (
    <Dlg id="dlgKeys" title="Keyboard Shortcuts" label="Keyboard Shortcuts" buttons={[['OK', close]]}>
      <div className={BODY}>
        <table className="border-collapse w-full" id="keystable"><tbody>
          {keys.map((k) => (
            <tr key={k.keys}>
              <td className="py-2 px-6 border-b border-xp-rule w-110 font-bold whitespace-nowrap">{k.keys}</td>
              <td className="py-2 px-6 border-b border-xp-rule">{k.label}</td>
            </tr>
          ))}
        </tbody></table>
      </div>
    </Dlg>
  );
}

/** A newer exe is out (the host found another host build): the download, or later (Help has it too). */
export function UpdateAvailable() {
  const close = useCloseDialog(), spotify = useApp((st) => st.auth.engine === 'spotify');
  const name = spotify ? 'WMP Spotify' : 'the Alchemy screensaver';
  const download = () => { openLink(appDownload(spotify)); close(); };
  return (
    <Dlg id="dlgUpdate" title="Player Update" label="Player Update" buttons={[['Download', download], ['Later', close]]}>
      <div className={BODY}>
        <p className="m-0 mb-8">A newer version of {name} is available.</p>
        <p className={HINT}>Fixes to the player arrive by themselves. This one changes the app itself, so it needs the new download. Help has the link too.</p>
      </div>
    </Dlg>
  );
}

/** Help > Check for Player Updates: asks now, then says what it found. A newer exe hands over to the
 *  Player Update dialog (the download); a newer page offers Restart Now (the apps) or Reload. */
export function CheckUpdates() {
  const sh = useShell(), close = useCloseDialog();
  const { spotify, web } = useApp((st) => ({ spotify: st.auth.engine === 'spotify', web: st.auth.mode === 'web' }));
  const [r, setR] = useState<UpdateCheck | null>(null);
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
    <Dlg id="dlgCheck" title="Player Update" label="Check for Player Updates" buttons={buttons}>
      <div className={BODY} id="checkmsg">
        {!r && <p className="m-0">Checking for updates…</p>}
        {r?.state === 'latest' && <p className="m-0">You have the latest version of {name}.</p>}
        {r?.state === 'error' && <p className="m-0">Could not check for updates. {r.message}</p>}
        {r?.state === 'ready' && (web
          ? <p className="m-0">A newer version of the player is available. Reload the page to use it.</p>
          : <p className="m-0">A player update has been downloaded. Restart {spotify ? 'WMP Spotify' : 'the screensaver settings'} to use it.</p>)}
      </div>
    </Dlg>
  );
}

export function OpenLink() {
  const sh = useShell(), close = useCloseDialog();
  const [q, setQ] = useState(''), [err, setErr] = useState('');
  const ok = () => {
    if (!sh.store.getState().commands.openLink(q)) { setErr('That is not a Spotify track, album, playlist or artist link.'); return; }
    close();
  };
  return (
    <Dlg id="dlgLink" title="Open Spotify Link" label="Open Spotify Link" buttons={[['OK', ok], ['Cancel', close]]}>
      <div className={BODY}>
        <p className={HINT}>Paste a Spotify link (open.spotify.com/…) or URI (spotify:album:…).</p>
        <input className="w-full py-2 px-4 border border-xp-field bg-white text-black" id="linkq" type="text" aria-label="Spotify link" value={q}
               onChange={(e) => setQ(e.currentTarget.value)} onKeyDown={(e) => { if (e.key === 'Enter') ok(); }} />
        <p className={HINT} id="linkerr">{err}</p>
      </div>
    </Dlg>
  );
}
