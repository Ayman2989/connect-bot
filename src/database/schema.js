export const createTables = (db) => {
  // ✅ Deals table - stores all completed escrow transactions
  db.exec(`
    CREATE TABLE IF NOT EXISTS deals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id TEXT NOT NULL UNIQUE,
      buyer_id TEXT NOT NULL,
      seller_id TEXT NOT NULL,
      coin TEXT NOT NULL,
      deal_amount REAL NOT NULL,
      service_fee REAL NOT NULL,
      buyer_paid REAL NOT NULL,
      seller_received REAL NOT NULL,
      crypto_amount REAL NOT NULL,
      seller_crypto_amount REAL NOT NULL,
      tx_hash TEXT NOT NULL,
      buyer_privacy TEXT NOT NULL,
      seller_privacy TEXT NOT NULL,
      completed_at INTEGER NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s', 'now'))
    )
  `);

  // ✅ Create indexes for fast queries
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_buyer_id ON deals(buyer_id);
    CREATE INDEX IF NOT EXISTS idx_seller_id ON deals(seller_id);
    CREATE INDEX IF NOT EXISTS idx_completed_at ON deals(completed_at);
    CREATE INDEX IF NOT EXISTS idx_coin ON deals(coin);
  `);

  // ✅ User stats cache (for ultra-fast stats retrieval)
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_stats (
      user_id TEXT PRIMARY KEY,
      total_deals INTEGER DEFAULT 0,
      deals_as_buyer INTEGER DEFAULT 0,
      deals_as_seller INTEGER DEFAULT 0,
      total_spent REAL DEFAULT 0,
      total_earned REAL DEFAULT 0,
      total_fees_paid REAL DEFAULT 0,
      last_deal_at INTEGER,
      updated_at INTEGER DEFAULT (strftime('%s', 'now'))
    )
  `);

  // ✅ Commission tracking (for owner analytics)
  db.exec(`
    CREATE TABLE IF NOT EXISTS commissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id TEXT NOT NULL,
      coin TEXT NOT NULL,
      amount_crypto REAL NOT NULL,
      amount_usd REAL NOT NULL,
      earned_at INTEGER NOT NULL
    )
  `);

  console.log("✅ Database schema created successfully");
};
