// Entry: dist/index.html (standalone) and dist/spotify-inject.js (the host runs this bundle after
// mounting the shadow root, so the DOM is already there).
import { mount } from './app/mount';

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => void mount());
else void mount();
