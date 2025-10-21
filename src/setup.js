// Create: setup.js
import Binance from "binance-api-node";
import { BINANCE_API_KEY, BINANCE_API_SECRET } from "./config.js";

const client = Binance({
  apiKey: BINANCE_API_KEY,
  apiSecret: BINANCE_API_SECRET,
});

async function setupDepositAddresses() {
  const coins = ["BTC", "ETH", "LTC", "SOL", "USDT", "USDC"];

  console.log("═══════════════════════════════════════════════");
  console.log("🔍 Fetching Your Binance Deposit Addresses");
  console.log("═══════════════════════════════════════════════\n");

  for (const coin of coins) {
    try {
      const address = await client.depositAddress({ coin });
      console.log(`${coin}:`);
      console.log(`  Address: ${address.address}`);
      if (address.tag) {
        console.log(`  Tag/Memo: ${address.tag}`);
      }
      console.log(`  Network: ${address.network || "default"}`);
      console.log("");
    } catch (error) {
      console.error(`❌ Failed to get ${coin} address:`, error.message);
    }
  }

  console.log("═══════════════════════════════════════════════");
  console.log("💾 SAVE THESE ADDRESSES!");
  console.log("⚠️  All buyers will send crypto to these addresses.");
  console.log("⚠️  Binance automatically tracks deposits.");
  console.log("═══════════════════════════════════════════════");
}

setupDepositAddresses().catch(console.error);
