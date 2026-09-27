// Entry for dist/engine.js (npm run build:engine): a classic script that sets window.Alchemy exactly
// as the old concatenated src/*.js did, for the A/B drivers in tools/ and anything else that wants globals.
import { A } from './index';
(window as unknown as { Alchemy: unknown }).Alchemy = A;
