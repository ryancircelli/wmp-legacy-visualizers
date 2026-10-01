// Settings: the nano 5G's menu, each value at the right of its row as the real one draws it (a row
// that cycles in place, as Shuffle does, changes on centre without leaving), with this player's own
// rows after Language: Color, Wheel, Skin, Output, Appearance, Updates, Support, Log Out. Legal and
// Reset Settings close it, as on the nano. The nano's Audiobooks speed and Sound Check have nothing
// to drive here, so they are left out; EQ stays, Off, saying why.
import { useEffect, useState, type CSSProperties } from 'react';
import { LIKED, type RepeatMode, type UpdateCheck } from '../../../../model';
import { appDownload, LINKS, openLink, restartApp, useApp, useCollection, useDevices, useShell } from '../../../../ui';
import { useHostGlobal } from '../../host';
import { COLORS } from '../../settings';
import { MenuScreen, Spinner, useIpodSettings, useNav, useWheel } from '../../ui';
import type { IpodSettings, MenuItem, ScreenEntry } from '../contract';
import { cityOf, fmtClock, stepHue, zoneTime } from './logic';
import { BarPage, check, confirm, DIM, menu, onOff, page, Row, TEXT, TextPage, u, useNow } from './parts';
import { CLOCK0, MAIN_MENU, MUSIC_MENU, resetPrefs, setMenuItem, useAppearance, useMenuVisibility, usePref, useVolumeLimit, useVolumeLimitPref } from './prefs';

declare const __PAGE_BUILD__: string | undefined;
const BUILD = typeof __PAGE_BUILD__ === 'string' ? __PAGE_BUILD__ : 'dev';
/** the chrome's defaults (src/skins/ipod/settings.ts), for Reset Settings */
const IPOD0: IpodSettings = { color: 'silver', hue: 0, sat: 0, clicker: true, wheel: 'white' };

const REPEAT: Record<RepeatMode, string> = { off: 'Off', track: 'One', context: 'All' };
const NEXT_REPEAT: Record<RepeatMode, RepeatMode> = { off: 'track', track: 'context', context: 'off' };
const FILL: CSSProperties = { display: 'flex', flexDirection: 'column', height: '100%', color: TEXT };
const GROW: CSSProperties = { flex: 1, minHeight: 0 };

function SettingsMenu() {
  const nav = useNav(), sh = useShell(), [ip, patch] = useIpodSettings();
  const st = useApp((s) => ({ shuffle: s.playback.shuffle, repeat: s.playback.repeat, canLogout: s.auth.canLogout }));
  const c = () => sh.store.getState().commands, w = window;
  const go = (e: ScreenEntry) => () => nav.push(e);
  const items: (MenuItem | false)[] = [
    { id: 'about', label: 'About', chevron: true, onSelect: go(page('settings/about', 'About', About)) },
    { id: 'shuffle', label: 'Shuffle', right: st.shuffle ? 'Songs' : 'Off', onSelect: () => c().toggleShuffle() },
    { id: 'repeat', label: 'Repeat', right: REPEAT[st.repeat], onSelect: () => c().setRepeat(NEXT_REPEAT[st.repeat]) },
    { id: 'main', label: 'Main Menu', chevron: true, onSelect: go(page('settings/main', 'Main Menu', MainMenu)) },
    { id: 'music', label: 'Music Menu', chevron: true, onSelect: go(page('settings/music', 'Music Menu', MusicMenu)) },
    { id: 'volume', label: 'Volume Limit', chevron: true, onSelect: go(page('settings/volume', 'Volume Limit', VolumeLimit)) },
    !!w.alchemyBrightness && { id: 'brightness', label: 'Brightness', chevron: true, onSelect: go(page('settings/brightness', 'Brightness', Brightness)) },
    { id: 'eq', label: 'EQ', right: 'Off', chevron: true, onSelect: go(page('settings/eq', 'EQ', Eq)) },
    { id: 'clicker', label: 'Clicker', right: onOff(ip.clicker), onSelect: () => patch({ clicker: !ip.clicker }) },
    { id: 'clock', label: 'Date & Time', chevron: true, onSelect: go(page('settings/clock', 'Date & Time', DateTime)) },
    { id: 'language', label: 'Language', chevron: true, onSelect: go(menu('settings/language', 'Language', () => LANGS.map((l, i) => ({ id: l, label: l, right: check(!i), disabled: !!i })))) },
    { id: 'color', label: 'Color', right: <Swatch bg={swatch(ip)} />, chevron: true, onSelect: go(page('settings/color', 'Color', Color)) },
    { id: 'wheel', label: 'Wheel', right: ip.wheel === 'black' ? 'Black' : 'White', onSelect: () => patch({ wheel: ip.wheel === 'black' ? 'white' : 'black' }) },
    { id: 'skin', label: 'Skin', chevron: true, onSelect: go(menu('settings/skin', 'Skin', () => [
      { id: 'wmp9', label: 'Windows Media Player 9', onSelect: () => sh.store.getState().actions.setSettings({ skin: 'wmp9' }) },
      { id: 'ipod', label: 'iPod nano', right: '✓' }])) },
    { id: 'output', label: 'Output', chevron: true, onSelect: go(page('settings/output', 'Output', Output)) },
    !!w.alchemyAppearance && { id: 'appearance', label: 'Appearance', chevron: true, onSelect: go(page('settings/appearance', 'Appearance', Appearance)) },
    { id: 'updates', label: 'Updates', chevron: true, onSelect: go(page('settings/updates', 'Updates', Updates)) },
    { id: 'support', label: 'Support', chevron: true, onSelect: go(menu('settings/support', 'Support', () => [
      { id: 'repo', label: 'Source Code', onSelect: () => openLink(LINKS.repo) },
      { id: 'issues', label: 'Report a Problem', onSelect: () => openLink(LINKS.repo + '/issues') }])) },
    st.canLogout && { id: 'logout', label: 'Log Out', chevron: true,
                      onSelect: go(confirm('settings/logout', 'Log Out', 'Log Out', (n) => { n.home(); c().logout(); })) },
    { id: 'legal', label: 'Legal', chevron: true, onSelect: go(page('settings/legal', 'Legal', Legal)) },
    { id: 'reset', label: 'Reset Settings', chevron: true,
      onSelect: go(confirm('settings/reset', 'Reset Settings', 'Reset', (n) => { resetPrefs(); patch(IPOD0); n.pop(); })) },
  ];
  return <MenuScreen items={items.filter((x): x is MenuItem => !!x)} />;
}

/** The nano's About: the player's name, then its numbers (the iOS app's, when it reports them). */
function About() {
  const spotify = useApp((s) => s.auth.engine === 'spotify'), host = useHostGlobal('__wmpHost', 'wmp-host');
  const liked = useCollection(spotify ? LIKED : null);
  useEffect(() => { window.alchemyHost?.(); }, []);
  return (
    <TextPage>
      <div style={{ fontWeight: 'bold', fontSize: u(17), textAlign: 'center', marginBottom: u(8) }}>{spotify ? 'WMP Spotify' : 'WMP Legacy Visualizers'}</div>
      {liked.loaded && <Row label="Songs" value={liked.total.toLocaleString()} />}
      <Row label="Version" value={host?.version ?? BUILD} />
      {host && <><Row label="Build" value={host.build} /><Row label="Page" value={BUILD} />
                 <Row label="iOS" value={host.ios} /><Row label="Model" value={host.model} /></>}
    </TextPage>
  );
}

function Toggles({ which }: { which: 'main' | 'music' }) {
  const vis = useMenuVisibility()[which];
  return <MenuScreen items={(which === 'main' ? MAIN_MENU : MUSIC_MENU).map(([id, label]) => ({
    id, label, right: onOff(vis[id] !== false), onSelect: () => setMenuItem(which, id, vis[id] === false) }))} />;
}
const MainMenu = () => <Toggles which="main" />;
const MusicMenu = () => <Toggles which="music" />;

function VolumeLimit() {
  const [limit, set] = useVolumeLimitPref();
  useVolumeLimit();
  return <BarPage value={limit / 100} caption={limit < 100 ? 'Limit ' + limit + '%' : 'No Limit'}
                  onTick={(d) => set(Math.max(0, Math.min(100, limit + d * 2)))} />;
}

function Brightness() {
  const host = useHostGlobal('__wmpBrightness', 'wmp-brightness'), [mine, setMine] = useState<number | null>(null);
  useEffect(() => { window.alchemyBrightness?.(); }, []);
  const v = mine ?? host ?? 0.5;
  return <BarPage value={v} caption="Brightness" onTick={(d) => {
    const x = Math.max(0, Math.min(1, Math.round(v * 20 + d) / 20));
    setMine(x);
    window.alchemyBrightness?.(x);
  }} />;
}

const EQ = ['Off', 'Acoustic', 'Bass Booster', 'Bass Reducer', 'Classical', 'Dance', 'Deep', 'Electronic', 'Flat', 'Hip Hop', 'Jazz',
  'Latin', 'Loudness', 'Lounge', 'Piano', 'Pop', 'R&B', 'Rock', 'Small Speakers', 'Spoken Word', 'Treble Booster', 'Treble Reducer', 'Vocal Booster'];
const Eq = () => (
  <div style={FILL}>
    <div style={GROW}><MenuScreen items={EQ.map((l, i) => ({ id: l, label: l, right: check(!i), disabled: !!i }))} /></div>
    <p style={{ margin: 0, padding: u(6), fontSize: u(11), color: DIM, textAlign: 'center' }}>Spotify's web player has no equalizer.</p>
  </div>
);

function DateTime() {
  const [p, set] = usePref('ipod.clock', CLOCK0), now = useNow(1000), t = zoneTime(new Date(now), '');
  return (
    <div style={FILL}>
      <div style={{ textAlign: 'center', padding: u(8) }}>
        <div style={{ fontSize: u(26), fontWeight: 'bold' }}>{fmtClock(t.h, t.m, p.twentyFourHour)}</div>
        <div style={{ fontSize: u(12), color: DIM }}>{new Date(now).toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</div>
      </div>
      <div style={GROW}><MenuScreen items={[
        { id: 'h24', label: '24 Hour Clock', right: onOff(p.twentyFourHour), onSelect: () => set({ ...p, twentyFourHour: !p.twentyFourHour }) },
        { id: 'title', label: 'Time in Title', right: onOff(p.timeInTitle), onSelect: () => set({ ...p, timeInTitle: !p.timeInTitle }) },
        { id: 'zone', label: 'Time Zone', right: cityOf(''), disabled: true },
      ]} /></div>
    </div>
  );
}

const LANGS = ['English', 'Dansk', 'Deutsch', 'Español', 'Français', 'Italiano', 'Nederlands', 'Norsk', 'Polski', 'Português', 'Suomi',
  'Svenska', 'Русский', '日本語', '简体中文', '繁體中文', '한국어'];

const Legal = () => (
  <TextPage>
    <p style={{ margin: `0 0 ${u(8)}` }}><b>WMP Legacy Visualizers</b> is an independent open-source project.</p>
    <p style={{ margin: `0 0 ${u(8)}` }}>It is not affiliated with, endorsed by or sponsored by Apple Inc., Spotify AB or Microsoft Corporation.</p>
    <p style={{ margin: 0, color: DIM }}>iPod and iPod nano are trademarks of Apple Inc. Spotify is a trademark of Spotify AB. Windows Media Player is a trademark of Microsoft Corporation.</p>
  </TextPage>
);

// ---- Color --------------------------------------------------------------------------------------
const COLOR_ROWS: readonly (readonly [IpodSettings['color'], string])[] = [['silver', 'Silver'], ['black', 'Black'], ['purple', 'Purple'],
  ['blue', 'Blue'], ['green', 'Green'], ['yellow', 'Yellow'], ['orange', 'Orange'], ['red', 'Red'], ['pink', 'Pink'], ['custom', 'Custom']];
/** a body colour as CSS; Custom with no saturation yet previews at 60% */
function swatch(s: IpodSettings, color = s.color): string {
  const [h, sat, l] = color === 'custom' ? [s.hue, s.sat || 60, 55] : COLORS[color];
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
      patch({ color: 'custom', sat: ip.sat || 60 });
      nav.push({ key: 'settings/color/custom', title: 'Custom', render: () => <CustomColor prev={prev} /> });
    },
  }))} />;
}

/** The wheel turns the hue live; centre keeps it, MENU puts the old colour back. */
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

// ---- Output, Appearance, Updates -------------------------------------------------------------------
/** Play on Device: the Connect devices, the playing one checked; AirPlay is the iOS app's picker. */
function Output() {
  const d = useDevices(() => '');
  const items: MenuItem[] = d.items().flatMap((e, i) => ('label' in e
    ? [{ id: 'd' + i, label: e.label, right: check(!!e.check), disabled: e.disabled, onSelect: e.act }] : []));
  if (window.alchemyRoutePicker) items.push({ id: 'airplay', label: 'AirPlay…', onSelect: () => window.alchemyRoutePicker?.() });
  return <MenuScreen items={items} />;
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
