console.log("═══════════════════════════════════════════════");
console.log("🔍 ready.js file is being imported!");
console.log("═══════════════════════════════════════════════");

import {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  EmbedBuilder,
} from "discord.js";

export const name = "ready";
export const once = true;

// ⚠️ MUST BE A STRING IN QUOTES!
const CHANNEL_ID = "1428695614346104894";

console.log(`🔍 CHANNEL_ID defined as: "${CHANNEL_ID}"`);
console.log(`🔍 CHANNEL_ID type: ${typeof CHANNEL_ID}`);
console.log(`🔍 CHANNEL_ID length: ${CHANNEL_ID.length} characters`);

const options = [
  {
    label: "Bitcoin (BTC)",
    description: "Pay with Bitcoin",
    value: "BTC",
    emoji: "🪙",
  },
  {
    label: "Litecoin (LTC)",
    description: "Pay with Litecoin",
    value: "LTC",
    emoji: "💎",
  },
  {
    label: "Ethereum (ETH)",
    description: "Pay with Ethereum",
    value: "ETH",
    emoji: "⚡",
  },
  {
    label: "Solana (SOL)",
    description: "Pay with Solana",
    value: "SOL",
    emoji: "🌞",
  },
  {
    label: "USDT (Tether)",
    description: "Pay with Tether",
    value: "USDT",
    emoji: "💵",
  },
  {
    label: "USDC (USD Coin)",
    description: "Pay with USD Coin",
    value: "USDC",
    emoji: "💸",
  },
];

export async function execute(client) {
  console.log("═══════════════════════════════════════════════");
  console.log("🔍 ready.js execute() function is now running!");
  console.log("═══════════════════════════════════════════════");
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`🔍 Will now attempt to fetch channel: "${CHANNEL_ID}"`);
  console.log(`🔍 Channel ID type before fetch: ${typeof CHANNEL_ID}`);

  try {
    const channel = await client.channels.fetch(CHANNEL_ID);

    if (!channel) {
      console.error("❌ Channel fetch returned null/undefined!");
      return;
    }

    console.log(`✅ SUCCESS! Channel found:`);
    console.log(`   Name: #${channel.name}`);
    console.log(`   ID: ${channel.id}`);
    console.log(`   Type: ${channel.type}`);

    const embed = new EmbedBuilder()
      .setTitle("🤝 Start Your Escrow Deal")
      .setDescription(
        "Select your preferred cryptocurrency to start the escrow process."
      )
      .setColor("#00A86B");

    const select = new StringSelectMenuBuilder()
      .setCustomId("coinSelect")
      .setPlaceholder("Select your coin")
      .addOptions(options);

    const row = new ActionRowBuilder().addComponents(select);

    console.log(`📤 Sending dropdown menu to #${channel.name}...`);

    await channel.send({
      embeds: [embed],
      components: [row],
    });

    console.log("✅ Dropdown menu sent successfully!");
  } catch (error) {
    console.error("═══════════════════════════════════════════════");
    console.error("❌ ERROR OCCURRED:");
    console.error("═══════════════════════════════════════════════");
    console.error(`Channel ID we tried to fetch: "${CHANNEL_ID}"`);
    console.error(`Error name: ${error.name}`);
    console.error(`Error message: ${error.message}`);
    console.error(`Error code: ${error.code}`);
    if (error.url) {
      console.error(`API URL called: ${error.url}`);
    }
    console.error("\nFull error object:");
    console.error(error);
  }
}
