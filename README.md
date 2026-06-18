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
2. On the General Information page, copy the Application ID and put it in `.env` as `DISCORD_CLIENT_ID`.
3. Add a bot, copy the bot token, and put it in `.env` as `DISCORD_TOKEN`.
4. Enable these privileged gateway intents for the bot:
   - Message Content Intent
   - Server Members Intent
5. Invite the bot with these permissions:
   - View Channels
   - Send Messages
   - Read Message History
6. Use the dashboard's Invite bot button, or use this invite URL shape:

```txt
https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=68608&scope=bot
```

## Supabase Setup

1. Create a Supabase project.
2. Open the SQL editor and run `supabase/schema.sql`.
3. Copy your project URL and service role key into `.env`.

The web dashboard never receives the service role key. It talks to the local Express API, and the API talks to Supabase server-side.

## Local Development

```bash
npm install
cp .env.example .env
```

Fill `.env` locally with your Discord, Supabase, admin, and Vite API values. Never commit `.env`.

Run the bot/API in one terminal:

```bash
npm run dev:bot
```

Run the dashboard in another terminal:

```bash
npm run dev:web
```

Open `http://localhost:5173`. The API runs on `http://localhost:3001`.

The safe `.env.example` file contains placeholders for:

```txt
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
ADMIN_PASSWORD=
JWT_SECRET=
VITE_API_URL=http://localhost:3001/api
CORS_ORIGIN=http://localhost:5173
```

## Using the Dashboard

1. Log in with `ADMIN_PASSWORD`.
2. Go to Announcements.
3. Select a server and channel.
4. Create a message with date, time, timezone, repeat type, and status.
5. Keep the bot process running. The scheduler checks once per minute.

The default timezone is `Europe/Bucharest`. Times are saved as UTC in Supabase.

Servers are not added manually. Invite the bot to another Discord server with the Invite bot button, then click Refresh servers in the dashboard. The new server appears after Discord adds the bot and the backend syncs the live guild list. If a server has no channels in the dashboard, check that the bot can view and send messages in at least one text channel.

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
- stores the Discord message id and schedules auto-delete for 30 minutes later
- marks one-time announcements as `sent`
- moves recurring announcements to the next daily, weekly, or monthly `scheduled_at`
- writes `delivery_logs` rows for sent and failed attempts
- deletes posted announcement messages after 30 minutes using persisted `delivery_logs` state

For auto-delete to work, the bot needs View Channel, Send Messages, and Read Message History in the target channel. Manage Messages is only needed if the bot ever deletes messages not created by itself.

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
