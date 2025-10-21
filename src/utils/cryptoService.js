import CoinGecko from "coingecko-api";
import Binance from "binance-api-node";
import fs from "fs";
import path from "path";
import {
  BINANCE_API_KEY,
  BINANCE_API_SECRET,
  BINANCE_USE_TESTNET,
  DEPOSIT_ADDRESSES as CONFIG_DEPOSIT_ADDRESSES,
} from "../config.js";

const CoinGeckoClient = new CoinGecko();

// Initialize Binance client
const binanceClient = Binance({
  apiKey: BINANCE_API_KEY,
  apiSecret: BINANCE_API_SECRET,
  // Use testnet for development
  ...(BINANCE_USE_TESTNET && {
    httpBase: "https://testnet.binance.vision",
    wsBase: "wss://testnet.binance.vision/ws",
  }),
});

// Map symbols to CoinGecko IDs
const COIN_IDS = {
  BTC: "bitcoin",
  ETH: "ethereum",
  LTC: "litecoin",
  SOL: "solana",
  USDT: "tether",
  USDC: "usd-coin",
};

// Binance uses different symbols for some coins
const BINANCE_SYMBOLS = {
  BTC: "BTC",
  ETH: "ETH",
  LTC: "LTC",
  SOL: "SOL",
  USDT: "USDT",
  USDC: "USDC",
};

// ✅ FIXED: Use addresses from config.js instead of placeholders
const DEPOSIT_ADDRESSES = CONFIG_DEPOSIT_ADDRESSES;

/**
 * Get crypto price and convert USD to crypto amount
 */
export async function convertUSDToCrypto(coinSymbol, usdAmount) {
  try {
    const coinId = COIN_IDS[coinSymbol];
    if (!coinId) {
      throw new Error(`Unsupported coin: ${coinSymbol}`);
    }

    const response = await CoinGeckoClient.simple.price({
      ids: [coinId],
      vs_currencies: ["usd"],
    });

    const priceInUSD = response.data[coinId].usd;
    let cryptoAmount = usdAmount / priceInUSD;

    // Make amount unique to prevent collisions
    const uniqueSuffix = Math.random() * 0.00000099 + 0.00000001;
    cryptoAmount += uniqueSuffix;

    return {
      cryptoAmount: cryptoAmount,
      price: priceInUSD,
      coin: coinSymbol,
      usdAmount: usdAmount,
    };
  } catch (error) {
    console.error("Error fetching crypto price:", error);
    throw new Error("Failed to fetch crypto price. Please try again.");
  }
}

/**
 * Generate deposit address for buyer to send crypto to
 */
export async function generateDepositAddress(coinSymbol) {
  try {
    // Fetch from Binance (always get latest)
    const coin = BINANCE_SYMBOLS[coinSymbol];
    const depositAddress = await binanceClient.depositAddress({ coin });

    // Verify it matches your stored address (safety check)
    if (
      DEPOSIT_ADDRESSES[coinSymbol] &&
      DEPOSIT_ADDRESSES[coinSymbol] !== depositAddress.address
    ) {
      console.warn(`⚠️  WARNING: ${coinSymbol} address changed!`);
      console.warn(`   Expected: ${DEPOSIT_ADDRESSES[coinSymbol]}`);
      console.warn(`   Got: ${depositAddress.address}`);
    }

    return {
      address: depositAddress.address,
      tag: depositAddress.tag,
      coin: coinSymbol,
      network: depositAddress.network || "default",
    };
  } catch (error) {
    console.error("Error generating deposit address:", error);

    // Fallback to stored address if API fails
    if (DEPOSIT_ADDRESSES[coinSymbol]) {
      console.log(`⚠️  Using fallback address for ${coinSymbol}`);
      return {
        address: DEPOSIT_ADDRESSES[coinSymbol],
        coin: coinSymbol,
      };
    }

    throw new Error("Failed to generate deposit address.");
  }
}

/**
 * Check if payment has been received
 */
export async function checkPaymentReceived(coinSymbol, expectedAmount, since) {
  try {
    const coin = BINANCE_SYMBOLS[coinSymbol];

    const deposits = await binanceClient.depositHistory({
      coin: coin,
      startTime: since,
    });

    // ✅ FIXED: Increased tolerance from 0.00001 to 0.0001 (0.01%)
    // This accounts for rounding errors and unique suffix variations
    const tolerance = 0.0001;
    const minAmount = expectedAmount * (1 - tolerance);
    const maxAmount = expectedAmount * (1 + tolerance);

    const matchingDeposit = deposits.find(
      (deposit) =>
        deposit.status === 1 &&
        parseFloat(deposit.amount) >= minAmount &&
        parseFloat(deposit.amount) <= maxAmount &&
        deposit.insertTime >= since
    );

    if (matchingDeposit) {
      return {
        received: true,
        amount: parseFloat(matchingDeposit.amount),
        txId: matchingDeposit.txId,
        confirmations: matchingDeposit.confirmTimes || 0,
      };
    }

    return {
      received: false,
    };
  } catch (error) {
    console.error("Error checking payment:", error);
    throw new Error("Failed to check payment status.");
  }
}

/**
 * Send crypto to seller's wallet
 */
export async function sendCryptoToSeller(
  coinSymbol,
  amount,
  sellerAddress,
  network = "default"
) {
  try {
    const coin = BINANCE_SYMBOLS[coinSymbol];

    // Withdraw to seller's address
    const withdrawal = await binanceClient.withdraw({
      coin: coin,
      address: sellerAddress,
      amount: amount,
      network: network,
    });

    return {
      success: true,
      withdrawId: withdrawal.id,
      txId: withdrawal.txId,
    };
  } catch (error) {
    console.error("Error sending crypto to seller:", error);
    throw new Error("Failed to send crypto. Please contact support.");
  }
}

/**
 * Get account balance for a specific coin
 */
export async function getBalance(coinSymbol) {
  try {
    const accountInfo = await binanceClient.accountInfo();
    const balance = accountInfo.balances.find(
      (b) => b.asset === BINANCE_SYMBOLS[coinSymbol]
    );

    if (!balance) {
      return { free: 0, locked: 0 };
    }

    return {
      free: parseFloat(balance.free),
      locked: parseFloat(balance.locked),
      total: parseFloat(balance.free) + parseFloat(balance.locked),
    };
  } catch (error) {
    console.error("Error getting balance:", error);
    throw new Error("Failed to get balance.");
  }
}

/**
 * Refund crypto to buyer
 * ✅ FIXED: Added network parameter for consistency
 */
export async function refundBuyer(
  coinSymbol,
  amount,
  buyerAddress,
  network = "default"
) {
  try {
    const coin = BINANCE_SYMBOLS[coinSymbol];

    const withdrawal = await binanceClient.withdraw({
      coin: coin,
      address: buyerAddress,
      amount: amount,
      network: network, // ✅ FIXED: Added network parameter
    });

    return {
      success: true,
      withdrawId: withdrawal.id,
      txId: withdrawal.txId,
    };
  } catch (error) {
    console.error("CRITICAL: Refund failed:", error);
    throw new Error("Failed to refund buyer. CONTACT SUPPORT IMMEDIATELY!");
  }
}

/**
 * Log transaction to file for audit trail
 */
export function logTransaction(type, data) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    type: type, // 'deposit', 'withdrawal', 'refund', 'error'
    ...data,
  };

  const logFile = path.join(process.cwd(), "transactions.log");
  fs.appendFileSync(logFile, JSON.stringify(logEntry) + "\n");

  console.log("Transaction logged:", logEntry);
}

export default {
  convertUSDToCrypto,
  generateDepositAddress,
  checkPaymentReceived,
  sendCryptoToSeller,
  getBalance,
  refundBuyer,
  logTransaction,
};
