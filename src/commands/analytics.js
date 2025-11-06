import {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
} from "discord.js";
import { getTotalCommissions, getDealsStats } from "../database/queries.js";

export const data = new SlashCommandBuilder()
  .setName("analytics")
  .setDescription("View platform analytics (Admin only)")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({
      content: "❌ This command is only available to administrators!",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const commissions = getTotalCommissions();
    const dealsStats = getDealsStats();

    let commissionsText = "**Total Commissions Earned:**\n";
    let totalCommissionUSD = 0;

    for (const comm of commissions) {
      commissionsText += `• ${comm.coin}: ${comm.total_crypto.toFixed(
        8
      )} ($${comm.total_usd.toFixed(2)})\n`;
      totalCommissionUSD += comm.total_usd;
    }

    commissionsText += `\n**Total USD Value:** $${totalCommissionUSD.toFixed(
      2
    )}`;

    let volumeText = "\n\n**Trading Volume by Coin:**\n";
    let totalVolume = 0;
    let totalDeals = 0;

    for (const stat of dealsStats) {
      volumeText += `• ${stat.coin}: ${
        stat.total_deals
      } deals | $${stat.total_volume.toFixed(2)} volume\n`;
      totalVolume += stat.total_volume;
      totalDeals += stat.total_deals;
    }

    volumeText += `\n**Total:** ${totalDeals} deals | $${totalVolume.toFixed(
      2
    )} volume`;

    const analyticsEmbed = new EmbedBuilder()
      .setTitle("📊 Platform Analytics")
      .setDescription(commissionsText + volumeText)
      .setColor("#153ee9")
      .setTimestamp()
      .setFooter({ text: "Confidential - Admin Only" });

    await interaction.editReply({ embeds: [analyticsEmbed] });
  } catch (error) {
    console.error("Error fetching analytics:", error);
    await interaction.editReply({
      content: "❌ Error fetching analytics. Please try again later.",
    });
  }
}
