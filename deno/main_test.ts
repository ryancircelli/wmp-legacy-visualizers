import { assert, assertEquals } from "@std/assert";
import { handler, version } from "./main.ts";

const get = (path: string, init?: RequestInit) => handler(new Request("http://x" + path, init));

const SECURITY: [string, string][] = [
  ["x-content-type-options", "nosniff"],
  ["referrer-policy", "no-referrer"],
  ["permissions-policy", "microphone=(self), display-capture=(self), autoplay=(self)"],
];

for (const path of ["/", "/index.html", "/alchemy.html"]) {
  Deno.test(`GET ${path} serves the page with cache + security headers`, async () => {
    const res = await get(path);
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("content-type"), "text/html; charset=utf-8");
    assertEquals(res.headers.get("cache-control"), "public, max-age=300");
    assert(res.headers.get("etag")?.startsWith('"'), "strong etag");
    for (const [k, v] of SECURITY) assertEquals(res.headers.get(k), v);
    assertEquals(res.headers.get("content-disposition"), path === "/alchemy.html" ? "inline" : null);
    // The Vite single-file build: the bundle is inlined, never a separate request.
    const body = await res.text();
    assert(/<script\b/.test(body), "page body");
    assert(!/<script\b[^>]*\bsrc=/.test(body), "no external script");
  });
}

Deno.test("gzip is served when accepted, with its own ETag and Vary", async () => {
  const plain = await get("/");
  const gz = await get("/", { headers: { "accept-encoding": "gzip, deflate, br" } });
  assertEquals(gz.headers.get("content-encoding"), "gzip");
  assertEquals(gz.headers.get("vary"), "accept-encoding");
  assert(gz.headers.get("etag") !== plain.headers.get("etag"), "distinct etag per encoding");
  const raw = new Uint8Array(await gz.arrayBuffer());
  const body = await plain.text();
  assert(raw.length < body.length / 2, `gzip ${raw.length} vs ${body.length}`);
  const out = await new Response(
    new Blob([raw]).stream().pipeThrough(new DecompressionStream("gzip")),
  ).text();
  assertEquals(out, body);
  // ...and its ETag round-trips to a 304 too.
  const res = await get("/", {
    headers: { "accept-encoding": "gzip", "if-none-match": gz.headers.get("etag")! },
  });
  assertEquals(res.status, 304);
});

Deno.test("all three page routes are the same bytes", async () => {
  const [a, b, c] = await Promise.all(["/", "/index.html", "/alchemy.html"].map((p) => get(p).text()));
  assertEquals(a, b);
  assertEquals(a, c);
});

Deno.test("If-None-Match on the current ETag gives a 304 that still carries the headers", async () => {
  const etag = (await get("/")).headers.get("etag")!;
  const res = await get("/", { headers: { "if-none-match": etag } });
  assertEquals(res.status, 304);
  assertEquals(res.body, null);
  assertEquals(res.headers.get("etag"), etag);
  assertEquals(res.headers.get("cache-control"), "public, max-age=300");
  // A list, and the weak form, both match; a stale one does not.
  assertEquals((await get("/", { headers: { "if-none-match": `"stale", W/${etag}` } })).status, 304);
  assertEquals((await get("/", { headers: { "if-none-match": '"stale"' } })).status, 200);
});

Deno.test("HEAD is bodiless but keeps the headers", async () => {
  const res = await get("/", { method: "HEAD" });
  assertEquals(res.status, 200);
  assertEquals(res.body, null);
  assertEquals(res.headers.get("etag"), (await get("/")).headers.get("etag"));
});

Deno.test("/healthz reports ok + version, uncached", async () => {
  const res = await get("/healthz");
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("cache-control"), "no-store");
  assertEquals(await res.json(), { ok: true, version });
  assert(version.length > 0);
});

Deno.test("anything else is 404", async () => {
  for (const path of ["/nope", "/dist/index.html", "/_headers", "/..%2F"]) {
    const res = await get(path);
    assertEquals(res.status, 404, path);
    await res.body?.cancel();
  }
});
