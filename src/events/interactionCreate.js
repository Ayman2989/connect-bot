import {
  ChannelType,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  StringSelectMenuBuilder,
  ButtonStyle,
} from "discord.js";
import { saveDeal } from "../database/queries.js";
import {
  convertUSDToCrypto,
  generateDepositAddress,
  checkPaymentReceived,
  sendCryptoToSeller,
  refundBuyer,
} from "../utils/cryptoService.js";
import {
  validateCryptoAddress,
  getAddressWarnings,
} from "../utils/addressValidator.js";
import { logTransaction } from "../utils/logger.js";
import dotenv from "dotenv";
dotenv.config();

export const name = "interactionCreate";
export const once = false;

const TICKET_TIMEOUT = 30 * 60 * 1000;
const INACTIVITY_TIMEOUT = 30 * 60 * 1000; // 30 minutes inactivity
const COMPLETED_DEALS_CHANNEL_ID = process.env.COMPLETED_DEALS_CHANNEL_ID;

const MIN_DEAL_AMOUNTS = {
  BTC: 4.0,
  ETH: 4.0,
  LTC: 1.0,
  SOL: 1.0,
  USDT: 50.0,
  USDC: 50.0,
};

const MIN_CONFIRMATIONS = {
  BTC: 3,
  ETH: 12,
  LTC: 6,
  SOL: 1,
  USDT: 12,
  USDC: 12,
};

function getNetworkForCoin(coinSymbol) {
  const networks = {
    BTC: "BTC",
    ETH: "ETH",
    LTC: "LTC",
    SOL: "SOL",
    USDT: "ETH",
    USDC: "ETH",
  };
  return networks[coinSymbol];
}

// ✅ RESET INACTIVITY TIMER
function resetInactivityTimer(channel, ticketData, client) {
  // Don't track inactivity after payment starts
  if (ticketData.paymentStarted) return;

  if (ticketData.inactivityTimer) {
    clearTimeout(ticketData.inactivityTimer);
  }

  ticketData.inactivityTimer = setTimeout(async () => {
    try {
      await channel.send({
        content:
          "⏰ This ticket has been inactive for 30 minutes and will be deleted in 1 minute.",
      });

      setTimeout(async () => {
        try {
          await channel.delete("Inactivity timeout");
          console.log(`🗑️ Ticket ${channel.id} deleted due to inactivity`);
          if (client.ticketData && client.ticketData.has(channel.id)) {
            client.ticketData.delete(channel.id);
          }
        } catch (error) {
          console.error("Error deleting inactive channel:", error);
        }
      }, 60000);
    } catch (error) {
      console.error("Error handling inactivity:", error);
    }
  }, INACTIVITY_TIMEOUT);
}

// ✅ ASK FOR PRIVACY PREFERENCE
async function askPrivacyPreference(
  channel,
  ticketData,
  client,
  withdrawalTxHash
) {
  const buyer = await client.users.fetch(ticketData.buyer);
  const seller = await client.users.fetch(ticketData.seller);

  const privacyEmbed = new EmbedBuilder()
    .setTitle("🔒 Privacy Settings")
    .setDescription(
      `Before posting to the completed deals channel, would you like your identity to be:\n\n` +
        `**Public**: Everyone can see your username\n` +
        `**Anonymous**: Only server owner can see your username (shown as "Anonymous" to others)\n\n` +
        `Both parties must choose their preference.`
    )
    .setColor("#153ee9");

  const publicBtn = new ButtonBuilder()
    .setCustomId(`privacy_public_${channel.id}`)
    .setLabel("🌐 Public")
    .setStyle(ButtonStyle.Success);

  const anonBtn = new ButtonBuilder()
    .setCustomId(`privacy_anon_${channel.id}`)
    .setLabel("🔒 Anonymous")
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder().addComponents(publicBtn, anonBtn);

  await channel.send({
    content: `${buyer} ${seller}`,
    embeds: [privacyEmbed],
    components: [row],
  });

  // Store withdrawal hash for later use
  ticketData.withdrawalTxHash = withdrawalTxHash;
  ticketData.privacyVotes = {
    buyer: null,
    seller: null,
  };
  ticketData.privacyFinalized = false;
}

// ✅ POST COMPLETED DEAL
async function postCompletedDeal(guild, ticketData, txHash) {
  try {
    const completedChannel = guild.channels.cache.get(
      COMPLETED_DEALS_CHANNEL_ID
    );

    if (!completedChannel) {
      console.error(
        `❌ Channel with ID "${COMPLETED_DEALS_CHANNEL_ID}" not found!`
      );
      return;
    }

    const buyer = await guild.client.users.fetch(ticketData.buyer);
    const seller = await guild.client.users.fetch(ticketData.seller);

    // ✅ For main embed display (what everyone sees)
    const buyerDisplayPublic =
      ticketData.privacyVotes.buyer === "public" ? `${buyer}` : "Anonymous";
    const sellerDisplayPublic =
      ticketData.privacyVotes.seller === "public" ? `${seller}` : "Anonymous";

    // ✅ For footer (server owner only - shows real username + ID)
    const buyerRealName = `${buyer.tag} (${buyer.id})`;
    const sellerRealName = `${seller.tag} (${seller.id})`;

    const coinIcons = {
      BTC: "https://logo.svgcdn.com/logos/bitcoin.png",
      LTC: "https://logo.svgcdn.com/token-branded/ltc.png",
      ETH: "https://logo.svgcdn.com/logos/ethereum.png",
      SOL: "https://logo.svgcdn.com/token-branded/solana.png",
      USDT: "https://logo.svgcdn.com/token-branded/usdt.png",
      USDC: "https://logo.svgcdn.com/token-branded/usdc.png",
    };

    const coinIcon =
      coinIcons[ticketData.coin] || "https://logo.svgcdn.com/logos/bitcoin.png";

    const dealEmbed = new EmbedBuilder()
      .setTitle(`${ticketData.coin} Deal Completed`)
      .setDescription(
        `**Amount:**${ticketData.cryptoAmount.toFixed(8)} ${
          ticketData.coin
        } ($${ticketData.amount.toFixed(2)})\n ` +
          `**Service Fee:** $${ticketData.commissionAmount.toFixed(
            2
          )} USD\n\n` +
          `**Transaction Hash:** \`${txHash}\`\n`
        // `**Track on Explorer:** ${getBlockExplorerLink(
        //   ticketData.coin,
        //   txHash
        // )}`
      )
      .addFields(
        { name: "Buyer", value: `${buyerDisplayPublic}`, inline: true },
        { name: "Seller", value: `${sellerDisplayPublic}`, inline: true }
      )
      .setThumbnail(coinIcon)
      .setColor("#153ee9")
      .setTimestamp()
      .setFooter({
        text: `Ticket: ${ticketData.channelId}`,
      });
    //    .setFooter({
    //   text: `Ticket: ${ticketData.channelId}
    //    | Real IDs (Owner Only): Buyer: ${buyerRealName} | Seller: ${sellerRealName}
    //    `,
    // });

    await completedChannel.send({ embeds: [dealEmbed] });

    // ✅ SAVE TO DATABASE (NEW!)
    saveDeal({
      ticketId: ticketData.channelId,
      buyerId: ticketData.buyer,
      sellerId: ticketData.seller,
      coin: ticketData.coin,
      dealAmount: ticketData.amount,
      serviceFee: ticketData.commissionAmount,
      buyerPaid: ticketData.buyerPaysAmount,
      sellerReceived: ticketData.sellerReceivesAmount,
      cryptoAmount: ticketData.cryptoAmount,
      sellerCryptoAmount: ticketData.sellerCryptoAmount,
      txHash: txHash,
      buyerPrivacy: ticketData.privacyVotes.buyer,
      sellerPrivacy: ticketData.privacyVotes.seller,
    });

    console.log(
      `✅ Completed deal posted to channel ID: ${COMPLETED_DEALS_CHANNEL_ID}`
    );

    // ✅ LOG FOR SERVER OWNER
    console.log("📋 COMPLETED DEAL DETAILS (Server Owner Records):");
    console.log(`   Ticket ID: ${ticketData.channelId}`);
    console.log(
      `   Buyer: ${buyerRealName} - Privacy: ${ticketData.privacyVotes.buyer}`
    );
    console.log(
      `   Seller: ${sellerRealName} - Privacy: ${ticketData.privacyVotes.seller}`
    );
    console.log(`   Deal Amount: $${ticketData.amount.toFixed(2)}`);
    console.log(`   Commission: $${ticketData.commissionAmount.toFixed(2)}`);
  } catch (error) {
    console.error("Error posting completed deal:", error);
  }
}

// ✅ ASK BOTH USERS TO CLOSE TICKET
async function askToCloseTicket(channel, ticketData, client) {
  const buyer = await client.users.fetch(ticketData.buyer);
  const seller = await client.users.fetch(ticketData.seller);

  const closeEmbed = new EmbedBuilder()
    .setTitle("✅ Deal Complete - Close Ticket?")
    .setDescription(
      `The escrow transaction is complete!\n\n` +
        `**Both parties must agree to close this ticket.**\n` +
        `Once both click "Close Ticket", this channel will be permanently deleted in 5 seconds.`
    )
    .setColor("#00FF00");

  const closeBtn = new ButtonBuilder()
    .setCustomId(`final_close_${channel.id}`)
    .setLabel("🗑️ Close Ticket")
    .setStyle(ButtonStyle.Danger);

  const row = new ActionRowBuilder().addComponents(closeBtn);

  await channel.send({
    content: `${buyer} ${seller}`,
    embeds: [closeEmbed],
    components: [row],
  });

  ticketData.closeVotes = {
    buyer: false,
    seller: false,
  };
}

function startTicketTimeout(channel, ticketData, client) {
  if (ticketData.timeoutTimer) {
    clearTimeout(ticketData.timeoutTimer);
  }

  const timeRemaining = TICKET_TIMEOUT - (Date.now() - ticketData.createdAt);

  if (timeRemaining <= 0) {
    handleTicketTimeout(channel, ticketData, client);
    return;
  }

  ticketData.timeoutTimer = setTimeout(() => {
    handleTicketTimeout(channel, ticketData, client);
  }, timeRemaining);
}

async function handleTicketTimeout(channel, ticketData, client) {
  // ✅ IF PAYMENT HAS BEEN RECEIVED, DO NOT TIMEOUT - TICKET STAYS OPEN
  if (ticketData.paymentReceived || ticketData.paymentStarted) {
    console.log(
      `⏰ Timeout ignored - payment already started for ticket ${channel.id}`
    );
    return; // EXIT IMMEDIATELY - NO TIMEOUT
  }

  // ✅ SEND WARNING MESSAGE (NOT ASKING PERMISSION - JUST NOTIFYING)
  const timeoutEmbed = new EmbedBuilder()
    .setTitle("⏰ Ticket Timeout")
    .setDescription(
      `This ticket has exceeded the 30-minute time limit.\n\n` +
        `**This channel will be deleted in 10 seconds.**`
    )
    .setColor("#FFA500");

  await channel.send({ embeds: [timeoutEmbed] });
  ticketData.status = "timeout";

  // ✅ DELETE AFTER 10 SECONDS - NO BUTTONS, NO CONFIRMATION
  setTimeout(async () => {
    try {
      await channel.delete("Ticket timeout - 30 minutes expired");
      console.log(
        `🗑️ Ticket channel ${channel.id} deleted after 30-minute timeout`
      );

      if (client.ticketData && client.ticketData.has(channel.id)) {
        client.ticketData.delete(channel.id);
      }
    } catch (error) {
      console.error("Error deleting channel:", error);
    }
  }, 10000);
}

function getBlockExplorerLink(coinSymbol, txId, address = null) {
  const explorers = {
    BTC: {
      tx: `https://www.blockchain.com/btc/tx/${txId}`,
      address: `https://www.blockchain.com/btc/address/${address}`,
    },
    ETH: {
      tx: `https://etherscan.io/tx/${txId}`,
      address: `https://etherscan.io/address/${address}`,
    },
    LTC: {
      tx: `https://blockchair.com/litecoin/transaction/${txId}`,
      address: `https://blockchair.com/litecoin/address/${address}`,
    },
    SOL: {
      tx: `https://solscan.io/tx/${txId}`,
      address: `https://solscan.io/account/${address}`,
    },
    USDT: {
      tx: `https://etherscan.io/tx/${txId}`,
      address: `https://etherscan.io/token/0xdac17f958d2ee523a2206206994597c13d831ec7?a=${address}`,
    },
    USDC: {
      tx: `https://etherscan.io/tx/${txId}`,
      address: `https://etherscan.io/token/0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48?a=${address}`,
    },
  };

  if (txId) {
    return explorers[coinSymbol]?.tx || "#";
  } else if (address) {
    return explorers[coinSymbol]?.address || "#";
  }
  return "#";
}

async function startPaymentMonitoring(channel, ticketData, client) {
  const checkInterval = 60000;
  const timeoutAt = ticketData.createdAt + TICKET_TIMEOUT;

  let hasNotifiedPaymentDetected = false;
  let paymentDetectedTime = null;

  const paymentChecker = setInterval(async () => {
    let activeChannel;
    try {
      activeChannel = await client.channels.fetch(channel.id);
    } catch (error) {
      console.log(`⚠️  Channel deleted. Stopping monitoring.`);
      clearInterval(paymentChecker);
      if (client.ticketData && client.ticketData.has(channel.id)) {
        client.ticketData.delete(channel.id);
      }
      return;
    }

    if (Date.now() >= timeoutAt) {
      clearInterval(paymentChecker);
      await activeChannel
        .send({
          content: "⏱️ Payment monitoring timed out.",
        })
        .catch((err) => console.error(err.message));
      return;
    }

    if (["timeout", "refunded", "completed"].includes(ticketData.status)) {
      clearInterval(paymentChecker);
      return;
    }

    try {
      const paymentStatus = await checkPaymentReceived(
        ticketData.coin,
        ticketData.cryptoAmount,
        ticketData.depositStartTime
      );

      const minConf = MIN_CONFIRMATIONS[ticketData.coin] || 6;

      if (paymentStatus.received && !paymentDetectedTime) {
        paymentDetectedTime = Date.now();
      }

      const threeMinutesPassed =
        paymentDetectedTime &&
        Date.now() - paymentDetectedTime >= 2 * 60 * 1000;

      if (paymentStatus.received && threeMinutesPassed) {
        clearInterval(paymentChecker);
        ticketData.paymentReceived = true;
        ticketData.status = "awaiting_goods_delivery";

        ticketData.depositTxHash = paymentStatus.txId;

        logTransaction("deposit_confirmed", {
          ticketId: channel.id,
          coin: ticketData.coin,
          amount: paymentStatus.amount,
          txId: paymentStatus.txId,
          buyer: ticketData.buyer,
          seller: ticketData.seller,
          confirmations: paymentStatus.confirmations,
          forcedByTimer: true,
        });

        const buyer = await client.users.fetch(ticketData.buyer);
        const seller = await client.users.fetch(ticketData.seller);

        const txLink = getBlockExplorerLink(
          ticketData.coin,
          paymentStatus.txId
        );

        if (ticketData.paymentDetectionMessage) {
          try {
            await ticketData.paymentDetectionMessage.delete();
          } catch (error) {
            console.error("Couldn't delete payment detection message:", error);
          }
        }

        const paymentConfirmedEmbed = new EmbedBuilder()
          .setTitle("✅ Payment Recieved!")
          .setDescription(
            `${buyer} has sent **${paymentStatus.amount.toFixed(8)} ${
              ticketData.coin
            }**!\n\n` +
              `**Transaction ID:** \`${paymentStatus.txId}\`\n` +
              `${seller}, you can now deliver the goods/service to ${buyer}.\n` +
              `Once ${buyer} receives everything, they will confirm below.`
          )
          .setColor("#153ee9")
          .setThumbnail("https://media.tenor.com/WsmiS-hUZkEAAAAj/verify.gif");

        await activeChannel.send({
          content: `${buyer} ${seller}`,
          embeds: [paymentConfirmedEmbed],
        });

        const deliveryEmbed = new EmbedBuilder()
          .setTitle("📦 Goods/Service Delivery")
          .setDescription(
            `${seller}, please confirm you will deliver the goods/service now.`
          )
          .setColor("#153ee9");

        const confirmDeliveryBtn = new ButtonBuilder()
          .setCustomId(`confirm_delivery_${channel.id}`)
          .setLabel(" I Will Deliver Now")
          .setStyle(ButtonStyle.Success);

        const deliveryRow = new ActionRowBuilder().addComponents(
          confirmDeliveryBtn
        );

        const deliveryMessage = await activeChannel.send({
          content: `${seller}`,
          embeds: [deliveryEmbed],
          components: [deliveryRow],
        });

        ticketData.deliveryMessage = deliveryMessage;
      } else if (paymentStatus.received && !hasNotifiedPaymentDetected) {
        const txLink = getBlockExplorerLink(
          ticketData.coin,
          paymentStatus.txId
        );
        const detectionEmbed = new EmbedBuilder()
          .setTitle("💳 Payment Detected!")
          .setDescription(
            `Waiting for confirmations:` +
              `⏱️ Payment will be confirmed shortly`
          )
          .setColor("#153ee9") // Orange alert color
          .setThumbnail(
            "https://raw.githubusercontent.com/Codelessly/FlutterLoadingGIFs/master/packages/cupertino_activity_indicator_large.gif"
          ); // Optional: animated loading spinner

        const detectionMessage = await activeChannel
          .send({ embeds: [detectionEmbed] })
          .catch((err) => console.error(err.message));

        ticketData.paymentDetectionMessage = detectionMessage;
        hasNotifiedPaymentDetected = true;
        // ✅ NEW: Disable the close button visually
        try {
          // Find the welcome message with the close button
          const messages = await activeChannel.messages.fetch({ limit: 50 });
          const welcomeMessage = messages.find((msg) =>
            msg.embeds[0]?.title?.includes("Escrow Ticket")
          );

          if (welcomeMessage) {
            const disabledCloseButton = new ButtonBuilder()
              .setCustomId(`close_ticket_disabled_${activeChannel.id}`)
              .setLabel("🔒 Ticket Locked (Payment Active)")
              .setStyle(ButtonStyle.Danger)
              .setDisabled(true);

            const disabledRow = new ActionRowBuilder().addComponents(
              disabledCloseButton
            );

            await welcomeMessage.edit({
              components: [disabledRow],
            });

            console.log("✅ Close button disabled due to payment detection");
          }
        } catch (error) {
          console.error("Error disabling close button:", error);
        }
      }
    } catch (error) {
      console.error("Error checking payment:", error.message);

      logTransaction("payment_check_error", {
        ticketId: channel.id,
        coin: ticketData.coin,
        expectedAmount: ticketData.cryptoAmount,
        error: error.message,
      });

      if (error.code === 10003 || error.message.includes("Unknown Channel")) {
        console.log(`⚠️  Channel not found. Stopping monitoring.`);
        clearInterval(paymentChecker);
        if (client.ticketData && client.ticketData.has(channel.id)) {
          client.ticketData.delete(channel.id);
        }
      }
    }
  }, checkInterval);

  ticketData.paymentCheckInterval = paymentChecker;
}

async function handleCommissionSelection(interaction, client) {
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

  // ✅ RESET INACTIVITY
  resetInactivityTimer(interaction.channel, ticketData, client);

  if (userId !== ticketData.buyer && userId !== ticketData.seller) {
    await interaction.reply({
      content: "❌ You are not part of this ticket.",
      ephemeral: true,
    });
    return;
  }

  const isBuyer = userId === ticketData.buyer;
  const isSeller = userId === ticketData.seller;

  if (isBuyer && ticketData.commissionVotes.buyer) {
    await interaction.reply({
      content: "❌ You already voted! Waiting for the other party...",
      ephemeral: true,
    });
    return;
  }

  if (isSeller && ticketData.commissionVotes.seller) {
    await interaction.reply({
      content: "❌ You already voted! Waiting for the other party...",
      ephemeral: true,
    });
    return;
  }

  let vote;
  if (customId.includes("_buyer_")) {
    vote = "buyer_pays";
  } else if (customId.includes("_seller_")) {
    vote = "seller_pays";
  } else if (customId.includes("_split_")) {
    vote = "split";
  }

  if (isBuyer) {
    ticketData.commissionVotes.buyer = vote;
  } else {
    ticketData.commissionVotes.seller = vote;
  }

  await interaction.reply({
    content: `✅ You voted for: **${vote.replace("_", " ").toUpperCase()}**`,
    ephemeral: true,
  });

  if (
    ticketData.commissionVotes.buyer &&
    ticketData.commissionVotes.seller &&
    !ticketData.processingCommission
  ) {
    ticketData.processingCommission = true;

    const buyer = await client.users.fetch(ticketData.buyer);
    const seller = await client.users.fetch(ticketData.seller);

    if (
      ticketData.commissionVotes.buyer === ticketData.commissionVotes.seller
    ) {
      const agreedOption = ticketData.commissionVotes.buyer;
      ticketData.commissionPayer = agreedOption;

      let buyerPaysAmount;
      let sellerReceivesAmount;
      const commission = ticketData.commissionAmount;

      switch (agreedOption) {
        case "buyer_pays":
          buyerPaysAmount = ticketData.amount + commission;
          sellerReceivesAmount = ticketData.amount;
          break;
        case "seller_pays":
          buyerPaysAmount = ticketData.amount;
          sellerReceivesAmount = ticketData.amount - commission;
          break;
        case "split":
          buyerPaysAmount = ticketData.amount + commission / 2;
          sellerReceivesAmount = ticketData.amount - commission / 2;
          break;
      }

      ticketData.buyerPaysAmount = buyerPaysAmount;
      ticketData.sellerReceivesAmount = sellerReceivesAmount;

      if (ticketData.commissionMessage) {
        try {
          await ticketData.commissionMessage.delete();
        } catch (error) {
          console.error("Couldn't delete commission message:", error);
        }
      }

      const agreementEmbed = new EmbedBuilder()
        .setTitle("✅ Fee Payment Agreement Reached!")
        .setDescription(
          `Both parties agreed on: **${agreedOption
            .replace("_", " ")
            .toUpperCase()}**\n\n` +
            `**Final Amounts:**\n` +
            `💰 ${buyer} will send: **$${buyerPaysAmount.toFixed(2)}**\n` +
            `📦 ${seller} will receive: **$${sellerReceivesAmount.toFixed(
              2
            )}**\n` +
            `💼 Escrow service fee: **$${commission.toFixed(2)}**\n\n` +
            `Converting to ${ticketData.coin}...`
        )
        .setColor("#153ee9");

      await interaction.channel.send({
        embeds: [agreementEmbed],
      });

      try {
        const conversion = await convertUSDToCrypto(
          ticketData.coin,
          buyerPaysAmount
        );

        ticketData.cryptoAmount = conversion.cryptoAmount;
        ticketData.pricePerCoin = conversion.price;

        const sellerCryptoConversion = await convertUSDToCrypto(
          ticketData.coin,
          sellerReceivesAmount
        );
        ticketData.sellerCryptoAmount = sellerCryptoConversion.cryptoAmount;

        const depositInfo = await generateDepositAddress(ticketData.coin);
        ticketData.depositAddress = depositInfo.address;
        ticketData.depositStartTime = Date.now();
        ticketData.status = "awaiting_deposit";

        // ✅ MARK PAYMENT AS STARTED - STOP INACTIVITY TIMER
        ticketData.paymentStarted = true;
        if (ticketData.inactivityTimer) {
          clearTimeout(ticketData.inactivityTimer);
        }

        const coinIcons = {
          BTC: "<:btc:1432442120903594104>",
          LTC: "<:ltc:1432442117426385067>",
          ETH: "<:eth:1432442114981232811>",
          SOL: "<:sol:1432442111147638978>",
          USDT: "<:usdt:1432442107435417641>",
          USDC: "<:usdc:1432442123957043413>",
          // Add other coin icons here
        };

        const coinIcon = coinIcons[ticketData.coin] || "";

        const summaryEmbed = new EmbedBuilder()
          .setTitle("📊 Deal Summary")
          .addFields(
            { name: "Sender", value: `${buyer}`, inline: true },
            { name: "Receiver", value: `${seller}`, inline: true },
            {
              name: "Deal Value",
              value: `$${ticketData.amount.toFixed(2)}`,
              inline: true,
            },
            {
              name: "Coin",
              value: `${coinIcon}  ${ticketData.coin}`,
              inline: true,
            },
            {
              name: "Fee",
              value: `$${ticketData.commissionAmount?.toFixed(2) || "0.00"}`,
              inline: true,
            }
          )
          .setColor("#153ee9")
          .setFooter({
            text: "Refer to this deal summary for any clarifications.",
          });

        const depositEmbed = new EmbedBuilder()
          .setTitle("📥 Payment Invoice")
          .setDescription(
            `${buyer}, send **exactly** \`${conversion.cryptoAmount.toFixed(
              8
            )}\` ${ticketData.coin} to:\n\n` +
              `Exchange Rate: 1 ${
                ticketData.coin
              } = $${conversion.price.toLocaleString()}\n\n` + // Added exchange rate line here
              `\`${depositInfo.address}\`\n\n` +
              `⚠️ **CRITICAL INSTRUCTIONS:**\n` +
              `• Send ONLY ${ticketData.coin} to this address\n` +
              `• Send the EXACT amount shown above\n` +
              `• Failure to send the precise amount will be treated as an attempt to manipulate the system; such payments will be irrecoverable, and you will be required to resend the exact amount.\n` +
              `• Use a personal wallet you control\n\n`
          )
          .setColor("#153ee9")
          .setFooter({
            text: `The bot will automatically detect your payment.`,
          });

        await interaction.channel.send({
          embeds: [summaryEmbed],
        });

        await interaction.channel.send({
          content: `${buyer}`,
          embeds: [depositEmbed],
        });

        await interaction.channel.permissionOverwrites.edit(ticketData.buyer, {
          SendMessages: true,
        });

        await interaction.channel.permissionOverwrites.edit(ticketData.seller, {
          SendMessages: true,
        });

        startPaymentMonitoring(interaction.channel, ticketData, client);
      } catch (error) {
        ticketData.processingCommission = false;
        await interaction.channel.send({
          content: "❌ Failed to generate deposit address. Please try again.",
        });
        console.error(error);
      }
    } else {
      ticketData.processingCommission = false;

      if (ticketData.commissionMessage) {
        try {
          await ticketData.commissionMessage.delete();
        } catch (error) {
          console.error("Couldn't delete commission message:", error);
        }
      }

      const disagreementEmbed = new EmbedBuilder()
        .setTitle("❌ No Agreement on Commission")
        .setDescription(
          `${buyer} voted: **${ticketData.commissionVotes.buyer
            .replace("_", " ")
            .toUpperCase()}**\n` +
            `${seller} voted: **${ticketData.commissionVotes.seller
              .replace("_", " ")
              .toUpperCase()}**\n\n` +
            `You both need to agree on who pays the service fee.\n` +
            `Please discuss and vote again.`
        )
        .setColor("#FF0000");

      ticketData.commissionVotes = {
        buyer: null,
        seller: null,
      };

      const buyerPaysBtn = new ButtonBuilder()
        .setCustomId(`commission_buyer_${channelId}`)
        .setLabel(`Buyer Pays All`)
        .setStyle(ButtonStyle.Primary);

      const sellerPaysBtn = new ButtonBuilder()
        .setCustomId(`commission_seller_${channelId}`)
        .setLabel(`Seller Pays All`)
        .setStyle(ButtonStyle.Success);

      const splitBtn = new ButtonBuilder()
        .setCustomId(`commission_split_${channelId}`)
        .setLabel(`Split 50/50`)
        .setStyle(ButtonStyle.Secondary);

      const commissionRow = new ActionRowBuilder().addComponents(
        buyerPaysBtn,
        sellerPaysBtn,
        splitBtn
      );

      const newCommissionMessage = await interaction.channel.send({
        embeds: [disagreementEmbed],
        components: [commissionRow],
      });

      ticketData.commissionMessage = newCommissionMessage;
    }
  }
}

async function handleRoleSelection(interaction, client) {
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

  // ✅ RESET INACTIVITY
  resetInactivityTimer(interaction.channel, ticketData, client);

  if (userId !== ticketData.user1 && userId !== ticketData.user2) {
    await interaction.reply({
      content: "❌ You are not part of this ticket.",
      ephemeral: true,
    });
    return;
  }

  const role = customId.startsWith("buyer_") ? "buyer" : "seller";

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

  if (role === "buyer") {
    ticketData.buyer = userId;
  } else {
    ticketData.seller = userId;
  }

  await interaction.reply({
    content: `✅ You are now the **${role.toUpperCase()}**!`,
    ephemeral: true,
  });

  if (
    ticketData.buyer &&
    ticketData.seller &&
    !ticketData.processingRoleSelection
  ) {
    ticketData.processingRoleSelection = true;

    try {
      await interaction.message.delete();
    } catch (error) {
      console.error("Couldn't delete role selection message:", error);
    }

    const buyer = await client.users.fetch(ticketData.buyer);
    const seller = await client.users.fetch(ticketData.seller);

    const rolesSetEmbed = new EmbedBuilder()
      .setTitle("✅ Roles Confirmed")
      .setDescription(
        `**Buyer:** ${buyer}\n` +
          `**Seller:** ${seller}\n\n` +
          `${buyer}, please enter the amount (in USD) you're willing to pay.`
      )
      .setColor("#153ee9");

    await interaction.channel.send({ embeds: [rolesSetEmbed] });

    await interaction.channel.permissionOverwrites.edit(ticketData.seller, {
      SendMessages: false,
      ViewChannel: true,
      ReadMessageHistory: true,
    });

    const amountCollector = interaction.channel.createMessageCollector({
      filter: (m) => m.author.id === ticketData.buyer,
      time: 300000,
    });

    amountCollector.on("collect", async (message) => {
      // ✅ RESET INACTIVITY
      resetInactivityTimer(interaction.channel, ticketData, client);

      const amount = parseFloat(message.content.trim());

      const minAmount = MIN_DEAL_AMOUNTS[ticketData.coin];

      // ❌ Invalid number
      if (isNaN(amount) || amount <= 0) {
        await interaction.channel.send({
          content:
            "❌ Invalid amount. Please enter a valid number (e.g., 100 or 99.99)",
        });
        // Collector keeps running, allowing retry
        return;
      }

      // ❌ Below minimum
      if (amount < minAmount) {
        await interaction.channel.send({
          content: `❌ Minimum deal amount for ${
            ticketData.coin
          } is **${minAmount.toFixed(2)}**.\n\nPlease enter a higher amount.`,
        });
        // Collector still active for retry
        return;
      }

      // ✅ Valid input — stop the collector immediately
      amountCollector.stop("valid_amount");

      ticketData.amount = amount;

      await interaction.channel.permissionOverwrites.edit(ticketData.buyer, {
        SendMessages: false,
      });

      const approvalEmbed = new EmbedBuilder()
        .setTitle("💵 Amount Confirmation")
        .setDescription(
          `${buyer} wants to pay **$${amount.toFixed(2)}**\n\n` +
            `${seller}, do you agree with this amount?`
        )
        .setColor("#153ee9");

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

      const approvalMessage = await interaction.channel.send({
        content: `${seller}`,
        embeds: [approvalEmbed],
        components: [approvalRow],
      });

      ticketData.approvalMessage = approvalMessage;
    });
  }
}

// ✅ HANDLE RESET ROLES
async function handleResetRoles(interaction, client) {
  const channelId = interaction.channel.id;
  const ticketData = client.ticketData.get(channelId);

  if (!ticketData) {
    await interaction.reply({
      content: "❌ Ticket data not found.",
      ephemeral: true,
    });
    return;
  }

  // ✅ RESET INACTIVITY
  resetInactivityTimer(interaction.channel, ticketData, client);

  const userId = interaction.user.id;

  if (userId !== ticketData.user1 && userId !== ticketData.user2) {
    await interaction.reply({
      content: "❌ You are not part of this ticket.",
      ephemeral: true,
    });
    return;
  }

  // Reset roles
  ticketData.buyer = null;
  ticketData.seller = null;
  ticketData.processingRoleSelection = false;

  const user1 = await client.users.fetch(ticketData.user1);
  const user2 = await client.users.fetch(ticketData.user2);

  await interaction.reply({
    content: "✅ Roles have been reset! Please select your roles again.",
    ephemeral: true,
  });

  const roleEmbed = new EmbedBuilder()
    .setTitle("👥 Select Your Role")
    .setDescription(
      `${user1} and ${user2}, please select your roles in this escrow deal.\n\n` +
        `**Buyer**: Person paying money\n` +
        `**Seller**: Person providing goods/service`
    )
    .setColor("#153ee9");

  const buyerButton = new ButtonBuilder()
    .setCustomId(`buyer_${user1.id}_${user2.id}`)
    .setLabel("I'm the Buyer ")
    .setStyle(ButtonStyle.Primary);

  const sellerButton = new ButtonBuilder()
    .setCustomId(`seller_${user1.id}_${user2.id}`)
    .setLabel("I'm the Seller 📦")
    .setStyle(ButtonStyle.Primary);

  const resetButton = new ButtonBuilder()
    .setCustomId(`reset_roles_${channelId}`)
    .setLabel("🔄 Reset Roles")
    .setStyle(ButtonStyle.Secondary);

  const roleRow = new ActionRowBuilder().addComponents(
    buyerButton,
    sellerButton,
    resetButton
  );

  await interaction.channel.send({
    embeds: [roleEmbed],
    components: [roleRow],
  });
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

  // ✅ RESET INACTIVITY
  resetInactivityTimer(interaction.channel, ticketData, client);

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
    ticketData.status = "awaiting_commission_agreement";

    let commissionAmount = 0;
    const amount = ticketData.amount;

    if (amount < 30) {
      commissionAmount = 0.0;
    } else if (amount < 50) {
      commissionAmount = 1.0;
    } else if (amount < 300) {
      commissionAmount = 2.0;
    } else {
      commissionAmount = amount * 0.01;
    }

    if (ticketData.coin === "USDT" || ticketData.coin === "USDC") {
      commissionAmount += 1.0;
    }
    ticketData.commissionAmount = commissionAmount;

    try {
      await interaction.message.delete();
    } catch (error) {
      console.error("Couldn't delete approval message:", error);
    }

    // ✅ CHECK IF COMMISSION IS ZERO
    if (commissionAmount === 0) {
      // 🎉 NO COMMISSION CASE

      const noCommissionEmbed = new EmbedBuilder()
        .setTitle("🎉 YAYY NO COMMISSION!")
        .setDescription(
          `**Lucky you!** Deals under $30 ${ticketData.amount} have NO service fee!\n\n` +
            `**Deal Amount:** $${ticketData.amount.toFixed(2)}\n` +
            `**Service Fee:** $0.00 ✨\n\n` +
            `**You both pay exactly what was agreed:**\n` +
            ` ${buyer} will send: **$${ticketData.amount.toFixed(2)}**\n` +
            ` ${seller} will receive: **$${ticketData.amount.toFixed(
              2
            )}**\n\n` +
            `Converting to ${ticketData.coin}...`
        )
        .setColor("#153ee9");

      await interaction.channel.send({ embeds: [noCommissionEmbed] });

      // Set amounts (no commission deducted)
      ticketData.buyerPaysAmount = ticketData.amount;
      ticketData.sellerReceivesAmount = ticketData.amount;
      ticketData.commissionPayer = "none"; // No one pays commission

      try {
        const conversion = await convertUSDToCrypto(
          ticketData.coin,
          ticketData.buyerPaysAmount // ✅ FIXED: Use from ticketData
        );

        ticketData.cryptoAmount = conversion.cryptoAmount;
        ticketData.pricePerCoin = conversion.price;

        const sellerCryptoConversion = await convertUSDToCrypto(
          ticketData.coin,
          ticketData.sellerReceivesAmount
        );
        ticketData.sellerCryptoAmount = sellerCryptoConversion.cryptoAmount;

        const depositInfo = await generateDepositAddress(ticketData.coin);

        console.log(depositInfo, "deposit info");

        ticketData.depositAddress = depositInfo.address;
        ticketData.depositStartTime = Date.now();
        ticketData.status = "awaiting_deposit";

        // ✅ MARK PAYMENT AS STARTED - STOP INACTIVITY TIMER
        ticketData.paymentStarted = true;
        if (ticketData.inactivityTimer) {
          clearTimeout(ticketData.inactivityTimer);
        }

        const coinIcons = {
          BTC: "<:btc:1432442120903594104>",
          LTC: "<:ltc:1432442117426385067>",
          ETH: "<:eth:1432442114981232811>",
          SOL: "<:sol:1432442111147638978>",
          USDT: "<:usdt:1432442107435417641>",
          USDC: "<:usdc:1432442123957043413>",
          // Add other coin icons here
        };

        const coinIcon = coinIcons[ticketData.coin] || "";

        const summaryEmbed = new EmbedBuilder()
          .setTitle("📊 Deal Summary")
          .addFields(
            { name: "Sender", value: `${buyer}`, inline: true },
            { name: "Receiver", value: `${seller}`, inline: true },
            {
              name: "Deal Value",
              value: `$${ticketData.amount.toFixed(2)}`,
              inline: true,
            },
            {
              name: "Coin",
              value: `${coinIcon}  ${ticketData.coin}`,
              inline: true,
            },
            {
              name: "Fee",
              value: `$${ticketData.commissionAmount?.toFixed(2) || "0.00"}`,
              inline: true,
            }
          )
          .setColor("#153ee9")
          .setFooter({
            text: "Refer to this deal summary for any clarifications.",
          });

        const depositEmbed = new EmbedBuilder()
          .setTitle("📥 Payment Invoice")
          .setDescription(
            `${buyer}, send **exactly** \`${conversion.cryptoAmount.toFixed(
              8
            )}\` ${ticketData.coin} to:\n\n` +
              `Exchange Rate: 1 ${
                ticketData.coin
              } = $${conversion.price.toLocaleString()}\n\n` + // Added exchange rate line here
              `\`${depositInfo.address}\`\n\n` +
              `⚠️ **CRITICAL INSTRUCTIONS:**\n` +
              `• Send ONLY ${ticketData.coin} to this address\n` +
              `• Send the EXACT amount shown above\n` +
              `• Failure to send the precise amount will be treated as an attempt to manipulate the system; such payments will be irrecoverable, and you will be required to resend the exact amount.\n` +
              `• Use a personal wallet you control\n\n`
          )
          .setColor("#153ee9")
          .setFooter({
            text: `The bot will automatically detect your payment.`,
          });

        await interaction.channel.send({
          embeds: [summaryEmbed],
        });

        await interaction.channel.send({
          content: `${buyer}`,
          embeds: [depositEmbed],
        });

        await interaction.channel.permissionOverwrites.edit(ticketData.buyer, {
          SendMessages: true,
        });

        await interaction.channel.permissionOverwrites.edit(ticketData.seller, {
          SendMessages: true,
        });

        startPaymentMonitoring(interaction.channel, ticketData, client);
      } catch (error) {
        ticketData.processingCommission = false;
        await interaction.channel.send({
          content: "❌ Failed to generate deposit address. Please try again.",
        });
        console.error(error);
      }
    } else {
      const commissionEmbed = new EmbedBuilder()
        .setTitle("Fee Payment")
        .setDescription(
          `**Deal Amount:** $${ticketData.amount.toFixed(2)}\n` +
            `**Service Fee:** $${commissionAmount.toFixed(2)}\n\n` +
            `Who will pay the $${commissionAmount.toFixed(
              2
            )} escrow service fee?\n\n` +
            `**Option 1: Buyer Pays All** \n` +
            `• ${buyer} sends **$${(
              ticketData.amount + commissionAmount
            ).toFixed(2)}**\n` +
            `• ${seller} receives **$${ticketData.amount.toFixed(2)}**\n\n` +
            `**Option 2: Seller Pays All** \n` +
            `• ${buyer} sends **$${ticketData.amount.toFixed(2)}**\n` +
            `• ${seller} receives **$${(
              ticketData.amount - commissionAmount
            ).toFixed(2)}**\n\n` +
            `**Option 3: Split 50/50** 🤝\n` +
            `• ${buyer} sends **$${(
              ticketData.amount +
              commissionAmount / 2
            ).toFixed(2)}**\n` +
            `• ${seller} receives **$${(
              ticketData.amount -
              commissionAmount / 2
            ).toFixed(2)}**\n\n` +
            `**Both parties must agree on who pays the fee.**`
        )
        .setColor("#153ee9");

      const buyerPaysBtn = new ButtonBuilder()
        .setCustomId(`commission_buyer_${channelId}`)
        .setLabel(`Buyer Pays All`)
        .setStyle(ButtonStyle.Primary);

      const sellerPaysBtn = new ButtonBuilder()
        .setCustomId(`commission_seller_${channelId}`)
        .setLabel(`Seller Pays All`)
        .setStyle(ButtonStyle.Success);

      const splitBtn = new ButtonBuilder()
        .setCustomId(`commission_split_${channelId}`)
        .setLabel(`Split 50/50`)
        .setStyle(ButtonStyle.Secondary);

      const commissionRow = new ActionRowBuilder().addComponents(
        buyerPaysBtn,
        sellerPaysBtn,
        splitBtn
      );

      const commissionMessage = await interaction.channel.send({
        embeds: [commissionEmbed],
        components: [commissionRow],
      });

      ticketData.commissionMessage = commissionMessage;

      ticketData.commissionVotes = {
        buyer: null,
        seller: null,
      };
    }
  } else if (customId.startsWith("reject_")) {
    const rejectEmbed = new EmbedBuilder()
      .setTitle("❌ Amount Rejected")
      .setDescription(
        `${seller} rejected $${ticketData.amount.toFixed(2)}.\n\n` +
          `${buyer}, please enter a new amount.`
      )
      .setColor("#FF0000");

    try {
      await interaction.message.delete();
    } catch (error) {
      console.error("Couldn't delete approval message:", error);
    }

    await interaction.channel.send({
      embeds: [rejectEmbed],
    });

    ticketData.amount = null;

    await interaction.channel.permissionOverwrites.edit(ticketData.buyer, {
      SendMessages: true,
    });

    await interaction.channel.permissionOverwrites.edit(ticketData.seller, {
      SendMessages: false,
    });

    const amountCollector = interaction.channel.createMessageCollector({
      filter: (m) => m.author.id === ticketData.buyer,
      time: 300000,
    });

    amountCollector.on("collect", async (message) => {
      // ✅ RESET INACTIVITY
      resetInactivityTimer(interaction.channel, ticketData, client);

      const amount = parseFloat(message.content.trim());

      const minAmount = MIN_DEAL_AMOUNTS[ticketData.coin];

      // ❌ Invalid number
      if (isNaN(amount) || amount <= 0) {
        await interaction.channel.send({
          content:
            "❌ Invalid amount. Please enter a valid number (e.g., 100 or 99.99)",
        });
        // Collector keeps running, allowing retry
        return;
      }

      // ❌ Below minimum
      if (amount < minAmount) {
        await interaction.channel.send({
          content: `❌ Minimum deal amount for ${
            ticketData.coin
          } is **${minAmount.toFixed(2)}**.\n\nPlease enter a higher amount.`,
        });
        // Collector still active for retry
        return;
      }

      // ✅ Valid input — stop the collector immediately
      amountCollector.stop("valid_amount");

      ticketData.amount = amount;

      await interaction.channel.permissionOverwrites.edit(ticketData.buyer, {
        SendMessages: false,
      });

      const approvalEmbed = new EmbedBuilder()
        .setTitle("💵 Amount Confirmation")
        .setDescription(
          `${buyer} wants to pay **${amount.toFixed(2)} USD**\n\n` +
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

      const approvalMessage = await interaction.channel.send({
        content: `${seller}`,
        embeds: [approvalEmbed],
        components: [approvalRow],
      });

      ticketData.approvalMessage = approvalMessage;
    });
  }
}

async function handleDeliveryConfirmation(interaction, client) {
  const channelId = interaction.channel.id;
  const ticketData = client.ticketData.get(channelId);

  if (!ticketData) {
    await interaction.reply({
      content: "❌ Ticket data not found.",
      ephemeral: true,
    });
    return;
  }

  if (interaction.user.id !== ticketData.seller) {
    await interaction.reply({
      content: "❌ Only the seller can confirm delivery.",
      ephemeral: true,
    });
    return;
  }

  const buyer = await client.users.fetch(ticketData.buyer);
  const seller = await client.users.fetch(ticketData.seller);

  ticketData.status = "awaiting_buyer_confirmation";

  try {
    await interaction.message.delete();
  } catch (error) {
    console.error("Couldn't delete delivery message:", error);
  }

  const deliveryConfirmedEmbed = new EmbedBuilder()
    .setTitle("📦 Seller Confirmed Delivery")
    .setDescription(
      `${seller} has confirmed they will deliver the goods/service.\n\n` +
        `${buyer}, once you receive everything, please confirm below.`
    )
    .setColor("#153ee9");

  const receivedButton = new ButtonBuilder()
    .setCustomId(`goods_received_${channelId}`)
    .setLabel("✅ I Received Everything")
    .setStyle(ButtonStyle.Success);

  const notReceivedButton = new ButtonBuilder()
    .setCustomId(`goods_not_received_${channelId}`)
    .setLabel("❌ I Did NOT Receive")
    .setStyle(ButtonStyle.Danger);

  const confirmRow = new ActionRowBuilder().addComponents(
    receivedButton,
    notReceivedButton
  );

  const confirmMessage = await interaction.channel.send({
    embeds: [deliveryConfirmedEmbed],
    components: [confirmRow],
  });

  ticketData.buyerConfirmMessage = confirmMessage;
}

async function handleBuyerConfirmation(interaction, client) {
  const customId = interaction.customId;
  const channelId = interaction.channel.id;
  const ticketData = client.ticketData.get(channelId);

  if (!ticketData) {
    await interaction.reply({
      content: "❌ Ticket data not found.",
      ephemeral: true,
    });
    return;
  }

  if (interaction.user.id !== ticketData.buyer) {
    await interaction.reply({
      content: "❌ Only the buyer can confirm receipt.",
      ephemeral: true,
    });
    return;
  }

  const buyer = await client.users.fetch(ticketData.buyer);
  const seller = await client.users.fetch(ticketData.seller);

  if (customId.startsWith("goods_received_")) {
    ticketData.status = "awaiting_seller_address";

    try {
      await interaction.message.delete();
    } catch (error) {
      console.error("Couldn't delete buyer confirmation message:", error);
    }

    const proceedEmbed = new EmbedBuilder()
      .setTitle("✅ Buyer Confirmed Receipt!")
      .setDescription(
        `${buyer} confirmed they received the goods/service!\n\n` +
          `${seller}, please provide your **${ticketData.coin} wallet address** to receive payment.`
      )
      .setColor("#153ee9");

    await interaction.channel.send({
      embeds: [proceedEmbed],
    });

    // ✅ Call the new reusable function
    await collectSellerAddress(interaction.channel, ticketData, client);
  } else if (customId.startsWith("goods_not_received_")) {
    ticketData.status = "disputed";

    try {
      await interaction.message.delete();
    } catch (error) {
      console.error("Couldn't delete buyer confirmation message:", error);
    }

    // ✅ ASK SELLER TO APPROVE REFUND
    const disputeEmbed = new EmbedBuilder()
      .setTitle("⚠️ Dispute Opened")
      .setDescription(
        `${buyer} reported they did NOT receive the goods/service.\n\n` +
          `${seller}, if this is true, please approve the refund to ${buyer}.\n` +
          `If this is false, please contact support.`
      )
      .setColor("#FFA500");

    const approveRefundBtn = new ButtonBuilder()
      .setCustomId(`approve_refund_${channelId}`)
      .setLabel("✅ Approve Refund")
      .setStyle(ButtonStyle.Success);

    const contactSupportBtn = new ButtonBuilder()
      .setCustomId(`contact_support_${channelId}`)
      .setLabel("📞 Contact Support")
      .setStyle(ButtonStyle.Danger);

    const disputeRow = new ActionRowBuilder().addComponents(
      approveRefundBtn,
      contactSupportBtn
    );

    await interaction.channel.send({
      content: `${seller}`,
      embeds: [disputeEmbed],
      components: [disputeRow],
    });
  }
}

// ✅ ADD THIS NEW FUNCTION HERE
async function collectSellerAddress(channel, ticketData, client) {
  const seller = await client.users.fetch(ticketData.seller);

  const addressCollector = channel.createMessageCollector({
    filter: (m) => m.author.id === ticketData.seller,
    max: 1,
    time: 600000,
  });

  addressCollector.on("collect", async (message) => {
    const sellerAddress = message.content.trim();

    const validation = validateCryptoAddress(sellerAddress, ticketData.coin);

    if (!validation.valid) {
      await channel.send({
        content: `❌ ${validation.error}\n${getAddressWarnings(
          ticketData.coin
        )}\n\nPlease provide a valid ${ticketData.coin} address.`,
      });
      // ✅ Recursively ask again
      return collectSellerAddress(channel, ticketData, client);
    }

    // ✅ Valid address - proceed with confirmation
    ticketData.sellerAddress = sellerAddress;

    const confirmationEmbed = new EmbedBuilder()
      .setTitle("⚠️ CONFIRM YOUR WALLET ADDRESS")
      .setDescription(
        `${seller}, is this your CORRECT ${ticketData.coin} address?\n\n` +
          `\`\`\`${sellerAddress}\`\`\`\n\n` +
          `🚨 **WARNING:**\n` +
          `• Cryptocurrency transactions are IRREVERSIBLE\n` +
          `• If this address is wrong, YOUR MONEY IS GONE FOREVER\n` +
          `• Double-check EVERY character\n` +
          `• Triple-check the address type matches the coin\n\n` +
          `${getAddressWarnings(ticketData.coin)}`
      )
      .setColor("#153ee9");

    const confirmButton = new ButtonBuilder()
      .setCustomId(`confirm_address_${channel.id}`)
      .setLabel("✅ YES - Send My Payment")
      .setStyle(ButtonStyle.Success);

    const cancelButton = new ButtonBuilder()
      .setCustomId(`cancel_address_${channel.id}`)
      .setLabel("❌ NO - Let Me Re-enter")
      .setStyle(ButtonStyle.Danger);

    const confirmRow = new ActionRowBuilder().addComponents(
      confirmButton,
      cancelButton
    );

    const addressConfirmMessage = await channel.send({
      content: `${seller}`,
      embeds: [confirmationEmbed],
      components: [confirmRow],
    });

    ticketData.addressConfirmMessage = addressConfirmMessage;
  });

  addressCollector.on("end", async (collected) => {
    if (collected.size === 0) {
      await channel.send({
        content: `⏰ Time expired waiting for address. Please contact support.`,
      });
    }
  });
}

// ✅ HANDLE DISPUTE ACTIONS
async function handleDisputeAction(interaction, client) {
  const customId = interaction.customId;
  const channelId = interaction.channel.id;
  const ticketData = client.ticketData.get(channelId);

  if (!ticketData) {
    await interaction.reply({
      content: "❌ Ticket data not found.",
      ephemeral: true,
    });
    return;
  }

  if (interaction.user.id !== ticketData.seller) {
    await interaction.reply({
      content: "❌ Only the seller can respond to this.",
      ephemeral: true,
    });
    return;
  }

  const buyer = await client.users.fetch(ticketData.buyer);
  const seller = await client.users.fetch(ticketData.seller);

  if (customId.startsWith("approve_refund_")) {
    try {
      await interaction.message.delete();
    } catch (error) {
      console.error("Couldn't delete dispute message:", error);
    }

    const refundEmbed = new EmbedBuilder()
      .setTitle("✅ Seller Approved Refund")
      .setDescription(
        `${seller} has approved the refund request.\n\n` +
          `${buyer}, please provide your **${ticketData.coin} wallet address** to receive your refund.`
      )
      .setColor("#00FF00");

    await interaction.channel.send({
      embeds: [refundEmbed],
    });

    const addressCollector = interaction.channel.createMessageCollector({
      filter: (m) => m.author.id === ticketData.buyer,
      max: 1,
      time: 600000,
    });

    addressCollector.on("collect", async (message) => {
      const buyerAddress = message.content.trim();

      const validation = validateCryptoAddress(buyerAddress, ticketData.coin);

      if (!validation.valid) {
        await interaction.channel.send({
          content: `❌ ${validation.error}. Please provide a valid address.`,
        });
        addressCollector.resetTimer();
        return;
      }

      try {
        const commissionCrypto = ticketData.sellerCryptoAmount
          ? ticketData.cryptoAmount - ticketData.sellerCryptoAmount
          : 0;

        const refundAmount = ticketData.sellerCryptoAmount
          ? ticketData.cryptoAmount - commissionCrypto
          : ticketData.cryptoAmount;

        const refund = await refundBuyer(
          ticketData.coin,
          refundAmount,
          buyerAddress,
          getNetworkForCoin(ticketData.coin)
        );

        const refundSuccessEmbed = new EmbedBuilder()
          .setTitle("✅ Refund Processed")
          .setDescription(
            `**Refund sent successfully!**\n\n` +
              `💰 Refunded: **${refundAmount.toFixed(8)} ${
                ticketData.coin
              }** (${ticketData.sellerReceivesAmount.toFixed(2)})\n` +
              `💼 Service Fee Retained: **${commissionCrypto.toFixed(8)} ${
                ticketData.coin
              }** (${ticketData.commissionAmount.toFixed(2)})\n` +
              `📍 Destination: \`${buyerAddress}\`\n` +
              `🔗 Transaction ID: \`${refund.withdrawId}\`\n\n` +
              `${buyer}, you should receive your refund within 10-60 minutes.`
          )
          .setColor("#00FF00");

        await interaction.channel.send({ embeds: [refundSuccessEmbed] });
        ticketData.status = "refunded";

        setTimeout(async () => {
          try {
            await interaction.channel.delete(
              "Dispute resolved - refund processed"
            );
            console.log(`🗑️ Ticket channel ${channelId} deleted after refund`);
          } catch (error) {
            console.error("Error deleting channel:", error);
          }
        }, 60000);
      } catch (error) {
        await interaction.channel.send({
          content: `❌ CRITICAL ERROR: Refund failed. Please contact support immediately with ticket ID: ${channelId}`,
        });
        console.error("CRITICAL: Refund failed:", error);
      }
    });
  } else if (customId.startsWith("contact_support_")) {
    try {
      await interaction.message.delete();
    } catch (error) {
      console.error("Couldn't delete dispute message:", error);
    }

    const supportEmbed = new EmbedBuilder()
      .setTitle("📞 Contact Support")
      .setDescription(
        `${seller} has requested support intervention.\n\n` +
          `**Both parties must contact support** to resolve this dispute.\n\n` +
          `**Ticket ID:** \`${channelId}\`\n` +
          `**DO NOT CLOSE THIS TICKET** until support resolves the issue.`
      )
      .setColor("#FFA500");

    await interaction.channel.send({
      content: `${buyer} ${seller}`,
      embeds: [supportEmbed],
    });

    ticketData.status = "awaiting_support";
  }
}

async function handleAddressConfirmation(interaction, client) {
  const customId = interaction.customId;
  const channelId = interaction.channel.id;
  const ticketData = client.ticketData.get(channelId);

  if (!ticketData) {
    await interaction.reply({
      content: "❌ Ticket data not found.",
      ephemeral: true,
    });
    return;
  }

  if (interaction.user.id !== ticketData.seller) {
    await interaction.reply({
      content: "❌ Only the seller can confirm the address.",
      ephemeral: true,
    });
    return;
  }

  if (customId.startsWith("confirm_address_")) {
    try {
      try {
        await interaction.message.delete();
      } catch (error) {
        console.error("Couldn't delete address confirmation message:", error);
      }

      const processingEmbed = new EmbedBuilder()
        .setTitle("⚙️ Processing Payment")
        .setDescription(
          `**Please wait while we process the payment to the seller...**\n\n` +
            `🔄 Releasing Payment\n`
        )
        .setColor("#153ee9")
        .setFooter({ text: "This may take a few minutes." })
        .setThumbnail(
          "https://media.tenor.com/mFUK6kFFCqIAAAAi/pengu-pudgy.gif"
        );

      await interaction.channel.send({
        embeds: [processingEmbed],
      });

      if (ticketData.timeoutTimer) {
        clearTimeout(ticketData.timeoutTimer);
      }

      const withdrawal = await sendCryptoToSeller(
        ticketData.coin,
        ticketData.sellerCryptoAmount.toFixed(8),
        ticketData.sellerAddress,
        getNetworkForCoin(ticketData.coin)
      );

      await new Promise((resolve) => setTimeout(resolve, 100000));

      const buyer = await client.users.fetch(ticketData.buyer);
      const seller = await client.users.fetch(ticketData.seller);

      const commissionCrypto =
        ticketData.cryptoAmount - ticketData.sellerCryptoAmount;

      const withdrawalTxHash = withdrawal.txId || withdrawal.withdrawId;

      const completedEmbed = new EmbedBuilder()
        .setTitle("🎉 Escrow Deal Completed!")
        .setDescription(
          `**Payment successfully sent to seller!**\n\n` +
            ` Buyer Paid: **${ticketData.cryptoAmount.toFixed(8)} ${
              ticketData.coin
            }** (${ticketData.buyerPaysAmount.toFixed(2)})\n` +
            ` Seller Received: **${ticketData.sellerCryptoAmount.toFixed(8)} ${
              ticketData.coin
            }** (${ticketData.sellerReceivesAmount.toFixed(2)})\n` +
            `💼 Service Fee: **${commissionCrypto.toFixed(8)} ${
              ticketData.coin
            }** (${ticketData.commissionAmount.toFixed(2)})\n\n` +
            ` Seller Address: \`${ticketData.sellerAddress}\`\n` +
            ` Withdrawal ID: \`${withdrawal.withdrawId}\`\n` +
            `${
              withdrawal.txId
                ? `📝 Transaction Hash: \`${withdrawal.txId}\`\n`
                : ""
            }\n` +
            `👤 Buyer: ${buyer}\n` +
            `👤 Seller: ${seller}\n\n`
        )
        .setColor("#00FF00")
        .setFooter({
          text: "This ticket will remain open for your records. You can save transaction details.",
        })
        .setThumbnail(
          "https://media.tenor.com/QUCJ9Lc4Oa4AAAAi/yes-friends.gif"
        )
        .setTimestamp();

      await interaction.channel.send({
        content: `${buyer} ${seller}`,
        embeds: [completedEmbed],
      });

      ticketData.status = "completed";

      console.log("💼 COMMISSION EARNED:");
      console.log(
        `   Amount: ${commissionCrypto.toFixed(8)} ${ticketData.coin}`
      );
      console.log(`   USD Value: ${ticketData.commissionAmount.toFixed(2)}`);
      console.log(`   Deal Amount: ${ticketData.amount.toFixed(2)}`);
      console.log(`   Ticket ID: ${channelId}`);
      console.log(`   Buyer: ${ticketData.buyer}`);
      console.log(`   Seller: ${ticketData.seller}`);

      // ✅ ASK FOR PRIVACY PREFERENCE
      await askPrivacyPreference(
        interaction.channel,
        ticketData,
        client,
        withdrawalTxHash
      );
    } catch (error) {
      console.error("CRITICAL ERROR - Payment to seller failed:", error);

      const errorEmbed = new EmbedBuilder()
        .setTitle("❌ CRITICAL ERROR: Payment Failed")
        .setDescription(
          `**Failed to send payment to seller!**\n\n` +
            `⚠️ **IMPORTANT:** Your crypto is SAFE in the escrow wallet.\n\n` +
            `**Error Details:**\n${error.message}\n\n` +
            `**Next Steps:**\n` +
            `1. Screenshot this entire conversation\n` +
            `2. Contact support immediately with Ticket ID: \`${channelId}\`\n` +
            `3. DO NOT close this ticket\n\n` +
            `Our team will manually process the payment or refund.`
        )
        .setColor("#FF0000")
        .setFooter({ text: "Ticket ID: " + channelId });

      await interaction.channel.send({
        content: `@everyone **URGENT: Payment Processing Failed**`,
        embeds: [errorEmbed],
      });

      console.error("=".repeat(60));
      console.error("CRITICAL PAYMENT FAILURE");
      console.error("Ticket ID:", channelId);
      console.error("Coin:", ticketData.coin);
      console.error("Amount:", ticketData.cryptoAmount);
      console.error("Seller Address:", ticketData.sellerAddress);
      console.error("Buyer:", ticketData.buyer);
      console.error("Seller:", ticketData.seller);
      console.error("Error:", error);
      console.error("=".repeat(60));
    }
  } else if (customId.startsWith("cancel_address_")) {
    try {
      await interaction.message.delete();
    } catch (error) {
      console.error("Couldn't delete address confirmation message:", error);
    }

    await interaction.channel.send({
      content: `Please send your **${ticketData.coin} wallet address** again:`,
    });

    ticketData.sellerAddress = null;

    // ✅ Call the reusable function instead of duplicating code
    await collectSellerAddress(interaction.channel, ticketData, client);
  } // ✅ This closing brace was misplaced in your version
}

// ✅ HANDLE PRIVACY VOTE
async function handlePrivacyVote(interaction, client) {
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

  if (userId !== ticketData.buyer && userId !== ticketData.seller) {
    await interaction.reply({
      content: "❌ You are not part of this ticket.",
      ephemeral: true,
    });
    return;
  }

  const isBuyer = userId === ticketData.buyer;
  const preference = customId.includes("_public_") ? "public" : "anonymous";

  if (isBuyer) {
    if (ticketData.privacyVotes.buyer) {
      await interaction.reply({
        content: "❌ You already voted!",
        ephemeral: true,
      });
      return;
    }
    ticketData.privacyVotes.buyer = preference;
  } else {
    if (ticketData.privacyVotes.seller) {
      await interaction.reply({
        content: "❌ You already voted!",
        ephemeral: true,
      });
      return;
    }
    ticketData.privacyVotes.seller = preference;
  }

  await interaction.reply({
    content: `✅ You chose: **${preference.toUpperCase()}**`,
    ephemeral: true,
  });

  // ✅ CHECK IF BOTH VOTED
  if (ticketData.privacyVotes.buyer && ticketData.privacyVotes.seller) {
    // 🧱 Race-condition guard: prevent duplicate execution
    if (ticketData.privacyFinalized) return;
    ticketData.privacyFinalized = true; // set immediately before any awaits

    try {
      await interaction.message.delete();
    } catch (error) {
      console.error("Couldn't delete privacy message:", error);
    }

    // ✅ POST TO COMPLETED DEALS
    await postCompletedDeal(
      interaction.guild,
      ticketData,
      ticketData.withdrawalTxHash
    );

    // ✅ ASK BOTH TO CLOSE TICKET
    await askToCloseTicket(interaction.channel, ticketData, client);
  }
}

// ✅ HANDLE FINAL CLOSE VOTE
async function handleFinalClose(interaction, client) {
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

  if (userId !== ticketData.buyer && userId !== ticketData.seller) {
    await interaction.reply({
      content: "❌ You are not part of this ticket.",
      ephemeral: true,
    });
    return;
  }

  const isBuyer = userId === ticketData.buyer;

  if (isBuyer) {
    if (ticketData.closeVotes.buyer) {
      await interaction.reply({
        content: "❌ You already voted to close!",
        ephemeral: true,
      });
      return;
    }
    ticketData.closeVotes.buyer = true;
  } else {
    if (ticketData.closeVotes.seller) {
      await interaction.reply({
        content: "❌ You already voted to close!",
        ephemeral: true,
      });
      return;
    }
    ticketData.closeVotes.seller = true;
  }

  await interaction.reply({
    content: "✅ You voted to close the ticket. Waiting for the other party...",
    ephemeral: true,
  });

  // ✅ CHECK IF BOTH VOTED TO CLOSE
  if (ticketData.closeVotes.buyer && ticketData.closeVotes.seller) {
    if (ticketData.closeFinalized) return;
    ticketData.closeFinalized = true;

    try {
      await interaction.message.delete();
    } catch (error) {
      console.error("Couldn't delete close message:", error);
    }

    await interaction.channel.send({
      content:
        "🗑️ Both parties agreed to close. Deleting ticket in 5 seconds...",
    });

    setTimeout(async () => {
      try {
        await interaction.channel.delete(
          "Deal completed - both parties agreed to close"
        );
        console.log(`🗑️ Ticket ${channelId} closed by mutual agreement`);
        client.ticketData.delete(channelId);
      } catch (error) {
        console.error("Error deleting channel:", error);
      }
    }, 5000);
  }
}

// ✅ HANDLE CLOSE BUTTON (EARLY STAGE)
// ✅ HANDLE CLOSE BUTTON (EARLY STAGE)
async function handleCloseTicket(interaction, client) {
  const channelId = interaction.channel.id;
  const ticketData = client.ticketData.get(channelId);

  if (!ticketData) {
    await interaction.reply({
      content: "❌ Ticket data not found.",
      ephemeral: true,
    });
    return;
  }

  const userId = interaction.user.id;

  // ✅ FIXED: Allow both user1 AND user2 to close
  if (userId !== ticketData.user1 && userId !== ticketData.user2) {
    await interaction.reply({
      content: "❌ Only participants of this ticket can close it.",
      ephemeral: true,
    });
    return;
  }

  // ✅ Check if payment has started
  if (ticketData.paymentStarted) {
    await interaction.reply({
      content:
        "🔒 **This ticket cannot be closed!**\n\n" +
        "Payment processing has begun. For security reasons, the ticket must remain open until the deal is completed.\n\n" +
        "If there's an issue, please contact support.",
      ephemeral: true,
    });
    return;
  }

  const confirmEmbed = new EmbedBuilder()
    .setTitle("⚠️ Close Ticket?")
    .setDescription(
      `Are you sure you want to close this ticket?\n\n` +
        `**This action cannot be undone.**`
    )
    .setColor("#FFA500");

  const confirmBtn = new ButtonBuilder()
    .setCustomId(`confirm_close_${channelId}`)
    .setLabel("✅ Yes, Close Ticket")
    .setStyle(ButtonStyle.Danger);

  const cancelBtn = new ButtonBuilder()
    .setCustomId(`cancel_close_${channelId}`)
    .setLabel("❌ Cancel")
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder().addComponents(confirmBtn, cancelBtn);

  await interaction.reply({
    embeds: [confirmEmbed],
    components: [row],
    ephemeral: true,
  });
}

async function handleCloseConfirmation(interaction, client) {
  const customId = interaction.customId;
  const channelId = interaction.channel.id;

  if (customId.startsWith("confirm_close_")) {
    await interaction.update({
      content: "🗑️ Closing ticket...",
      embeds: [],
      components: [],
    });

    setTimeout(async () => {
      try {
        await interaction.channel.delete("Ticket closed by user");
        console.log(`🗑️ Ticket ${channelId} closed by user`);

        if (client.ticketData && client.ticketData.has(channelId)) {
          client.ticketData.delete(channelId);
        }
      } catch (error) {
        console.error("Error deleting channel:", error);
      }
    }, 2000);
  } else if (customId.startsWith("cancel_close_")) {
    await interaction.update({
      content: "✅ Ticket closure cancelled.",
      embeds: [],
      components: [],
    });
  }
}

// ========================================
// MAIN EXECUTE FUNCTION
// ========================================

export async function execute(interaction, client) {
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

  if (interaction.isButton()) {
    const customId = interaction.customId;

    if (customId.startsWith("buyer_") || customId.startsWith("seller_")) {
      await handleRoleSelection(interaction, client);
    }

    if (customId.startsWith("reset_roles_")) {
      await handleResetRoles(interaction, client);
    }

    if (customId.startsWith("approve_") || customId.startsWith("reject_")) {
      await handleSellerApproval(interaction, client);
    }

    if (customId.startsWith("commission_")) {
      await handleCommissionSelection(interaction, client);
    }

    if (customId.startsWith("confirm_delivery_")) {
      await handleDeliveryConfirmation(interaction, client);
    }

    if (
      customId.startsWith("goods_received_") ||
      customId.startsWith("goods_not_received_")
    ) {
      await handleBuyerConfirmation(interaction, client);
    }

    if (
      customId.startsWith("approve_refund_") ||
      customId.startsWith("contact_support_")
    ) {
      await handleDisputeAction(interaction, client);
    }

    if (
      customId.startsWith("confirm_address_") ||
      customId.startsWith("cancel_address_")
    ) {
      await handleAddressConfirmation(interaction, client);
    }

    if (customId.startsWith("privacy_")) {
      await handlePrivacyVote(interaction, client);
    }

    if (customId.startsWith("final_close_")) {
      await handleFinalClose(interaction, client);
    }

    if (customId.startsWith("close_ticket_")) {
      await handleCloseTicket(interaction, client);
    }

    if (
      customId.startsWith("confirm_close_") ||
      customId.startsWith("cancel_close_")
    ) {
      await handleCloseConfirmation(interaction, client);
    }
  }

  if (interaction.isStringSelectMenu()) {
    if (interaction.customId === "coinSelect") {
      const coin = interaction.values[0];
      const user = interaction.user;
      const guild = interaction.guild;

      // ✅ Defer the update first to avoid interaction timeout
      await interaction.deferUpdate();

      // ✅ Send ephemeral message
      await interaction.followUp({
        content: `💰 You selected **${coin}**! Creating your private ticket...`,
        ephemeral: true,
      });

      // ✅ Reset the dropdown after responding
      try {
        const embed = new EmbedBuilder()
          .setTitle("Start Your Escrow Deal")
          .setDescription(
            "**Cryptocurrency**\n" +
              "__Fees:__\n" +
              "• Deals $300+: **1%**\n" +
              "• Deals under $300: **$2**\n" +
              "• Deals under $50: **$0.50**\n" +
              "• Deals under $30 are **FREE**\n" +
              "• **USDT & USDC** have a **$1 subcharge**\n\n" +
              "Press the dropdown below to select & initiate a deal involving:\n" +
              "**Bitcoin, Ethereum, Litecoin, Solana, USDT [ERC-20], USDC [ERC-20].**"
          )
          .setColor("#153ee9");

        const options = [
          {
            label: "Bitcoin (BTC)",
            description: "Pay with Bitcoin",
            value: "BTC",
            emoji: { id: "1432442120903594104", name: "btc" },
          },
          {
            label: "Litecoin (LTC)",
            description: "Pay with Litecoin",
            value: "LTC",
            emoji: { id: "1432442117426385067", name: "ltc" },
          },
          {
            label: "Ethereum (ETH)",
            description: "Pay with Ethereum",
            value: "ETH",
            emoji: { id: "1432442114981232811", name: "eth" },
          },
          {
            label: "Solana (SOL)",
            description: "Pay with Solana",
            value: "SOL",
            emoji: { id: "1432442111147638978", name: "sol" },
          },
          {
            label: "USDT (Tether)",
            description: "Pay with Tether",
            value: "USDT",
            emoji: { id: "1432442107435417641", name: "usdt" },
          },
          {
            label: "USDC (USD Coin)",
            description: "Pay with USD Coin",
            value: "USDC",
            emoji: { id: "1432442123957043413", name: "usdc" },
          },
        ];

        const select = new StringSelectMenuBuilder()
          .setCustomId("coinSelect")
          .setPlaceholder("Select your coin")
          .addOptions(options);

        const row = new ActionRowBuilder().addComponents(select);

        await interaction.message.edit({
          embeds: [embed],
          components: [row],
        });

        console.log("✅ Dropdown reset to default state");
      } catch (error) {
        console.error("Error resetting dropdown:", error);
      }

      try {
        const ticketChannel = await guild.channels.create({
          name: `ticket-${user.username}-${coin}`,
          type: ChannelType.GuildText,
          parent: null,
          permissionOverwrites: [
            {
              id: guild.id,
              deny: [PermissionFlagsBits.ViewChannel],
            },
            {
              id: user.id,
              allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
              ],
            },
            {
              id: client.user.id,
              allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
              ],
            },
          ],
        });

        const welcomeEmbed = new EmbedBuilder()
          .setTitle(`🎫 Escrow Ticket - ${coin}`)
          .setDescription(
            `Welcome ${user}!\n\n` +
              `**Selected Cryptocurrency:** ${coin}\n\n` +
              `Please provide the **User ID** of the person you want to add to this escrow deal.\n\n` +
              `**How to get User ID:**\n` +
              `1️⃣ Enable Developer Mode in Discord Settings\n` +
              `2️⃣ Right-click on their profile\n` +
              `3️⃣ Click "Copy User ID"\n\n` +
              `__Who are you dealing with?__\n` +
              `*e.g.* \`123456789123456789\`\n\n` +
              `⏰ **This ticket will be deleted after 30 minutes of inactivity**`
          )
          .setColor("#153ee9")
          .setFooter({ text: "Reply with the User ID below" });

        const securityEmbed = new EmbedBuilder()
          .setTitle("🔒 Security Notice")
          .setDescription(
            `Your safety is our **top priority**.\n\n` +
              `Our bot and escrow staff will **never DM you first**. Always keep all communication **inside this ticket only**.\n\n` +
              `Engaging outside of this ticket may put you at risk of being scammed — stay cautious and verify everything.`
          )
          .setColor("#FF0000")
          .setFooter({ text: "Stay safe — only trust verified escrow staff." });

        const closeButton = new ButtonBuilder()
          .setCustomId(`close_ticket_${ticketChannel.id}`)
          .setLabel("🔒 Close Ticket")
          .setStyle(ButtonStyle.Secondary);

        const closeRow = new ActionRowBuilder().addComponents(closeButton);

        await ticketChannel.send({
          content: `${user}`,
          embeds: [welcomeEmbed, securityEmbed],
          components: [closeRow],
        });

        // ✅ Edit the ephemeral message
        await interaction.editReply({
          content: `✅ Ticket created! Check ${ticketChannel}`,
        });

        const filter = (m) => m.author.id === user.id;
        const collector = ticketChannel.createMessageCollector({
          filter,
          time: 300000,
        });

        // Initialize ticket data
        if (!client.ticketData) {
          client.ticketData = new Map();
        }

        const ticketData = {
          user1: user.id,
          user2: null,
          coin: coin,
          buyer: null,
          seller: null,
          amount: null,
          cryptoAmount: null,
          pricePerCoin: null,
          depositAddress: null,
          depositStartTime: null,
          paymentReceived: false,
          sellerAddress: null,
          buyerAddress: null,
          channelId: ticketChannel.id,
          status: "awaiting_roles",
          createdAt: Date.now(),
          timeoutTimer: null,
          inactivityTimer: null,
          paymentStarted: false,
          commissionAmount: null,
          commissionPayer: null,
          commissionVotes: null,
          buyerPaysAmount: null,
          sellerReceivesAmount: null,
          sellerCryptoAmount: null,
          processingCommission: false,
          processingRoleSelection: false,
          depositTxHash: null,
          withdrawalTxHash: null,
          privacyVotes: null,
          closeVotes: null,
          roleMessage: null,
          approvalMessage: null,
          commissionMessage: null,
          paymentDetectionMessage: null,
          deliveryMessage: null,
          buyerConfirmMessage: null,
          addressConfirmMessage: null,
          privacyFinalized: false,
          closeFinalized: false,
        };

        client.ticketData.set(ticketChannel.id, ticketData);

        // ✅ START INACTIVITY TIMER
        resetInactivityTimer(ticketChannel, ticketData, client);

        let userAdded = false;
        collector.on("collect", async (message) => {
          // ✅ RESET INACTIVITY
          resetInactivityTimer(ticketChannel, ticketData, client);

          const secondUserId = message.content.trim();

          if (!/^\d{17,19}$/.test(secondUserId)) {
            await ticketChannel.send({
              content:
                "❌ Invalid User ID format. Please provide a valid Discord User ID.",
            });
            return;
          }

          try {
            const secondUser = await client.users
              .fetch(secondUserId)
              .catch(() => null);
            if (!secondUser) {
              await ticketChannel.send({
                content:
                  "⚠️ That User ID could not be found. Please double-check and try again:",
              });
              return; // still allow retry
            }

            // ✅ Valid user — mark as added
            userAdded = true;
            collector.stop("user_added");

            ticketData.user2 = secondUser.id;

            await ticketChannel.permissionOverwrites.create(secondUser.id, {
              ViewChannel: true,
              SendMessages: true,
              ReadMessageHistory: true,
            });

            const confirmEmbed = new EmbedBuilder()
              .setTitle("✅ User Added to Ticket")
              .setDescription(
                `${secondUser} has been added to this escrow deal!\n\n**Deal Details:**\n💰 Cryptocurrency: **${coin}**\n`
              )
              .setColor("#153ee9");

            await ticketChannel.send({
              content: `${secondUser}`,
              embeds: [confirmEmbed],
            });

            const roleEmbed = new EmbedBuilder()
              .setTitle("👥 Select Your Role")
              .setDescription(
                `${user} and ${secondUser}, please select your roles in this escrow deal.\n\n` +
                  `**Buyer**: Person paying money\n` +
                  `**Seller**: Person providing goods/service`
              )
              .setColor("#153ee9");

            const buyerButton = new ButtonBuilder()
              .setCustomId(`buyer_${user.id}_${secondUser.id}`)
              .setLabel("I'm the Buyer 💰")
              .setStyle(ButtonStyle.Primary);

            const sellerButton = new ButtonBuilder()
              .setCustomId(`seller_${user.id}_${secondUser.id}`)
              .setLabel("I'm the Seller 📦")
              .setStyle(ButtonStyle.Primary);

            const resetButton = new ButtonBuilder()
              .setCustomId(`reset_roles_${ticketChannel.id}`)
              .setLabel("🔄 Reset Roles")
              .setStyle(ButtonStyle.Secondary);

            const roleRow = new ActionRowBuilder().addComponents(
              buyerButton,
              sellerButton,
              resetButton
            );

            const roleMessage = await ticketChannel.send({
              embeds: [roleEmbed],
              components: [roleRow],
            });

            ticketData.roleMessage = roleMessage;

            startTicketTimeout(ticketChannel, ticketData, client);
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
