import axios from "axios";
import CoinGecko from "coingecko-api";
import Binance from "binance-api-node";
import {
  BINANCE_API_KEY,
  BINANCE_API_SECRET,
  BINANCE_USE_TESTNET,
  DEPOSIT_ADDRESSES as CONFIG_DEPOSIT_ADDRESSES,
} from "../config.js";
import { logTransaction } from "./logger.js";

const CoinGeckoClient = new CoinGecko();

const binanceClient = Binance.default({
  apiKey: BINANCE_API_KEY,
  apiSecret: BINANCE_API_SECRET,
  ...(BINANCE_USE_TESTNET && {
    httpBase: "https://testnet.binance.vision",
    wsBase: "wss://testnet.binance.vision/ws",
  }),
});

// ✅ ADD YOUR API KEYS HERE
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY;
const BLOCKCYPHER_TOKEN = process.env.BLOCKCYPHER_TOKEN;

const COIN_IDS = {
  BTC: "bitcoin",
  ETH: "ethereum",
  LTC: "litecoin",
  SOL: "solana",
  USDT: "tether",
  USDC: "usd-coin",
};

const BINANCE_SYMBOLS = {
  BTC: "BTC",
  ETH: "ETH",
  LTC: "LTC",
  SOL: "SOL",
  USDT: "USDT",
  USDC: "USDC",
};

const DEPOSIT_ADDRESSES = CONFIG_DEPOSIT_ADDRESSES;

// ERC-20 token contract addresses
const TOKEN_CONTRACTS = {
  USDT: "0xdac17f958d2ee523a2206206994597c13d831ec7",
  USDC: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
};

/**
 * Convert USD to Crypto
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

    // Add unique suffix
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
 * Generate deposit address
 */
export async function generateDepositAddress(coinSymbol) {
  try {
    const coin = BINANCE_SYMBOLS[coinSymbol];
    const depositAddress = await binanceClient.depositAddress({ coin });

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
 * ✅ NEW: Check payment using BLOCKCHAIN directly (FAST!)
 */
export async function checkPaymentReceived(coinSymbol, expectedAmount, since) {
  try {
    const address = DEPOSIT_ADDRESSES[coinSymbol];

    // ✅ STEP 1: Check blockchain first (FAST - 10-30 seconds)
    let blockchainResult;

    switch (coinSymbol) {
      case "BTC":
        blockchainResult = await checkBitcoinPayment(
          address,
          expectedAmount,
          since
        );
        break;
      case "ETH":
        blockchainResult = await checkEthereumPayment(
          address,
          expectedAmount,
          since
        );
        break;
      case "USDT":
      case "USDC":
        blockchainResult = await checkERC20Payment(
          coinSymbol,
          address,
          expectedAmount,
          since
        );
        break;
      case "LTC":
        blockchainResult = await checkLitecoinPayment(
          address,
          expectedAmount,
          since
        );
        break;
      case "SOL":
        blockchainResult = await checkSolanaPayment(
          address,
          expectedAmount,
          since
        );
        break;
      default:
        throw new Error(`Unsupported coin: ${coinSymbol}`);
    }

    if (blockchainResult.received) {
      return blockchainResult;
    }

    // ✅ STEP 2: Fallback to Binance if blockchain returns nothing
    return await checkBinanceDeposit(coinSymbol, expectedAmount, since);
  } catch (error) {
    console.error(`Error checking ${coinSymbol} payment:`, error.message);

    // ✅ FALLBACK: Try Binance if blockchain check fails
    try {
      return await checkBinanceDeposit(coinSymbol, expectedAmount, since);
    } catch (binanceError) {
      console.error("Binance fallback also failed:", binanceError.message);
      throw new Error("Failed to check payment status.");
    }
  }
}

/**
 * ✅ Check Bitcoin using BlockCypher
 */
async function checkBitcoinPayment(address, expectedAmount, since) {
  try {
    const response = await axios.get(
      `https://api.blockcypher.com/v1/btc/main/addrs/${address}/full?token=${BLOCKCYPHER_TOKEN}`,
      { timeout: 10000 }
    );

    if (!response.data.txs || response.data.txs.length === 0) {
      return { received: false };
    }

    const recentTxs = response.data.txs.filter((tx) => {
      const txTime = new Date(tx.received).getTime();
      return txTime >= since;
    });

    for (const tx of recentTxs) {
      const output = tx.outputs.find(
        (out) => out.addresses && out.addresses.includes(address)
      );

      if (output) {
        const amountBTC = output.value / 100000000;
        const tolerance = 0.001;

        if (amountBTC >= expectedAmount * (1 - tolerance)) {
          return {
            received: true,
            amount: amountBTC,
            txId: tx.hash,
            confirmations: tx.confirmations || 0,
          };
        }
      }
    }

    return { received: false };
  } catch (error) {
    console.error("BlockCypher BTC error:", error.message);
    throw error;
  }
}

/**
 * ✅ Check Ethereum using Etherscan
 */
async function checkEthereumPayment(address, expectedAmount, since) {
  try {
    const response = await axios.get(
      `https://api.etherscan.io/api?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&sort=desc&apikey=${ETHERSCAN_API_KEY}`,
      { timeout: 10000 }
    );

    if (response.data.status !== "1" || !response.data.result) {
      return { received: false };
    }

    const recentTxs = response.data.result.filter((tx) => {
      const txTime = parseInt(tx.timeStamp) * 1000;
      return txTime >= since && tx.to.toLowerCase() === address.toLowerCase();
    });

    for (const tx of recentTxs) {
      const amountETH = parseFloat(tx.value) / 1e18;
      const tolerance = 0.001;

      if (amountETH >= expectedAmount * (1 - tolerance)) {
        // Get current block for confirmations
        const blockResponse = await axios.get(
          `https://api.etherscan.io/api?module=proxy&action=eth_blockNumber&apikey=${ETHERSCAN_API_KEY}`
        );
        const currentBlock = parseInt(blockResponse.data.result, 16);
        const confirmations = currentBlock - parseInt(tx.blockNumber);

        return {
          received: true,
          amount: amountETH,
          txId: tx.hash,
          confirmations: confirmations,
        };
      }
    }

    return { received: false };
  } catch (error) {
    console.error("Etherscan ETH error:", error.message);
    throw error;
  }
}

/**
 * ✅ Check USDT/USDC using Etherscan
 */
async function checkERC20Payment(coinSymbol, address, expectedAmount, since) {
  try {
    const contractAddress = TOKEN_CONTRACTS[coinSymbol];

    const response = await axios.get(
      `https://api.etherscan.io/api?module=account&action=tokentx&contractaddress=${contractAddress}&address=${address}&startblock=0&endblock=99999999&sort=desc&apikey=${ETHERSCAN_API_KEY}`,
      { timeout: 10000 }
    );

    if (response.data.status !== "1" || !response.data.result) {
      return { received: false };
    }

    const recentTxs = response.data.result.filter((tx) => {
      const txTime = parseInt(tx.timeStamp) * 1000;
      return txTime >= since && tx.to.toLowerCase() === address.toLowerCase();
    });

    for (const tx of recentTxs) {
      const decimals = 6; // USDT/USDC have 6 decimals
      const amount = parseFloat(tx.value) / Math.pow(10, decimals);
      const tolerance = 0.001;

      if (amount >= expectedAmount * (1 - tolerance)) {
        const blockResponse = await axios.get(
          `https://api.etherscan.io/api?module=proxy&action=eth_blockNumber&apikey=${ETHERSCAN_API_KEY}`
        );
        const currentBlock = parseInt(blockResponse.data.result, 16);
        const confirmations = currentBlock - parseInt(tx.blockNumber);

        return {
          received: true,
          amount: amount,
          txId: tx.hash,
          confirmations: confirmations,
        };
      }
    }

    return { received: false };
  } catch (error) {
    console.error(`Etherscan ${coinSymbol} error:`, error.message);
    throw error;
  }
}

/**
 * ✅ Check Litecoin using BlockCypher
 */
async function checkLitecoinPayment(address, expectedAmount, since) {
  try {
    const response = await axios.get(
      `https://api.blockcypher.com/v1/ltc/main/addrs/${address}/full?token=${BLOCKCYPHER_TOKEN}`,
      { timeout: 10000 }
    );

    if (!response.data.txs || response.data.txs.length === 0) {
      return { received: false };
    }

    const recentTxs = response.data.txs.filter((tx) => {
      const txTime = new Date(tx.received).getTime();
      return txTime >= since;
    });

    for (const tx of recentTxs) {
      const output = tx.outputs.find(
        (out) => out.addresses && out.addresses.includes(address)
      );

      if (output) {
        const amountLTC = output.value / 100000000;
        const tolerance = 0.001;

        if (amountLTC >= expectedAmount * (1 - tolerance)) {
          return {
            received: true,
            amount: amountLTC,
            txId: tx.hash,
            confirmations: tx.confirmations || 0,
          };
        }
      }
    }

    return { received: false };
  } catch (error) {
    console.error("BlockCypher LTC error:", error.message);
    throw error;
  }
}

/**
 * ✅ Check Solana (using public RPC - free but limited)
 */
async function checkSolanaPayment(address, expectedAmount, since) {
  try {
    // Use public Solana RPC (you can use Helius/QuickNode for better reliability)
    const response = await axios.post(
      "https://api.mainnet-beta.solana.com",
      {
        jsonrpc: "2.0",
        id: 1,
        method: "getSignaturesForAddress",
        params: [address, { limit: 10 }],
      },
      { timeout: 10000 }
    );

    if (!response.data.result || response.data.result.length === 0) {
      return { received: false };
    }

    for (const sig of response.data.result) {
      const txTime = sig.blockTime * 1000;
      if (txTime < since) continue;

      // Get transaction details
      const txResponse = await axios.post(
        "https://api.mainnet-beta.solana.com",
        {
          jsonrpc: "2.0",
          id: 1,
          method: "getTransaction",
          params: [sig.signature, { encoding: "jsonParsed" }],
        }
      );

      const tx = txResponse.data.result;
      if (!tx) continue;

      // Check if incoming transfer
      const postBalance = tx.meta.postBalances[1] / 1e9; // Convert lamports to SOL
      const preBalance = tx.meta.preBalances[1] / 1e9;
      const amountSOL = postBalance - preBalance;

      const tolerance = 0.001;
      if (amountSOL >= expectedAmount * (1 - tolerance)) {
        return {
          received: true,
          amount: amountSOL,
          txId: sig.signature,
          confirmations: tx.slot ? 1 : 0, // Simplified
        };
      }
    }

    return { received: false };
  } catch (error) {
    console.error("Solana RPC error:", error.message);
    throw error;
  }
}

/**
 * ✅ Fallback: Check Binance deposit history (SLOW but reliable)
 */
async function checkBinanceDeposit(coinSymbol, expectedAmount, since) {
  try {
    const coin = BINANCE_SYMBOLS[coinSymbol];

    const deposits = await binanceClient.depositHistory({
      coin: coin,
      startTime: since,
    });

    const tolerance = 0.001;
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

    return { received: false };
  } catch (error) {
    console.error("Binance deposit check error:", error);
    throw error;
  }
}

/**
 * Send crypto to seller
 */
export async function sendCryptoToSeller(
  coinSymbol,
  amount,
  sellerAddress,
  network
) {
  try {
    const coin = BINANCE_SYMBOLS[coinSymbol];

    if (!network) {
      throw new Error(`Network parameter is required for ${coinSymbol}`);
    }

    // ✅ FIX: Round to 8 decimal places (satoshi precision)
    const roundedAmount = Math.floor(amount * 100000000) / 100000000;

    const withdrawal = await binanceClient.withdraw({
      coin: coin,
      address: sellerAddress,
      amount: amount,
      network: network,
    });

    logTransaction("withdrawal", {
      coin: coinSymbol,
      amount: roundedAmount,
      address: sellerAddress,
      network: network,
      withdrawId: withdrawal.id,
      txId: withdrawal.txId,
    });

    return {
      success: true,
      withdrawId: withdrawal.id,
      txId: withdrawal.txId,
    };
  } catch (error) {
    logTransaction("withdrawal_error", {
      coin: coinSymbol,
      amount: amount,
      address: sellerAddress,
      error: error.message,
    });
    console.error("Error sending crypto to seller:", error);
    throw new Error("Failed to send crypto. Please contact support.");
  }
}

/**
 * Get balance
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
 * Refund buyer
 */
export async function refundBuyer(coinSymbol, amount, buyerAddress, network) {
  try {
    const coin = BINANCE_SYMBOLS[coinSymbol];

    if (!network) {
      throw new Error(`Network parameter is required for ${coinSymbol}`);
    }

    // ✅ FIX: Round to 8 decimal places
    const roundedAmount = Math.floor(amount * 100000000) / 100000000;

    const withdrawal = await binanceClient.withdraw({
      coin: coin,
      address: buyerAddress,
      amount: roundedAmount, // ✅ Use rounded amount
      network: network,
    });

    logTransaction("refund", {
      coin: coinSymbol,
      amount: roundedAmount,
      address: buyerAddress,
      network: network,
      withdrawId: withdrawal.id,
      txId: withdrawal.txId,
    });

    return {
      success: true,
      withdrawId: withdrawal.id,
      txId: withdrawal.txId,
    };
  } catch (error) {
    logTransaction("refund_error", {
      coin: coinSymbol,
      amount: amount,
      address: buyerAddress,
      error: error.message,
    });
    console.error("CRITICAL: Refund failed:", error);
    throw new Error("Failed to refund buyer. CONTACT SUPPORT IMMEDIATELY!");
  }
}

export default {
  convertUSDToCrypto,
  generateDepositAddress,
  checkPaymentReceived,
  sendCryptoToSeller,
  getBalance,
  refundBuyer,
};
