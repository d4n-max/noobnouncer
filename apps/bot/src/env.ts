import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { z } from "zod";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../../../.env") });
const snowflake = z.string().regex(/^\d{17,20}$/);
export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: snowflake,
  DISCORD_CLIENT_SECRET: z.string().min(1),
  DISCORD_REDIRECT_URI: z.string().url(),
  BOT_OWNER_DISCORD_ID: snowflake,
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3001),
  CORS_ORIGIN: z.string().url().default("http://localhost:5173"),
  // Trust only the last proxy; production must be reachable exclusively through Railway's proxy.
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(1).default(0),
  DEFAULT_TIMEZONE: z.string().default("Europe/Bucharest")
}).superRefine((value, ctx) => {
  const origin = new URL(value.CORS_ORIGIN);
  const callback = new URL(value.DISCORD_REDIRECT_URI);
  if (origin.origin !== value.CORS_ORIGIN || callback.pathname !== "/api/auth/discord/callback" || callback.search || callback.hash || callback.username || callback.password) {
    ctx.addIssue({ code: "custom", message: "Configure an exact dashboard origin and /api/auth/discord/callback URL" });
  }
  if (value.NODE_ENV === "production" && (origin.protocol !== "https:" || callback.origin !== origin.origin)) {
    ctx.addIssue({ code: "custom", message: "Production requires same-origin HTTPS dashboard and callback" });
  }
  if (value.NODE_ENV !== "production" && (origin.protocol !== "http:" || callback.protocol !== "http:" || ![origin.hostname, callback.hostname].every(h => h === "localhost" || h === "127.0.0.1"))) {
    ctx.addIssue({ code: "custom", message: "HTTP development is restricted to localhost or 127.0.0.1" });
  }
});
export const env = envSchema.parse(process.env);
