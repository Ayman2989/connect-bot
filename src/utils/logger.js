// Create new file: utils/logger.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function logTransaction(type, data) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    type: type, // 'deposit', 'withdrawal', 'refund', 'error', 'timeout'
    ...data,
  };

  const logFile = path.join(__dirname, "..", "transactions.log");
  const logLine = JSON.stringify(logEntry) + "\n";

  fs.appendFileSync(logFile, logLine);
  console.log("📝 Transaction logged:", type);
}

export default { logTransaction };
