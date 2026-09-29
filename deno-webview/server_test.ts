import { assertEquals, assertNotEquals } from "@std/assert";

// /audio is the system's sound, what is playing, and transport and wake commands: the port is
// findable by any local page, so only a request carrying the per-launch key main.ts gives the page
// is served.
Deno.test("server: /audio answers only with the launch's key", async () => {
  Deno.env.set("ALCHEMY_AUDIO_EXE", "no-such-helper.exe");
  Deno.env.set("ALCHEMY_AUDIO_KEY", "k3y");
  const w = new Worker(new URL("./server.ts", import.meta.url), { type: "module" });
  try {
    const port = await new Promise<string>((ok) => w.onmessage = (e) => ok(String(e.data)));
    const status = async (q: string) => {
      const r = await fetch(`http://127.0.0.1:${port}/audio${q}`);
      await r.body?.cancel();
      return r.status;
    };
    assertEquals(await status(""), 403, "no key");
    assertEquals(await status("?k=wrong"), 403, "wrong key");
    // the right key reaches the WebSocket upgrade (a plain GET is not one, so it fails there)
    assertNotEquals(await status("?k=k3y"), 403, "the key");
  } finally {
    w.terminate();
    Deno.env.delete("ALCHEMY_AUDIO_EXE");
    Deno.env.delete("ALCHEMY_AUDIO_KEY");
  }
});
