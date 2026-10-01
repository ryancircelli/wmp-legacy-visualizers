// Extras, as the nano 5G lists them (docs/ipod-skin.md §2.3, alphabetical): Alarms, Calendars,
// Clocks, Contacts, Fitness, Games, Notes, Screen Lock, Stopwatch, Voice Memos. Alarms, Calendars,
// Clocks, Notes, Screen Lock and Stopwatch work (§2.4 Extras); Contacts, Fitness and Voice Memos are
// the iPod's own empty pages (nothing behind this player holds an address book, steps or a
// microphone), and the games are "Coming Soon".
import { useState, type CSSProperties, type ReactNode } from 'react';
import { MenuScreen, Popup, useNav, useWheel } from '../../ui';
import type { MenuItem, Nav, ScreenEntry } from '../contract';
import {
  cityOf, elapsed, fmtClock, fmtLeft, fmtStopwatch, lapStats, lapTimes, logOf, markLap, monthGrid, startStop, STOPWATCH0, zoneTime, type StopwatchLog,
} from './logic';
import { BLUE, check, DIM, menu, nothing, onOff, page, SEL_BG, TEXT, TextPage, u, useNow } from './parts';
import { SLEEP0, useAlarm, useClockPrefs, useClocks, useLockCode, useSleepTimer, useStopwatch, useStopwatchLogs } from './prefs';

const FILL: CSSProperties = { display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', color: TEXT, fontSize: u(14) };
const mono: CSSProperties = { fontVariantNumeric: 'tabular-nums' };

// ---- Alarms ----------------------------------------------------------------------------------------
/** Alarms [UG p.78]: one alarm that plays at a time each day, and the Sleep Timer that pauses (both
 *  run from useSettingsEffects, so they keep time on any screen). */
function AlarmsMenu() {
  const nav = useNav(), [alarm] = useAlarm(), [sleep] = useSleepTimer(), { twentyFourHour } = useClockPrefs();
  const now = useNow(1000, sleep.at != null);
  return <MenuScreen items={[
    { id: 'alarm', label: 'Alarm', right: alarm.on ? fmtClock(alarm.h, alarm.m, twentyFourHour) : 'Off', chevron: true,
      onSelect: () => nav.push(page('extras/alarms/alarm', 'Alarm', Alarm)) },
    { id: 'sleep', label: 'Sleep Timer', right: sleep.at != null ? fmtLeft(sleep.at - now) : 'Off', chevron: true,
      onSelect: () => nav.push(page('extras/alarms/sleep', 'Sleep Timer', SleepTimer)) },
  ]} />;
}

function Alarm() {
  const nav = useNav(), [a, set] = useAlarm(), { twentyFourHour } = useClockPrefs();
  return <MenuScreen items={[
    { id: 'on', label: 'Alarm', right: onOff(a.on), onSelect: () => set({ ...a, on: !a.on }) },
    { id: 'time', label: 'Time', right: fmtClock(a.h, a.m, twentyFourHour), chevron: true, onSelect: () => nav.push(page('extras/alarms/time', 'Time', AlarmTime)) },
  ]} />;
}

/** The hour then the minute, each turned by the wheel; ⏮⏭ move between them; centre on the minute
 *  sets the alarm (and turns it on). */
function AlarmTime() {
  const nav = useNav(), [a, set] = useAlarm(), { twentyFourHour } = useClockPrefs();
  const [hm, setHm] = useState([a.h, a.m] as const), [at, setAt] = useState(0), [h, m] = hm;
  useWheel({
    onTick: (d) => setHm(at ? [h, (m + d + 60) % 60] : [(h + d + 24) % 24, m]),
    onPrev: () => setAt(0), onNext: () => setAt(1),
    onCenter: () => { if (!at) { setAt(1); return; } set({ on: true, h, m }); nav.pop(); },
  });
  const cells = [twentyFourHour ? String(h) : String((h % 12) || 12), String(m).padStart(2, '0')];
  return (
    <div style={{ ...FILL, justifyContent: 'center', gap: u(12) }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: u(6), fontSize: u(26), fontWeight: 'bold' }}>
        {cells.map((c, i) => (
          <span key={i} style={{ ...mono, minWidth: u(46), padding: `${u(4)} 0`, textAlign: 'center', borderRadius: u(4), boxShadow: `inset 0 0 0 1px ${DIM}`,
                                 ...(i === at ? { background: SEL_BG, color: '#fff' } : {}) }}>{c}</span>
        ))}
        {!twentyFourHour && <span style={{ fontSize: u(16) }}>{h < 12 ? 'AM' : 'PM'}</span>}
      </div>
      <div style={{ color: DIM, fontSize: u(12) }}>{at ? 'Minute' : 'Hour'}</div>
    </div>
  );
}

/** Sleep Timer [UG p.78]: Off, 15–120 minutes; checks the running choice. */
function SleepTimer() {
  const [s, set] = useSleepTimer();
  return <MenuScreen items={[0, 15, 30, 60, 90, 120].map((n) => ({
    id: String(n), label: n ? n + ' Minutes' : 'Off', right: check(n ? s.at != null && s.mins === n : s.at == null),
    onSelect: () => set(n ? { at: Date.now() + n * 60_000, mins: n } : SLEEP0) }))} />;
}

export const alarms = (): ScreenEntry => page('extras/alarms', 'Alarms', AlarmsMenu);

// ---- Clocks --------------------------------------------------------------------------------------
/** the cities a clock can be added for, by region (UG p.77: Add, a region, then a city) */
const ZONES: readonly (readonly [tz: string, city: string])[] = [
  ['America/Los_Angeles', 'Los Angeles'], ['America/Chicago', 'Chicago'], ['America/New_York', 'New York'], ['America/Sao_Paulo', 'São Paulo'],
  ['Europe/London', 'London'], ['Europe/Paris', 'Paris'], ['Africa/Cairo', 'Cairo'], ['Asia/Dubai', 'Dubai'], ['Asia/Kolkata', 'Mumbai'],
  ['Asia/Shanghai', 'Beijing'], ['Asia/Tokyo', 'Tokyo'], ['Australia/Sydney', 'Sydney'],
];
const REGIONS = [...new Set(ZONES.map(([z]) => z.split('/')[0]!))];
const city = (tz: string) => (tz ? ZONES.find(([z]) => z === tz)?.[1] ?? cityOf(tz) : cityOf(''));

/** The nano's clock face, 180 across: white by day, black by night, the red seconds hand. */
function Face({ h, m, s, night }: { h: number; m: number; s: number; night: boolean }) {
  const fg = night ? '#fff' : '#000';
  const hand = (deg: number, len: number, w: number, color = fg, tail = 0) =>
    <line x1="50" y1={50 + tail} x2="50" y2={50 - len} stroke={color} strokeWidth={w} strokeLinecap="round" transform={`rotate(${deg} 50 50)`} />;
  return (
    <svg viewBox="0 0 100 100" style={{ width: u(180), height: u(180), flex: 'none' }} aria-hidden="true">
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

/** The cities, each with its time at the right; a city opens its face. */
function Clocks() {
  const nav = useNav(), [zones] = useClocks(), { twentyFourHour } = useClockPrefs(), now = new Date(useNow(1000));
  return <MenuScreen items={zones.map((tz): MenuItem => {
    const t = zoneTime(now, tz);
    return { id: tz || 'local', label: city(tz), right: fmtClock(t.h, t.m, twentyFourHour), chevron: true,
             onSelect: () => nav.push({ key: 'extras/clocks/face', title: city(tz), render: () => <ClockFace tz={tz} /> }) };
  })} />;
}

/** One city's face; centre offers Add (a region, then a city) and Delete (not this device's own). */
function ClockFace({ tz }: { tz: string }) {
  const nav = useNav(), [zones, setZones] = useClocks(), { twentyFourHour } = useClockPrefs(), [pop, setPop] = useState(false);
  const t = zoneTime(new Date(useNow(1000)), tz);
  useWheel({ onCenter: () => setPop(true) });
  const items: MenuItem[] = [
    { id: 'add', label: 'Add', chevron: true, onSelect: () => nav.push(menu('extras/clocks/add', 'Add', (n) => REGIONS.map((r) => ({
      id: r, label: r, chevron: true, onSelect: () => n.push(page('extras/clocks/add/' + r, r, () => <Cities region={r} />)) })))) },
    ...(tz ? [{ id: 'delete', label: 'Delete', onSelect: () => { setZones(zones.filter((z) => z !== tz)); nav.pop(); } }] : []),
    { id: 'cancel', label: 'Cancel' },
  ];
  return (
    <div style={{ ...FILL, justifyContent: 'center', gap: u(6) }}>
      <div style={{ fontWeight: 'bold', fontSize: u(16) }}>{city(tz)}</div>
      <Face h={t.h} m={t.m} s={t.s} night={t.h < 6 || t.h >= 18} />
      <div style={{ fontSize: u(18), fontWeight: 'bold' }}>{fmtClock(t.h, t.m, twentyFourHour)}</div>
      <div style={{ color: DIM, fontSize: u(12) }}>{t.date}</div>
      {pop && <Popup items={items} onClose={() => setPop(false)} />}
    </div>
  );
}

/** a region's cities not yet on the list; a pick adds it and goes back to Clocks */
function Cities({ region }: { region: string }) {
  const nav = useNav(), [zones, setZones] = useClocks();
  return <MenuScreen empty="No Cities" items={ZONES.filter(([z]) => z.startsWith(region + '/') && !zones.includes(z)).map(([z, c]) => ({
    id: z, label: c, onSelect: () => { setZones([...zones, z]); nav.pop(); nav.pop(); nav.pop(); } }))} />;
}

// ---- Calendars -----------------------------------------------------------------------------------
/** The month (§2.4: 7 columns 28 wide, today ringed blue); the wheel moves the day, ⏮⏭ the month
 *  [UG p.73], centre opens the day. */
function Calendar() {
  const nav = useNav(), now = new Date(useNow(60_000));
  const [day, setDay] = useState(() => new Date(now.getFullYear(), now.getMonth(), now.getDate()));
  const y = day.getFullYear(), m = day.getMonth(), d = day.getDate();
  const month = (k: number) => setDay(new Date(y, m + k, Math.min(d, new Date(y, m + k + 1, 0).getDate())));
  useWheel({
    onTick: (k) => setDay(new Date(y, m, d + k)), onPrev: () => month(-1), onNext: () => month(1),
    onCenter: () => nav.push(nothing('extras/calendars/day', day.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }), 'No events')),
  });
  const today = now.getFullYear() === y && now.getMonth() === m ? now.getDate() : 0;
  return (
    <div style={{ ...FILL, padding: u(6) }}>
      <div style={{ fontWeight: 'bold', marginBottom: u(4) }}>{day.toLocaleDateString([], { month: 'long', year: 'numeric' })}</div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(7, ${u(28)})`, gridAutoRows: u(28), alignItems: 'center', textAlign: 'center', fontSize: u(13) }}>
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((w, i) => <div key={'w' + i} style={{ color: DIM, fontSize: u(12) }}>{w}</div>)}
        {monthGrid(y, m).map((n, i) => (
          <div key={i} style={n === d ? { background: SEL_BG, color: '#fff', borderRadius: u(3), fontWeight: 'bold' }
                              : n && n === today ? { fontWeight: 'bold', boxShadow: `inset 0 0 0 ${u(1.5)} ${BLUE}`, borderRadius: '50%' } : undefined}>
            {n || ''}
          </div>
        ))}
      </div>
      <div style={{ color: DIM, fontSize: u(12), marginTop: u(8) }}>No events</div>
    </div>
  );
}

// ---- Stopwatch -----------------------------------------------------------------------------------
/** The timer [UG p.79]: Play/Pause starts and stops, centre marks a lap while it runs (starts it while
 *  stopped); the two most recent laps above the time. MENU opens the Stopwatch menu (Timer, New
 *  Timer, the logs). Kept in localStorage, so it runs on with its screen closed. */
function Timer() {
  const nav = useNav(), [w, set] = useStopwatch(), running = w.start != null, now = Math.max(useNow(41, running), w.start ?? 0);
  useWheel({
    onPlay: () => set(startStop(w, Date.now())),
    onCenter: () => set(running ? markLap(w, Date.now()) : startStop(w, Date.now())),
    onMenu: () => { nav.replace(stopwatchMenu()); return true; },
  });
  // newest first, the running lap first of all; numbered from the oldest
  const laps = w.laps.length ? lapTimes(w, now).slice(0, 2).map((ms, i) => [w.laps.length + 1 - i, ms] as const).reverse() : [];
  return (
    <div style={{ ...FILL, ...mono, justifyContent: 'center', gap: u(4) }}>
      {laps.map(([n, ms]) => (
        <div key={n} style={{ display: 'flex', justifyContent: 'space-between', width: u(170), fontSize: u(16), color: DIM }}>
          <span>Lap {n}</span><span>{fmtStopwatch(ms)}</span>
        </div>
      ))}
      <div style={{ fontSize: u(40), fontWeight: 'bold' }}>{fmtStopwatch(elapsed(w, now))}</div>
    </div>
  );
}
const timer = (): ScreenEntry => page('extras/stopwatch', 'Stopwatch', Timer);

const when = (ms: number) => new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** The Stopwatch menu: Timer (back to the one running), New Timer (this one logged, a fresh one),
 *  each log by its start, Clear Logs. It replaces the timer, so MENU here goes back to Extras. */
function StopwatchMenu() {
  const nav = useNav(), [w, set] = useStopwatch(), [logs, setLogs] = useStopwatchLogs();
  const items: MenuItem[] = [
    ...(w.began != null ? [{ id: 'timer', label: 'Timer', chevron: true, onSelect: () => nav.replace(timer()) }] : []),
    { id: 'new', label: 'New Timer', chevron: true, onSelect: () => {
      const l = logOf(w, Date.now());
      if (l) setLogs([l, ...logs]);
      set(STOPWATCH0);
      nav.replace(timer());
    } },
    ...logs.map((l): MenuItem => ({ id: 'log' + l.began, label: when(l.began), right: fmtStopwatch(l.total), chevron: true,
                                    onSelect: () => nav.push({ key: 'extras/stopwatch/log', title: when(l.began), render: () => <Log l={l} /> }) })),
    ...(logs.length ? [{ id: 'clear', label: 'Clear Logs', onSelect: () => setLogs([]) }] : []),
  ];
  return <MenuScreen items={items} />;
}
const stopwatchMenu = (): ScreenEntry => page('extras/stopwatch/menu', 'Stopwatch', StopwatchMenu);

/** A log: start, total, shortest / longest / average lap, each lap, Delete Log. */
function Log({ l }: { l: StopwatchLog }) {
  const nav = useNav(), [logs, setLogs] = useStopwatchLogs(), s = lapStats(l.laps);
  const row = (id: string, label: string, right: string): MenuItem => ({ id, label, right });
  return <MenuScreen items={[
    row('start', 'Start', when(l.began)), row('total', 'Total', fmtStopwatch(l.total)),
    row('short', 'Shortest Lap', fmtStopwatch(s.shortest)), row('long', 'Longest Lap', fmtStopwatch(s.longest)),
    row('avg', 'Average Lap', fmtStopwatch(s.average)),
    ...l.laps.map((ms, i) => row('lap' + i, 'Lap ' + (i + 1), fmtStopwatch(ms))),
    { id: 'delete', label: 'Delete Log', onSelect: () => { setLogs(logs.filter((x) => x.began !== l.began)); nav.pop(); } },
  ]} />;
}

// ---- Screen Lock ---------------------------------------------------------------------------------
/** Four digits [UG p.80]: the wheel turns the lit one, ⏮⏭ move between them, centre moves on; after
 *  the fourth, `onDone`. Blue-grey, a padlock, the caption under the digits (screenshot p.78). */
function Tumbler({ caption, onDone }: { caption: ReactNode; onDone: (code: string) => void }) {
  const [digits, setDigits] = useState([0, 0, 0, 0]), [at, setAt] = useState(0);
  useWheel({
    onTick: (d) => setDigits(digits.map((x, i) => (i === at ? (x + d + 10) % 10 : x))),
    onPrev: () => setAt(Math.max(0, at - 1)), onNext: () => setAt(Math.min(3, at + 1)),
    onCenter: () => { if (at < 3) setAt(at + 1); else onDone(digits.join('')); },
  });
  return (
    <div style={{ ...FILL, justifyContent: 'center', gap: u(14), color: '#fff', background: 'linear-gradient(#9fb0c4, #5e6f84)' }}>
      <svg viewBox="0 0 24 28" style={{ width: u(40), height: u(46) }} aria-hidden="true">
        <path d="M6 12V8a6 6 0 0 1 12 0v4" fill="none" stroke="#e8edf3" strokeWidth="3" />
        <rect x="2" y="12" width="20" height="15" rx="2.5" fill="#f4f6f9" /><circle cx="12" cy="19" r="2" fill="#5e6f84" />
      </svg>
      <div style={{ display: 'flex', gap: u(8) }}>
        {digits.map((x, i) => (
          <span key={i} style={{ width: u(30), height: u(38), display: 'grid', placeItems: 'center', fontSize: u(22), fontWeight: 'bold', borderRadius: u(4),
                                 background: i === at ? SEL_BG : 'rgb(255 255 255 / .9)', color: i === at ? '#fff' : '#000' }}>{x}</span>
        ))}
      </div>
      <div style={{ fontSize: u(14), fontWeight: 'bold' }}>{caption}</div>
    </div>
  );
}

const CAPTION = { new: 'New Combination', confirm: 'Confirm Combination', enter: 'Enter Combination' } as const;
type Step = keyof typeof CAPTION;

/** Lock: with no combination yet, a new one (twice), then locked: "Enter Combination" until it is
 *  dialled, MENU doing nothing meanwhile. Reset Combination: the old one first (if any), then a new
 *  one twice. A wrong combination warns and starts that step over. */
function LockFlow({ reset }: { reset: boolean }) {
  const nav = useNav(), [code, setCode] = useLockCode(), [step, setStep] = useState<Step>(code ? 'enter' : 'new');
  const [draft, setDraft] = useState(''), [tries, setTries] = useState(0);
  const locked = !reset && step === 'enter';
  useWheel({ onMenu: () => locked });
  const wrong = () => { window.alchemyHaptic?.('warning'); setTries(tries + 1); };
  const done = (c: string) => {
    if (step === 'new') { setDraft(c); setStep('confirm'); }
    else if (step === 'confirm') {
      if (c !== draft) { wrong(); setStep('new'); return; }
      setCode(c);
      if (reset) nav.pop(); else setStep('enter');
    } else if (c !== code) wrong();
    else if (reset) setStep('new');
    else nav.pop();
  };
  return <Tumbler key={step + tries} caption={CAPTION[step]} onDone={done} />;
}
const lock = (reset: boolean): ScreenEntry =>
  ({ key: 'extras/lock/' + (reset ? 'reset' : 'lock'), title: 'Screen Lock', render: () => <LockFlow reset={reset} /> });

// ---- Notes ---------------------------------------------------------------------------------------
const ReadMe = () => (
  <TextPage>
    <p style={{ margin: `0 0 ${u(8)}` }}><b>The Click Wheel.</b> Turn it to move; press the center to choose; hold the center for a song's
      menu; MENU goes back, held it goes to the main menu. Play/Pause plays the row you are on (a playlist or album whole); held, it
      sleeps. ⏮ and ⏭ change songs; held, they scan.</p>
    <p style={{ margin: `0 0 ${u(8)}` }}><b>On Spotify.</b> Music is your library: Playlists starts with On-The-Go (what plays next),
      Songs are your Liked Songs, Artists come from your liked songs and saved albums, and Genius Mixes are Spotify Home. Photos is
      your cover art, Radio is Spotify's stations on the FM dial, and Search types a letter at a time (⏭ a space, ⏮ deletes).</p>
    <p style={{ margin: 0 }}><b>Settings.</b> Play On picks the device Spotify plays on; Lyrics and Karaoke are Now Playing's; Color
      and Click Wheel dress the iPod; Skin goes back to Windows Media Player 9.</p>
  </TextPage>
);

// ---- the menu ------------------------------------------------------------------------------------
function ExtrasMenu() {
  const nav = useNav(), go = (e: ScreenEntry) => () => nav.push(e);
  const empty = (id: string, label: string, text: string): MenuItem =>
    ({ id, label, chevron: true, onSelect: go(nothing('extras/' + id, label, text)) });
  return <MenuScreen items={[
    { id: 'alarms', label: 'Alarms', chevron: true, onSelect: go(alarms()) },
    { id: 'calendars', label: 'Calendars', chevron: true, onSelect: go(page('extras/calendars', 'Calendars', Calendar)) },
    { id: 'clocks', label: 'Clocks', chevron: true, onSelect: go(page('extras/clocks', 'Clocks', Clocks)) },
    empty('contacts', 'Contacts', 'No Contacts'),
    empty('fitness', 'Fitness', 'No Pedometer'),
    { id: 'games', label: 'Games', chevron: true, onSelect: go(menu('extras/games', 'Games', (n: Nav) => ['Klondike', 'Maze', 'Vortex'].map((g) => ({
      id: g, label: g, chevron: true, onSelect: () => n.push(nothing('extras/games/' + g, g, 'Coming Soon')) })))) },
    { id: 'notes', label: 'Notes', chevron: true, onSelect: go(menu('extras/notes', 'Notes', (n) => [
      { id: 'readme', label: 'Read Me', chevron: true, onSelect: () => n.push(page('extras/notes/readme', 'Read Me', ReadMe)) }])) },
    { id: 'lock', label: 'Screen Lock', chevron: true, onSelect: go(menu('extras/lock', 'Screen Lock', (n) => [
      { id: 'lock', label: 'Lock', onSelect: () => n.push(lock(false)) },
      { id: 'reset', label: 'Reset Combination', chevron: true, onSelect: () => n.push(lock(true)) }])) },
    { id: 'stopwatch', label: 'Stopwatch', chevron: true, onSelect: go(timer()) },
    empty('voicememos', 'Voice Memos', 'No Voice Memos'),
  ]} />;
}

export const extras = (): ScreenEntry => page('extras', 'Extras', ExtrasMenu);
