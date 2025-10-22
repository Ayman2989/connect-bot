// setup.js
import Binance from "binance-api-node";
import {
  BINANCE_API_KEY,
  BINANCE_API_SECRET,
  BINANCE_USE_TESTNET,
} from "./config.js";

console.log("═══════════════════════════════════════════════");
console.log("🔍 Binance Configuration Check");
console.log("═══════════════════════════════════════════════");
console.log(
  `API Key: ${
    BINANCE_API_KEY ? BINANCE_API_KEY.substring(0, 10) + "..." : "❌ MISSING"
  }`
);
console.log(`API Secret: ${BINANCE_API_SECRET ? "✅ Set" : "❌ MISSING"}`);
console.log(
  `Testnet Mode: ${
    BINANCE_USE_TESTNET ? "✅ YES (Testnet)" : "❌ NO (Production)"
  }`
);
console.log("═══════════════════════════════════════════════\n");

if (!BINANCE_API_KEY || !BINANCE_API_SECRET) {
  console.error("❌ ERROR: Binance API credentials are missing!");
  console.error("Please add them to your .env file:");
  console.error("BINANCE_API_KEY=your_key_here");
  console.error("BINANCE_API_SECRET=your_secret_here");
  process.exit(1);
}

if (BINANCE_USE_TESTNET) {
  console.error("⚠️  WARNING: You're using TESTNET mode!");
  console.error("Testnet doesn't support deposit addresses.");
  console.error("Set BINANCE_USE_TESTNET=false in your .env file");
  console.error("to use your REAL Binance account.\n");
}

const client = Binance.default({
  apiKey: BINANCE_API_KEY,
  apiSecret: BINANCE_API_SECRET,
  ...(BINANCE_USE_TESTNET && {
    httpBase: "https://testnet.binance.vision",
    wsBase: "wss://testnet.binance.vision/ws",
  }),
});

async function testConnection() {
  try {
    console.log("Testing API connection...");
    const accountInfo = await client.accountInfo();
    console.log("✅ API Connection successful!");
    console.log(`Account can trade: ${accountInfo.canTrade}`);
    console.log(`Account can withdraw: ${accountInfo.canWithdraw}`);
    console.log(`Account can deposit: ${accountInfo.canDeposit}\n`);
    return true;
  } catch (error) {
    console.error("❌ API Connection failed!");
    console.error(`Error: ${error.message}`);
    console.error("\nPossible issues:");
    console.error("1. API Key/Secret is incorrect");
    console.error("2. API Key doesn't have required permissions");
    console.error("3. IP address not whitelisted on Binance");
    return false;
  }
}

async function setupDepositAddresses() {
  const coins = ["BTC", "ETH", "LTC", "SOL", "USDT", "USDC"];

  console.log("═══════════════════════════════════════════════");
  console.log("🔍 Fetching Your Binance Deposit Addresses");
  console.log("═══════════════════════════════════════════════\n");

  // Test connection first
  const connected = await testConnection();
  if (!connected) {
    console.error(
      "\n❌ Cannot fetch deposit addresses - API connection failed"
    );
    process.exit(1);
  }

  const results = {};

  for (const coin of coins) {
    try {
      console.log(`Fetching ${coin} address...`);
      const address = await client.depositAddress({ coin });

      results[coin] = {
        address: address.address,
        tag: address.tag || null,
        network: address.network || "default",
      };

      console.log(`✅ ${coin}:`);
      console.log(`   Address: ${address.address}`);
      if (address.tag) {
        console.log(`   Tag/Memo: ${address.tag}`);
      }
      console.log(`   Network: ${address.network || "default"}`);
      console.log("");
    } catch (error) {
      console.error(`❌ Failed to get ${coin} address:`);
      console.error(`   Error: ${error.message}`);
      console.error(`   Code: ${error.code}\n`);
    }
  }

  console.log("═══════════════════════════════════════════════");
  console.log("📋 COPY THESE TO YOUR config.js:");
  console.log("═══════════════════════════════════════════════\n");

  console.log("export const DEPOSIT_ADDRESSES = {");
  for (const [coin, data] of Object.entries(results)) {
    console.log(`  ${coin}: "${data.address}",`);
  }
  console.log("};\n");

  console.log("═══════════════════════════════════════════════");
  console.log("⚠️  IMPORTANT NOTES:");
  console.log("═══════════════════════════════════════════════");
  console.log("• All buyers will send crypto to these addresses");
  console.log("• Binance automatically tracks deposits");
  console.log("• Make sure your API key has withdrawal permissions");
  console.log("• Consider enabling IP whitelist for security");
  console.log("═══════════════════════════════════════════════");
}

setupDepositAddresses().catch((error) => {
  console.error("\n❌ CRITICAL ERROR:");
  console.error(error);
  process.exit(1);
});
