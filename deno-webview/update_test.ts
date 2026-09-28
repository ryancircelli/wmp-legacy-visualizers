import { assertEquals } from "@std/assert";
import { cached, check, HOST_API, type Manifest, refresh, sha256hex, verify } from "./update.ts";

const b64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b)));
const enc = (s: string) => new TextEncoder().encode(s);

// A throwaway key pair: the tests sign what the site would publish.
const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
  "sign",
  "verify",
]) as CryptoKeyPair;
const KEY = b64(await crypto.subtle.exportKey("raw", pair.publicKey));
const PKCS8 = b64(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
const sign = async (bytes: Uint8Array<ArrayBuffer>) =>
  b64(await crypto.subtle.sign({ name: "Ed25519" }, pair.privateKey, bytes));

const OWN: Manifest = {
  version: "a".repeat(40),
  built: 100,
  needs: HOST_API,
  host: "h1",
  files: {},
};
const PAGE = enc('{"html":"","css":"","js":"/* newer */"}');

/** What the site serves: a manifest (overridable), its signature, the page file. */
async function site(
  m: Partial<Manifest> = {},
  o: { sig?: string; file?: Uint8Array<ArrayBuffer> } = {},
) {
  const manifest = {
    version: "b".repeat(40),
    built: 200,
    needs: HOST_API,
    host: "h1",
    files: { "spotify-inject.js": await sha256hex(PAGE) },
    ...m,
  };
  const mb = enc(JSON.stringify(manifest));
  const sig = o.sig ?? await sign(mb);
  const hits: string[] = [];
  const f = ((url: string) => {
    const path = url.replace("https://site.test/", "");
    hits.push(path);
    const body = path === "update.json"
      ? mb
      : path === "update.json.sig"
      ? enc(sig)
      : path === "spotify-inject.js"
      ? (o.file ?? PAGE)
      : null;
    return Promise.resolve(body ? new Response(body) : new Response("", { status: 404 }));
  }) as typeof fetch;
  return { f, hits };
}

async function withDir(fn: (dir: string) => Promise<void>) {
  const dir = await Deno.makeTempDir({ prefix: "wmp-update-test-" });
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}
const opts = (dir: string, f: typeof fetch) => ({
  dir,
  name: "spotify-inject.js",
  own: OWN,
  key: KEY,
  origin: "https://site.test/",
  fetch: f,
});

Deno.test("verify: the key's signature of exactly these bytes, and nothing else", async () => {
  const mb = enc(JSON.stringify({ version: "v", built: 1, needs: 1, host: "h", files: {} }));
  const sig = await sign(mb);
  assertEquals((await verify(mb, sig, KEY))?.version, "v");
  assertEquals(
    await verify(
      enc(JSON.stringify({ version: "w", built: 1, needs: 1, host: "h", files: {} })),
      sig,
      KEY,
    ),
    null,
    "other bytes",
  );
  const other = await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ]) as CryptoKeyPair;
  assertEquals(
    await verify(mb, sig, b64(await crypto.subtle.exportKey("raw", other.publicKey))),
    null,
    "other key",
  );
  assertEquals(await verify(mb, "not base64!", KEY), null, "garbage signature");
  const shapeless = enc('{"version":"v"}');
  assertEquals(
    await verify(shapeless, await sign(shapeless), KEY),
    null,
    "signed but not a manifest",
  );
});

Deno.test("refresh: a newer page for this host is fetched, checked, cached; the next launch reads it", () =>
  withDir(async (dir) => {
    const s = await site();
    const r = await refresh(opts(dir, s.f));
    assertEquals([
      r.page?.manifest.version.slice(0, 1),
      new TextDecoder().decode(r.page?.bytes),
      r.hostUpdate,
    ], ["b", '{"html":"","css":"","js":"/* newer */"}', false]);
    const c = await cached(opts(dir, s.f));
    assertEquals([c.page?.manifest.built, c.hostUpdate], [200, false]);
    // the same version again: the cached copy, the file not fetched twice
    await refresh(opts(dir, s.f));
    assertEquals(s.hits.filter((h) => h === "spotify-inject.js").length, 1);
  }));

Deno.test("refresh: not newer, or for a newer host, keeps the built-in page; a new host build is reported", () =>
  withDir(async (dir) => {
    const old = await site({ built: 50 });
    assertEquals(await refresh(opts(dir, old.f)), { page: null, hostUpdate: false });
    const newer = await site({ needs: HOST_API + 1, host: "h2" });
    assertEquals(await refresh(opts(dir, newer.f)), { page: null, hostUpdate: true });
    assertEquals(newer.hits.includes("spotify-inject.js"), false, "the page is never fetched");
    // remembered: the next launch knows without the network
    assertEquals((await cached(opts(dir, old.f))).hostUpdate, true);
  }));

Deno.test("refresh: a bad signature, a file that does not match, or no network change nothing", () =>
  withDir(async (dir) => {
    const forged = await site({}, { sig: await sign(enc("something else")) });
    assertEquals(await refresh(opts(dir, forged.f)), {
      page: null,
      hostUpdate: false,
      error: "The update's signature does not verify.",
    });
    const swapped = await site({}, { file: enc("evil") });
    assertEquals((await refresh(opts(dir, swapped.f))).page, null);
    assertEquals((await cached(opts(dir, swapped.f))).page, null, "nothing cached");
    const offline = (() => Promise.reject(new TypeError("offline"))) as typeof fetch;
    assertEquals(await refresh(opts(dir, offline)), {
      page: null,
      hostUpdate: false,
      error: "The update site could not be reached.",
    });
  }));

Deno.test("refresh: an older signed manifest (a replay) does not replace a newer cache", () =>
  withDir(async (dir) => {
    await refresh(opts(dir, (await site({ built: 300 })).f));
    const replay = await site({ built: 200, version: "d".repeat(40) });
    assertEquals((await refresh(opts(dir, replay.f))).page?.manifest.built, 300);
    assertEquals((await cached(opts(dir, replay.f))).page?.manifest.built, 300);
  }));

Deno.test("check (Help > Check for Player Updates): ready when a newer page than the running one is cached", () =>
  withDir(async (dir) => {
    const s = await site();
    const running = "a".repeat(40);
    assertEquals(await check({ ...opts(dir, s.f), running }), {
      running,
      ready: "b".repeat(40),
      hostUpdate: false,
      error: null,
    });
    // already running that page (a launch that took it): the latest
    assertEquals((await check({ ...opts(dir, s.f), running: "b".repeat(40) })).ready, null);
    const offline = (() => Promise.reject(new TypeError("offline"))) as typeof fetch;
    assertEquals(
      (await check({ ...opts(dir, offline), running })).error,
      "The update site could not be reached.",
    );
  }));

Deno.test("cached: a cached file changed on disk no longer counts", () =>
  withDir(async (dir) => {
    const s = await site();
    await refresh(opts(dir, s.f));
    await Deno.writeTextFile(`${dir}/spotify-inject.js`, "tampered");
    assertEquals((await cached(opts(dir, s.f))).page, null);
  }));

Deno.test("tools/sign-update.js signs what update.ts verifies (CI's format, end to end)", () =>
  withDir(async (dir) => {
    const mb = enc(
      JSON.stringify({ version: "c".repeat(40), built: 1, needs: 1, host: "h", files: {} }),
    );
    await Deno.writeFile(`${dir}/update.json`, mb);
    const out = await new Deno.Command("node", {
      args: [new URL("../tools/sign-update.js", import.meta.url).pathname, dir],
      env: { UPDATE_SIGNING_KEY: PKCS8 },
    }).output();
    assertEquals(out.code, 0, new TextDecoder().decode(out.stderr));
    const sig = await Deno.readTextFile(`${dir}/update.json.sig`);
    assertEquals((await verify(mb, sig, KEY))?.version, "c".repeat(40));
  }));

// The manifest the build embeds (skipped until `npm run build` has made it): it must describe the
// files beside it, and need no more than this host has.
const DIST = new URL("../dist/", import.meta.url);
Deno.test({
  name: "dist/update.json describes dist/ and fits this host",
  ignore: !(await Deno.stat(new URL("update.json", DIST)).then(() => true, () => false)),
  fn: async () => {
    const m = JSON.parse(await Deno.readTextFile(new URL("update.json", DIST))) as Manifest;
    assertEquals(m.needs, HOST_API);
    for (const f of ["index.html", "spotify-inject.js"]) {
      assertEquals(m.files[f], await sha256hex(await Deno.readFile(new URL(f, DIST))), f);
    }
  },
});
