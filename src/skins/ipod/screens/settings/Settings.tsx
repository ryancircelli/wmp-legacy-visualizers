// Settings: this player's tree in the nano's look (docs/ipod-skin.md §4.4), one list in sections under
// headers (Appearance, Menus, General, Support, Account); a row that is a real choice opens its page.
// What Now Playing controls itself is not here (Shuffle and Repeat: the status row; Lyrics, Karaoke,
// Visualizer, Play On: its ⋯ and hold menus), nor what the device does (brightness, backlight, the date
// and time, the clock's 24 hours, the volume), nor what has no meaning on Spotify (§4.4: Radio Regions, Language,
// Font Size, Rotate, Sort Contacts, Spoken Menus, Sound Check, EQ, Audio Crossfade, Audiobooks, Mono
// Audio). A value shows at its row's right; a value list checks the current choice; a toggle flips in
// place (§2.4).
import { useEffect, useState, type CSSProperties } from 'react';
import { LIKED, type UpdateCheck } from '../../../../model';
import { appDownload, isAlbum, LINKS, openLink, restartApp, useApp, useCollection, useLibraryList, useShell } from '../../../../ui';
import { useHostGlobal } from '../../host';
import { bodyHsl, DEFAULTS } from '../../settings';
import { MenuScreen, Spinner, useIpodSettings, useNav, useWheel } from '../../ui';
import type { IpodSettings, MenuItem, ScreenEntry } from '../contract';
import { CustomColor } from './CustomColor';
import { check, confirm, DIM, menu, onOff, page, Row, TEXT, TextPage, u } from './parts';
import {
  LIBRARY_FILTERS, MAIN_MENU, resetMenu, resetPrefs, setMenuItem, useAppearance, useLibraryView, useMenuVisibility,
} from './prefs';

declare const __PAGE_BUILD__: string | undefined;
const BUILD = typeof __PAGE_BUILD__ === 'string' ? __PAGE_BUILD__ : 'dev';

const FILL: CSSProperties = { display: 'flex', flexDirection: 'column', height: '100%', color: TEXT };
const GROW: CSSProperties = { flex: 1, minHeight: 0 };
const to = (nav: ReturnType<typeof useNav>, e: ScreenEntry) => () => nav.push(e);
const header = (label: string): MenuItem => ({ id: 'h:' + label, label, header: true });
/** the rows shown: the gated ones dropped, then a header left with no row under it */
const shown = (items: (MenuItem | false)[]) => items.filter((x): x is MenuItem => !!x)
  .filter((x, i, a) => !x.header || (i + 1 < a.length && !a[i + 1]!.header));

function SettingsMenu() {
  const nav = useNav(), sh = useShell(), canLogout = useApp((s) => s.auth.canLogout);
  const [ip, patch] = useIpodSettings(), [theme] = useAppearance(), [view, setView] = useLibraryView();
  return <MenuScreen items={shown([
    header('Appearance'),
    { id: 'skin', label: 'Skin', right: 'iPod', chevron: true, onSelect: to(nav, menu('settings/skin', 'Skin', () => [
      { id: 'ipod', label: 'iPod', right: '✓' },
      { id: 'wmp9', label: 'Windows Media Player 9', onSelect: () => sh.store.getState().actions.setSettings({ skin: 'wmp9' }) }])) },
    { id: 'color', label: 'Color', right: <Swatch bg={swatch(ip)} />, chevron: true, onSelect: to(nav, page('settings/color', 'Color', Color)) },
    { id: 'wheel', label: 'Click Wheel', right: ip.wheel === 'black' ? 'Black' : 'White', onSelect: () => patch({ wheel: ip.wheel === 'black' ? 'white' : 'black' }) },
    { id: 'clicker', label: 'Clicker', right: onOff(ip.clicker), onSelect: () => patch({ clicker: !ip.clicker }) },
    // the host's light / dark (the iOS app's)
    !!window.alchemyAppearance && { id: 'theme', label: 'Theme', right: MODES.find(([m]) => m === theme)?.[1], chevron: true,
                                    onSelect: to(nav, page('settings/theme', 'Theme', Theme)) },

    header('Menus'),
    { id: 'main', label: 'Main Menu', chevron: true, onSelect: to(nav, page('settings/main', 'Main Menu', MainMenu)) },
    { id: 'music', label: 'Library Filters', chevron: true, onSelect: to(nav, page('settings/music', 'Library Filters', LibraryFilters)) },
    { id: 'view', label: 'Library View', right: view === 'list' ? 'List' : 'Grid', onSelect: () => setView(view === 'list' ? 'grid' : 'list') },

    header('General'),
    { id: 'about', label: 'About', chevron: true, onSelect: to(nav, page('settings/about', 'About', About)) },
    { id: 'updates', label: 'Check for Updates', chevron: true, onSelect: to(nav, page('settings/updates', 'Check for Updates', Updates)) },
    // The newest player from the site, in place: the music goes on (ios/WmpSpotify/observer.js alchemyRestart)
    !!window.alchemyRestart && { id: 'refresh', label: 'Refresh Player', onSelect: restartApp },
    { id: 'reset', label: 'Reset Settings', chevron: true,
      onSelect: to(nav, confirm('settings/reset', 'Reset Settings', 'Reset', (n) => { resetPrefs(); patch(DEFAULTS); n.pop(); })) },
    { id: 'legal', label: 'Legal', chevron: true, onSelect: to(nav, page('settings/legal', 'Legal', Legal)) },

    header('Support'),
    { id: 'repo', label: 'Source Code', onSelect: () => openLink(LINKS.repo) },
    { id: 'issues', label: 'Report a Problem', onSelect: () => openLink(LINKS.repo + '/issues') },
    // the iOS app's log sheet (the band that opens it is hidden under this skin)
    !!window.alchemyShowLog && { id: 'log', label: 'Host Log', onSelect: () => window.alchemyShowLog?.() },

    header('Account'),
    canLogout && { id: 'logout', label: 'Log Out', chevron: true,
                   onSelect: to(nav, confirm('settings/logout', 'Log Out', 'Log Out', (n) => { n.home(); void sh.store.getState().commands.logout(); })) },
  ])} />;
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

// ---- Main Menu, Library Filters -----------------------------------------------------------------------
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

const Legal = () => (
  <TextPage>
    <p style={{ margin: `0 0 ${u(8)}` }}><b>WMP Legacy Visualizers</b> is an independent open-source project.</p>
    <p style={{ margin: `0 0 ${u(8)}` }}>It is not affiliated with, endorsed by or sponsored by Apple Inc., Spotify AB or Microsoft Corporation.</p>
    <p style={{ margin: 0, color: DIM }}>iPod and iPod nano are trademarks of Apple Inc. Spotify is a trademark of Spotify AB. Windows Media Player is a trademark of Microsoft Corporation.</p>
  </TextPage>
);

// ---- Color --------------------------------------------------------------------------------------
/** the nine 5G colours in Apple's order (§1.2), the owner's two, then Custom */
const COLOR_ROWS: readonly (readonly [IpodSettings['color'], string])[] = [['silver', 'Silver'], ['black', 'Black'], ['purple', 'Purple'],
  ['blue', 'Blue'], ['green', 'Green'], ['yellow', 'Yellow'], ['orange', 'Orange'], ['pink', 'Pink'], ['red', '(PRODUCT) RED'],
  ['mocha', 'Mocha Tan'], ['espresso', 'Espresso Brown'], ['custom', 'Custom']];
/** a body colour as CSS, as the chrome's bodyVars draws it */
function swatch(s: IpodSettings, color = s.color): string {
  const [h, sat, l] = bodyHsl(s, color);
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
    onSelect: () => { patch({ color: id }); if (id === 'custom') nav.push(page('settings/color/custom', 'Custom', CustomColor)); },
  }))} />;
}

// ---- Theme, Check for Updates ------------------------------------------------------------------------

const MODES = [['light', 'Light'], ['dark', 'Dark'], ['auto', 'Automatic']] as const;
function Theme() {
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
