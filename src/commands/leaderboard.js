import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import {
  getTopTraders,
  getTopBuyers,
  getTopSellers,
} from "../database/queries.js";

export const data = new SlashCommandBuilder()
  .setName("leaderboard")
  .setDescription("View top traders leaderboard")
  .addStringOption((option) =>
    option
      .setName("type")
      .setDescription("Leaderboard type")
      .setRequired(false)
      .addChoices(
        { name: "Top Traders (Most Deals)", value: "traders" },
        { name: "Top Buyers (Most Spent)", value: "buyers" },
        { name: "Top Sellers (Most Earned)", value: "sellers" }
      )
  );

export async function execute(interaction) {
  const type = interaction.options.getString("type") || "traders";

  await interaction.deferReply();

  try {
    let leaderboard;
    let title;
    let description;

    switch (type) {
      case "traders":
        leaderboard = getTopTraders(10);
        title = "🏆 Top Traders Leaderboard";
        description = "Most active traders by total deals completed";
        break;
      case "buyers":
        leaderboard = getTopBuyers(10);
        title = "💰 Top Buyers Leaderboard";
        description = "Highest spending buyers";
        break;
      case "sellers":
        leaderboard = getTopSellers(10);
        title = "📦 Top Sellers Leaderboard";
        description = "Highest earning sellers";
        break;
    }

    if (!leaderboard || leaderboard.length === 0) {
      await interaction.editReply({
        content: "📊 No data available yet. Complete some deals first!",
      });
      return;
    }

    let leaderboardText = "";

    for (let i = 0; i < leaderboard.length; i++) {
      const entry = leaderboard[i];
      const user = await interaction.client.users
        .fetch(entry.user_id)
        .catch(() => null);
      const username = user ? user.tag : `User ${entry.user_id}`;

      const medal =
        i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`;

      if (type === "traders") {
        const netPos = entry.net_position;
        leaderboardText +=
          `${medal} **${username}**\n` +
          `   Deals: ${entry.total_deals} | Net: $${netPos.toFixed(2)}\n\n`;
      } else if (type === "buyers") {
        leaderboardText +=
          `${medal} **${username}**\n` +
          `   Deals: ${
            entry.deals_as_buyer
          } | Spent: $${entry.total_spent.toFixed(2)}\n\n`;
      } else if (type === "sellers") {
        leaderboardText +=
          `${medal} **${username}**\n` +
          `   Deals: ${
            entry.deals_as_seller
          } | Earned: $${entry.total_earned.toFixed(2)}\n\n`;
      }
    }

    const leaderboardEmbed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(`${description}\n\n${leaderboardText}`)
      .setColor("#153ee9")
      .setTimestamp()
      .setFooter({ text: "Use /stats to view your own statistics" });

    await interaction.editReply({ embeds: [leaderboardEmbed] });
  } catch (error) {
    console.error("Error fetching leaderboard:", error);
    await interaction.editReply({
      content: "❌ Error fetching leaderboard. Please try again later.",
    });
  }
}
