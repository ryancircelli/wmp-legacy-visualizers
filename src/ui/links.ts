// The project on GitHub and the two Windows downloads, offered by the website only: the desktop
// apps are those downloads. The release tags are rolled by CI on every push, so the URLs never change.
const REPO = 'https://github.com/ryancircelli/wmp-legacy-visualizers';
export const LINKS = {
  spotify: REPO + '/releases/download/spotify-latest/WmpSpotify-win64.zip',
  screensaver: REPO + '/releases/download/screensaver-latest/AlchemyScreensaver-win64.zip',
  repo: REPO,
} as const;

/** In the desktop apps the host opens it in the user's browser; on the website, a new tab. */
export const openLink = (url: string): void => {
  if (typeof window.alchemyOpenUrl === 'function') window.alchemyOpenUrl(url);
  else window.open(url, '_blank', 'noopener');
};
/** The download that replaces the app this page runs in. */
export const appDownload = (spotify: boolean): string => (spotify ? LINKS.spotify : LINKS.screensaver);
