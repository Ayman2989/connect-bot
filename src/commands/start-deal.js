import {
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  EmbedBuilder,
} from "discord.js";

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

export const data = new SlashCommandBuilder()
  .setName("start-deal")
  .setDescription("Start a new escrow deal and choose the cryptocurrency");

export async function execute(interaction) {
  const embed = new EmbedBuilder()
    .setTitle("🤝 Start Your Deal")
    .setDescription(
      "Select your preferred cryptocurrency to start the escrow process."
    )
    .setColor("#00A86B");

  const select = new StringSelectMenuBuilder()
    .setCustomId("coinSelect")
    .setPlaceholder("Select your coin")
    .addOptions(options);

  const row = new ActionRowBuilder().addComponents(select);
  await interaction.reply({
    embeds: [embed],
    components: [row],
    ephemeral: true,
  });
}
