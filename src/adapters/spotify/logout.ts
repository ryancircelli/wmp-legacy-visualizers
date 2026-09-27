// File > Log Out of Spotify: the host's binding lands on the login page (CONTRACT v6).
import '../host/globals';

export const canLogout = () => typeof window.alchemySpotifyLogout === 'function';
export function logout(): void { if (canLogout()) window.alchemySpotifyLogout!(); }
