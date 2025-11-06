import {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
} from "discord.js";
import { getUserStats, getUserDeals } from "../database/queries.js";

export const data = new SlashCommandBuilder()
  .setName("stats")
  .setDescription("View your escrow deal statistics")
  .addUserOption((option) =>
    option
      .setName("user")
      .setDescription("User to check stats for (admin only)")
      .setRequired(false)
  )
  .addBooleanOption((option) =>
    option
      .setName("public")
      .setDescription("Show stats publicly (default: private)")
      .setRequired(false)
  );

export async function execute(interaction) {
  const targetUser = interaction.options.getUser("user") || interaction.user;
  const isPublic = interaction.options.getBoolean("public") || false;

  // ✅ Check permissions
  if (targetUser.id !== interaction.user.id) {
    if (
      !interaction.member.permissions.has(PermissionFlagsBits.Administrator)
    ) {
      await interaction.reply({
        content: "❌ Only administrators can view other users' stats!",
        ephemeral: true,
      });
      return;
    }
  }

  await interaction.deferReply({ ephemeral: !isPublic });

  try {
    // ✅ ULTRA-FAST DATABASE QUERY
    const stats = getUserStats(targetUser.id);

    if (!stats || stats.total_deals === 0) {
      await interaction.editReply({
        content: `📊 ${targetUser} has not completed any escrow deals yet.`,
      });
      return;
    }

    const netPosition = stats.total_earned - stats.total_spent;
    const lastDealDate = new Date(stats.last_deal_at);

    // Get recent deals
    const recentDeals = getUserDeals(targetUser.id, 5);
    const recentDealsText =
      recentDeals.length > 0
        ? recentDeals
            .map((deal, i) => {
              const role = deal.buyer_id === targetUser.id ? "Buyer" : "Seller";
              return `${i + 1}. ${role} - $${deal.deal_amount.toFixed(2)} (${
                deal.coin
              })`;
            })
            .join("\n")
        : "No recent deals";

    const statsEmbed = new EmbedBuilder()
      .setTitle(`📊 Escrow Statistics for ${targetUser.tag}`)
      .setThumbnail(targetUser.displayAvatarURL())
      .setDescription(
        `**Total Deals:** ${stats.total_deals}\n` +
          `• As Buyer: ${stats.deals_as_buyer}\n` +
          `• As Seller: ${stats.deals_as_seller}\n\n` +
          `**Financial Summary:**\n` +
          `💰 Total Spent (as Buyer): $${stats.total_spent.toFixed(2)}\n` +
          `📦 Total Earned (as Seller): $${stats.total_earned.toFixed(2)}\n` +
          `💼 Total Fees Paid: $${stats.total_fees_paid.toFixed(2)}\n\n` +
          `**Net Position:** $${netPosition.toFixed(2)}\n\n` +
          `**Recent Deals:**\n${recentDealsText}`
      )
      .setColor(netPosition >= 0 ? "#00FF00" : "#FF0000")
      .setTimestamp()
      .setFooter({ text: `Last deal: ${lastDealDate.toLocaleDateString()}` });

    await interaction.editReply({ embeds: [statsEmbed] });
  } catch (error) {
    console.error("Error fetching stats:", error);
    await interaction.editReply({
      content: "❌ Error fetching statistics. Please try again later.",
    });
  }
}
