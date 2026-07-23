# Noobnouncer — Discord Announcement Scheduler

A self-hosted dashboard and Discord bot for scheduling one-time and recurring community announcements.

## Overview

Noobnouncer is built for a Discord server administrator who wants to prepare announcements in a browser and have a bot publish them to the right channel at the chosen time. The dashboard manages the schedule and access list; the bot process sends messages and maintains their delivery history.

This is an MVP and a portfolio project. It is designed as a deployable single-service application, but this repository does not verify a public production deployment or store listing.

## What is implemented

- Password-protected dashboard sessions using signed JSON Web Tokens.
- Discord server and text-channel discovery after the bot has been invited.
- Create, edit, disable, and delete scheduled announcements.
- One-time, daily, weekly, and monthly schedules with a selected timezone.
- A scheduler that checks for due work every minute and uses a database lock to avoid duplicate sends.
- Discord member, role, `@everyone`, and `@here` mention selection, subject to Discord permissions.
- Optional GIF selection through the GIPHY API when a browser-safe GIPHY API key is configured.
- Delivery logging, persisted delayed deletion of bot-posted messages, and a `.list` bot command for allow-listed server users.
- Supabase SQL schema and migration files for the application data model.

## Technology

- TypeScript workspaces with npm.
- React 19 and Vite for the dashboard.
- Express 5 for the authenticated API and static dashboard hosting.
- discord.js for Discord gateway, guild, channel, member, and message operations.
- Supabase (Postgres) for schedules, access rules, and delivery logs.
- Zod for environment and request validation.
- Luxon for timezone and recurring-schedule calculations.

## Architecture

The repository is an npm workspace monorepo:

```text
apps/web          React dashboard
apps/bot          Express API, Discord client, scheduler, deletion worker
packages/shared   Shared announcement types and mention/media helpers
supabase          SQL schema and migration files
```

The browser calls the Express API. The API authenticates dashboard requests, synchronizes Discord metadata, and uses the Supabase service-role client only on the server. The same bot process connects to Discord and polls Supabase for due announcements. In a single-service deployment, Express serves the built dashboard from `apps/web/dist`.

## Main product flow

1. An administrator logs in and invites the bot to a Discord server.
2. The dashboard refreshes that server’s available text channels.
3. The administrator drafts an announcement, chooses its schedule, repeat rule, and optional GIF or mentions.
4. The API saves the validated announcement to Supabase.
5. The scheduler claims due work, posts it through Discord, logs the outcome, and either marks it sent or advances the next recurring occurrence.
6. A deletion worker removes bot-posted messages after one hour when that action is permitted.

## My Role

I owned the product end to end: problem framing, UX decisions, data model, dashboard, API, Discord integration, scheduler behavior, deployment configuration, testing, and release readiness. AI-assisted development was used transparently as a development aid; product decisions, architecture, implementation review, integration, testing, and release ownership remained mine.

## Local setup

Prerequisites: Node.js/npm, a Discord application and bot, and a Supabase project.

```bash
npm install
cp .env.example .env
```

On Windows PowerShell, use `Copy-Item .env.example .env` rather than `cp` if needed. Populate the local `.env` with the required values; it is ignored by Git.

```text
DISCORD_TOKEN
DISCORD_CLIENT_ID
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
ADMIN_PASSWORD
JWT_SECRET
VITE_API_URL
VITE_GIPHY_API_KEY
CORS_ORIGIN
```

Run `supabase/schema.sql` in the Supabase SQL editor. Then start the two development processes:

```bash
npm run dev:bot
npm run dev:web
```

The dashboard defaults to `http://localhost:5173`; the API defaults to `http://localhost:3001`. Enable Discord’s Message Content and Server Members intents. The bot needs View Channels, Send Messages, and Read Message History; mass mentions additionally require the relevant Discord permission.

## Deployment status

The project contains configuration guidance for a single Railway service:

```text
Build command: npm run build
Start command: npm start
```

For that setup, use `VITE_API_URL=/api` and set `CORS_ORIGIN` to the public service origin. No Railway configuration file, public URL, store listing, or deployed-environment evidence is committed here, so a public launch is not claimed.

## Verification

The repository defines the following automated checks:

```bash
npm run typecheck
npm run build
```

There is currently no lint script, unit-test script, or committed test suite. Production verification still needs a configured Discord test server and Supabase project to exercise login, Discord permissions, message delivery, recurrence, and delayed deletion.

## Screenshots

No screenshots are currently committed. When available, add real product captures under `docs/screenshots/` and reference them here; do not use mockups or unrelated assets.

## Known limitations

- Dashboard access is a shared admin password, not Discord OAuth or multi-user role-based access control.
- The scheduler runs inside one bot/API process. High-availability, queue-based processing, retries, and operational alerting are not implemented.
- The current bot command surface is limited to `.list` for users present in the server’s allow list.
- GIPHY selection requires a configured browser API key; it is optional.
- There is no automated test suite or CI workflow in this repository.

## Privacy and security

Never commit `.env` files or service credentials. The browser does not receive the Supabase service-role key; it is used by the Express process only. Dashboard authentication and Discord metadata access should be reviewed before any public deployment, especially because the MVP uses a shared admin password and can send mass mentions when Discord permissions allow them.

## License and repository status

No license file is currently included, so reuse rights have not been granted by this repository. Add an explicit license before accepting external contributions or presenting the code as reusable open source.
