# WMP Legacy Visualizers

Every visualizer Windows Media Player shipped, from WMP 7 to today's, reverse-engineered and ported
instruction for instruction, byte-identical to Microsoft's own objects for 30,000 consecutive frames.
Two packages, one npm workspace:

| Folder | What it is |
|---|---|
| [`visualizers/`](visualizers/README.md) | **`wmp-legacy-visualizers`**, the engine, usable on its own: the ports, WMP's spectrum analyzer, the tests that prove them exact. Take this folder and you have the visualizers. |
| [`app/`](app/README.md) | **The player** that uses it: the WMP 9 / iPod / iTunes skins, the Spotify client, and the website, Windows (Tauri) and iPhone builds. Live at https://wmp.ryancircelli.com. |

The engine never imports the app (an eslint rule enforces it); the app imports the engine by package name.

```sh
npm ci              # once, at this root
npm run typecheck   # both packages
npm run lint        # eslint, both packages
npm test            # vitest, both packages
npm run build       # visualizers/dist/engine.js, then app/dist/ (the site) and app/alchemy.html
```

See [`app/README.md`](app/README.md) for the downloads and the build details, and
[`visualizers/README.md`](visualizers/README.md) for using the engine in your own project, the fidelity record and
a note on the source material.
