# Discord Announcement Scheduler

A small TypeScript monorepo for scheduling Discord announcements from a dark web dashboard. The bot posts messages automatically, supports one-time and recurring schedules, and gates prefix commands through Supabase-backed allowed users.

## Project Structure

```txt
apps/web          React + Vite dashboard
apps/bot          Express API, discord.js bot, scheduler worker
packages/shared  Shared TypeScript types
supabase          Database schema
```

## Discord Setup

1. Open the Discord Developer Portal and create an application.
2. Add a bot, copy the bot token, and put it in `.env` as `DISCORD_TOKEN`.
3. Enable these privileged gateway intents for the bot:
   - Message Content Intent
   - Server Members Intent
4. Invite the bot with these permissions:
   - View Channels
   - Send Messages
   - Read Message History
5. Use this invite URL shape:

```txt
https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=274878024704&integration_type=0&scope=bot
```

## Supabase Setup

1. Create a Supabase project.
2. Open the SQL editor and run `supabase/schema.sql`.
3. Copy your project URL and service role key into `.env`.

The web dashboard never receives the service role key. It talks to the local Express API, and the API talks to Supabase server-side.

## Local Development

```bash
npm install
```

Create a local `.env` file with your Discord, Supabase, admin, and Vite API values. Do not commit this file.

Run the bot/API in one terminal:

```bash
npm run dev:bot
```

Run the dashboard in another terminal:

```bash
npm run dev:web
```

Open `http://localhost:5173`. The API runs on `http://localhost:3001`.

Required environment values:

```txt
DISCORD_TOKEN=...
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
ADMIN_PASSWORD=...
JWT_SECRET=...
PORT=3001
CORS_ORIGIN=http://localhost:5173
DEFAULT_TIMEZONE=Europe/Bucharest
VITE_API_URL=http://localhost:3001/api
```

## Using the Dashboard

1. Log in with `ADMIN_PASSWORD`.
2. Go to Announcements.
3. Select a server and channel.
4. Create a message with date, time, timezone, repeat type, and status.
5. Keep the bot process running. The scheduler checks once per minute.

The default timezone is `Europe/Bucharest`. Times are saved as UTC in Supabase.

## Allowed Users

The Allowed Users page lets you select a guild, search Discord members, and add them to `allowed_users`.

Only users in `allowed_users` for that guild can use bot commands. For this MVP, dashboard access uses a simple admin password and signed token. The API and UI are structured so Discord OAuth can replace that later.

## Bot Commands

Prefix commands are used for now.

```txt
.list
```

`.list` checks the author against `allowed_users` for the guild and replies with upcoming scheduled announcements.

## Scheduler Behavior

The worker runs every minute. It:

- finds due announcements with `status = scheduled`
- claims each row with a short `locked_until` database lock
- sends the message to the Discord channel
- marks one-time announcements as `sent`
- moves recurring announcements to the next daily, weekly, or monthly `scheduled_at`
- writes `delivery_logs` rows for sent and failed attempts

## Railway Deployment

Create one Railway service from this repository.

Recommended settings:

```txt
Build command: npm run build
Start command: npm start
```

Add the same environment variables from your local `.env`. For a single-service deploy, set:

```txt
CORS_ORIGIN=https://your-railway-domain.up.railway.app
VITE_API_URL=/api
```

The Express API serves the built dashboard from `apps/web/dist`, so the Railway service hosts both the web dashboard and bot/API process.
