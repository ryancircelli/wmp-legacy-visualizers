// The skin's glyphs, drawn here as SVG in currentColor: iTunes 10's monochrome source icons, the
// transport and bottom-bar glyphs, the view switcher's four, the caption buttons. Nothing of Apple's
// artwork is copied (a public repo); each is a plain drawing of what the 2010 captures show
// (docs/itunes-skin.md §Icons). 16×16 unless the name says otherwise.
import type { CSSProperties } from 'react';

const P = {
  // sources
  music: 'M6 2.5 13.5 1v10.2a2.3 1.9 0 1 1-1.4-1.75V4.3L7.4 5.3v7.9A2.3 1.9 0 1 1 6 11.45Z',
  podcast: 'M8 6.2a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2Zm-.9 4.3h1.8l.5 4.5H6.6ZM8 1.5a6.3 6.3 0 0 1 3.7 11.4l-.5-1.2a5 5 0 1 0-6.4 0l-.5 1.2A6.3 6.3 0 0 1 8 1.5Zm0 2.4a3.9 3.9 0 0 1 2.6 6.8l-.5-1.1a2.7 2.7 0 1 0-4.2 0l-.5 1.1A3.9 3.9 0 0 1 8 3.9Z',
  radio: 'M7.3 6.5h1.4l3 8.5h-1.4L9.6 13H6.4l-.7 2H4.3Zm.7 2.1L6.9 11.8h2.2ZM8 3.6a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8ZM4.2 2.2l1 .8a3.9 3.9 0 0 0 0 4l-1 .8a5.2 5.2 0 0 1 0-5.6Zm7.6 0a5.2 5.2 0 0 1 0 5.6l-1-.8a3.9 3.9 0 0 0 0-4ZM2.3.9l1 .8a6.7 6.7 0 0 0 0 6.6l-1 .8a8 8 0 0 1 0-8.2Zm11.4 0a8 8 0 0 1 0 8.2l-1-.8a6.7 6.7 0 0 0 0-6.6Z',
  store: 'M3 5h10l.7 9.5H2.3Zm2.3 0a2.7 2.7 0 0 1 5.4 0h-1.2a1.5 1.5 0 0 0-3 0Z',
  search: 'M6.5 1.5a5 5 0 0 1 4.05 7.93l3.96 3.96-1.12 1.12-3.96-3.96A5 5 0 1 1 6.5 1.5Zm0 1.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z',
  genius: 'M8 6.6a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8ZM8 1c1.6 0 2.4 3.1 2.4 7S9.6 15 8 15 5.6 11.9 5.6 8 6.4 1 8 1Zm0 1.1c-.6 0-1.3 2.4-1.3 5.9s.7 5.9 1.3 5.9 1.3-2.4 1.3-5.9S8.6 2.1 8 2.1ZM1.9 4.5c.8-1.4 3.9-.5 7.3 1.5s5.7 4.2 4.9 5.5-3.9.5-7.3-1.5S1.1 5.8 1.9 4.5Zm1 .5c-.3.5 1.5 2.3 4.5 4s5.4 2.4 5.7 1.9-1.5-2.3-4.5-4S3.2 4.5 2.9 5Zm11.2-.5c.8 1.4-1.5 3.6-4.9 5.5s-6.5 2.9-7.3 1.5 1.5-3.5 4.9-5.5 6.5-2.9 7.3-1.5Zm-1 .5c-.3-.5-2.7.2-5.7 1.9s-4.8 3.5-4.5 4 2.7-.2 5.7-1.9 4.8-3.5 4.5-4Z',
  mixes: 'M1.5 1.5h5.6v5.6H1.5Zm7.4 0h5.6v5.6H8.9ZM1.5 8.9h5.6v5.6H1.5Zm7.4 0h5.6v5.6H8.9Z',
  dj: 'M2 2h9v1.4H2Zm0 3h9v1.4H2Zm0 3h5v1.4H2Zm9.2.3 3.3 2.2-3.3 2.2v-1.4H8.5V9.7h2.7Zm-2.9 3.4H2v1.4h6.3Z',
  // the phone's library shortcuts: an album (a sleeve with its record half out), an artist (a head and shoulders)
  album: 'M1.5 3h8.5v10H1.5Zm1.2 1.2v7.6h6.1V4.2ZM11 3.6a4.4 4.4 0 0 1 0 8.8V11a3 3 0 0 0 0-6Zm0 3.2a1.2 1.2 0 1 1 0 2.4Z',
  artist: 'M8 1.8a3.1 3.1 0 1 1 0 6.2 3.1 3.1 0 0 1 0-6.2Zm0 7.2c3.3 0 5.6 1.7 5.9 5.2H2.1C2.4 10.7 4.7 9 8 9Z',
  smart: 'M7 1h2l.3 1.9 1.3.6 1.6-1.1 1.4 1.4-1.1 1.6.6 1.3L15 7v2l-1.9.3-.6 1.3 1.1 1.6-1.4 1.4-1.6-1.1-1.3.6L9 15H7l-.3-1.9-1.3-.6-1.6 1.1-1.4-1.4 1.1-1.6-.6-1.3L1 9V7l1.9-.3.6-1.3-1.1-1.6 1.4-1.4 1.6 1.1 1.3-.6Zm1 4.4a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2Z',
  playlist: 'M2.5 1.5h11v13h-11Zm1.3 1.3v10.4h8.4V2.8Zm1.5 1.5h5.4v1.1H5.3Zm0 2.3h5.4v1.1H5.3Zm3.6 2.2.1 2.9a1.1.9 0 1 1-.7-.8V8.8l1.6-.4v.9Z',
  pc: 'M1.5 2.5h13v8.5h-13Zm1.2 1.2v6.1h10.6V3.7ZM6 12h4l.5 1.6h1.8V15H3.7v-1.4h1.8Z',
  phone: 'M4.5 1h7a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1Zm.3 1.6v9.6h6.4V2.6ZM8 12.6a.7.7 0 1 1 0 1.4.7.7 0 0 1 0-1.4Z',
  tv: 'M1 3h14v8.6H1Zm1.2 1.2v6.2h11.6V4.2ZM5.5 12.6h5v1.4h-5Z',
  speaker: 'M4 1.5h8a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1Zm4 6a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Zm0 1.2a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6ZM8 2.8a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8Z',
  // the playing row and the volume ends
  playing: 'M1.5 5.5h2.8L8 2.3v11.4L4.3 10.5H1.5Zm8.6-.6a4.2 4.2 0 0 1 0 6.2l-.8-.9a3 3 0 0 0 0-4.4Zm1.9-2.1a7.1 7.1 0 0 1 0 10.4l-.9-.9a5.8 5.8 0 0 0 0-8.6Z',
  'vol-low': 'M1 6h2.6L7 3v10l-3.4-3H1Zm8.2.4a2.4 2.4 0 0 1 0 3.2l-.7-.7a1.4 1.4 0 0 0 0-1.8Z',
  'vol-high': 'M1 6h2.6L7 3v10l-3.4-3H1Zm8.2.4a2.4 2.4 0 0 1 0 3.2l-.7-.7a1.4 1.4 0 0 0 0-1.8Zm1.7-1.7a4.8 4.8 0 0 1 0 6.6l-.7-.7a3.8 3.8 0 0 0 0-5.2Zm1.7-1.7a7.2 7.2 0 0 1 0 10l-.7-.7a6.2 6.2 0 0 0 0-8.6Z',
  // transport
  prev: 'M8 3.5v4L13.5 3.5v9L8 8.5v4L1.8 8Z',
  next: 'M8 3.5v4L2.5 3.5v9L8 8.5v4L14.2 8Z',
  play: 'M4 2.2 13.6 8 4 13.8Z',
  pause: 'M3.6 2.5h3v11h-3Zm5.8 0h3v11h-3Z',
  // the view switcher
  'view-list': 'M2 3h12v1.5H2Zm0 3.2h12v1.5H2Zm0 3.2h12v1.5H2Zm0 3.1h12V14H2Z',
  'view-album': 'M2 3.5h3v3H2Zm4.5 0H14V5H6.5Zm0 2H14V7H6.5ZM2 9.5h3v3H2Zm4.5 0H14V11H6.5Zm0 2H14V13H6.5Z',
  'view-grid': 'M2.5 4h3v3h-3Zm4 0h3v3h-3Zm4 0h3v3h-3Zm-8 4.5h3v3h-3Zm4 0h3v3h-3Zm4 0h3v3h-3Z',
  'view-flow': 'M5 3h6v10H5ZM1 4.5l3 .7v5.6l-3 .7Zm14 0v7l-3-.7V5.2Z',
  // the bottom bar
  add: 'M7.1 2.5h1.8v4.6h4.6v1.8H8.9v4.6H7.1V8.9H2.5V7.1h4.6Z',
  shuffle: 'M1 4h2.6c2.4 0 3.4 1.4 4.4 3l.6 1c.8 1.3 1.6 2.4 3.4 2.4V8.8L15 11.1l-3 2.3v-1.6c-2.5 0-3.6-1.5-4.6-3.1l-.6-1C6 6.4 5.2 5.4 3.6 5.4H1Zm11 0V2.6L15 4.9l-3 2.3V5.4c-1.2 0-2 .6-2.6 1.4l-.8-1.2C9.4 4.7 10.4 4 12 4ZM1 10.6h2.6c1.1 0 1.8-.5 2.4-1.2l.8 1.2c-.8.9-1.8 1.4-3.2 1.4H1Z',
  repeat: 'M3 6.5a2.5 2.5 0 0 1 2.5-2.5H11V2l3.2 2.7L11 7.4V5.4H5.5a1.1 1.1 0 0 0-1.1 1.1V8H3Zm10 3a2.5 2.5 0 0 1-2.5 2.5H5V14l-3.2-2.7L5 8.6v2h5.5a1.1 1.1 0 0 0 1.1-1.1V8H13Z',
  // Smart Shuffle's mark on the shuffle glyph (Spotify draws its smart shuffle with a sparkle)
  sparkle: 'M8 .5 9.7 6.3 15.5 8 9.7 9.7 8 15.5 6.3 9.7.5 8l5.8-1.7Z',
  artwork: 'M1.5 2.5h13v11h-13Zm1.3 1.3v8.4h10.4V3.8ZM8 5.5l3.2 4H4.8Z',
  airplay: 'M1.5 2h13v8.5h-3.1l-1-1.2h2.8V3.2H2.8v6.1h2.8l-1 1.2H1.5ZM8 8l4.2 5.5H3.8Z',
  // the LCD: the idle glyph (a pair of quavers: no logo) and "show the playing song"
  note: 'M5.2 3.2 13.6 1v9.6a2.2 1.8 0 1 1-1.4-1.7V4.4L6.6 5.9v6.9a2.2 1.8 0 1 1-1.4-1.7Z',
  goto: 'M8 1.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13ZM7.6 4.6l-.9.9 1.8 1.8H4.2v1.4h4.3l-1.8 1.8.9.9L11 8Z',
  back: 'M10.5 2.5 5 8l5.5 5.5-1.2 1.2L2.6 8l6.7-6.7Z',
  forward: 'M5.5 2.5 11 8l-5.5 5.5 1.2 1.2L13.4 8 6.7 1.3Z',
  home: 'M8 2 15 8h-2v6H9.6v-4H6.4v4H3V8H1Z',
  check: 'M2.5 8.5 4 7l2.5 2.5L12 4l1.5 1.5-7 7Z',
  // caption buttons (Windows 7's glyphs, drawn small)
  min: 'M4 10h8v1.6H4Z',
  max: 'M3.5 3.5h9v9h-9Zm1.4 2.2v5.4h6.2V5.7Z',
  close: 'm4.3 3.2 3.7 3.7 3.7-3.7 1.1 1.1L9.1 8l3.7 3.7-1.1 1.1L8 9.1l-3.7 3.7-1.1-1.1L6.9 8 3.2 4.3Z',
} satisfies Record<string, string>;

export type IconName = keyof typeof P;

/** One glyph in currentColor. `size` in px (default 16); the viewBox is always 16. */
export function Icon({ name, size = 16, className, style, title }: {
  name: IconName; size?: number; className?: string; style?: CSSProperties; title?: string;
}) {
  return (
    <svg className={className} style={style} width={size} height={size} viewBox="0 0 16 16" fill="currentColor"
         aria-hidden={title ? undefined : true} role={title ? 'img' : undefined} aria-label={title}>
      <path d={P[name]} fillRule="evenodd" />
    </svg>
  );
}
