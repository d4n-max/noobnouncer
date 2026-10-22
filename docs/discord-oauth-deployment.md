# Discord dashboard authentication: setup and release

The implementation is on the feature branch. This hardening pass changes code and documentation only; it does not apply migrations, modify production variables, merge main, or deploy.

## Access model and security contract

- BOT_OWNER comes exclusively from BOT_OWNER_DISCORD_ID and can access every server where the bot is currently installed, plus global settings.
- SERVER_ADMIN comes from fresh Discord guild ownership, Administrator or Manage Guild permissions. Guild membership, role assignments and role permission bitfields are fetched through bot-authenticated Discord REST requests on every protected operation; cached Discord.js permission flags and frontend roles are not authorization sources.
- EDITOR is an explicit dashboard_access assignment and also requires current Discord server membership. Editors manage announcements, channels, roles and mention searches only.
- Server administrators and the owner manage Dashboard Access and the separate allowed_users list used by .list. Editor assignments never grant .list access and .list assignments never grant dashboard access.
- Guild listing intersects installed bot guilds with the same live permission checks. Unverifiable permissions fail closed. All announcement reads are scoped; updates and deletes check existing ownership and apply guild predicates. Announcements cannot change guild, including for the owner. Channel ownership is checked with Discord before create/update.
- /api/settings is owner-only. The existing application has no persisted server-settings or delivery-history API; future endpoints must use the same guild checks. Scheduling and delivery workers continue independently of dashboard sessions.

Discord Authorization Code login requests identify and guilds, uses S256 PKCE and a random state bound to a separate HttpOnly browser cookie. A database DELETE RETURNING consumes state atomically, once, within ten minutes, including failed callbacks. Redirects are fixed configuration values. OAuth access/refresh tokens never reach the browser or persist in the database; the access token is revoked best-effort after identity discovery. Subsequent permission checks use the bot token.

Sessions last 24 hours with random 256-bit opaque identifiers. Only SHA-256 token hashes and CSRF hashes persist. Production cookies use the __Host- prefix, Secure, HttpOnly, Path=/, no Domain and SameSite=Lax (needed for the OAuth callback). Local HTTP cookies are restricted by configuration to loopback development. /api/auth/me returns a CSRF token held only in frontend memory; all authenticated mutations, including logout, require it and the exact configured Origin. Sessions expire and logout records revocation immediately. To revoke every session for one user in an administrator SQL console:

```sql
update public.dashboard_sessions set revoked_at = now()
where discord_user_id = 'REPLACE_WITH_DISCORD_USER_ID' and revoked_at is null;
```

Login rotates the browser's prior session. Expired state/session rows are removed on subsequent login starts. Do not log OAuth query strings, Authorization headers or cookies in proxy/access logs. No credentials are logged by the new handlers.

## Discord Developer Portal

1. Open https://discord.com/developers/applications and select the existing bot application.
2. Under General Information, copy Application ID into DISCORD_CLIENT_ID. Under OAuth2, supply the confidential Client Secret directly to your local ignored .env and Railway secret variables. Do not paste it into chat. Keep the application confidential (not a public client).
3. Under OAuth2 > Redirects, add these exact entries for the environments you use:
   - Development with the Vite proxy: http://localhost:5173/api/auth/discord/callback
   - Production: https://YOUR-RAILWAY-DOMAIN/api/auth/discord/callback
   Replace YOUR-RAILWAY-DOMAIN with the actual service/custom hostname, without an extra path or trailing slash. Redirect URI, scheme, port and path must match DISCORD_REDIRECT_URI exactly.
4. Login scopes identify and guilds are set by the backend automatically. PKCE is S256; no secret is embedded in the login URL or frontend. Bot installation remains a separate bot-scope invite; do not replace it with the user-login URL.
5. Preserve Message Content and Server Members privileged intents under Bot. Preserve existing bot permissions: View Channel, Send Messages, Read Message History and Mention Everyone when required. Do not rotate the bot token for this change.
6. Enable Developer Mode in Discord, copy the owner's immutable user ID, and set BOT_OWNER_DISCORD_ID. For an editor, copy their user ID and add it in the selected server's Dashboard Access screen. The editor must already be a member of that server.

Discord's provider metadata advertises S256: https://discord.com/.well-known/oauth-authorization-server . OAuth reference: https://docs.discord.com/developers/topics/oauth2 .

## Database migration order

For an existing scheduler database, back up the application tables and apply only:

`supabase/migrations/20261022145601_dashboard_discord_oauth.sql`

Run its contents in the intended project's Supabase SQL editor before releasing the new API. It is transactional and repeatable; it creates dashboard_users, dashboard_access, dashboard_sessions and dashboard_oauth_states with indexes, constraints, foreign keys, RLS and service-role-only grants. Existing guilds, channels, announcements, allowed_users and delivery_logs are preserved. Grantees need not have logged in yet, so dashboard_access.discord_user_id deliberately has no dashboard_users FK; the granting account and sessions do have user FKs. The role constraint accepts only EDITOR.

For a fresh, dedicated installation, run supabase/schema.sql instead; it includes the new tables. Do not rerun the complete fresh-install schema on production as an auth migration: it includes historical scheduling normalization.

Do not blindly run `supabase db push` on this checkout: it already contains unrelated, untracked migration files from other work. Select the auth SQL file explicitly and use your established migration-history process. No pre-existing migration file was modified by this implementation.

The service role bypasses RLS. All tenant checks therefore execute in the Express API; the new table grants/RLS provide an additional direct-API barrier. Verify new tables are accessible to service_role and inaccessible to anon/authenticated in your target Data API configuration. Reference: https://supabase.com/docs/guides/api/securing-your-api .

## Local configuration

Keep existing .env values; merge the new variable names from .env.example without overwriting credentials. Use:

```dotenv
NODE_ENV=development
PORT=3001
CORS_ORIGIN=http://localhost:5173
DISCORD_REDIRECT_URI=http://localhost:5173/api/auth/discord/callback
TRUST_PROXY_HOPS=0
VITE_API_URL=/api
DEFAULT_TIMEZONE=Europe/Bucharest
```

Also supply DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, BOT_OWNER_DISCORD_ID, SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. VITE_GIPHY_API_KEY remains optional and browser-safe. ADMIN_PASSWORD and JWT_SECRET are ignored by the OAuth release, but must be retained securely, with their exact previous values, in the existing Railway service and the operator secret manager throughout the rollback window. Do not delete, print, commit or rotate them during that window. Old browser JWTs are removed on dashboard load. Do not use VITE_ for any backend secret.

Run `npm install`, then `npm run dev:bot` and `npm run dev:web` in separate terminals. Open http://localhost:5173 consistently, not 127.0.0.1. Vite proxies /api to localhost:3001. Direct callback to http://localhost:3001/api/auth/discord/callback is also supported if registered exactly and set in DISCORD_REDIRECT_URI, but the same-origin Vite URL is preferred. Use one hostname throughout so cookies are consistent.

## Railway release procedure (manual, authorized release only)

1. Confirm the intended service/domain, preserve the existing database and bot credentials, and apply the single auth migration above to its actual Supabase project.
2. Register the production callback in Discord before changing the service.
3. Set these Railway variables (replace YOUR-RAILWAY-DOMAIN literally everywhere):

```dotenv
NODE_ENV=production
CORS_ORIGIN=https://YOUR-RAILWAY-DOMAIN
DISCORD_REDIRECT_URI=https://YOUR-RAILWAY-DOMAIN/api/auth/discord/callback
VITE_API_URL=/api
TRUST_PROXY_HOPS=1
DEFAULT_TIMEZONE=Europe/Bucharest
```

4. Supply DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET and BOT_OWNER_DISCORD_ID. Retain DISCORD_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and optional VITE_GIPHY_API_KEY. Railway supplies PORT; do not hardcode it. Retain ADMIN_PASSWORD and JWT_SECRET with their exact prior values throughout the rollback window; they are required by the previous password-auth release and are not used by the OAuth handlers. All existing password sessions become invalid with the new code.
5. Build command: `npm run build`. Start command: `npm start`. Ensure VITE_API_URL=/api is present during build, because Vite embeds it. Serve the frontend from this same Express service over HTTPS, with no wildcard CORS or cross-site cookie deployment.
6. TRUST_PROXY_HOPS=1 trusts only the last proxy, not arbitrary chains. Ensure the production listener is reachable exclusively through Railway's HTTPS reverse proxy. Use 0 outside that topology. Keep the existing replica count and operational configuration. Login limiting is per process (20 attempts/minute/IP); multiple replicas need shared/edge limits before broader public use.
7. Deploy the reviewed changes using the existing release process only after authorization. Check /health, then perform the manual tests below. Remove any proxy logs of OAuth callback query strings/cookies. No deploy command has been executed here.

## Automated checks and results

Commands: `npm test`, `npm run typecheck`, `npm run build`, and `git diff --check` for the changed paths. There is no lint script in the repository.

The API integration suite uses an isolated HTTP server, a filtering/mutating PostgREST double, fake environment values and a mocked Discord HTTP provider. It exercises successful PKCE login; invalid/expired/mismatched/replayed and concurrently replayed state; provider denial/errors; missing/expired sessions; logout; owner/admin/editor roles; forbidden access management; unauthorized identities; guild resource isolation; announcement IDOR and channel/guild reassignment; editor/membership/admin revocation; CSRF; database failures; and secure production cookie attributes. Existing recurrence tests remain intact, including the user's pre-existing test changes.

SQL was additionally executed in an isolated PGlite PostgreSQL instance: fresh schema, auth migration twice, unique assignment, FK checks, role escalation rejection, four RLS tables, denied anonymous/authenticated session reads and allowed service-role writes. The fresh schema's pgcrypto extension declaration was omitted in that engine because gen_random_uuid is built in; the auth migration ran unchanged. This is local SQL evidence, not hosted Supabase/PostgREST acceptance.

Browser checks use API fixtures and verify login UI, admin Dashboard Access, editor-only navigation after server switching, account logout, empty-authorized-server UI and expiry handling. These do not prove production OAuth or Discord delivery.

## Before enabling production access

Use two controlled Discord servers and owner, administrator, editor and unprivileged accounts. Confirm actual login, denied/cancelled consent, expired/invalid state, session expiry and logout. Inspect production cookies for Secure/HttpOnly/SameSite=Lax and verify no tokens appear in browser storage, response bodies or logs. Attempt cross-server IDs/channels manually and confirm 403 without mutation.

Grant/revoke an editor in one server, remove their Discord membership, and remove an administrator's Manage Server permission; confirm the next protected request fails. Ensure Discord Administrator or server ownership is also removed when testing administrator revocation. Verify that .list remains governed by allowed_users, independently of Dashboard Access.

Create a real one-time and recurring announcement with the desired timezone, GIF and mentions; verify delivery logs, locking/duplicate prevention and one-hour automatic deletion. Confirm scheduling continues after all dashboard users log out. Hosted schema/service-role queries, the Railway proxy path, provider rate limits and these real deliveries remain unverified until this manual acceptance.

## Initial implementation limitations (superseded by hardening below)

Fresh permission checks trade API latency and Discord rate-limit usage for immediate revocation. Discord outages/rate limits deny access; the UI may show no authorized servers until refresh. No cross-request permission-result cache is used. Request-scoped decisions are shared by middleware and handlers, and discarded after that request. OAuth grant revocation is best-effort after login, and users must log in again after 24 hours. Profile names/avatars refresh on login. No permanent user-token storage or refresh-token infrastructure is introduced.

The dependency audit still reports pre-existing moderate/high advisories outside the authentication replacement. The critical proxy-addr advisory was addressed with a compatible transitive update; GIPHY/browser tooling and Discord dependency advisories require a separate compatibility review before a public rollout. Do not run audit fix --force blindly. No claim of production security acceptance is made from mocked tests.

## Change inventory and local verification result

Created:

- apps/bot/src/authorization.ts
- apps/bot/src/auth.integration.test.ts
- apps/bot/src/scheduler.regression.test.ts
- supabase/migrations/20261022145601_dashboard_discord_oauth.sql
- docs/discord-oauth-deployment.md

Modified:

- apps/bot/src/auth.ts
- apps/bot/src/api.ts
- apps/bot/src/env.ts
- apps/bot/package.json (removed jsonwebtoken and its types)
- apps/web/src/App.tsx
- apps/web/src/api.ts
- apps/web/src/styles.css
- apps/web/vite.config.ts
- supabase/schema.sql
- .env.example
- README.md
- package.json (root test command)
- package-lock.json (JWT removal and compatible proxy-addr security update)

Local result on 2026-10-22: 27 tests passed with the pre-existing working-tree test edits included. The publication snapshot preserves those edits locally and has 26 passing tests, 0 failed; TypeScript typecheck and production build also passed. SQL and fixture-browser results are described above. The full dependency audit reports 15 advisories (6 moderate, 9 high, 0 critical). Authenticated API requests are limited to 120/minute/user/process in addition to login limits.

The user's existing announcementRules.test.ts edits and pre-existing untracked migration/backup files were preserved. Implementation ran directly under the handoff skill's dirty-working-tree rule; no worker delegation/correction pass was applicable. The initial implementation phase performed no commit, push, live database change or deployment. GitHub publication is a separate step; it does not authorize a production release.

## Rollback window and exact rollback procedure

This is a manual runbook, not authorization to perform a release. No production variables are changed by the feature-branch push.

Before a controlled OAuth release, record the known-good password-auth revision **6959790949c91fbdec9010e9e5627eac0025ada3**, its Railway deployment/image ID, public URL, replica count, and build/start commands. Keep the old image if Railway retention permits. Back up the existing scheduler tables. Retain the existing **ADMIN_PASSWORD** (minimum 8 characters in that release) and **JWT_SECRET** (minimum 16 characters) securely in the existing Railway service and the operator's secret manager. Also retain DISCORD_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CORS_ORIGIN, DEFAULT_TIMEZONE and the build-time VITE_API_URL=/api. Never put secrets in a rollback command, commit, issue, screenshot or CI variable. Extra OAuth variables are harmless to the previous Zod schema, which strips unknown fields.

Keep these legacy credentials through completion of controlled multi-server acceptance and a seven-day stable observation window, whichever ends later. Record the owner who closes the window explicitly. Only after that decision may an authorized operator remove the unused variables and retire old release artifacts. OAuth has no password fallback endpoint; retention does not reactivate shared-password login in the new release.

If rollback is needed:

1. **Restrict dashboard access first.** The password release has global administrator access and no tenant isolation. Put the dashboard behind the established operator-only network/access gate or maintenance procedure; stop editor/public dashboard acceptance. Leave the bot/scheduler running unless incident response specifically requires otherwise. Old JWTs signed with the retained secret may become valid again, including long-lived Remember Device tokens; treat all prior token holders as global administrators during rollback.
2. In the existing Railway **noobnouncer / production** service, select the recorded known-good password deployment, verify its source SHA is exactly **6959790949c91fbdec9010e9e5627eac0025ada3**, and use its rollback/redeploy action **only if the retained artifact is available**. Do not redeploy the latest OAuth deployment by mistake. Preserve the service, database, volume, replica and source-branch configuration.
3. If that image has expired, rebuild the exact old source in an isolated checkout. From a separate operator shell with explicit release authorization, use the following PowerShell commands. Choose a new, nonexistent checkout directory; do not reset this working tree or change main:

```powershell
git fetch origin
git worktree add --detach C:\Temp\noobnouncer-password-rollback 6959790949c91fbdec9010e9e5627eac0025ada3
Set-Location C:\Temp\noobnouncer-password-rollback
npm ci
npm run typecheck
npm run build
# DEPLOYMENT: execute only as the separately authorized rollback action.
railway up --project 13af5b5b-f7b0-49e4-886d-bd7c0104a1e1 --service noobnouncer --environment production --ci
```

The Railway IDs/service above identify the existing project observed during the publication check. Verify the destination in the dashboard immediately before using the command. `railway up` uploads this isolated source and uses the service's retained variables and build settings. Do not use --new, --no-gitignore, or commands that create or reconnect a service. The local build requires no production credential values. If an operator needs a real password-auth startup check, supply credentials only through the approved secret mechanism, never in command arguments or logs.

4. **Do not reverse the auth migration.** dashboard_users, dashboard_access, dashboard_sessions and dashboard_oauth_states are additive and ignored by the old release. Keep them, all existing guilds/channels/announcements/allowed_users/delivery_logs, and their grants. Do not restore an old database backup over announcements created since release. There are no hardening migrations.
5. Verify the Railway deployment source SHA and successful runtime status. `GET https://noobnouncer-production.up.railway.app/health` must return `{ "ok": true }`. In a fresh/private browser, `/api/auth/me` without credentials must return 401 and the old password form must render. Log in using the retained password without capturing or sharing it; verify authenticated API access, guild/channel discovery and create/edit/disable/delete in a controlled server. OAuth-only sessions should not authenticate the old API; its bearer JWTs are a different mechanism. Re-login is expected because the OAuth frontend removed old browser tokens.
6. Verify scheduler startup, a controlled delivery and delivery_logs persistence, recurrence in the selected timezone, duplicate-send protection and one-hour deletion. Confirm .list still uses allowed_users. Compare row counts/IDs with the pre-release record; never delete real announcement rows as a rollback check. Keep public/editor dashboard access closed while the legacy release is active.
7. Record the rollback result and incident cause. To try OAuth again, deploy the reviewed OAuth revision through a separately authorized release, keep the legacy variables during the renewed rollback window, retain the additive auth tables, and rerun all manual OAuth/tenant acceptance checks before reopening access.

## Guild discovery and Discord failure behavior after hardening

A protected HTTP request creates one authorization scope. Middleware and management handlers share its in-flight/completed decision for the same user and guild, reducing an admin management request from six permission REST reads to three. Nothing grants access from another HTTP request's result: the next request fetches fresh guild metadata, membership and role bitfields, and queries explicit editor assignments again. Guild owners skip the unnecessary role-list read after fresh guild/member verification. The Bot Owner's discovery uses the freshly paginated bot guild list directly, avoiding N additional guild reads; resource operations still verify bot installation with a guild read. Channel listing synchronizes channels once rather than twice, and granting dashboard/.list access avoids unnecessary channel enumeration.

Authorization REST reads are serialized per API process, with a maximum queue of 100, three attempts, a 15-second authorization-scope budget (including queue time), and a five-second maximum individual fetch timeout. Discord 429 handling honors retry_after, Retry-After, global throttling and rate-limit reset headers. A delay beyond the remaining request budget produces 503 with Retry-After instead of retrying early. Network errors and 5xx get bounded backoff; 403/404 deny immediately. No stale-allow fallback exists. This limiter coordinates these dashboard authorization calls only: discord.js gateway/synchronization/scheduler traffic uses its own limiter, and multiple replicas need shared/edge coordination for bot-wide rate limits.

A failed guild is excluded from discovery; other guilds may still be returned if independently verified. Such a partial result carries X-Guild-Discovery-Partial and the frontend shows a refresh warning. If no guild can be returned because verification failed, the API returns 503 rather than misrepresenting an outage as an empty authorized-server list. A genuine user with no access still sees the existing friendly guidance. In that empty state only BOT_OWNER sees Invite bot, using the existing authenticated invite endpoint; other users do not gain onboarding permissions.

## Dependency audit and CI after hardening

See [the complete dependency report](security/dependency-audit.md), [baseline JSON](security/npm-audit-baseline.json) and [current JSON](security/npm-audit.json). Counts refer to npm's affected-package entries, not distinct CVEs. The baseline is the committed 2deb027 dependency tree. Compatible updates and a scoped react-use patch override remove all high findings. The remaining uuid/GIPHY finding and its shipped code path are documented rather than hidden by an incompatible downgrade or forced major override.

The GitHub Actions workflow `.github/workflows/ci.yml` runs only for pull requests targeting main: npm ci, npm test, npm run typecheck, npm run build and an audit gate at high severity. It uses Node 22, read-only contents permission, pinned checkout/setup-node actions, no persisted checkout credentials, no production secrets, no deployment step, and no pull_request_target trigger. Tests create fake configuration before importing backend modules. A feature-branch push alone does not start this workflow. No PR is created as part of this task; hosted CI execution remains unverified until an authorized PR is opened.

## Hardening verification result and acceptance decision

On 2026-10-22, a clean snapshot of the staged publication files (excluding the pre-existing local announcementRules.test.ts edits and every .env/local SQL file) was installed with **npm ci** and verified using **Node 22.23.4**, matching the CI major line:

- npm test: **46 passed, 0 failed** (43 backend, 3 frontend).
- The original working tree on Node 24 additionally passes its preserved local test: **47 passed, 0 failed**.
- npm run typecheck: passed.
- npm run build: passed; a clean build uses the default /api URL without any .env file or production secret.
- npm audit --json: exit **1**, correctly reporting **2 moderate affected entries**, **0 high**, **0 critical**. Raw final JSON is committed in docs/security/npm-audit.json.
- npm audit --audit-level=high: exit **0**. The CI gate allows the documented moderate finding and fails on future high/critical findings.
- Browser fixture checks: the empty Bot Owner screen offers Invite bot; a normal unauthorized identity remains covered by the frontend regression test; the GIPHY picker mounts and renders a mocked empty response using react-use 17.6.1 with no browser errors. No real Discord invite or GIPHY account request was performed.
- Vite production module analysis: only uuid rng/stringify/native/v4 modules are rendered. Vulnerable v3/v5 implementations are absent. Evidence: docs/security/bundle-reachability.json.
- Security regression tests include OAuth/session/CSRF isolation, fresh editor/admin revocation, per-request deduplication, partial/total discovery outages, 429/global cooldown behavior, bounded transient retries, Retry-After, released error response bodies, unchanged scheduler behavior, and retained legacy credentials being ignored by the OAuth release.

**Decision: ready to enter controlled production acceptance testing, with the documented moderate browser dependency finding retained for follow-up.** This is not approval to deploy or open public access. Hosted GitHub Actions has not run because no PR was opened. Real OAuth consent/callback, actual Discord permissions and revocation, hosted Supabase/session persistence, the Railway proxy and real delivery/deletion still need the controlled checks above. Keep rollback secrets and operator-only rollback procedures available until the acceptance and rollback windows close.

The hardening commit/push targets only feature/discord-oauth-multiuser. main, production environment values, service settings and database state are unchanged. No migration is introduced or applied. The user's unrelated test edit, .env, SQL backup and 43 pre-existing SQL migrations remain local and unmodified. No DeepSeek worker/correction pass was used because the repository was dirty at task start.
