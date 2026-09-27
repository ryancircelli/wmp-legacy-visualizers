#!/usr/bin/env -S deno run --allow-net --allow-read --allow-env --allow-run
// The page as a module: `handler` is the static handler both the deployed site and the two desktop
// hosts serve the built page with (deno-webview/server.ts imports it), and `deno task serve` runs
// it here for local development.
import { parseArgs } from "@std/cli/parse-args";

const dist = new URL("../dist/", import.meta.url);
const page = await Deno.readFile(new URL("index.html", dist));

const sha = async (b: Uint8Array<ArrayBuffer>) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", b))]
    .slice(0, 16).map((x) => x.toString(16).padStart(2, "0")).join("");

// The page is static, so both representations and their tags are computed once, at boot.
const gzipped = new Uint8Array(
  await new Response(new Blob([page]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer(),
);
const etag = `"${await sha(page)}"`;
const etagGz = `"${await sha(page)}-gzip"`;
// ponytail: gzip only — Deno has no brotli CompressionStream. Add one if a client that only speaks
// br ever shows up; for localhost this is already more than enough.

export const version: string = await Deno.readTextFile(new URL("version.json", dist))
  .then((t) => JSON.parse(t).version as string)
  .catch(() => Deno.env.get("GIT_SHA") ?? "dev");

// Same set as dist/_headers.
const SECURITY = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "permissions-policy": "microphone=(self), display-capture=(self), autoplay=(self)",
};

const matches = (h: string | null, tag: string) =>
  (h ?? "").split(",").some((t) => t.trim().replace(/^W\//, "") === tag);

export function handler(req: Request): Response {
  const { pathname } = new URL(req.url);

  if (pathname === "/healthz") {
    return Response.json({ ok: true, version }, {
      headers: { "cache-control": "no-store", ...SECURITY },
    });
  }

  const inline = pathname === "/alchemy.html";
  if (!inline && pathname !== "/" && pathname !== "/index.html") {
    return new Response("Not Found\n", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8", ...SECURITY },
    });
  }

  const gz = /\bgzip\b/.test(req.headers.get("accept-encoding") ?? "");
  const tag = gz ? etagGz : etag;
  const headers = new Headers({
    "content-type": "text/html; charset=utf-8",
    "cache-control": "public, max-age=300",
    etag: tag,
    vary: "accept-encoding",
    ...SECURITY,
  });
  if (gz) headers.set("content-encoding", "gzip");
  if (inline) headers.set("content-disposition", "inline");
  if (matches(req.headers.get("if-none-match"), tag)) return new Response(null, { status: 304, headers });
  return new Response(req.method === "HEAD" ? null : (gz ? gzipped : page), { headers });
}

function open(url: string) {
  const cmd = Deno.build.os === "windows"
    ? ["cmd", "/c", "start", "", url]
    : Deno.build.os === "darwin"
    ? ["open", url]
    : ["xdg-open", url];
  new Deno.Command(cmd[0], { args: cmd.slice(1), stdout: "null", stderr: "null" }).spawn().unref();
}

if (import.meta.main) {
  const f = parseArgs(Deno.args, {
    string: ["port", "host"],
    boolean: ["open", "help"],
    default: { port: "8765", host: "127.0.0.1" },
  });
  if (f.help) {
    console.log(
      "serves the WMP visualizer page on a local port\n\n" +
        "  --port <n>     port (default 8765)\n" +
        "  --host <addr>  bind address (default 127.0.0.1; use 0.0.0.0 to expose on the LAN)\n" +
        "  --open         open the page in the default browser\n",
    );
    Deno.exit(0);
  }
  const port = Number(f.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`bad --port ${f.port}`);
    Deno.exit(2);
  }
  Deno.serve({
    port,
    hostname: f.host,
    onListen: ({ port, hostname }) => {
      const url = `http://${hostname === "0.0.0.0" ? "127.0.0.1" : hostname}:${port}/`;
      console.log(`WMP visualizer page ${version.slice(0, 7)} on ${url}`);
      if (f.open) open(url);
    },
  }, handler);
}
