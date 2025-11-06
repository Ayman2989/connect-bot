import Database from "better-sqlite3";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createTables } from "./schema.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ✅ Initialize database
const db = new Database(join(__dirname, "../../escrow.db"));

// Enable WAL mode for better concurrent performance
db.pragma("journal_mode = WAL");

// Create tables and indexes
createTables(db);

// ✅ Optimize database
db.pragma("synchronous = NORMAL");
db.pragma("cache_size = -64000"); // 64MB cache

console.log("✅ Database initialized and optimized");

export default db;
