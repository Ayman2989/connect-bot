import {
  ChannelType,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";

export const name = "interactionCreate";
export const once = false;

export async function execute(interaction, client) {
  // Handle slash commands (if any remain)
  if (interaction.isChatInputCommand()) {
    const command = client.commands.get(interaction.commandName);
    if (!command) return;
    try {
      await command.execute(interaction, client);
    } catch (err) {
      console.error(err);
      await interaction.reply({
        content: "⚠️ There was an error executing this command.",
        ephemeral: true,
      });
    }
  }

  // Handle dropdown (select menu)
  if (interaction.isStringSelectMenu()) {
    if (interaction.customId === "coinSelect") {
      const coin = interaction.values[0];
      const user = interaction.user;
      const guild = interaction.guild;

      // Acknowledge the selection
      await interaction.reply({
        content: `💰 You selected **${coin}**! Creating your private ticket...`,
        ephemeral: true,
      });

      try {
        // Create private channel (ticket)
        const ticketChannel = await guild.channels.create({
          name: `ticket-${user.username}-${coin}`,
          type: ChannelType.GuildText,
          parent: null, // You can set a category ID here if you want
          permissionOverwrites: [
            {
              id: guild.id, // @everyone role
              deny: [PermissionFlagsBits.ViewChannel],
            },
            {
              id: user.id, // The user who clicked
              allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
              ],
            },
            {
              id: client.user.id, // The bot
              allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
              ],
            },
          ],
        });

        // Create welcome embed
        const welcomeEmbed = new EmbedBuilder()
          .setTitle(`🎫 Escrow Ticket - ${coin}`)
          .setDescription(
            `Welcome ${user}!\n\n**Selected Cryptocurrency:** ${coin}\n\nPlease provide the **User ID** of the person you want to add to this escrow deal.\n\n**How to get User ID:**\n1. Enable Developer Mode in Discord Settings\n2. Right-click on their profile\n3. Click "Copy User ID"`
          )
          .setColor("#00A86B")
          .setFooter({ text: "Reply with the User ID below" });

        await ticketChannel.send({
          content: `${user}`,
          embeds: [welcomeEmbed],
        });

        // Update the original interaction
        await interaction.editReply({
          content: `✅ Ticket created! Check ${ticketChannel}`,
        });

        // Create message collector to wait for user ID
        const filter = (m) => m.author.id === user.id;
        const collector = ticketChannel.createMessageCollector({
          filter,
          max: 1,
          time: 300000, // 5 minutes
        });

        collector.on("collect", async (message) => {
          const secondUserId = message.content.trim();

          // Validate if it's a valid user ID (18-19 digits)
          if (!/^\d{17,19}$/.test(secondUserId)) {
            await ticketChannel.send({
              content:
                "❌ Invalid User ID format. Please provide a valid Discord User ID.",
            });
            return;
          }

          try {
            // Try to fetch the user
            const secondUser = await client.users.fetch(secondUserId);

            // Add them to the channel
            await ticketChannel.permissionOverwrites.create(secondUser.id, {
              ViewChannel: true,
              SendMessages: true,
              ReadMessageHistory: true,
            });

            // Send confirmation
            const confirmEmbed = new EmbedBuilder()
              .setTitle("✅ User Added to Ticket")
              .setDescription(
                `${secondUser} has been added to this escrow deal!\n\n**Deal Details:**\n💰 Cryptocurrency: **${coin}**\n👤 Buyer: ${user}\n👤 Seller: ${secondUser}\n\nYou can now discuss the terms of your escrow deal.`
              )
              .setColor("#00FF00");

            await ticketChannel.send({
              content: `${secondUser}`,
              embeds: [confirmEmbed],
            });
          } catch (error) {
            await ticketChannel.send({
              content:
                "❌ Could not find that user. Make sure the User ID is correct and the user shares a server with this bot.",
            });
            console.error(error);
          }
        });

        collector.on("end", (collected, reason) => {
          if (reason === "time") {
            ticketChannel.send({
              content:
                "⏱️ Time expired. Please send the User ID to add them to this ticket.",
            });
          }
        });
      } catch (error) {
        console.error("Error creating ticket:", error);
        await interaction.editReply({
          content: "❌ Failed to create ticket. Please try again.",
        });
      }
    }
  }
}
