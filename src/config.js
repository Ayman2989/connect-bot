import dotenv from "dotenv";
dotenv.config();

export const TOKEN = process.env.DISCORD_TOKEN;
export const CLIENT_ID = process.env.CLIENT_ID;
export const GUILD_ID = process.env.GUILD_ID;
export const BINANCE_API_KEY = process.env.BINANCE_API_KEY;
export const BINANCE_API_SECRET = process.env.BINANCE_API_SECRET;
export const BINANCE_USE_TESTNET = process.env.BINANCE_USE_TESTNET === "true";

// config.js
export const DEPOSIT_ADDRESSES = {
  BTC: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
  ETH: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1",
  LTC: "LhK2kQwiaAvhjWY799cZvMyYwnQAcxkarr",
  SOL: "7EqQdEUwY3dZVNsVLqRz4CkVDFGmxb1CLRkTqxrmgzLC",
  USDT: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1", // Same as ETH
  USDC: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1", // Same as ETH
};
