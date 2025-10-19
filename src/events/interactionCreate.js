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

// ========================================
// HELPER FUNCTIONS (Top Level)
// ========================================

async function handleRoleSelection(interaction, client) {
  const customId = interaction.customId;
  const userId = interaction.user.id;
  const channelId = interaction.channel.id;

  // Get ticket data
  const ticketData = client.ticketData.get(channelId);
  if (!ticketData) {
    await interaction.reply({
      content: "❌ Ticket data not found.",
      ephemeral: true,
    });
    return;
  }

  // Check if user is part of this ticket
  if (userId !== ticketData.user1 && userId !== ticketData.user2) {
    await interaction.reply({
      content: "❌ You are not part of this ticket.",
      ephemeral: true,
    });
    return;
  }

  const role = customId.startsWith("buyer_") ? "buyer" : "seller";

  // Check if role already taken
  if (ticketData.buyer === userId || ticketData.seller === userId) {
    await interaction.reply({
      content: "❌ You already selected a role!",
      ephemeral: true,
    });
    return;
  }

  if (role === "buyer" && ticketData.buyer !== null) {
    await interaction.reply({
      content: "❌ Buyer role already taken!",
      ephemeral: true,
    });
    return;
  }

  if (role === "seller" && ticketData.seller !== null) {
    await interaction.reply({
      content: "❌ Seller role already taken!",
      ephemeral: true,
    });
    return;
  }

  // Assign role
  if (role === "buyer") {
    ticketData.buyer = userId;
  } else {
    ticketData.seller = userId;
  }

  await interaction.reply({
    content: `✅ You are now the **${role.toUpperCase()}**!`,
    ephemeral: true,
  });

  // Check if both roles assigned
  if (ticketData.buyer && ticketData.seller) {
    const buyer = await client.users.fetch(ticketData.buyer);
    const seller = await client.users.fetch(ticketData.seller);

    const rolesSetEmbed = new EmbedBuilder()
      .setTitle("✅ Roles Confirmed")
      .setDescription(
        `**Buyer:** ${buyer}\n` +
          `**Seller:** ${seller}\n\n` +
          `${buyer}, please enter the amount (in USD) you're willing to pay.`
      )
      .setColor("#00FF00");

    await interaction.channel.send({ embeds: [rolesSetEmbed] });

    // DISABLE SELLER'S TYPING PERMISSION
    await interaction.channel.permissionOverwrites.edit(ticketData.seller, {
      SendMessages: false, // Seller can't type now
      ViewChannel: true,
      ReadMessageHistory: true,
    });

    // Start amount collector (only listens to buyer)
    const amountCollector = interaction.channel.createMessageCollector({
      filter: (m) => m.author.id === ticketData.buyer,
      max: 1,
      time: 300000, // 5 minutes
    });

    amountCollector.on("collect", async (message) => {
      const amount = parseFloat(message.content.trim());

      // Validate amount
      if (isNaN(amount) || amount <= 0) {
        await interaction.channel.send({
          content:
            "❌ Invalid amount. Please enter a valid number (e.g., 100 or 99.99)",
        });
        // Restart collector
        amountCollector.resetTimer();
        return;
      }

      ticketData.amount = amount;

      // DISABLE BUYER'S TYPING
      await interaction.channel.permissionOverwrites.edit(ticketData.buyer, {
        SendMessages: false, // Buyer can't type now
      });

      // Ask seller for approval
      const approvalEmbed = new EmbedBuilder()
        .setTitle("💵 Amount Confirmation")
        .setDescription(
          `${buyer} wants to pay **$${amount.toFixed(2)} USD**\n\n` +
            `${seller}, do you agree with this amount?`
        )
        .setColor("#FFA500");

      const approveButton = new ButtonBuilder()
        .setCustomId(`approve_${channelId}`)
        .setLabel("✅ I Agree")
        .setStyle(ButtonStyle.Success);

      const rejectButton = new ButtonBuilder()
        .setCustomId(`reject_${channelId}`)
        .setLabel("❌ I Reject")
        .setStyle(ButtonStyle.Danger);

      const approvalRow = new ActionRowBuilder().addComponents(
        approveButton,
        rejectButton
      );

      await interaction.channel.send({
        content: `${seller}`,
        embeds: [approvalEmbed],
        components: [approvalRow],
      });
    });

    amountCollector.on("end", (collected, reason) => {
      if (reason === "time") {
        interaction.channel.send({
          content: "⏱️ Time expired. Please enter the amount again.",
        });
      }
    });
  }
}

async function handleSellerApproval(interaction, client) {
  const customId = interaction.customId;
  const userId = interaction.user.id;
  const channelId = interaction.channel.id;

  const ticketData = client.ticketData.get(channelId);
  if (!ticketData) {
    await interaction.reply({
      content: "❌ Ticket data not found.",
      ephemeral: true,
    });
    return;
  }

  // Only seller can click these buttons
  if (userId !== ticketData.seller) {
    await interaction.reply({
      content: "❌ Only the seller can respond to this.",
      ephemeral: true,
    });
    return;
  }

  const buyer = await client.users.fetch(ticketData.buyer);
  const seller = await client.users.fetch(ticketData.seller);

  if (customId.startsWith("approve_")) {
    // Seller approved
    const successEmbed = new EmbedBuilder()
      .setTitle("✅ Amount Approved!")
      .setDescription(
        `**Deal Summary:**\n` +
          `💰 Amount: **$${ticketData.amount.toFixed(2)} USD**\n` +
          `🪙 Cryptocurrency: **${ticketData.coin}**\n` +
          `👤 Buyer: ${buyer}\n` +
          `👤 Seller: ${seller}\n\n` +
          `Both parties can now proceed with the escrow.`
      )
      .setColor("#00FF00");

    await interaction.update({
      embeds: [successEmbed],
      components: [], // Remove buttons
    });

    // RE-ENABLE TYPING FOR BOTH
    await interaction.channel.permissionOverwrites.edit(ticketData.buyer, {
      SendMessages: true,
    });

    await interaction.channel.permissionOverwrites.edit(ticketData.seller, {
      SendMessages: true,
    });
  } else if (customId.startsWith("reject_")) {
    // Seller rejected
    const rejectEmbed = new EmbedBuilder()
      .setTitle("❌ Amount Rejected")
      .setDescription(
        `${seller} rejected the amount of **$${ticketData.amount.toFixed(
          2
        )} USD**.\n\n` + `${buyer}, please enter a new amount.`
      )
      .setColor("#FF0000");

    await interaction.update({
      embeds: [rejectEmbed],
      components: [], // Remove buttons
    });

    // Reset amount
    ticketData.amount = null;

    // ENABLE BUYER TYPING, DISABLE SELLER
    await interaction.channel.permissionOverwrites.edit(ticketData.buyer, {
      SendMessages: true,
    });

    await interaction.channel.permissionOverwrites.edit(ticketData.seller, {
      SendMessages: false,
    });

    // Restart amount collector
    const amountCollector = interaction.channel.createMessageCollector({
      filter: (m) => m.author.id === ticketData.buyer,
      max: 1,
      time: 300000,
    });

    amountCollector.on("collect", async (message) => {
      const amount = parseFloat(message.content.trim());

      if (isNaN(amount) || amount <= 0) {
        await interaction.channel.send({
          content:
            "❌ Invalid amount. Please enter a valid number (e.g., 100 or 99.99)",
        });
        amountCollector.resetTimer();
        return;
      }

      ticketData.amount = amount;

      await interaction.channel.permissionOverwrites.edit(ticketData.buyer, {
        SendMessages: false,
      });

      const approvalEmbed = new EmbedBuilder()
        .setTitle("💵 Amount Confirmation")
        .setDescription(
          `${buyer} wants to pay **$${amount.toFixed(2)} USD**\n\n` +
            `${seller}, do you agree with this amount?`
        )
        .setColor("#FFA500");

      const approveButton = new ButtonBuilder()
        .setCustomId(`approve_${interaction.channel.id}`)
        .setLabel("✅ I Agree")
        .setStyle(ButtonStyle.Success);

      const rejectButton = new ButtonBuilder()
        .setCustomId(`reject_${interaction.channel.id}`)
        .setLabel("❌ I Reject")
        .setStyle(ButtonStyle.Danger);

      const approvalRow = new ActionRowBuilder().addComponents(
        approveButton,
        rejectButton
      );

      await interaction.channel.send({
        content: `${seller}`,
        embeds: [approvalEmbed],
        components: [approvalRow],
      });
    });
  }
}

// ========================================
// MAIN EXECUTE FUNCTION
// ========================================

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

  // Handle button interactions
  if (interaction.isButton()) {
    const customId = interaction.customId;

    // Role selection buttons
    if (customId.startsWith("buyer_") || customId.startsWith("seller_")) {
      await handleRoleSelection(interaction, client);
    }

    // Seller approval buttons
    if (customId.startsWith("approve_") || customId.startsWith("reject_")) {
      await handleSellerApproval(interaction, client);
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
          parent: null,
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
                `${secondUser} has been added to this escrow deal!\n\n**Deal Details:**\n💰 Cryptocurrency: **${coin}**\n`
              )
              .setColor("#00FF00");

            await ticketChannel.send({
              content: `${secondUser}`,
              embeds: [confirmEmbed],
            });

            // NOW send role selection (after user is added)
            const roleEmbed = new EmbedBuilder()
              .setTitle("👥 Select Your Role")
              .setDescription(
                `${user} and ${secondUser}, please select your roles in this escrow deal.\n\n` +
                  `**Buyer**: Person paying money\n` +
                  `**Seller**: Person providing goods/service`
              )
              .setColor("#FFA500");

            const buyerButton = new ButtonBuilder()
              .setCustomId(`buyer_${user.id}_${secondUser.id}`)
              .setLabel("I'm the Buyer 💰")
              .setStyle(ButtonStyle.Primary);

            const sellerButton = new ButtonBuilder()
              .setCustomId(`seller_${user.id}_${secondUser.id}`)
              .setLabel("I'm the Seller 📦")
              .setStyle(ButtonStyle.Success);

            const roleRow = new ActionRowBuilder().addComponents(
              buyerButton,
              sellerButton
            );

            await ticketChannel.send({
              embeds: [roleEmbed],
              components: [roleRow],
            });

            // Store ticket data (in memory for now)
            if (!client.ticketData) {
              client.ticketData = new Map();
            }

            client.ticketData.set(ticketChannel.id, {
              user1: user.id,
              user2: secondUser.id,
              coin: coin,
              buyer: null,
              seller: null,
              amount: null,
              channelId: ticketChannel.id,
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
