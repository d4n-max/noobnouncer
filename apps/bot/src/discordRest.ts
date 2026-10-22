import { env } from "./env.js";
import { HttpError } from "./auth.js";

type Timing = { now: () => number; sleep: (ms: number) => Promise<void>; jitter: () => number };
const defaultTiming: Timing = { now: Date.now, sleep: ms => new Promise(resolve => setTimeout(resolve, ms)), jitter: () => Math.random() * 100 };
export function createDiscordRest(fetcher: typeof fetch = fetch, timing: Timing = defaultTiming) {
  let tail = Promise.resolve();
  let queued = 0, globalUntil = 0;
  const routes = new Map<string, { bucket: string; until: number }>();
  const buckets = new Map<string, number>();
  function unavailable(delay = 1): never {
    throw new HttpError(503, "Discord permissions are temporarily unavailable. Please refresh shortly.", Math.max(1, Math.ceil(delay)));
  }
  function seconds(value: unknown): number | null {
    const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  function keyFor(route: string) {
    // Preserve major guild/channel IDs; member IDs share a rate-limit bucket.
    return route.replace(/\/members\/\d+/, "/members/:user");
  }
  async function execute<T>(route: string, deadline: number): Promise<T> {
    const key = keyFor(route);
    for (let attempt = 0; attempt < 3; attempt++) {
      const now = timing.now();
      // Evict expired metadata; no successful permission response is cached.
      for (const [id, until] of buckets) if (until <= now) buckets.delete(id);
      for (const [id, entry] of routes) if (entry.until <= now) routes.delete(id);
      const bucket = routes.get(key)?.bucket;
      const wait = Math.max(globalUntil, bucket ? buckets.get(bucket) ?? 0 : 0, routes.get(key)?.until ?? 0) - now;
      if (now >= deadline || wait >= deadline - now) unavailable(Math.max(1, wait / 1000));
      if (wait > 0) await timing.sleep(wait);
      let response: Response;
      try {
        response = await fetcher(`https://discord.com/api/v10${route}`, {
          headers: { Authorization: `Bot ${env.DISCORD_TOKEN}` },
          signal: AbortSignal.timeout(Math.max(1, Math.min(5000, deadline - timing.now())))
        });
      } catch {
        if (attempt === 2) unavailable();
        const delay = 250 * 2 ** attempt + timing.jitter();
        if (timing.now() + delay >= deadline) unavailable();
        await timing.sleep(delay); continue;
      }
      const major = route.match(/^\/(?:guilds|channels)\/\d+/)?.[0] ?? "other";
      const bucketId = response.headers.get("X-RateLimit-Bucket");
      const reset = seconds(response.headers.get("X-RateLimit-Reset-After"));
      const sharedKey = bucketId ? `${major}:${bucketId}` : key;
      if (response.headers.get("X-RateLimit-Remaining") === "0" && reset !== null) {
        const until = timing.now() + reset * 1000;
        routes.set(key, { bucket: sharedKey, until }); buckets.set(sharedKey, until);
      }
      if (response.status === 429) {
        const body = await response.json().catch(() => ({})) as { retry_after?: unknown; global?: boolean };
        const header = response.headers.get("Retry-After");
        const headerDelay = seconds(header) ?? (header && Number.isFinite(Date.parse(header)) ? Math.max(0, (Date.parse(header) - timing.now()) / 1000) : 0);
        const delay = Math.max(seconds(body.retry_after) ?? 1, headerDelay, reset ?? 0, 0.05);
        const until = timing.now() + delay * 1000;
        if (body.global === true || response.headers.get("X-RateLimit-Global") === "true") globalUntil = Math.max(globalUntil, until);
        routes.set(key, { bucket: sharedKey, until }); buckets.set(sharedKey, until);
        if (attempt === 2 || until >= deadline) unavailable(delay);
        continue;
      }
      if (response.status === 403 || response.status === 404) {
        await response.body?.cancel().catch(() => {});
        throw new HttpError(403, "You do not have permission for this server.");
      }
      if (response.status >= 500) {
        await response.body?.cancel().catch(() => {});
        const retry = seconds(response.headers.get("Retry-After"));
        const delay = Math.max(250 * 2 ** attempt + timing.jitter(), (retry ?? 0) * 1000);
        if (retry !== null) routes.set(key, { bucket: sharedKey, until: timing.now() + delay });
        if (attempt === 2 || timing.now() + delay >= deadline) unavailable(delay / 1000);
        await timing.sleep(delay); continue;
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        unavailable();
      }
      try { return await response.json() as T; } catch { unavailable(); }
    }
    return unavailable();
  }
  async function request<T>(route: string, deadline = timing.now() + 10_000): Promise<T> {
    if (queued >= 100) unavailable();
    queued++;
    const previous = tail;
    let release!: () => void;
    tail = new Promise<void>(resolve => { release = resolve; });
    try { await previous; return await execute<T>(route, deadline); }
    finally { queued--; release(); }
  }
  return { request, now: timing.now };
}
