import {
  ChannelType,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
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

export const name = "interactionCreate";
export const once = false;

const TICKET_TIMEOUT = 30 * 60 * 1000; // 30 minutes in milliseconds
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
    USDT: "ETH", // ERC20 uses Ethereum network
    USDC: "ETH", // ERC20 uses Ethereum network
  };
  return networks[coinSymbol];
}

// ========================================
// HELPER FUNCTIONS
// ========================================

function startTicketTimeout(channel, ticketData, client) {
  // Clear existing timeout if any
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
  const buyer = await client.users.fetch(ticketData.buyer);
  const seller = await client.users.fetch(ticketData.seller);

  if (ticketData.paymentReceived && !ticketData.status.includes("completed")) {
    // Payment received but deal not completed - REFUND BUYER
    const timeoutEmbed = new EmbedBuilder()
      .setTitle("⏰ Ticket Timeout - Refunding Buyer")
      .setDescription(
        `This ticket has exceeded the 30-minute time limit.\n\n` +
          `**Refund Status:** Processing refund to ${buyer}...`
      )
      .setColor("#FF0000");

    await channel.send({
      content: `${buyer} ${seller}`,
      embeds: [timeoutEmbed],
    });

    try {
      // Request buyer's refund address
      await channel.send({
        content: `${buyer}, please provide your **${ticketData.coin} wallet address** to receive your refund.`,
      });

      const refundCollector = channel.createMessageCollector({
        filter: (m) => m.author.id === ticketData.buyer,
        max: 1,
        time: 600000, // 10 minutes to provide address
      });

      refundCollector.on("collect", async (message) => {
        const buyerAddress = message.content.trim();

        const validation = validateCryptoAddress(buyerAddress, ticketData.coin);
        if (!validation.valid) {
          await channel.send({
            content: `❌ ${validation.error}. Please provide a valid address.`,
          });
          return;
        }

        try {
          // Calculate refund WITHOUT commission (you keep the $1 fee)
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
            getNetworkForCoin(ticketData.coin) // ✅ ADDED THIS LINE
          );

          const refundSuccessEmbed = new EmbedBuilder()
            .setTitle("✅ Refund Processed")
            .setDescription(
              `**Refund sent successfully!**\n\n` +
                `💰 Refunded: **${refundAmount.toFixed(8)} ${
                  ticketData.coin
                }** ($${ticketData.sellerReceivesAmount.toFixed(2)})\n` +
                `💼 Service Fee Retained: **${commissionCrypto.toFixed(8)} ${
                  ticketData.coin
                }** ($${ticketData.commissionAmount.toFixed(2)})\n` +
                `📍 Destination: \`${buyerAddress}\`\n` +
                `🔗 Transaction ID: \`${refund.withdrawId}\`\n\n` +
                `${buyer}, you should receive your refund within 10-60 minutes.`
            )
            .setColor("#00FF00");

          await channel.send({ embeds: [refundSuccessEmbed] });
          ticketData.status = "refunded";

          // Log commission earned
          if (commissionCrypto > 0) {
            console.log("💼 COMMISSION EARNED FROM TIMEOUT:");
            console.log(
              `   Amount: ${commissionCrypto.toFixed(8)} ${ticketData.coin}`
            );
            console.log(
              `   USD Value: $${
                ticketData.commissionAmount
                  ? ticketData.commissionAmount.toFixed(2)
                  : "N/A"
              }`
            );
            console.log(`   Ticket ID: ${channel.id}`);
          }
        } catch (error) {
          await channel.send({
            content: `❌ CRITICAL ERROR: Refund failed. Please contact support immediately with ticket ID: ${channel.id}`,
          });
          console.error("CRITICAL: Refund failed:", error);
        }
      });
    } catch (error) {
      console.error("Error processing timeout refund:", error);
    }
  } else {
    // No payment received - just close
    const timeoutEmbed = new EmbedBuilder()
      .setTitle("⏰ Ticket Timeout")
      .setDescription(
        `This ticket has exceeded the 30-minute time limit and will be closed.`
      )
      .setColor("#FFA500");

    await channel.send({ embeds: [timeoutEmbed] });
    ticketData.status = "timeout";
  }
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
  const checkInterval = 60000; // Check every 1 minute
  const timeoutAt = ticketData.createdAt + TICKET_TIMEOUT;

  // ✅ TRACK IF WE ALREADY NOTIFIED
  let hasNotifiedPaymentDetected = false;
  let paymentDetectedTime = null; // ✅ Track when payment first detected

  const paymentChecker = setInterval(async () => {
    // ✅ CHECK IF CHANNEL STILL EXISTS
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

    // CHECK TIMEOUT
    if (Date.now() >= timeoutAt) {
      clearInterval(paymentChecker);
      await activeChannel
        .send({
          content: "⏱️ Payment monitoring timed out.",
        })
        .catch((err) => console.error(err.message));
      return;
    }

    // CHECK STATUS
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

      // ✅ If payment detected for FIRST TIME, record timestamp
      if (paymentStatus.received && !paymentDetectedTime) {
        paymentDetectedTime = Date.now();
      }

      // ✅ Check if 5 minutes passed since detection
      const fiveMinutesPassed =
        paymentDetectedTime &&
        Date.now() - paymentDetectedTime >= 5 * 60 * 1000;

      // ✅ SHOW CONFIRMATION AFTER 5 MINUTES
      if (paymentStatus.received && fiveMinutesPassed) {
        // ✅ STOP CHECKING - Payment confirmed!
        clearInterval(paymentChecker);
        ticketData.paymentReceived = true;
        ticketData.status = "awaiting_goods_delivery";

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

        // ✅ EMBED 1: Payment Confirmed
        const paymentConfirmedEmbed = new EmbedBuilder()
          .setTitle("✅ Payment Confirmed!")
          .setDescription(
            `${buyer} has sent **${paymentStatus.amount.toFixed(8)} ${
              ticketData.coin
            }**!\n\n` +
              `**Transaction ID:** \`${paymentStatus.txId}\`\n` +
              `**Confirmations:** ${paymentStatus.confirmations}/${minConf}\n` +
              `**Track Transaction:** [View on Block Explorer](${txLink})\n\n` +
              `${seller}, you can now deliver the goods/service to ${buyer}.\n` +
              `Once ${buyer} receives everything, they will confirm below.`
          )
          .setColor("#00FF00");

        await activeChannel.send({
          content: `${buyer} ${seller}`,
          embeds: [paymentConfirmedEmbed],
        });

        // ✅ EMBED 2: Delivery Button
        const deliveryEmbed = new EmbedBuilder()
          .setTitle("📦 Goods/Service Delivery")
          .setDescription(
            `${seller}, please confirm you will deliver the goods/service now.`
          )
          .setColor("#FFA500");

        const confirmDeliveryBtn = new ButtonBuilder()
          .setCustomId(`confirm_delivery_${channel.id}`)
          .setLabel("✅ I Will Deliver Now")
          .setStyle(ButtonStyle.Success);

        const deliveryRow = new ActionRowBuilder().addComponents(
          confirmDeliveryBtn
        );

        await activeChannel.send({
          content: `${seller}`,
          embeds: [deliveryEmbed],
          components: [deliveryRow],
        });
      } else if (paymentStatus.received && !hasNotifiedPaymentDetected) {
        // ✅ FIRST TIME DETECTION - Show message ONCE
        const txLink = getBlockExplorerLink(
          ticketData.coin,
          paymentStatus.txId
        );

        await activeChannel
          .send({
            content:
              `⏳ **Payment detected!** Waiting for confirmations: ${paymentStatus.confirmations}/${minConf}\n\n` +
              `📍 **Track your transaction:** ${txLink}\n` +
              `⏱️ Payment will be confirmed in ~5 minutes.`,
          })
          .catch((err) => console.error(err.message));

        hasNotifiedPaymentDetected = true;
      }
      // ✅ REMOVED: No more confirmation updates!
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

  // Check if user is part of this ticket
  if (userId !== ticketData.buyer && userId !== ticketData.seller) {
    await interaction.reply({
      content: "❌ You are not part of this ticket.",
      ephemeral: true,
    });
    return;
  }

  // ✅ CHECK IF THIS USER ALREADY VOTED
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

  // Determine which option they voted for
  let vote;
  if (customId.includes("_buyer_")) {
    vote = "buyer_pays";
  } else if (customId.includes("_seller_")) {
    vote = "seller_pays";
  } else if (customId.includes("_split_")) {
    vote = "split";
  }

  // Record their vote
  if (isBuyer) {
    ticketData.commissionVotes.buyer = vote;
  } else {
    ticketData.commissionVotes.seller = vote;
  }

  await interaction.reply({
    content: `✅ You voted for: **${vote.replace("_", " ").toUpperCase()}**`,
    ephemeral: true,
  });

  // ✅ CHECK IF BOTH HAVE VOTED *AND* NOT ALREADY PROCESSING
  if (
    ticketData.commissionVotes.buyer &&
    ticketData.commissionVotes.seller &&
    !ticketData.processingCommission
  ) {
    // ✅ SET LOCK IMMEDIATELY - FIRST ONE HERE WINS
    ticketData.processingCommission = true;

    const buyer = await client.users.fetch(ticketData.buyer);
    const seller = await client.users.fetch(ticketData.seller);

    // Check if they agree
    if (
      ticketData.commissionVotes.buyer === ticketData.commissionVotes.seller
    ) {
      // AGREEMENT REACHED!
      const agreedOption = ticketData.commissionVotes.buyer;
      ticketData.commissionPayer = agreedOption;

      // Calculate final amounts
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

      const agreementEmbed = new EmbedBuilder()
        .setTitle("✅ Commission Agreement Reached!")
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
        .setColor("#00FF00");

      await interaction.channel.send({
        embeds: [agreementEmbed],
      });

      // Now proceed with crypto conversion and deposit address
      try {
        const conversion = await convertUSDToCrypto(
          ticketData.coin,
          buyerPaysAmount // Buyer pays this amount
        );

        ticketData.cryptoAmount = conversion.cryptoAmount;
        ticketData.pricePerCoin = conversion.price;

        // Calculate seller's crypto amount (for reference)
        const sellerCryptoConversion = await convertUSDToCrypto(
          ticketData.coin,
          sellerReceivesAmount
        );
        ticketData.sellerCryptoAmount = sellerCryptoConversion.cryptoAmount;

        const depositInfo = await generateDepositAddress(ticketData.coin);
        ticketData.depositAddress = depositInfo.address;
        ticketData.depositStartTime = Date.now();
        ticketData.status = "awaiting_deposit";

        const summaryEmbed = new EmbedBuilder()
          .setTitle("📊 Deal Summary")
          .setDescription(
            `**USD Amounts:**\n` +
              `• Deal Amount: $${ticketData.amount.toFixed(2)}\n` +
              `• Service Fee: $${commission.toFixed(2)}\n` +
              `• Buyer Sends: $${buyerPaysAmount.toFixed(2)}\n` +
              `• Seller Receives: $${sellerReceivesAmount.toFixed(2)}\n\n` +
              `**Crypto Conversion:**\n` +
              `• Buyer Sends: **${conversion.cryptoAmount.toFixed(8)} ${
                ticketData.coin
              }**\n` +
              `• Seller Gets: **${sellerCryptoConversion.cryptoAmount.toFixed(
                8
              )} ${ticketData.coin}**\n` +
              `• Current Price: $${conversion.price.toLocaleString()} per ${
                ticketData.coin
              }\n\n` +
              `⚠️ **Exchange Rate Locked:** This rate is fixed for this transaction.`
          )
          .setColor("#00A86B");

        const depositEmbed = new EmbedBuilder()
          .setTitle("📥 BUYER: Send Payment to Escrow")
          .setDescription(
            `${buyer}, send **exactly** \`${conversion.cryptoAmount.toFixed(
              8
            )}\` ${ticketData.coin} to:\n\n` +
              `\`${depositInfo.address}\`\n\n` + // 👈 Tap-to-copy on mobile
              `⚠️ **CRITICAL INSTRUCTIONS:**\n` +
              `• Send ONLY ${ticketData.coin} to this address\n` +
              `• Send the EXACT amount shown above\n` +
              `• Do NOT send from an exchange\n` +
              `• Use a personal wallet you control\n\n` +
              `⏰ **This ticket expires in 30 minutes**\n` +
              `The bot will automatically detect your payment.\n\n` +
              `📍 **Monitor address:** ${getBlockExplorerLink(
                ticketData.coin,
                null,
                depositInfo.address
              )}`
          )
          .setColor("#FFA500")
          .setFooter({
            text: `Requires ${
              MIN_CONFIRMATIONS[ticketData.coin] || 6
            } confirmations`,
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
      // DISAGREEMENT!
      ticketData.processingCommission = false; // ✅ UNLOCK for re-voting

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

      // Reset votes
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

      await interaction.channel.send({
        embeds: [disagreementEmbed],
        components: [commissionRow],
      });
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

  // ✅ ASSIGN ROLE
  if (role === "buyer") {
    ticketData.buyer = userId;
  } else {
    ticketData.seller = userId;
  }

  await interaction.reply({
    content: `✅ You are now the **${role.toUpperCase()}**!`,
    ephemeral: true,
  });

  // ✅ CHECK IF BOTH ROLES ARE FILLED *AND* NOT ALREADY PROCESSING
  if (
    ticketData.buyer &&
    ticketData.seller &&
    !ticketData.processingRoleSelection
  ) {
    // ✅ SET LOCK IMMEDIATELY - FIRST ONE HERE WINS
    ticketData.processingRoleSelection = true;

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

    await interaction.channel.permissionOverwrites.edit(ticketData.seller, {
      SendMessages: false,
      ViewChannel: true,
      ReadMessageHistory: true,
    });

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
    // Amount approved - now ask about commission
    ticketData.status = "awaiting_commission_agreement";

    // Calculate base commission
    let commissionAmount = 0;
    const amount = ticketData.amount;

    if (amount < 10) {
      commissionAmount = 0; // No commission for deals under $10
    } else if (amount < 50) {
      commissionAmount = 1.0; // $1 for deals $10-$49.99
    } else if (amount < 300) {
      commissionAmount = 2.0; // $2 for deals $50-$299.99
    } else {
      commissionAmount = amount * 0.01; // 1% for deals $300+
    }

    // Add $1 extra for USDT/USDC (unless it's a no-commission deal)
    if (ticketData.coin === "USDT" || ticketData.coin === "USDC") {
      commissionAmount += 1.0;
    }
    ticketData.commissionAmount = commissionAmount;

    const commissionEmbed = new EmbedBuilder()
      .setTitle("💵 Commission Payment")
      .setDescription(
        `**Deal Amount:** $${ticketData.amount.toFixed(2)}\n` +
          `**Service Fee:** $${commissionAmount.toFixed(2)}\n\n` +
          `Who will pay the $${commissionAmount.toFixed(
            2
          )} escrow service fee?\n\n` +
          `**Option 1: Buyer Pays All** 💰\n` +
          `• ${buyer} sends **$${(ticketData.amount + commissionAmount).toFixed(
            2
          )}**\n` +
          `• ${seller} receives **$${ticketData.amount.toFixed(2)}**\n\n` +
          `**Option 2: Seller Pays All** 📦\n` +
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
      .setColor("#FFA500");

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

    // ✅ Remove buttons from old message
    await interaction.update({
      embeds: [interaction.message.embeds[0]],
      components: [],
    });

    // ✅ Send fresh message with 3 buttons
    await interaction.channel.send({
      embeds: [commissionEmbed],
      components: [commissionRow],
    });

    // Initialize commission votes
    ticketData.commissionVotes = {
      buyer: null,
      seller: null,
    };
  } else if (customId.startsWith("reject_")) {
    const rejectEmbed = new EmbedBuilder()
      .setTitle("❌ Amount Rejected")
      .setDescription(
        `${seller} rejected $${ticketData.amount.toFixed(2)} USD.\n\n` +
          `${buyer}, please enter a new amount.`
      )
      .setColor("#FF0000");

    //

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

    // ✅ FIXED: Use correct variables
    await interaction.update({
      embeds: [rejectEmbed],
      components: [],
    });

    ticketData.amount = null;

    await interaction.channel.permissionOverwrites.edit(ticketData.buyer, {
      SendMessages: true,
    });

    await interaction.channel.permissionOverwrites.edit(ticketData.seller, {
      SendMessages: false,
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

  const deliveryConfirmedEmbed = new EmbedBuilder()
    .setTitle("📦 Seller Confirmed Delivery")
    .setDescription(
      `${seller} has confirmed they will deliver the goods/service.\n\n` +
        `${buyer}, once you receive everything, please confirm below.`
    )
    .setColor("#00FF00");

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

  // ✅ FIX: Try both methods
  try {
    await interaction.update({
      embeds: [deliveryConfirmedEmbed],
      components: [confirmRow],
    });
  } catch (error) {
    // ✅ Fallback: If update fails, reply with new message
    console.log("Update failed, sending new message:", error.message);
    await interaction.reply({
      embeds: [deliveryConfirmedEmbed],
      components: [confirmRow],
    });
  }
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
    // Buyer confirms receipt - proceed to get seller address
    ticketData.status = "awaiting_seller_address";

    const proceedEmbed = new EmbedBuilder()
      .setTitle("✅ Buyer Confirmed Receipt!")
      .setDescription(
        `${buyer} confirmed they received the goods/service!\n\n` +
          `${seller}, please provide your **${ticketData.coin} wallet address** to receive payment.`
      )
      .setColor("#00FF00");

    await interaction.update({
      embeds: [proceedEmbed],
      components: [],
    });

    const addressCollector = interaction.channel.createMessageCollector({
      filter: (m) => m.author.id === ticketData.seller,
      max: 1,
      time: 600000,
    });

    addressCollector.on("collect", async (message) => {
      const sellerAddress = message.content.trim();

      const validation = validateCryptoAddress(sellerAddress, ticketData.coin);

      if (!validation.valid) {
        await interaction.channel.send({
          content: `❌ ${validation.error}\n${getAddressWarnings(
            ticketData.coin
          )}\n\nPlease provide a valid ${ticketData.coin} address.`,
        });
        addressCollector.resetTimer();
        return;
      }

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
        .setColor("#FF0000");

      const confirmButton = new ButtonBuilder()
        .setCustomId(`confirm_address_${channelId}`)
        .setLabel("✅ YES - Send My Payment")
        .setStyle(ButtonStyle.Success);

      const cancelButton = new ButtonBuilder()
        .setCustomId(`cancel_address_${channelId}`)
        .setLabel("❌ NO - Let Me Re-enter")
        .setStyle(ButtonStyle.Danger);

      const confirmRow = new ActionRowBuilder().addComponents(
        confirmButton,
        cancelButton
      );

      await interaction.channel.send({
        content: `${seller}`,
        embeds: [confirmationEmbed],
        components: [confirmRow],
      });
    });
  } else if (customId.startsWith("goods_not_received_")) {
    // Buyer says they didn't receive - open dispute
    ticketData.status = "disputed";

    const disputeEmbed = new EmbedBuilder()
      .setTitle("⚠️ Dispute Opened")
      .setDescription(
        `${buyer} reported they did NOT receive the goods/service.\n\n` +
          `**Both parties should discuss this issue.**\n` +
          `If no resolution is reached, the funds will be refunded to ${buyer} when the ticket times out.`
      )
      .setColor("#FFA500");

    await interaction.update({
      embeds: [disputeEmbed],
      components: [],
    });
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
    // Final confirmation - send crypto to seller
    try {
      await interaction.update({
        content:
          "⏳ Processing payment to seller... Please wait (this may take 1-2 minutes).",
        embeds: [],
        components: [],
      });

      // Clear timeout since we're completing the deal
      if (ticketData.timeoutTimer) {
        clearTimeout(ticketData.timeoutTimer);
      }

      const withdrawal = await sendCryptoToSeller(
        ticketData.coin,
        ticketData.sellerCryptoAmount,
        ticketData.sellerAddress,
        getNetworkForCoin(ticketData.coin) // ✅ ADDED THIS LINE
      );

      ticketData.status = "completed";

      const buyer = await client.users.fetch(ticketData.buyer);
      const seller = await client.users.fetch(ticketData.seller);

      // Calculate commission for display
      const commissionCrypto =
        ticketData.cryptoAmount - ticketData.sellerCryptoAmount;

      const completedEmbed = new EmbedBuilder()
        .setTitle("🎉 Escrow Deal Completed!")
        .setDescription(
          `**Payment successfully sent to seller!**\n\n` +
            `💰 Buyer Paid: **${ticketData.cryptoAmount.toFixed(8)} ${
              ticketData.coin
            }** (${ticketData.buyerPaysAmount.toFixed(2)})\n` +
            `📦 Seller Received: **${ticketData.sellerCryptoAmount.toFixed(
              8
            )} ${ticketData.coin}** ($${ticketData.sellerReceivesAmount.toFixed(
              2
            )})\n` +
            `💼 Service Fee: **${commissionCrypto.toFixed(8)} ${
              ticketData.coin
            }** ($${ticketData.commissionAmount.toFixed(2)})\n\n` +
            `📍 Seller Address: \`${ticketData.sellerAddress}\`\n` +
            `🔗 Withdrawal ID: \`${withdrawal.withdrawId}\`\n` +
            `${
              withdrawal.txId
                ? `📝 Transaction Hash: \`${withdrawal.txId}\`\n`
                : ""
            }\n` +
            `👤 Buyer: ${buyer}\n` +
            `👤 Seller: ${seller}\n\n` +
            `✅ Seller will receive payment within 10-60 minutes depending on network congestion.\n\n` +
            `Thank you for using our escrow service! 🤝`
        )
        .setColor("#00FF00")
        .setFooter({
          text: "This ticket will remain open for your records. You can save transaction details.",
        })
        .setTimestamp();

      await interaction.channel.send({
        content: `${buyer} ${seller}`,
        embeds: [completedEmbed],
      });

      // Log commission earned
      console.log("💼 COMMISSION EARNED:");
      console.log(
        `   Amount: ${commissionCrypto.toFixed(8)} ${ticketData.coin}`
      );
      console.log(`   USD Value: ${ticketData.commissionAmount.toFixed(2)}`);
      console.log(`   Deal Amount: ${ticketData.amount.toFixed(2)}`);
      console.log(`   Ticket ID: ${channelId}`);
      console.log(`   Buyer: ${ticketData.buyer}`);
      console.log(`   Seller: ${ticketData.seller}`);

      // Optional: Archive or close the ticket after some time
      setTimeout(async () => {
        const archiveEmbed = new EmbedBuilder()
          .setTitle("📁 Ticket Archived")
          .setDescription(
            "This ticket has been automatically archived. All transaction details are shown above.\n\n" +
              "If you need support, please create a new ticket."
          )
          .setColor("#808080");

        await interaction.channel.send({ embeds: [archiveEmbed] });

        // Optionally delete the channel after 24 hours
        // await interaction.channel.delete();
      }, 3600000); // 1 hour
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

      // Log to your monitoring system
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
    // Seller wants to re-enter address
    await interaction.update({
      content: `Please send your **${ticketData.coin} wallet address** again:`,
      embeds: [],
      components: [],
    });

    ticketData.sellerAddress = null;

    const addressCollector = interaction.channel.createMessageCollector({
      filter: (m) => m.author.id === ticketData.seller,
      max: 1,
      time: 600000,
    });

    const seller = await client.users.fetch(ticketData.seller);

    addressCollector.on("collect", async (message) => {
      const sellerAddress = message.content.trim();

      const validation = validateCryptoAddress(sellerAddress, ticketData.coin);

      if (!validation.valid) {
        await interaction.channel.send({
          content: `❌ ${validation.error}\n${getAddressWarnings(
            ticketData.coin
          )}\n\nPlease provide a valid ${ticketData.coin} address.`,
        });
        addressCollector.resetTimer();
        return;
      }

      ticketData.sellerAddress = sellerAddress;

      const confirmationEmbed = new EmbedBuilder()
        .setTitle("⚠️ CONFIRM YOUR WALLET ADDRESS")
        .setDescription(
          `${seller}, is this your CORRECT ${ticketData.coin} address?\n\n` +
            `\`\`\`${sellerAddress}\`\`\`\n\n` +
            `🚨 **WARNING:**\n` +
            `• Cryptocurrency transactions are IRREVERSIBLE\n` +
            `• If this address is wrong, YOUR MONEY IS GONE FOREVER\n` +
            `• Double-check EVERY character\n\n` +
            `${getAddressWarnings(ticketData.coin)}`
        )
        .setColor("#FF0000");

      const confirmButton = new ButtonBuilder()
        .setCustomId(`confirm_address_${interaction.channel.id}`)
        .setLabel("✅ YES - Send My Payment")
        .setStyle(ButtonStyle.Success);

      const cancelButton = new ButtonBuilder()
        .setCustomId(`cancel_address_${interaction.channel.id}`)
        .setLabel("❌ NO - Let Me Re-enter")
        .setStyle(ButtonStyle.Danger);

      const confirmRow = new ActionRowBuilder().addComponents(
        confirmButton,
        cancelButton
      );

      await interaction.channel.send({
        content: `${seller}`,
        embeds: [confirmationEmbed],
        components: [confirmRow],
      });
    });
  }
}

// ========================================
// MAIN EXECUTE FUNCTION
// ========================================

export async function execute(interaction, client) {
  // Handle slash commands
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

    // Commission selection buttons
    if (customId.startsWith("commission_")) {
      await handleCommissionSelection(interaction, client);
    }

    // Delivery confirmation
    if (customId.startsWith("confirm_delivery_")) {
      await handleDeliveryConfirmation(interaction, client);
    }

    // Buyer confirmation (goods received)
    if (
      customId.startsWith("goods_received_") ||
      customId.startsWith("goods_not_received_")
    ) {
      await handleBuyerConfirmation(interaction, client);
    }

    // Address confirmation
    if (
      customId.startsWith("confirm_address_") ||
      customId.startsWith("cancel_address_")
    ) {
      await handleAddressConfirmation(interaction, client);
    }
  }

  // Handle dropdown (select menu)
  if (interaction.isStringSelectMenu()) {
    if (interaction.customId === "coinSelect") {
      const coin = interaction.values[0];
      const user = interaction.user;
      const guild = interaction.guild;

      await interaction.reply({
        content: `💰 You selected **${coin}**! Creating your private ticket...`,
        ephemeral: true,
      });

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
            `Welcome ${user}!\n\n**Selected Cryptocurrency:** ${coin}\n\nPlease provide the **User ID** of the person you want to add to this escrow deal.\n\n**How to get User ID:**\n1. Enable Developer Mode in Discord Settings\n2. Right-click on their profile\n3. Click "Copy User ID"\n\n⏰ **This ticket expires in 30 minutes**`
          )
          .setColor("#00A86B")
          .setFooter({ text: "Reply with the User ID below" });

        await ticketChannel.send({
          content: `${user}`,
          embeds: [welcomeEmbed],
        });

        await interaction.editReply({
          content: `✅ Ticket created! Check ${ticketChannel}`,
        });

        const filter = (m) => m.author.id === user.id;
        const collector = ticketChannel.createMessageCollector({
          filter,
          max: 1,
          time: 300000,
        });

        collector.on("collect", async (message) => {
          const secondUserId = message.content.trim();

          if (!/^\d{17,19}$/.test(secondUserId)) {
            await ticketChannel.send({
              content:
                "❌ Invalid User ID format. Please provide a valid Discord User ID.",
            });
            return;
          }

          try {
            const secondUser = await client.users.fetch(secondUserId);

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
              .setColor("#00FF00");

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

            // Initialize ticket data
            if (!client.ticketData) {
              client.ticketData = new Map();
            }

            const ticketData = {
              user1: user.id,
              user2: secondUser.id,
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
              // Commission fields
              commissionAmount: null,
              commissionPayer: null, // 'buyer_pays', 'seller_pays', or 'split'
              commissionVotes: null,
              buyerPaysAmount: null, // Final amount buyer sends (including commission)
              sellerReceivesAmount: null, // Final amount seller gets (after commission)
              sellerCryptoAmount: null, // Crypto amount seller receives
              processingCommission: false, // Race condition lock
              processingRoleSelection: false, // ✅ ADD THIS
            };

            client.ticketData.set(ticketChannel.id, ticketData);

            // Start 30-minute timeout
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
