import { createApi } from "./api.js";
import { handleMessage } from "./commands.js";
import { client, upsertGuild } from "./discord.js";
import { env } from "./env.js";
import { startScheduler } from "./scheduler.js";

client.once("ready", () => {
  console.log(`Discord bot ready as ${client.user?.tag}`);
  startScheduler();
});

client.on("messageCreate", (message) => {
  void handleMessage(message);
});

client.on("guildCreate", (guild) => {
  void upsertGuild(guild).catch((error) => {
    console.error(`Failed to sync joined guild ${guild.id}`, error);
  });
});

const app = createApi();
app.listen(env.PORT, () => {
  console.log(`API listening on http://localhost:${env.PORT}`);
});

await client.login(env.DISCORD_TOKEN);
