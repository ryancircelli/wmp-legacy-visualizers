// Settings: the nano 5G's tree in its order and words (docs/ipod-skin.md §2.3: About, Shuffle,
// Repeat, General, Playback, Date & Time, Legal, Reset Settings), less what has no meaning on Spotify
// (§4.4: Radio Regions, Language, Font Size, Rotate, Sort Contacts, Spoken Menus, Sound Check, EQ,
// Audio Crossfade, Audiobooks, Mono Audio), then this player's own rows (§4.4): Play On, Lyrics,
// Karaoke, Visualizer, Color, Click Wheel, Skin, Appearance, Check for Updates, Support, Log Out. A value shows
// at its row's right; a value list checks the current choice; a toggle flips in place (§2.4).
import { useEffect, useState, type CSSProperties } from 'react';
import { LIKED, type RepeatMode, type UpdateCheck } from '../../../../model';
import { appDownload, isAlbum, LINKS, openLink, restartApp, useApp, useCollection, useDevices, useLibraryList, useShell } from '../../../../ui';
import { useHostGlobal } from '../../host';
import { COLORS } from '../../settings';
import { MenuScreen, Spinner, useIpodSettings, useNav, useWheel } from '../../ui';
import type { IpodSettings, MenuItem, ScreenEntry } from '../contract';
import { cityOf, fmtClock, stepHue, zoneTime } from './logic';
import { BarPage, check, confirm, DIM, menu, onOff, page, Row, Sun, TEXT, TextPage, u, useNow } from './parts';
import {
  CLOCK0, LIBRARY_FILTERS, MAIN_MENU, resetMenu, resetPrefs, setMenuItem, useAppearance, useDisplay, useLibraryView, useMenuVisibility, usePref, useShake,
  useVisFit, useVisualizers, useVolumeLimitPref,
} from './prefs';

declare const __PAGE_BUILD__: string | undefined;
const BUILD = typeof __PAGE_BUILD__ === 'string' ? __PAGE_BUILD__ : 'dev';
/** the chrome's defaults (src/skins/ipod/settings.ts), for Reset Settings */
const IPOD0: IpodSettings = { color: 'silver', hue: 0, sat: 0, clicker: true, wheel: 'white' };

const REPEAT: [RepeatMode, string][] = [['off', 'Off'], ['track', 'One'], ['context', 'All']];
const FILL: CSSProperties = { display: 'flex', flexDirection: 'column', height: '100%', color: TEXT };
const GROW: CSSProperties = { flex: 1, minHeight: 0 };
const to = (nav: ReturnType<typeof useNav>, e: ScreenEntry) => () => nav.push(e);

function SettingsMenu() {
  const nav = useNav(), sh = useShell(), [ip, patch] = useIpodSettings(), vis = useVisualizers().name;
  const st = useApp((s) => ({ shuffle: s.playback.shuffle, repeat: s.playback.repeat, canLogout: s.auth.canLogout,
                              lyrics: s.settings.lyrics, karaoke: s.settings.karaoke }));
  const a = () => sh.store.getState().actions, c = () => sh.store.getState().commands;
  const items: (MenuItem | false)[] = [
    { id: 'about', label: 'About', chevron: true, onSelect: to(nav, page('settings/about', 'About', About)) },
    { id: 'shuffle', label: 'Shuffle', right: st.shuffle ? 'Songs' : 'Off', chevron: true, onSelect: to(nav, page('settings/shuffle', 'Shuffle', Shuffle)) },
    { id: 'repeat', label: 'Repeat', right: REPEAT.find(([m]) => m === st.repeat)?.[1], chevron: true, onSelect: to(nav, page('settings/repeat', 'Repeat', Repeat)) },
    { id: 'general', label: 'General', chevron: true, onSelect: to(nav, page('settings/general', 'General', General)) },
    { id: 'playback', label: 'Playback', chevron: true, onSelect: to(nav, page('settings/playback', 'Playback', Playback)) },
    { id: 'clock', label: 'Date & Time', chevron: true, onSelect: to(nav, page('settings/clock', 'Date & Time', DateTime)) },
    { id: 'legal', label: 'Legal', chevron: true, onSelect: to(nav, page('settings/legal', 'Legal', Legal)) },
    { id: 'reset', label: 'Reset Settings', chevron: true,
      onSelect: to(nav, confirm('settings/reset', 'Reset Settings', 'Reset', (n) => { resetPrefs(); patch(IPOD0); n.pop(); })) },
    // this player's
    { id: 'playon', label: 'Play On', chevron: true, onSelect: to(nav, page('settings/playon', 'Play On', PlayOn)) },
    { id: 'lyrics', label: 'Lyrics', right: onOff(st.lyrics), onSelect: () => a().setLyricsEnabled(!st.lyrics) },
    { id: 'karaoke', label: 'Karaoke', right: onOff(st.karaoke), onSelect: () => a().setKaraoke(!st.karaoke) },
    { id: 'vis', label: 'Visualizer', right: vis, chevron: true,
      onSelect: to(nav, page('settings/visualizer', 'Visualizer', Visualizer)) },
    { id: 'color', label: 'Color', right: <Swatch bg={swatch(ip)} />, chevron: true, onSelect: to(nav, page('settings/color', 'Color', Color)) },
    { id: 'wheel', label: 'Click Wheel', right: ip.wheel === 'black' ? 'Black' : 'White', onSelect: () => patch({ wheel: ip.wheel === 'black' ? 'white' : 'black' }) },
    { id: 'skin', label: 'Skin', right: 'iPod', chevron: true, onSelect: to(nav, menu('settings/skin', 'Skin', () => [
      { id: 'ipod', label: 'iPod', right: '✓' },
      { id: 'wmp9', label: 'Windows Media Player 9', onSelect: () => a().setSettings({ skin: 'wmp9' }) }])) },
    !!window.alchemyAppearance && { id: 'appearance', label: 'Appearance', chevron: true, onSelect: to(nav, page('settings/appearance', 'Appearance', Appearance)) },
    { id: 'updates', label: 'Check for Updates', chevron: true, onSelect: to(nav, page('settings/updates', 'Check for Updates', Updates)) },
    // The newest player from the site, in place: the music goes on (ios/WmpSpotify/observer.js alchemyRestart)
    !!window.alchemyRestart && { id: 'refresh', label: 'Refresh Player', onSelect: restartApp },
    { id: 'support', label: 'Support', chevron: true, onSelect: to(nav, menu('settings/support', 'Support', () => [
      { id: 'repo', label: 'Source Code', onSelect: () => openLink(LINKS.repo) },
      { id: 'issues', label: 'Report a Problem', onSelect: () => openLink(LINKS.repo + '/issues') }])) },
    st.canLogout && { id: 'logout', label: 'Log Out', chevron: true,
                      onSelect: to(nav, confirm('settings/logout', 'Log Out', 'Log Out', (n) => { n.home(); c().logout(); })) },
  ];
  return <MenuScreen items={items.filter((x): x is MenuItem => !!x)} />;
}

/** The nano's About [UG p.12]: center cycles its screens: the player and its counts, the versions,
 *  the device it plays on. */
function About() {
  const spotify = useApp((s) => s.auth.engine === 'spotify'), host = useHostGlobal('__wmpHost', 'wmp-host');
  const liked = useCollection(spotify ? LIKED : null), lib = useLibraryList(), [at, setAt] = useState(0);
  const device = useApp((s) => s.devices.list.find((d) => d.active)?.name ?? '');
  useEffect(() => { window.alchemyHost?.(); }, []);
  useWheel({ onCenter: () => setAt((at + 1) % 3) });
  const albums = lib.items.filter((x) => isAlbum(x.uri)).length;
  return (
    <TextPage>
      {at === 0 && <>
        <div style={{ fontWeight: 'bold', fontSize: u(28), textAlign: 'center' }}>iPod</div>
        <div style={{ color: DIM, fontSize: u(12), textAlign: 'center', marginBottom: u(10) }}>{spotify ? 'WMP Spotify' : 'WMP Legacy Visualizers'}</div>
        {liked.loaded && <Row label="Songs" value={liked.total.toLocaleString()} />}
        {!lib.loading && <><Row label="Playlists" value={(lib.items.length - albums).toLocaleString()} /><Row label="Albums" value={albums.toLocaleString()} /></>}
      </>}
      {at === 1 && <>
        <Row label="Version" value={host?.version ?? BUILD} />
        {host && <><Row label="Build" value={host.build} /><Row label="Page" value={BUILD} />
                   <Row label="iOS" value={host.ios} /><Row label="Model" value={host.model} /></>}
      </>}
      {at === 2 && <Row label="Playing On" value={device || '—'} />}
    </TextPage>
  );
}

/** Shuffle: Off / Songs (Spotify has no album shuffle; §4.4). */
function Shuffle() {
  const sh = useShell(), on = useApp((s) => s.playback.shuffle);
  return <MenuScreen items={([['off', 'Off', false], ['songs', 'Songs', true]] as const).map(([id, label, v]) => ({
    id, label, right: check(on === v), onSelect: () => { if (on !== v) sh.store.getState().commands.toggleShuffle(); } }))} />;
}

function Repeat() {
  const sh = useShell(), mode = useApp((s) => s.playback.repeat);
  return <MenuScreen items={REPEAT.map(([m, label]) => ({ id: m, label, right: check(mode === m), onSelect: () => sh.store.getState().commands.setRepeat(m) }))} />;
}

// ---- General -----------------------------------------------------------------------------------------
const BACKLIGHT = [2, 5, 10, 15, 20, 30, 0];
const seconds = (n: number) => (n ? n + ' Seconds' : 'Always On');

function General() {
  const nav = useNav(), [ip, patch] = useIpodSettings(), [d] = useDisplay(), [view, setView] = useLibraryView();
  return <MenuScreen items={[
    { id: 'main', label: 'Main Menu', chevron: true, onSelect: to(nav, page('settings/main', 'Main Menu', MainMenu)) },
    { id: 'music', label: 'Library Filters', chevron: true, onSelect: to(nav, page('settings/music', 'Library Filters', LibraryFilters)) },
    { id: 'view', label: 'Library View', right: view === 'list' ? 'List' : 'Grid', onSelect: () => setView(view === 'list' ? 'grid' : 'list') },
    { id: 'backlight', label: 'Backlight', right: seconds(d.backlight), chevron: true, onSelect: to(nav, page('settings/backlight', 'Backlight', Backlight)) },
    { id: 'brightness', label: 'Brightness', chevron: true, onSelect: to(nav, page('settings/brightness', 'Brightness', Brightness)) },
    { id: 'clicker', label: 'Clicker', right: onOff(ip.clicker), onSelect: () => patch({ clicker: !ip.clicker }) },
  ]} />;
}

/** Main Menu and Library Filters: a checklist of the rows or chips (✓ shows it), then Reset Filters. */
function MainMenu() {
  const vis = useMenuVisibility().main;
  return <MenuScreen items={[
    ...MAIN_MENU.map(([id, label]) => ({ id, label, right: check(vis[id] !== false), onSelect: () => setMenuItem('main', id, vis[id] === false) })),
  ]} />;
}
function LibraryFilters() {
  const vis = useMenuVisibility().music;
  return <MenuScreen items={[
    ...LIBRARY_FILTERS.map(([id, label]) => ({ id, label, right: check(vis[id] !== false), onSelect: () => setMenuItem('music', id, vis[id] === false) })),
    { id: 'reset', label: 'Reset Filters', onSelect: () => resetMenu('music') },
  ]} />;
}

function Backlight() {
  const [d, set] = useDisplay();
  return <MenuScreen items={BACKLIGHT.map((n) => ({ id: String(n), label: seconds(n), right: check(d.backlight === n), onSelect: () => set({ ...d, backlight: n }) }))} />;
}

/** The phone's own brightness on the iPhone; elsewhere the LCD's (0.2 at the least, so it stays readable). */
function Brightness() {
  const host = useHostGlobal('__wmpBrightness', 'wmp-brightness'), [mine, setMine] = useState<number | null>(null), [d, set] = useDisplay();
  const phone = !!window.alchemyBrightness;
  useEffect(() => { window.alchemyBrightness?.(); }, []);
  const v = phone ? mine ?? host ?? 0.5 : d.brightness;
  return <BarPage value={v} caption="Brightness" lo={<Sun n={9} />} hi={<Sun n={14} />} onTick={(dir) => {
    const x = Math.max(phone ? 0 : 0.2, Math.min(1, Math.round(v * 20 + dir) / 20));
    if (x === v) return false;
    if (phone) { setMine(x); window.alchemyBrightness?.(x); } else set({ ...d, brightness: x });
  }} />;
}

// ---- Playback ----------------------------------------------------------------------------------------
function Playback() {
  const nav = useNav(), [shake, setShake] = useShake(), [d, set] = useDisplay(), [limit] = useVolumeLimitPref()
  const [fit, setFit] = useVisFit(), stretch = fit === 'stretch';
  const items: (MenuItem | false)[] = [
    // the iPhone's shake; nothing else reports one
    !!window.alchemyHaptic && { id: 'shake', label: 'Shake', right: shake ? 'Shuffle' : 'Off', onSelect: () => setShake(!shake) },
    { id: 'volume', label: 'Volume Limit', right: limit < 100 ? limit + '%' : 'Off', chevron: true, onSelect: to(nav, page('settings/volume', 'Volume Limit', VolumeLimit)) },
    { id: 'energy', label: 'Energy Saver', right: onOff(d.energySaver), onSelect: () => set({ ...d, energySaver: !d.energySaver }) },
    // Now Playing's visualizer: the screen's real shape, or WMP's native surface stretched to it
    { id: 'visfit', label: 'Visualizer', right: stretch ? 'Stretch' : 'Fit', onSelect: () => setFit(stretch ? 'fit' : 'stretch') },
  ];
  return <MenuScreen items={items.filter((x): x is MenuItem => !!x)} />;
}

/** Now Playing's visualization (ipod.visualizer) by engine, each engine's presets a page of their own;
 *  shown at once when its visualizer is on screen. */
function Visualizer() {
  const nav = useNav(), open = (g: string) => nav.push({ key: 'settings/visualizer/' + g, title: g, render: () => <Presets group={g} /> });
  return <MenuScreen items={useVisualizers().engines(open)} />;
}
const Presets = ({ group }: { group: string }) => <MenuScreen items={useVisualizers().presets(group)} />;

/** Root's useSettingsEffects holds the volume under it everywhere. */
function VolumeLimit() {
  const [limit, set] = useVolumeLimitPref();
  return <BarPage value={limit / 100} caption={limit < 100 ? 'Limit ' + limit + '%' : 'No Limit'} onTick={(d) => {
    const x = Math.max(0, Math.min(100, limit + d * 2));
    if (x === limit) return false;
    set(x);
  }} />;
}

// ---- Date & Time ---------------------------------------------------------------------------------------
/** Date, Time and Time Zone are this device's; the two toggles are the iPod's. */
function DateTime() {
  const [p, set] = usePref('ipod.clock', CLOCK0), now = new Date(useNow(1000)), t = zoneTime(now, '');
  return <MenuScreen items={[
    { id: 'date', label: 'Date', right: now.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) },
    { id: 'time', label: 'Time', right: fmtClock(t.h, t.m, p.twentyFourHour) },
    { id: 'zone', label: 'Time Zone', right: cityOf('') },
    { id: 'h24', label: '24 Hour Clock', right: onOff(p.twentyFourHour), onSelect: () => set({ ...p, twentyFourHour: !p.twentyFourHour }) },
    { id: 'title', label: 'Time in Title', right: onOff(p.timeInTitle), onSelect: () => set({ ...p, timeInTitle: !p.timeInTitle }) },
  ]} />;
}

const Legal = () => (
  <TextPage>
    <p style={{ margin: `0 0 ${u(8)}` }}><b>WMP Legacy Visualizers</b> is an independent open-source project.</p>
    <p style={{ margin: `0 0 ${u(8)}` }}>It is not affiliated with, endorsed by or sponsored by Apple Inc., Spotify AB or Microsoft Corporation.</p>
    <p style={{ margin: 0, color: DIM }}>iPod and iPod nano are trademarks of Apple Inc. Spotify is a trademark of Spotify AB. Windows Media Player is a trademark of Microsoft Corporation.</p>
  </TextPage>
);

// ---- Color --------------------------------------------------------------------------------------
/** the nine 5G colours in Apple's order (§1.2), then Custom */
const COLOR_ROWS: readonly (readonly [IpodSettings['color'], string])[] = [['silver', 'Silver'], ['black', 'Black'], ['purple', 'Purple'],
  ['blue', 'Blue'], ['green', 'Green'], ['yellow', 'Yellow'], ['orange', 'Orange'], ['pink', 'Pink'], ['red', '(PRODUCT) RED'], ['custom', 'Custom']];
/** a body colour as CSS, as the chrome's bodyVars draws it (Custom with no saturation set: 85%) */
function swatch(s: IpodSettings, color = s.color): string {
  const [h, sat, l] = color === 'custom' ? [s.hue, s.sat || 85, 50] : COLORS[color];
  return `hsl(${h} ${sat}% ${l}%)`;
}
const Swatch = ({ bg }: { bg: string }) => (
  <span style={{ display: 'inline-block', verticalAlign: 'middle', width: u(16), height: u(11), borderRadius: u(2), background: bg,
                 boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.35)' }} />
);

function Color() {
  const nav = useNav(), [ip, patch] = useIpodSettings();
  return <MenuScreen items={COLOR_ROWS.map(([id, label]) => ({
    id, label, chevron: id === 'custom',
    right: <>{id === ip.color && '✓ '}<Swatch bg={swatch(ip, id)} /></>,
    onSelect: id !== 'custom' ? () => patch({ color: id }) : () => {
      const prev = { color: ip.color, hue: ip.hue, sat: ip.sat };
      patch({ color: 'custom' });
      nav.push({ key: 'settings/color/custom', title: 'Custom', render: () => <CustomColor prev={prev} /> });
    },
  }))} />;
}

/** The wheel turns the hue live, 5° a detent (§4.4); centre keeps it, MENU puts the old colour back. */
function CustomColor({ prev }: { prev: Partial<IpodSettings> }) {
  const nav = useNav(), [ip, patch] = useIpodSettings();
  useWheel({ onTick: (d) => patch({ hue: stepHue(ip.hue, d) }), onCenter: () => nav.pop(), onMenu: () => { patch(prev); } });
  const stops = [0, 60, 120, 180, 240, 300, 360].map((h) => `hsl(${h} 80% 50%)`).join();
  return (
    <div style={{ ...FILL, alignItems: 'center', justifyContent: 'center', gap: u(12), fontSize: u(14) }}>
      <div style={{ width: u(70), height: u(70), borderRadius: '50%', background: swatch(ip), boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.3)' }} />
      <div style={{ position: 'relative', width: '80%', height: u(10), borderRadius: u(5), background: `linear-gradient(to right, ${stops})` }}>
        <div style={{ position: 'absolute', top: u(-3), bottom: u(-3), left: `${(ip.hue / 360) * 100}%`, width: u(3), marginLeft: u(-1.5),
                      background: TEXT, borderRadius: u(1) }} />
      </div>
      <div>{ip.hue}°</div>
      <div style={{ color: DIM, fontSize: u(12) }}>Press the center button to keep it</div>
    </div>
  );
}

// ---- Play On, Appearance, Check for Updates -----------------------------------------------------------
/** The Connect devices (§4.4), the playing one checked, offline ones greyed; AirPlay is the iOS app's picker. */
function PlayOn() {
  const d = useDevices(() => ''), entries = d.items();
  const items: MenuItem[] = entries.flatMap((e, i) => ('label' in e
    ? [{ id: 'd' + i, label: e.label, right: check(!!e.check), disabled: e.disabled, onSelect: e.act }] : []));
  if (window.alchemyRoutePicker) items.push({ id: 'airplay', label: 'AirPlay…', onSelect: () => window.alchemyRoutePicker?.() });
  // the cursor starts on the playing device (the check), so the list reads as "this one"
  const [sel, setSel] = useState(Math.max(0, entries.findIndex((e) => 'check' in e && e.check)));
  return <MenuScreen items={items} selected={sel} onSelectedChange={setSel} empty="No Devices" />;
}

const MODES = [['light', 'Light'], ['dark', 'Dark'], ['auto', 'Automatic']] as const;
function Appearance() {
  const [mode, set] = useAppearance();
  return <MenuScreen items={MODES.map(([m, label]) => ({ id: m, label, right: check(mode === m),
                                                         onSelect: () => { set(m); window.alchemyAppearance?.(m); } }))} />;
}

/** Help > Check for Player Updates, as WMP 9's dialog words it; a found update's action is a row. */
function Updates() {
  const sh = useShell(), [r, setR] = useState<UpdateCheck | null>(null);
  const { spotify, web } = useApp((s) => ({ spotify: s.auth.engine === 'spotify', web: s.auth.mode === 'web' }));
  useEffect(() => {
    let live = true;
    void sh.store.getState().commands.checkForUpdates().then((x) => {
      if (!live) return;
      if (x.state === 'app') sh.store.getState().actions.setAuth({ hostUpdate: true });
      setR(x);
    });
    return () => { live = false; };
  }, [sh]);
  if (!r) return <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}><Spinner /></div>;
  const name = spotify ? 'WMP Spotify' : web ? 'the player' : 'the Alchemy screensaver';
  const [text, act] = {
    latest: ['You have the latest version of ' + name + '.', null],
    error: ['Could not check for updates. ' + (r.message ?? ''), null],
    ready: [web ? 'A newer version of the player is available.' : 'A player update has been downloaded.',
            { id: 'go', label: web ? 'Reload' : 'Restart Now', onSelect: restartApp }],
    app: ['A newer version of ' + name + ' is available. It needs the new download.',
          { id: 'go', label: 'Download', onSelect: () => openLink(appDownload(spotify)) }],
  }[r.state] as [string, MenuItem | null];
  return (
    <div style={FILL}>
      <p style={{ margin: 0, padding: u(10), fontSize: u(14), lineHeight: 1.35 }}>{text}</p>
      {act && <div style={GROW}><MenuScreen items={[act]} /></div>}
    </div>
  );
}

export const settings = (): ScreenEntry => page('settings', 'Settings', SettingsMenu);
