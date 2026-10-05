// Preferences (iTunes' Edit > Preferences) on the phone: one list under the source list's bold grey
// headers instead of the dialog's General / Playback / Advanced panes, its rows in the table's stripes,
// a choice that is a switch an iTunes check box, a value at the row's right, › for a page of its own.
// It carries what the iPod's Settings carries that applies here: the skin, the lyrics, the host
// player's sound (only while the iOS app plays itself: auth.hostPlayer), about and updates, the log,
// the project's links, Log Out. Playback's switches iTunes put in Preferences are the app's settings;
// shuffle, repeat and the device are the bottom bar's.
import { useEffect, useState, type ReactNode } from 'react';
import { EQ_PRESETS, eqPreset, LIKED, QUALITY_OPTS, type Settings, type UpdateCheck } from '../../../model';
import { appDownload, BUILD, cx, isAlbum, LINKS, openLink, restartApp, useApp, useCollection, useLibraryList, useShell } from '../../../ui';
// a cycle (registry -> itunes -> here), safe: `skins` is read only while this page renders
import { skinFor, skins } from '../../registry';
import { Icon } from '../shared';
import { useHostGlobal } from './host';
import { ROW, Strip } from './Pages';
import { SheetFrame, openSheet } from './Sheet';

/** Crossfade's steps in seconds (Off after the last), and Audio Quality's names by QUALITY_OPTS: the iPod's */
const FADES = [2, 5, 8, 12];
const QUALITY_NAMES = ['Normal', 'High', 'Very High'];

type Sub = 'skin' | 'eq' | 'about' | null;

export function PrefsPage({ back, backLabel }: { back: () => void; backLabel: string }) {
  const [sub, setSub] = useState<Sub>(null);
  const title = sub === 'skin' ? 'Skin' : sub === 'eq' ? 'Equalizer' : sub === 'about' ? 'About' : 'Preferences';
  return (
    <>
      <Strip title={title} back={sub ? () => setSub(null) : back} backLabel={sub ? 'Preferences' : backLabel} />
      <div className="flex-auto min-h-0 overflow-y-auto overscroll-contain bg-itunes-side pb-16" id="prefs">
        {sub === 'skin' ? <SkinList /> : sub === 'eq' ? <EqList /> : sub === 'about' ? <About /> : <Main open={setSub} />}
      </div>
    </>
  );
}

const Head = ({ children }: { children: string }) => (
  <div className="h-30 pt-13 pl-12 text-11 leading-[15px] font-bold tracking-[.02em] text-itunes-side-head [text-shadow:0_1px_0_rgba(255,255,255,.7)]">{children}</div>
);
/** a section's rows: the table's stripes between rules */
const Group = ({ children }: { children: ReactNode }) => (
  <div className="border-y border-[#C4C4C4] bg-white [&>*:nth-child(even)]:bg-itunes-stripe">{children}</div>
);

/** One row: a label, then a check box (`check`), a value and/or › at the right. */
function Row({ label, value, check, chevron, disabled, danger, onClick, id }: {
  label: string; value?: ReactNode; check?: boolean; chevron?: boolean; disabled?: boolean; danger?: boolean; onClick?: () => void; id?: string;
}) {
  return (
    <button type="button" id={id} disabled={disabled} onClick={onClick} style={{ height: ROW }}
            role={check !== undefined ? 'checkbox' : undefined} aria-checked={check}
            className="flex items-center gap-9 w-full px-12 border-0 bg-transparent text-left text-13 text-black active:bg-itunes-sel active:text-white disabled:text-[#9A9A9A] disabled:active:bg-transparent">
      {check !== undefined && (
        <span aria-hidden="true" className="flex-none grid place-items-center w-15 h-15 rounded-[2px] border border-[#707070] bg-[linear-gradient(180deg,#FFFFFF,#E3E3E3)] shadow-[inset_0_1px_1px_rgba(0,0,0,.12)]">
          {check && <Icon name="check" size={13} className="text-[#1E3F7A]" />}
        </span>
      )}
      <span className={cx('flex-auto min-w-0 truncate', danger && 'text-[#C0291F] font-bold')}>{label}</span>
      {value !== undefined && <span className="flex-none max-w-[55%] truncate text-12 text-itunes-dim">{value}</span>}
      {chevron && <Icon name="forward" size={10} className="flex-none text-[#8A8A8A]" />}
    </button>
  );
}

function Main({ open }: { open: (s: Sub) => void }) {
  const sh = useShell(), a = () => sh.store.getState().actions;
  const s = useApp((x) => ({ S: x.settings, host: !!x.auth.hostPlayer, logout: x.auth.canLogout, spotify: x.auth.engine === 'spotify', web: x.auth.mode === 'web' }));
  const set = (p: Partial<Settings>) => a().setSettings(p), q = QUALITY_OPTS.indexOf(s.S.quality);
  return (
    <>
      <Head>GENERAL</Head>
      <Group>
        <Row label="Skin" value={skinFor(s.S.skin).name} chevron onClick={() => open('skin')} id="pskin" />
        <Row label="Show Lyrics" check={s.S.lyrics} onClick={() => a().setLyricsEnabled(!s.S.lyrics)} id="plyrics" />
        <Row label="Highlight Lyrics Word by Word" check={s.S.karaoke !== false} disabled={!s.S.lyrics} onClick={() => a().setKaraoke(s.S.karaoke === false)} />
      </Group>
      {/* the host's own player's (docs/ipod-skin.md "Sound", "Crossfade"): iTunes' Playback pane */}
      {s.host && <>
        <Head>PLAYBACK</Head>
        <Group>
          <Row label="Equalizer" value={eqPreset(s.S.eq).name} chevron onClick={() => open('eq')} id="peq" />
          <Row label="Crossfade Songs" value={s.S.crossfade ? s.S.crossfade + ' seconds' : 'Off'} id="pfade"
               onClick={() => set({ crossfade: FADES.find((n) => n > s.S.crossfade) ?? 0 })} />
          <Row label="Sound Check" check={s.S.normalise} onClick={() => set({ normalise: !s.S.normalise })} id="pnormalise" />
          <Row label="Audio Quality" value={QUALITY_NAMES[q]} onClick={() => set({ quality: QUALITY_OPTS[(q + 1) % QUALITY_OPTS.length] })} id="pquality" />
          <Row label="Keep Played Songs (Audio Cache)" check={s.S.audioCache} onClick={() => set({ audioCache: !s.S.audioCache })} id="pcache" />
        </Group>
      </>}
      <Head>ADVANCED</Head>
      <Group>
        <Row label={'About ' + (s.spotify ? 'WMP Spotify' : 'WMP Legacy Visualizers')} chevron onClick={() => open('about')} id="pabout" />
        <Updates spotify={s.spotify} web={s.web} />
        {/* the newest player from the site, in place: the music goes on (observer.js alchemyRestart) */}
        {!!window.alchemyRestart && <Row label="Refresh Player" onClick={restartApp} />}
        {/* the iOS app's log sheet (the band that opens it is hidden under this skin) */}
        {!!window.alchemyShowLog && <Row label="Show Log" onClick={() => window.alchemyShowLog?.()} id="plog" />}
        <Row label="Source Code" onClick={() => openLink(LINKS.repo)} />
        <Row label="Report a Problem" onClick={() => openLink(LINKS.repo + '/issues')} />
      </Group>
      {s.logout && <>
        <Head>ACCOUNT</Head>
        <Group>
          <Row label="Log Out of Spotify" danger id="plogout"
               onClick={() => openSheet(<SheetFrame title="Log out of Spotify on this phone?"
                                                    items={[{ label: 'Log Out', danger: true, act: () => void sh.store.getState().commands.logout() }]} />)} />
        </Group>
      </>}
    </>
  );
}

/** Check for Updates, in its row: asked on a tap, the answer as the row's value, a found update's act a row under it. */
function Updates({ spotify, web }: { spotify: boolean; web: boolean }) {
  const sh = useShell(), [r, setR] = useState<UpdateCheck | 'asking' | null>(null);
  const ask = () => {
    setR('asking');
    void sh.store.getState().commands.checkForUpdates().then((x) => {
      if (x.state === 'app') sh.store.getState().actions.setAuth({ hostUpdate: true });
      setR(x);
    });
  };
  const value = r === 'asking' ? 'Checking…' : !r ? undefined
    : { latest: 'Up to date', error: 'Could not check', ready: 'Update ready', app: 'New version' }[r.state];
  return (
    <>
      <Row label="Check for Updates" value={value} disabled={r === 'asking'} onClick={ask} id="pupdates" />
      {r && r !== 'asking' && r.state === 'ready' && <Row label={web ? 'Reload the Player' : 'Restart Now'} onClick={restartApp} />}
      {r && r !== 'asking' && r.state === 'app' && <Row label="Download the New Version" onClick={() => openLink(appDownload(spotify))} />}
    </>
  );
}

/** The registry's skins (View > Skin's list), this one checked. */
function SkinList() {
  const sh = useShell(), cur = useApp((s) => skinFor(s.settings.skin).id);
  return (
    <div className="pt-12"><Group>
      {Object.values(skins).map((k) => (
        <Row key={k.id} label={k.name} value={k.id === cur ? <Icon name="check" size={13} className="text-[#1E3F7A]" /> : undefined}
             onClick={() => { if (k.id !== cur) sh.store.getState().actions.setSettings({ skin: k.id }); }} />
      ))}
    </Group></div>
  );
}

/** iTunes' Equalizer presets (the host player's ten bands, src/model/eq.ts): a tap applies one at once,
 *  so each is heard while choosing; the page stays. */
function EqList() {
  const sh = useShell(), eq = useApp((s) => s.settings.eq);
  return (
    <div className="pt-12"><Group>
      {EQ_PRESETS.map((p) => (
        <Row key={p.id} label={p.name} value={p.id === eq ? <Icon name="check" size={13} className="text-[#1E3F7A]" /> : undefined}
             onClick={() => sh.store.getState().actions.setSettings({ eq: p.id })} />
      ))}
    </Group></div>
  );
}

/** Help > About, with what the iPod's About counts and the versions the iOS app reports. */
function About() {
  const spotify = useApp((s) => s.auth.engine === 'spotify'), host = useHostGlobal('__wmpHost', 'wmp-host');
  const liked = useCollection(spotify ? LIKED : null), lib = useLibraryList(), device = useApp((s) => s.devices.list.find((d) => d.active)?.name ?? '');
  useEffect(() => { window.alchemyHost?.(); }, []);
  const albums = lib.items.filter((x) => isAlbum(x.uri)).length;
  const rows: [string, string][] = [
    ...(liked.loaded ? [['Songs', liked.total.toLocaleString()] as [string, string]] : []),
    ...(!lib.loading ? [['Playlists', (lib.items.length - albums).toLocaleString()], ['Albums', albums.toLocaleString()]] as [string, string][] : []),
    ['Version', host?.version ?? BUILD],
    ...(host ? [['Build', host.build], ['Page', BUILD], ['iOS', host.ios], ['Model', host.model]] as [string, string][] : []),
    ['Playing On', device || '—'],
  ];
  return (
    <div className="pt-16">
      <div className="flex flex-col items-center gap-6 pb-14 text-center">
        <span className="grid place-items-center w-64 h-64 rounded-full bg-[radial-gradient(circle_at_50%_35%,#9FD3FF,#2E7FD8_60%,#1B4F9C)] text-white shadow-[0_2px_6px_rgba(0,0,0,.35)]"><Icon name="note" size={34} /></span>
        <div className="text-17 font-bold">{spotify ? 'WMP Spotify' : 'WMP Legacy Visualizers'}</div>
        <div className="text-12 text-itunes-dim">The iTunes 10 skin, on the phone</div>
      </div>
      <Group>{rows.map(([k, v]) => <Row key={k} label={k} value={v} />)}</Group>
      <p className="mx-14 mt-12 text-11 leading-[15px] text-itunes-dim">
        An independent open-source project, not affiliated with, endorsed by or sponsored by Apple Inc., Spotify AB or Microsoft Corporation.
        iTunes and iPhone are trademarks of Apple Inc. Spotify is a trademark of Spotify AB.
      </p>
    </div>
  );
}
