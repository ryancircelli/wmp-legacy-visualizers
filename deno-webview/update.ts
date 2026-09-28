// Page updates without a new download (the page: the screensaver's index.html, WmpSpotify's
// spotify-inject.js). Every deploy publishes update.json beside those files, signed in CI
// (tools/sign-update.js) with a key only GitHub holds; the public half is below. A copy of the page
// is used only when its manifest verifies, its file matches the manifest's hash, it is newer than
// the page built into this exe, and it needs no more of the host than this exe has (HOST_API).
// Anything else — offline, a bad signature, a page for a newer host — leaves the built-in page.
//
// The newest good copy is cached, so an update fetched too late for this launch (or while offline)
// serves the next one. The latest verified manifest is cached too: when it names a different host
// build, the exe itself is out of date, and the page offers the download (window.alchemyHostUpdate).
import hostApi from "./host-api.json" with { type: "json" };

export const HOST_API: number = hostApi.hostApi;
export const UPDATE_ORIGIN = "https://wmp.ryancircelli.com/";
/** Ed25519, raw, base64: verifies what tools/sign-update.js signed with UPDATE_SIGNING_KEY. */
export const PUBLIC_KEY = "PtAmxNOZGD1FK8HvZQylQDQ69z0RDM+m0TYEylxQ6vA=";

export type Manifest = {
  version: string;
  /** the commit's time, seconds: newer wins */
  built: number;
  /** the HOST_API the page needs */
  needs: number;
  /** hash of the host's own sources: another value means another exe */
  host: string;
  /** sha256 (hex) of each published page file */
  files: Record<string, string>;
};
export type Page = { bytes: Uint8Array<ArrayBuffer>; manifest: Manifest };

const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function sha256hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(h, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The manifest these bytes hold, if `sig` (base64) is the key's signature of exactly them. */
export async function verify(
  bytes: Uint8Array<ArrayBuffer>,
  sig: string,
  key = PUBLIC_KEY,
): Promise<Manifest | null> {
  try {
    const k = await crypto.subtle.importKey("raw", b64(key), { name: "Ed25519" }, false, [
      "verify",
    ]);
    if (!await crypto.subtle.verify({ name: "Ed25519" }, k, b64(sig.trim()), bytes)) return null;
    const m = JSON.parse(new TextDecoder().decode(bytes));
    const ok = m && typeof m.version === "string" && typeof m.built === "number" &&
      typeof m.needs === "number" && typeof m.host === "string" && m.files &&
      typeof m.files === "object";
    return ok ? m as Manifest : null;
  } catch {
    return null; // a malformed key, signature or manifest is simply not an update
  }
}

/** Whether a verified manifest's copy of `name` may replace the page this exe has (`own`). */
export const usable = (m: Manifest, own: Manifest, name: string) =>
  m.needs <= HOST_API && m.built > own.built && typeof m.files[name] === "string";

/** Whether the site's latest build is a newer exe than this one. */
export const hostOutdated = (latest: Manifest, own: Manifest) =>
  latest.host !== own.host && latest.built > own.built;

const read = (p: string) => Deno.readFile(p).catch(() => null);

/** A cached page file, re-verified: its manifest's signature and its own hash. */
async function cachedPage(dir: string, name: string, own: Manifest, key: string) {
  const [bytes, mb, sig] = await Promise.all([
    read(`${dir}/${name}`),
    read(`${dir}/${name}.manifest.json`),
    Deno.readTextFile(`${dir}/${name}.manifest.sig`).catch(() => null),
  ]);
  if (!bytes || !mb || !sig) return null;
  const m = await verify(mb, sig, key);
  if (!m || !usable(m, own, name) || await sha256hex(bytes) !== m.files[name]) return null;
  return { bytes, manifest: m };
}

/** The latest verified manifest seen, from the cache. */
async function cachedLatest(dir: string, key: string): Promise<Manifest | null> {
  const [mb, sig] = await Promise.all([
    read(`${dir}/latest.json`),
    Deno.readTextFile(`${dir}/latest.sig`).catch(() => null),
  ]);
  return mb && sig ? verify(mb, sig, key) : null;
}

export type Options = {
  /** where the cache lives (created on demand) */
  dir: string;
  /** the page file this exe runs: "index.html" or "spotify-inject.js" */
  name: string;
  /** the exe's own manifest (dist/update.json, embedded) */
  own: Manifest;
  key?: string;
  origin?: string;
  fetch?: typeof fetch;
  log?: (m: string) => void;
};

/** What the cache offers now: a newer page (or null), and whether the exe is known to be old. */
export async function cached(o: Options): Promise<{ page: Page | null; hostUpdate: boolean }> {
  const key = o.key ?? PUBLIC_KEY;
  const [page, latest] = await Promise.all([
    cachedPage(o.dir, o.name, o.own, key),
    cachedLatest(o.dir, key),
  ]);
  return { page, hostUpdate: !!latest && hostOutdated(latest, o.own) };
}

/**
 * Asks the site for its manifest; caches it when it verifies, and fetches and caches the page file
 * when it is usable here. Never throws. `page`: the newer page, if one arrived; `hostUpdate`: the
 * site's build is a newer exe.
 */
export async function refresh(o: Options): Promise<{ page: Page | null; hostUpdate: boolean }> {
  const key = o.key ?? PUBLIC_KEY, origin = o.origin ?? UPDATE_ORIGIN, f = o.fetch ?? fetch;
  const log = o.log ?? (() => {});
  const get = async (path: string) => {
    const r = await f(origin + path, { cache: "no-store", signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
    return new Uint8Array(await r.arrayBuffer());
  };
  try {
    const [mb, sigBytes] = await Promise.all([get("update.json"), get("update.json.sig")]);
    const sig = new TextDecoder().decode(sigBytes);
    const m = await verify(mb, sig, key);
    if (!m) {
      log("update: the site's manifest does not verify; ignored");
      return { page: null, hostUpdate: false };
    }
    await Deno.mkdir(o.dir, { recursive: true });
    await Deno.writeFile(`${o.dir}/latest.json`, mb);
    await Deno.writeTextFile(`${o.dir}/latest.sig`, sig);
    const hostUpdate = hostOutdated(m, o.own);
    if (!usable(m, o.own, o.name)) {
      log(
        `update: site ${m.version.slice(0, 7)} (needs host ${m.needs}, have ${HOST_API}) ` +
          `not newer or not for this exe${hostUpdate ? "; a new exe is out" : ""}`,
      );
      return { page: null, hostUpdate };
    }
    // never backwards: a replayed older (still signed) manifest does not replace a newer cache
    const have = await cachedPage(o.dir, o.name, o.own, key);
    if (have && have.manifest.built >= m.built) return { page: have, hostUpdate };
    const bytes = await get(o.name === "index.html" ? "" : o.name);
    if (await sha256hex(bytes) !== m.files[o.name]) {
      log(`update: ${o.name} does not match the manifest; ignored`);
      return { page: null, hostUpdate };
    }
    // the file first, its manifest last: an interrupted write leaves nothing that verifies
    await Deno.writeFile(`${o.dir}/${o.name}`, bytes);
    await Deno.writeFile(`${o.dir}/${o.name}.manifest.json`, mb);
    await Deno.writeTextFile(`${o.dir}/${o.name}.manifest.sig`, sig);
    log(`update: cached ${o.name} ${m.version.slice(0, 7)}`);
    return { page: { bytes, manifest: m }, hostUpdate };
  } catch (e) {
    log(`update: ${e instanceof Error ? e.message : e}`);
    return { page: null, hostUpdate: false };
  }
}
