import dotenv from "dotenv";
dotenv.config();

export const TOKEN = process.env.DISCORD_TOKEN;
export const CLIENT_ID = process.env.CLIENT_ID;
export const GUILD_ID = process.env.GUILD_ID;
export const BINANCE_API_KEY = process.env.BINANCE_API_KEY;
export const BINANCE_API_SECRET = process.env.BINANCE_API_SECRET;
export const BINANCE_USE_TESTNET = process.env.BINANCE_USE_TESTNET === "true";

// TESTNET ADDRESSES - GET FROM BINANCE TESTNET
export const DEPOSIT_ADDRESSES = {
  BTC: "15NQQioz7K9qXkFviMCEkAnucPHvfp87XD",
  ETH: "0xc72b9146b15b2b56e28042dd42707ecdbb317550",
  LTC: "LhuT4yi9LnRfdQS4Lj6gRK4xLLaYQDwE11",
  SOL: "BzwshJH9iwV9K2Zsq9RiiLvdK9E6kyznLbF9KfWHM3kF",
  USDT: "0xc72b9146b15b2b56e28042dd42707ecdbb317550", // Same as ETH
  USDC: "0xc72b9146b15b2b56e28042dd42707ecdbb317550", // Same as ETH
};
// Add this function to get real testnet addresses
// export async function getTestnetAddresses() {
//   console.log("⚠️ UPDATE: Replace with real Binance testnet deposit addresses");
//   console.log(
//     "Go to Binance testnet -> Wallet -> Deposit to get real addresses"
//   );
// }
