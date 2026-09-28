// The project on GitHub and the two Windows downloads, offered by the website only: the desktop
// apps are those downloads. The release tags are rolled by CI on every push, so the URLs never change.
const REPO = 'https://github.com/ryancircelli/wmp-legacy-visualizers';
export const LINKS = {
  spotify: REPO + '/releases/download/spotify-latest/WmpSpotify-win64.zip',
  screensaver: REPO + '/releases/download/screensaver-latest/AlchemyScreensaver-win64.zip',
  repo: REPO,
} as const;

export const openLink = (url: string): void => void window.open(url, '_blank', 'noopener');
