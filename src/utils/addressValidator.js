import WAValidator from "multicoin-address-validator";

/**
 * Validate cryptocurrency wallet address
 * @param {string} address - The wallet address to validate
 * @param {string} coinSymbol - The coin symbol (BTC, ETH, etc.)
 * @returns {{valid: boolean, error?: string}}
 */
export function validateCryptoAddress(address, coinSymbol) {
  // Map coin symbols to validator names
  const coinMap = {
    BTC: "bitcoin",
    ETH: "ethereum",
    LTC: "litecoin",
    SOL: "solana",
    USDT: "ethereum", // USDT (ERC-20) uses Ethereum addresses
    USDC: "ethereum", // USDC (ERC-20) uses Ethereum addresses
  };

  const coin = coinMap[coinSymbol];

  if (!coin) {
    return {
      valid: false,
      error: `Unsupported coin: ${coinSymbol}`,
    };
  }

  // Basic checks first
  if (!address || typeof address !== "string") {
    return {
      valid: false,
      error: "Address is required and must be a string",
    };
  }

  if (address.length < 26 || address.length > 90) {
    return {
      valid: false,
      error: "Address length is invalid",
    };
  }

  // Check for spaces or invalid characters
  if (address.includes(" ")) {
    return {
      valid: false,
      error: "Address contains spaces",
    };
  }

  // Validate using multicoin-address-validator
  try {
    const isValid = WAValidator.validate(address, coin);

    if (!isValid) {
      return {
        valid: false,
        error: `Invalid ${coinSymbol} address format`,
      };
    }

    // Additional coin-specific checks
    switch (coinSymbol) {
      case "BTC":
        // Bitcoin addresses start with 1, 3, or bc1
        if (!address.match(/^(1|3|bc1)/)) {
          return {
            valid: false,
            error: "Bitcoin addresses must start with 1, 3, or bc1",
          };
        }
        break;

      case "ETH":
      case "USDT":
      case "USDC":
        // Ethereum addresses start with 0x and are 42 characters
        if (!address.match(/^0x[a-fA-F0-9]{40}$/)) {
          return {
            valid: false,
            error: "Ethereum addresses must start with 0x and be 42 characters",
          };
        }
        break;

      case "LTC":
        // Litecoin addresses start with L or M
        if (!address.match(/^(L|M)/)) {
          return {
            valid: false,
            error: "Litecoin addresses must start with L or M",
          };
        }
        break;

      case "SOL":
        // Solana addresses are 32-44 characters base58
        if (address.length < 32 || address.length > 44) {
          return {
            valid: false,
            error: "Solana addresses must be 32-44 characters",
          };
        }
        break;
    }

    return { valid: true };
  } catch (error) {
    console.error("Address validation error:", error);
    return {
      valid: false,
      error: "Address validation failed. Please check the format.",
    };
  }
}

/**
 * Get helpful warnings for each coin type
 * @param {string} coinSymbol - The coin symbol
 * @returns {string} - Warning message
 */
export function getAddressWarnings(coinSymbol) {
  const warnings = {
    BTC: "⚠️ **Bitcoin addresses** start with:\n• `1` (Legacy)\n• `3` (SegWit)\n• `bc1` (Native SegWit)\n\nExample: `bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh`",

    ETH: "⚠️ **Ethereum addresses:**\n• Start with `0x`\n• Are exactly 42 characters\n• Are case-sensitive\n\nExample: `0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb`",

    LTC: "⚠️ **Litecoin addresses** start with:\n• `L` (Legacy)\n• `M` (P2SH)\n\nExample: `LhK2kQwiaAvhjWY799cZvMyYwnQAcxkarr`",

    SOL: "⚠️ **Solana addresses:**\n• Are 32-44 characters\n• Use base58 encoding\n\nExample: `7EqQdEUwY3dZVNsVLqRz4CkVDFGmxb1CLRkTqxrmgzLC`",

    USDT: "⚠️ **USDT (ERC-20)** uses Ethereum addresses:\n• Start with `0x`\n• Are exactly 42 characters\n• Must be an Ethereum wallet\n\nExample: `0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb`",

    USDC: "⚠️ **USDC (ERC-20)** uses Ethereum addresses:\n• Start with `0x`\n• Are exactly 42 characters\n• Must be an Ethereum wallet\n\nExample: `0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb`",
  };

  return (
    warnings[coinSymbol] ||
    "⚠️ Please ensure the address format is correct for your coin."
  );
}

/**
 * Get example address for testing (DO NOT USE IN PRODUCTION)
 * @param {string} coinSymbol - The coin symbol
 * @returns {string} - Example address
 */
export function getExampleAddress(coinSymbol) {
  const examples = {
    BTC: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
    ETH: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1",
    LTC: "LhK2kQwiaAvhjWY799cZvMyYwnQAcxkarr",
    SOL: "7EqQdEUwY3dZVNsVLqRz4CkVDFGmxb1CLRkTqxrmgzLC",
    USDT: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1",
    USDC: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1",
  };

  return examples[coinSymbol] || "N/A";
}

export default {
  validateCryptoAddress,
  getAddressWarnings,
  getExampleAddress,
};
