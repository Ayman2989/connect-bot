import { Client, Collection, GatewayIntentBits } from "discord.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { TOKEN } from "./config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log("═══════════════════════════════════════════════");
console.log("🔍 DEBUG: Starting bot...");
console.log(`📁 Current directory: ${__dirname}`);
console.log("═══════════════════════════════════════════════");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.commands = new Collection();

// Load commands dynamically
const commandsPath = path.join(__dirname, "commands");
console.log(`📁 Commands path: ${commandsPath}`);
const commandFiles = fs
  .readdirSync(commandsPath)
  .filter((file) => file.endsWith(".js"));
console.log(`📦 Found ${commandFiles.length} command file(s):`, commandFiles);

for (const file of commandFiles) {
  console.log(`   ⚙️ Loading command: ${file}`);
  const command = await import(`./commands/${file}`);
  client.commands.set(command.data.name, command);
}

// Load events dynamically
const eventsPath = path.join(__dirname, "events");
console.log(`📁 Events path: ${eventsPath}`);
const eventFiles = fs
  .readdirSync(eventsPath)
  .filter((file) => file.endsWith(".js"));
console.log(`📦 Found ${eventFiles.length} event file(s):`, eventFiles);

for (const file of eventFiles) {
  console.log(`   ⚙️ Loading event: ${file}`);
  const fullPath = path.join(eventsPath, file);
  console.log(`   📄 Full path: ${fullPath}`);
  const event = await import(`./events/${file}`);
  console.log(`   ✅ Event name: ${event.name}, once: ${event.once}`);

  if (event.once)
    client.once(event.name, (...args) => event.execute(...args, client));
  else client.on(event.name, (...args) => event.execute(...args, client));
}

console.log("═══════════════════════════════════════════════");
console.log("🔐 Logging in to Discord...");
console.log("═══════════════════════════════════════════════");

client.login(TOKEN);
