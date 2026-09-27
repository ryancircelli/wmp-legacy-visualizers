# `deno/` — the page, served

**`main.ts`** exports `handler(req)`, the static handler for the built page in `../dist/` — content
types, strong `ETag`, gzip, cache and security headers. Both desktop hosts
(`../deno-webview/server.ts`) answer with this same function, so the page cannot behave differently
in one of them than at https://wmp.ryancircelli.com. The page itself is built by `npm run build` at
the repo root (Vite); the Deno port of the old build (`build.ts`) is retired.

## Tasks

```sh
npm run build       # at the repo root, first: -> ../dist/
deno task serve     # serve ../dist on http://127.0.0.1:8765/ for local work
deno task test      # main_test.ts (needs ../dist)
```

`deno task serve` flags: `--port <n>` (8765), `--host <addr>` (`127.0.0.1`; `0.0.0.0` exposes it on
the LAN), `--open` to launch a browser at it, `--help`.

Routes: `/` and `/index.html` are the page; `/alchemy.html` is the same bytes with
`Content-Disposition: inline`; `/healthz` returns `{"ok":true,"version":"<git sha>"}`; everything
else 404s. Responses carry a strong `ETag` (304 on `If-None-Match`),
`Cache-Control: public, max-age=300`, gzip when the client accepts it, and the same security headers
as `dist/_headers`.

`main_test.ts` covers the handler. `dist/` is generated and git-ignored; CI builds it before every
compile.

### Why a server is involved at all

Loading `alchemy.html` from `file://` works, but Chrome will not remember a microphone grant for a
`file://` origin, so it re-prompts on every load. `http://127.0.0.1` is a real origin: grant once,
and `localStorage` survives. That is also why the two desktop hosts serve the embedded page from a
fixed loopback port instead of loading it off disk.
