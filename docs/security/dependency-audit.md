# Dependency security audit - 2026-10-22

Baseline: committed revision `2deb027bb3935069273ab39d2b3948849b7e2bd8`. Command: `npm audit --json`. Before: **15 affected package entries (6 moderate, 9 high)**. After compatible updates: **2 moderate, 0 high, 0 critical**. Counts include propagated parent entries, not distinct CVEs. Raw baseline and final JSON are retained alongside this report.

The baseline package-lock.json matched the working dependency files before hardening. Registry advisory metadata is time-sensitive. No audit fix --force or blanket major override was used.

## Every baseline moderate/high affected package

### @discordjs/rest - moderate

- Installed: `2.6.1` -> `2.6.3`. Baseline affected range: `0.5.0-dev.1650197025-b94a876 - 2.6.1 || 3.0.0-core-gateway-rl.1762368996-5fa92a1ea - 3.0.0-dev.1744071169-d93a52c1d`.
- Exposure: Production Express/Discord bot runtime.
- Dependency paths:
  - `@scheduler/bot@0.1.0 -> discord.js@14.26.4 -> @discordjs/rest@2.6.1`.
- Result: Updated compatibly; absent from final npm audit.
- Baseline npm fix suggestion: `true`. This is evidence, not an automatically accepted command.
- Propagated from: undici.

### @giphy/js-util - moderate

- Installed: `5.2.0` -> `5.2.0`. Baseline affected range: `<=0.0.0-moat-testing-20240502211419 || 1.10.0 || >=2.1.0`.
- Exposure: Browser GIPHY fetch/picker/analytics dependency; not imported by the backend.
- Dependency paths:
  - `@scheduler/web@0.1.0 -> @giphy/js-fetch-api@5.8.0 -> @giphy/js-util@5.2.0`.
- Result: Unresolved; see remaining finding below.
- Baseline npm fix suggestion: `true`. This is evidence, not an automatically accepted command.
- Propagated from: uuid.

### @giphy/react-components - high

- Installed: `10.1.2` -> `10.1.2`. Baseline affected range: `<=0.0.0-moat-testing-20240502211419 || >=1.7.0-alpha.0`.
- Exposure: Browser GIPHY fetch/picker/analytics dependency; not imported by the backend.
- Dependency paths:
  - `@scheduler/web@0.1.0 -> @giphy/react-components@10.1.2`.
- Result: Updated compatibly; absent from final npm audit.
- Baseline npm fix suggestion: `{"name":"@giphy/react-components","version":"1.6.0","isSemVerMajor":true}`. This is evidence, not an automatically accepted command.
- Propagated from: react-use.

### baseline-browser-mapping - moderate

- Installed: `2.10.38` -> `2.11.30`. Baseline affected range: `>=2.0.0 <2.11.0`.
- Exposure: Development-only Vite/Babel/CSS build tooling; production uses Express static serving, not the Vite dev server.
- Dependency paths:
  - `@scheduler/web@0.1.0 -> @vitejs/plugin-react@4.7.0 -> @babel/core@7.29.7 -> @babel/helper-compilation-targets@7.29.7 -> browserslist@4.28.2 -> baseline-browser-mapping@2.10.38`.
- Result: Updated compatibly; absent from final npm audit.
- Baseline npm fix suggestion: `true`. This is evidence, not an automatically accepted command.
- [baseline-browser-mapping process termination on invalid input causes denial of service](https://github.com/advisories/GHSA-w5vr-8v7q-w6rv) - moderate; vulnerable versions `>=2.0.0 <2.11.0`.

### browserslist - high

- Installed: `4.28.2` -> `4.29.4`. Baseline affected range: `<=4.28.6`.
- Exposure: Development-only Vite/Babel/CSS build tooling; production uses Express static serving, not the Vite dev server.
- Dependency paths:
  - `@scheduler/web@0.1.0 -> @vitejs/plugin-react@4.7.0 -> @babel/core@7.29.7 -> @babel/helper-compilation-targets@7.29.7 -> browserslist@4.28.2`.
  - `@scheduler/web@0.1.0 -> @vitejs/plugin-react@4.7.0 -> @babel/core@7.29.7 -> @babel/helper-compilation-targets@7.29.7 -> browserslist@4.28.2 -> update-browserslist-db@1.2.3 -> browserslist@4.28.2`.
- Result: Updated compatibly; absent from final npm audit.
- Baseline npm fix suggestion: `true`. This is evidence, not an automatically accepted command.
- [Browserslist: Unbounded memory growth (no cache eviction) via distinct query results, leading to eventual OOM](https://github.com/advisories/GHSA-c83g-rgw3-j3cx) - high; vulnerable versions `<=4.28.6`.
- [Browserslist: Uncaught crash / prototype write via untrusted browserslist-stats.json custom stats (normalizeStats)](https://github.com/advisories/GHSA-73wf-gq98-2v4g) - high; vulnerable versions `<=4.28.6`.

### discord.js - moderate

- Installed: `14.26.4` -> `14.27.0`. Baseline affected range: `14.0.0-dev.1640779371.9cdc448 - 14.26.5 || 15.0.0-core-gateway-rl.1762368996-5fa92a1ea - 15.0.0-dev.1744071174-d93a52c1d`.
- Exposure: Production Express/Discord bot runtime.
- Dependency paths:
  - `@scheduler/bot@0.1.0 -> discord.js@14.26.4`.
- Result: Updated compatibly; absent from final npm audit.
- Baseline npm fix suggestion: `true`. This is evidence, not an automatically accepted command.
- Propagated from: undici.

### js-cookie - high

- Installed: `2.2.1` -> `3.0.8`. Baseline affected range: `<=3.0.5`.
- Exposure: Browser GIPHY fetch/picker/analytics dependency; not imported by the backend.
- Dependency paths:
  - `@scheduler/web@0.1.0 -> @giphy/react-components@10.1.2 -> react-use@17.6.0 -> js-cookie@2.2.1`.
- Result: Updated compatibly; absent from final npm audit.
- Baseline npm fix suggestion: `{"name":"@giphy/react-components","version":"1.6.0","isSemVerMajor":true}`. This is evidence, not an automatically accepted command.
- [JavaScript Cookie: Per-instance prototype hijack in assign() enables cookie-attribute injection](https://github.com/advisories/GHSA-qjx8-664m-686j) - high; vulnerable versions `<=3.0.5`.

### nanoid - high

- Installed: `3.3.12` -> `3.3.20`. Baseline affected range: `<=3.3.17`.
- Exposure: Development-only Vite/Babel/CSS build tooling; production uses Express static serving, not the Vite dev server.
- Dependency paths:
  - `@scheduler/web@0.1.0 -> vite@6.4.3 -> postcss@8.5.15 -> nanoid@3.3.12`.
- Result: Updated compatibly; absent from final npm audit.
- Baseline npm fix suggestion: `true`. This is evidence, not an automatically accepted command.
- [nanoid: non-secure generators can loop indefinitely with negative size](https://github.com/advisories/GHSA-28wg-ghj8-5hjv) - high; vulnerable versions `<3.3.16`.
- [nanoid: custom generators can loop indefinitely when size is zero](https://github.com/advisories/GHSA-2v37-7h3g-55p8) - high; vulnerable versions `<3.3.18`.

### postcss - high

- Installed: `8.5.15` -> `8.5.31`. Baseline affected range: `<=8.5.22`.
- Exposure: Development-only Vite/Babel/CSS build tooling; production uses Express static serving, not the Vite dev server.
- Dependency paths:
  - `@scheduler/web@0.1.0 -> vite@6.4.3 -> postcss@8.5.15`.
- Result: Updated compatibly; absent from final npm audit.
- Baseline npm fix suggestion: `true`. This is evidence, not an automatically accepted command.
- [PostCSS: incomplete fix of GHSA-6g55-p6wh-862q — attacker-controlled sourceMappingURL reads arbitrary .map files when `from` is unset](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp) - moderate; vulnerable versions `<=8.5.22`.
- [PostCSS: Path Traversal in Previous Source Map Auto-Loading (sourceMappingURL) leads to Arbitrary .map File Disclosure](https://github.com/advisories/GHSA-r28c-9q8g-f849) - high; vulnerable versions `<=8.5.17`.

### qs - moderate

- Installed: `6.15.2` -> `6.16.1`. Baseline affected range: `2.2.5 - 6.15.3`.
- Exposure: Production Express/Discord bot runtime.
- Dependency paths:
  - `@scheduler/bot@0.1.0 -> express@5.2.1 -> body-parser@2.3.0 -> qs@6.15.2`.
  - `@scheduler/bot@0.1.0 -> express@5.2.1 -> qs@6.15.2`.
- Result: Updated compatibly; absent from final npm audit.
- Baseline npm fix suggestion: `true`. This is evidence, not an automatically accepted command.
- [qs array-limit bypass via bracket-key comma parsing](https://github.com/advisories/GHSA-x5fp-wj9c-mxmx) - moderate; vulnerable versions `>=6.14.2 <=6.15.3`.
- [qs: Denial of Service via Attacker Controlled isBuffer](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g) - moderate; vulnerable versions `>=2.2.5 <6.16.0`.

### react-use - high

- Installed: `17.6.0` -> `17.6.1`. Baseline affected range: `13.15.0 - 17.6.0`.
- Exposure: Browser GIPHY fetch/picker/analytics dependency; not imported by the backend.
- Dependency paths:
  - `@scheduler/web@0.1.0 -> @giphy/react-components@10.1.2 -> react-use@17.6.0`.
- Result: Updated compatibly; absent from final npm audit.
- Baseline npm fix suggestion: `{"name":"@giphy/react-components","version":"1.6.0","isSemVerMajor":true}`. This is evidence, not an automatically accepted command.
- Propagated from: js-cookie.

### source-map-js - high

- Installed: `1.2.1` -> `1.2.2`. Baseline affected range: `1.0.0 - 1.2.1`.
- Exposure: Development-only Vite/Babel/CSS build tooling; production uses Express static serving, not the Vite dev server.
- Dependency paths:
  - `@scheduler/web@0.1.0 -> vite@6.4.3 -> postcss@8.5.15 -> source-map-js@1.2.1`.
- Result: Updated compatibly; absent from final npm audit.
- Baseline npm fix suggestion: `true`. This is evidence, not an automatically accepted command.
- [source-map-js allows event-loop denial of service through indexed source-map section offsets](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) - high; vulnerable versions `>=1.0.0 <1.2.2`.

### undici - high

- Installed: `6.24.1` -> `6.29.1`. Baseline affected range: `<=6.28.0`.
- Exposure: Production Express/Discord bot runtime.
- Dependency paths:
  - `@scheduler/bot@0.1.0 -> discord.js@14.26.4 -> @discordjs/rest@2.6.1 -> undici@6.24.1`.
  - `@scheduler/bot@0.1.0 -> discord.js@14.26.4 -> undici@6.24.1`.
- Result: Updated compatibly; absent from final npm audit.
- Baseline npm fix suggestion: `true`. This is evidence, not an automatically accepted command.
- [undici vulnerable to HTTP header injection via Set-Cookie percent-decoding](https://github.com/advisories/GHSA-p88m-4jfj-68fv) - moderate; vulnerable versions `<6.27.0`.
- [undici WebSocket client vulnerable to denial of service via fragment count bypass](https://github.com/advisories/GHSA-vxpw-j846-p89q) - high; vulnerable versions `<6.27.0`.
- [undici vulnerable to Set-Cookie SameSite attribute downgrade via permissive substring matching](https://github.com/advisories/GHSA-g8m3-5g58-fq7m) - low; vulnerable versions `<6.27.0`.
- [undici vulnerable to downstream response desynchronization via retry interceptor](https://github.com/advisories/GHSA-8xcm-r25x-g524) - moderate; vulnerable versions `<6.28.0`.
- [undici vulnerable to CRLF Injection via blob-like body 'type' property](https://github.com/advisories/GHSA-m8rv-5g2x-5cg5) - moderate; vulnerable versions `<6.28.0`.
- [undici vulnerable to cookie attribute injection via unsanitized domain and unparsed setCookie fields](https://github.com/advisories/GHSA-v3r7-h72x-cjcm) - moderate; vulnerable versions `<6.28.0`.
- [undici vulnerable to HTTP response queue poisoning via keep-alive socket reuse](https://github.com/advisories/GHSA-35p6-xmwp-9g52) - low; vulnerable versions `<6.27.0`.
- [undici vulnerable to downstream response splitting via retry interceptor](https://github.com/advisories/GHSA-r53p-7pc4-xj5r) - low; vulnerable versions `<6.28.1`.
- [undici vulnerable to Denial of Service via unrequested WebSocket subprotocol](https://github.com/advisories/GHSA-rfgv-xxqx-mfg5) - high; vulnerable versions `>=6.7.0 <6.28.1`.

### uuid - moderate

- Installed: `9.0.1` -> `9.0.1`. Baseline affected range: `<11.1.1`.
- Exposure: Browser GIPHY fetch/picker/analytics dependency; not imported by the backend.
- Dependency paths:
  - `@scheduler/web@0.1.0 -> @giphy/js-fetch-api@5.8.0 -> @giphy/js-util@5.2.0 -> uuid@9.0.1`.
- Result: Unresolved; see remaining finding below.
- Baseline npm fix suggestion: `true`. This is evidence, not an automatically accepted command.
- [uuid: Missing buffer bounds check in v3/v5/v6 when buf is provided](https://github.com/advisories/GHSA-w5hq-g745-h8pq) - moderate; vulnerable versions `<11.1.1`.

### vite - high

- Installed: `6.4.3` -> `6.4.5`. Baseline affected range: `<=6.4.3`.
- Exposure: Development-only Vite/Babel/CSS build tooling; production uses Express static serving, not the Vite dev server.
- Dependency paths:
  - `@scheduler/web@0.1.0 -> @vitejs/plugin-react@4.7.0 -> vite@6.4.3`.
  - `@scheduler/web@0.1.0 -> vite@6.4.3`.
- Result: Updated compatibly; absent from final npm audit.
- Baseline npm fix suggestion: `true`. This is evidence, not an automatically accepted command.
- [launch-editor: escapeCmdArgs() omits % escaping on Windows](https://github.com/advisories/GHSA-698v-4r3x-3vcv) - moderate; vulnerable versions `<=6.4.3`.
- [launch-editor: Editor CLI flag misinterpretation causing arbitrary command execution for some editors](https://github.com/advisories/GHSA-r825-w8mm-5pxw) - moderate; vulnerable versions `<=6.4.3`.
- [launch-editor: `fs.existsSync()` existence check can be bypassed on Windows](https://github.com/advisories/GHSA-587h-7wmj-h5pm) - high; vulnerable versions `<=6.4.3`.
- [Vite: Cross origin script execution through Vite custom middleware](https://github.com/advisories/GHSA-9jrq-w75r-8gcw) - low; vulnerable versions `<=6.4.3`.
- [Vite: Files outside `server.fs.allow` could be served when project paths match system paths on non-Windows machine](https://github.com/advisories/GHSA-rq7h-c2jc-7f22) - moderate; vulnerable versions `<=6.4.3`.

## Applied compatible changes

- discord.js 14.26.4 -> 14.27.0; @discordjs/rest 2.6.1 -> 2.6.3; undici 6.24.1 -> 6.29.1. Same supported major lines.
- qs 6.15.2 -> 6.16.1; Vite 6.4.3 -> 6.4.5; PostCSS 8.5.15 -> 8.5.31; source-map-js 1.2.1 -> 1.2.2; nanoid 3.3.12 -> 3.3.20; browserslist 4.28.2 -> 4.29.4; baseline-browser-mapping 2.10.38 -> 2.11.30.
- GIPHY pins react-use exactly at 17.6.0. A narrow root override under @giphy/react-components selects upstream patch 17.6.1. Its js-cookie dependency moves to 3.x and resolves 3.0.8, above the advisory's patched version 3.0.7. No GIPHY downgrade or public component API replacement was performed. Review/remove the override when upstream changes its pin.
- Development-only exposure is based on the application import graph and production start command, not just npm's dependency classification. For example, authentication uses node:crypto randomBytes, not nanoid; Express query parsing uses qs and is production-reachable. Discord uses undici in production, so those findings were treated as runtime issues.

## Remaining finding and actual exposure

- **GHSA-w5hq-g745-h8pq / CVE-2026-41907**, reported moderate by npm: uuid 9.0.1, affected `<11.1.1`, fixed in 11.1.1. npm also reports @giphy/js-util 5.2.0 as a moderate affected entry. This is **one underlying advisory, two affected package entries**.
- Paths: @scheduler/web -> @giphy/js-fetch-api -> @giphy/js-util -> uuid; and @scheduler/web -> @giphy/react-components -> @giphy/js-util (directly and through @giphy/js-analytics) -> uuid.
- @giphy/js-util 5.2.0 requires uuid ^9.0.0. Patched uuid 11.1.1 is outside that contract. An obsolete GIPHY downgrade or forced major override has not been accepted. Options: an upstream GIPHY release using patched uuid, replacement of the UUID helper, or a separately validated major override. The finding remains visible in npm audit.
- The vulnerable behavior is caller-supplied output buffers in uuid v3/v5/v6. Inspected installed @giphy/js-util/dist/index.js imports **v4 only**, and calls **uuid() with no arguments** to generate GIPHY pingback IDs. The application imports no uuid API directly and supplies no output buffer. Vite's production build module analysis additionally checks whether the affected exports reach the bundle. This is a reachability assessment, not a vulnerability suppression.
- This dependency is in the browser/GIPHY import graph, not the running Express/Discord backend graph. npm --omit=dev still counts it because the web workspace declares GIPHY as a production dependency; that does not prove backend execution.
- The patched js-cookie advisory is separate. Dashboard sessions are HttpOnly and are never managed by GIPHY/js-cookie. The helper did not implement the dashboard's authentication boundary.

## Verification and acceptance boundary

The final staged candidate is checked without .env files using npm ci, backend/frontend tests, TypeScript checks, production build, npm audit --json and the high-severity audit gate. Exact counts and outcomes are recorded in the deployment guide. Browser/Discord/hosted database behavior still requires controlled acceptance; this dependency audit is not a penetration test or proof that every dependency is safe.
