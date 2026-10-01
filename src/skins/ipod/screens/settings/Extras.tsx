// Extras, as the nano 5G lists them: Clock (world clocks), Calendar, Contacts, Fitness, Games, Notes,
// Screen Lock, Stopwatch. Contacts, Fitness and Notes are the iPod's own empty pages (nothing behind
// this player holds an address book, a pedometer or notes); the games are "Coming Soon".
import { useState, type CSSProperties, type ReactNode } from 'react';
import { MenuScreen, Popup, useNav, useWheel } from '../../ui';
import type { MenuItem, ScreenEntry } from '../contract';
import { cityOf, elapsed, fmtClock, fmtStopwatch, lapTimes, markLap, monthGrid, startStop, STOPWATCH0, zoneTime } from './logic';
import { BLUE, DIM, menu, nothing, page, TEXT, u, useNow } from './parts';
import { useClockPrefs, useClocks, useLockCode, useStopwatch } from './prefs';

const FILL: CSSProperties = { display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', color: TEXT, fontSize: u(14) };

// ---- Clock ---------------------------------------------------------------------------------------
/** the cities a clock can be added for ('' = this device's own zone) */
const ZONES: readonly (readonly [tz: string, city: string])[] = [
  ['', 'Local'], ['America/Los_Angeles', 'Los Angeles'], ['America/Chicago', 'Chicago'], ['America/New_York', 'New York'],
  ['America/Sao_Paulo', 'São Paulo'], ['Europe/London', 'London'], ['Europe/Paris', 'Paris'], ['Africa/Cairo', 'Cairo'],
  ['Asia/Dubai', 'Dubai'], ['Asia/Kolkata', 'Mumbai'], ['Asia/Shanghai', 'Beijing'], ['Asia/Tokyo', 'Tokyo'], ['Australia/Sydney', 'Sydney'],
];
const city = (tz: string) => (tz ? ZONES.find(([z]) => z === tz)?.[1] ?? cityOf(tz) : cityOf(''));

/** The nano's clock face: white by day, black by night, the red seconds hand. */
function Face({ h, m, s, night }: { h: number; m: number; s: number; night: boolean }) {
  const fg = night ? '#fff' : '#000';
  const hand = (deg: number, len: number, w: number, color = fg, tail = 0) =>
    <line x1="50" y1={50 + tail} x2="50" y2={50 - len} stroke={color} strokeWidth={w} strokeLinecap="round" transform={`rotate(${deg} 50 50)`} />;
  return (
    <svg viewBox="0 0 100 100" style={{ width: u(128), height: u(128), flex: 'none' }} aria-hidden="true">
      <circle cx="50" cy="50" r="48" fill={night ? '#000' : '#fff'} stroke="#9a9a9a" strokeWidth="2" />
      {Array.from({ length: 12 }, (_, k) => (
        <line key={k} x1="50" y1="7" x2="50" y2={k % 3 ? 11 : 15} stroke={fg} strokeWidth={k % 3 ? 1.5 : 3} transform={`rotate(${k * 30} 50 50)`} />
      ))}
      {hand((h % 12) * 30 + m / 2, 24, 4.5)}
      {hand(m * 6 + s / 10, 36, 3)}
      {hand(s * 6, 40, 1.2, '#e0242b', 10)}
      <circle cx="50" cy="50" r="2.6" fill="#e0242b" />
    </svg>
  );
}

/** One clock at a time; the wheel moves between them, centre offers Add and Delete. */
function Clock() {
  const [zones, setZones] = useClocks(), { twentyFourHour } = useClockPrefs(), now = useNow(1000);
  const [sel, setSel] = useState(0), [pop, setPop] = useState<'menu' | 'add' | null>(null);
  const at = Math.min(sel, zones.length - 1), tz = zones[at] ?? '', t = zoneTime(new Date(now), tz);
  useWheel({ onTick: (d) => setSel(Math.max(0, Math.min(zones.length - 1, at + d))), onCenter: () => setPop('menu') });
  const add: MenuItem[] = ZONES.filter(([z]) => !zones.includes(z)).map(([z, c]) => ({
    id: z || 'local', label: c, onSelect: () => { setZones([...zones, z]); setSel(zones.length); } }));
  const actions: MenuItem[] = [
    ...(add.length ? [{ id: 'add', label: 'Add', onSelect: () => setPop('add') }] : []),
    ...(zones.length > 1 ? [{ id: 'delete', label: 'Delete', onSelect: () => { setZones(zones.filter((_, k) => k !== at)); setSel(Math.max(0, at - 1)); } }] : []),
  ];
  return (
    <div style={{ ...FILL, justifyContent: 'center', gap: u(6) }}>
      <div style={{ fontWeight: 'bold', fontSize: u(16) }}>{city(tz)}</div>
      <Face h={t.h} m={t.m} s={t.s} night={t.h < 6 || t.h >= 18} />
      <div style={{ fontSize: u(18), fontWeight: 'bold' }}>{fmtClock(t.h, t.m, twentyFourHour)}</div>
      <div style={{ color: DIM, fontSize: u(12) }}>{t.date}</div>
      {zones.length > 1 && (
        <div style={{ display: 'flex', gap: u(5) }}>
          {zones.map((z, k) => <span key={z} style={{ width: u(5), height: u(5), borderRadius: '50%', background: k === at ? TEXT : DIM, opacity: k === at ? 1 : 0.4 }} />)}
        </div>
      )}
      {pop === 'menu' && <Popup items={actions} onClose={() => setPop(null)} />}
      {pop === 'add' && <Popup items={add} onClose={() => setPop(null)} />}
    </div>
  );
}

// ---- Calendar ------------------------------------------------------------------------------------
/** The month; the wheel moves the day, previous / next the month, centre opens the day. */
function Calendar() {
  const nav = useNav(), now = new Date(useNow(60_000));
  const [day, setDay] = useState(() => new Date(now.getFullYear(), now.getMonth(), now.getDate()));
  const y = day.getFullYear(), m = day.getMonth(), d = day.getDate();
  const month = (k: number) => setDay(new Date(y, m + k, Math.min(d, new Date(y, m + k + 1, 0).getDate())));
  useWheel({
    onTick: (k) => setDay(new Date(y, m, d + k)), onPrev: () => month(-1), onNext: () => month(1),
    onCenter: () => nav.push(nothing('extras/calendar/day', day.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }), 'No Events')),
  });
  const today = now.getFullYear() === y && now.getMonth() === m ? now.getDate() : 0;
  return (
    <div style={{ ...FILL, alignItems: 'stretch', padding: u(6) }}>
      <div style={{ textAlign: 'center', fontWeight: 'bold', marginBottom: u(4) }}>{day.toLocaleDateString([], { month: 'long', year: 'numeric' })}</div>
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', alignItems: 'center', textAlign: 'center', fontSize: u(13) }}>
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((w, i) => <div key={'w' + i} style={{ color: DIM, fontSize: u(11) }}>{w}</div>)}
        {monthGrid(y, m).map((n, i) => (
          <div key={i} style={n === d ? { background: BLUE, color: '#fff', borderRadius: u(3), fontWeight: 'bold' }
                              : n && n === today ? { fontWeight: 'bold', boxShadow: `inset 0 0 0 ${u(1)} ${BLUE}`, borderRadius: u(3) } : undefined}>
            {n || ''}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- Stopwatch -----------------------------------------------------------------------------------
/** As the nano: play/pause starts and stops; centre starts it, marks a lap while it runs, and
 *  resets it while stopped. Kept in localStorage, so it runs on with its screen closed. */
function Stopwatch() {
  const [w, set] = useStopwatch(), running = w.start != null, now = Math.max(useNow(41, running), w.start ?? 0);
  useWheel({
    onPlay: () => set(startStop(w, Date.now())),
    onCenter: () => set(running ? markLap(w, Date.now()) : w.acc ? STOPWATCH0 : startStop(w, Date.now())),
  });
  const laps = lapTimes(w, now), mono: CSSProperties = { fontVariantNumeric: 'tabular-nums' };
  return (
    <div style={{ ...FILL, alignItems: 'stretch', padding: `${u(8)} ${u(12)}` }}>
      <div style={{ ...mono, textAlign: 'center', fontSize: u(30), fontWeight: 'bold' }}>{fmtStopwatch(elapsed(w, now))}</div>
      <div style={{ ...mono, display: 'flex', justifyContent: 'space-between', color: BLUE, margin: `${u(4)} 0` }}>
        <span>Lap {w.laps.length + 1}</span><span>{fmtStopwatch(laps[0] ?? 0)}</span>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', fontSize: u(13) }}>
        {laps.slice(1).map((ms, i) => (
          <div key={i} style={{ ...mono, display: 'flex', justifyContent: 'space-between', padding: `${u(2)} 0`, borderTop: `${u(1)} solid rgba(0,0,0,.1)` }}>
            <span>Lap {w.laps.length - i}</span><span>{fmtStopwatch(ms)}</span>
          </div>
        ))}
      </div>
      <div style={{ color: DIM, fontSize: u(11), textAlign: 'center' }}>
        {running ? 'Center: lap · Play/Pause: stop' : w.acc ? 'Center: reset · Play/Pause: resume' : 'Center or Play/Pause: start'}
      </div>
    </div>
  );
}

// ---- Screen Lock ---------------------------------------------------------------------------------
/** Four digits: the wheel turns the lit one, centre moves on; after the fourth, `onDone`. */
function Dial({ caption, onDone }: { caption: ReactNode; onDone: (code: string) => void }) {
  const [digits, setDigits] = useState([0, 0, 0, 0]), [at, setAt] = useState(0);
  useWheel({
    onTick: (d) => setDigits(digits.map((x, i) => (i === at ? (x + d + 10) % 10 : x))),
    onCenter: () => {
      if (at < 3) { setAt(at + 1); return; }
      setDigits([0, 0, 0, 0]); setAt(0);
      onDone(digits.join(''));
    },
  });
  return (
    <div style={{ ...FILL, justifyContent: 'center', gap: u(14) }}>
      <svg viewBox="0 0 24 28" style={{ width: u(34), height: u(40) }} aria-hidden="true">
        <path d="M6 12V8a6 6 0 0 1 12 0v4" fill="none" stroke={DIM} strokeWidth="3" />
        <rect x="2" y="12" width="20" height="15" rx="2.5" fill={TEXT} />
      </svg>
      <div style={{ display: 'flex', gap: u(8) }}>
        {digits.map((x, i) => (
          <span key={i} style={{ width: u(30), height: u(38), display: 'grid', placeItems: 'center', fontSize: u(22), fontWeight: 'bold', borderRadius: u(4),
                                 boxShadow: `inset 0 0 0 ${u(1)} ${DIM}`, background: i === at ? BLUE : 'transparent', color: i === at ? '#fff' : TEXT }}>{x}</span>
        ))}
      </div>
      <div style={{ color: DIM, fontSize: u(12) }}>{caption}</div>
    </div>
  );
}

/** Locked until the combination is dialled: MENU does nothing meanwhile. */
function Locked() {
  const nav = useNav(), [code] = useLockCode(), [wrong, setWrong] = useState(false);
  useWheel({ onMenu: () => true });
  return <Dial caption={wrong ? 'Wrong combination' : 'Enter combination'} onDone={(c) => { if (c === code) nav.pop(); else setWrong(true); }} />;
}
function SetCombination() {
  const nav = useNav(), [, set] = useLockCode();
  return <Dial caption="Choose a combination" onDone={(c) => { set(c); nav.pop(); }} />;
}

const GAMES = ['Brick', 'Klondike', 'Maze', 'Music Quiz', 'Vortex'];

function ExtrasMenu() {
  const nav = useNav(), go = (e: ScreenEntry) => () => nav.push(e);
  return <MenuScreen items={[
    { id: 'clock', label: 'Clock', chevron: true, onSelect: go(page('extras/clock', 'Clock', Clock)) },
    { id: 'calendar', label: 'Calendar', chevron: true, onSelect: go(page('extras/calendar', 'Calendar', Calendar)) },
    { id: 'contacts', label: 'Contacts', chevron: true, onSelect: go(nothing('extras/contacts', 'Contacts', 'No Contacts')) },
    { id: 'fitness', label: 'Fitness', chevron: true, onSelect: go(nothing('extras/fitness', 'Fitness', 'No Pedometer')) },
    { id: 'games', label: 'Games', chevron: true, onSelect: go(menu('extras/games', 'Games', (n) => GAMES.map((g) => ({
      id: g, label: g, chevron: true, onSelect: () => n.push(nothing('extras/games/' + g, g, 'Coming Soon')) })))) },
    { id: 'notes', label: 'Notes', chevron: true, onSelect: go(nothing('extras/notes', 'Notes', 'No Notes')) },
    { id: 'lock', label: 'Screen Lock', chevron: true, onSelect: go(menu('extras/lock', 'Screen Lock', (n) => [
      { id: 'lock', label: 'Lock', onSelect: () => n.push(page('extras/lock/locked', 'Screen Lock', Locked)) },
      { id: 'set', label: 'Set Combination', chevron: true, onSelect: () => n.push(page('extras/lock/set', 'Set Combination', SetCombination)) }])) },
    { id: 'stopwatch', label: 'Stopwatch', chevron: true, onSelect: go(page('extras/stopwatch', 'Stopwatch', Stopwatch)) },
  ]} />;
}

export const extras = (): ScreenEntry => page('extras', 'Extras', ExtrasMenu);
