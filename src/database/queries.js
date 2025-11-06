import db from "./db.js";

// ========================================
// DEAL OPERATIONS
// ========================================

export function saveDeal(data) {
  const insertDeal = db.prepare(`
    INSERT INTO deals (
      ticket_id, buyer_id, seller_id, coin, 
      deal_amount, service_fee, buyer_paid, seller_received,
      crypto_amount, seller_crypto_amount,
      tx_hash, buyer_privacy, seller_privacy, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const updateBuyerStats = db.prepare(`
    INSERT INTO user_stats (user_id, total_deals, deals_as_buyer, total_spent, total_fees_paid, last_deal_at)
    VALUES (?, 1, 1, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      total_deals = total_deals + 1,
      deals_as_buyer = deals_as_buyer + 1,
      total_spent = total_spent + excluded.total_spent,
      total_fees_paid = total_fees_paid + excluded.total_fees_paid,
      last_deal_at = excluded.last_deal_at,
      updated_at = strftime('%s', 'now')
  `);

  const updateSellerStats = db.prepare(`
    INSERT INTO user_stats (user_id, total_deals, deals_as_seller, total_earned, last_deal_at)
    VALUES (?, 1, 1, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      total_deals = total_deals + 1,
      deals_as_seller = deals_as_seller + 1,
      total_earned = total_earned + excluded.total_earned,
      last_deal_at = excluded.last_deal_at,
      updated_at = strftime('%s', 'now')
  `);

  const saveCommission = db.prepare(`
    INSERT INTO commissions (ticket_id, coin, amount_crypto, amount_usd, earned_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  // ✅ Execute as transaction for data integrity
  const transaction = db.transaction(() => {
    const now = Date.now();

    // Insert deal
    insertDeal.run(
      data.ticketId,
      data.buyerId,
      data.sellerId,
      data.coin,
      data.dealAmount,
      data.serviceFee,
      data.buyerPaid,
      data.sellerReceived,
      data.cryptoAmount,
      data.sellerCryptoAmount,
      data.txHash,
      data.buyerPrivacy,
      data.sellerPrivacy,
      now
    );

    // Update buyer stats
    updateBuyerStats.run(data.buyerId, data.buyerPaid, data.serviceFee, now);

    // Update seller stats
    updateSellerStats.run(data.sellerId, data.sellerReceived, now);

    // Save commission
    const commissionCrypto = data.cryptoAmount - data.sellerCryptoAmount;
    saveCommission.run(
      data.ticketId,
      data.coin,
      commissionCrypto,
      data.serviceFee,
      now
    );
  });

  transaction();
  console.log(`✅ Deal ${data.ticketId} saved to database`);
}

// ========================================
// USER STATISTICS
// ========================================

export function getUserStats(userId) {
  const stmt = db.prepare(`
    SELECT * FROM user_stats WHERE user_id = ?
  `);

  return stmt.get(userId);
}

export function getUserDeals(userId, limit = 10) {
  const stmt = db.prepare(`
    SELECT * FROM deals 
    WHERE buyer_id = ? OR seller_id = ?
    ORDER BY completed_at DESC
    LIMIT ?
  `);

  return stmt.all(userId, userId, limit);
}

// ========================================
// LEADERBOARDS
// ========================================

export function getTopTraders(limit = 10) {
  const stmt = db.prepare(`
    SELECT 
      user_id,
      total_deals,
      deals_as_buyer,
      deals_as_seller,
      total_spent,
      total_earned,
      (total_earned - total_spent) as net_position
    FROM user_stats
    ORDER BY total_deals DESC
    LIMIT ?
  `);

  return stmt.all(limit);
}

export function getTopBuyers(limit = 10) {
  const stmt = db.prepare(`
    SELECT 
      user_id,
      deals_as_buyer,
      total_spent
    FROM user_stats
    WHERE deals_as_buyer > 0
    ORDER BY total_spent DESC
    LIMIT ?
  `);

  return stmt.all(limit);
}

export function getTopSellers(limit = 10) {
  const stmt = db.prepare(`
    SELECT 
      user_id,
      deals_as_seller,
      total_earned
    FROM user_stats
    WHERE deals_as_seller > 0
    ORDER BY total_earned DESC
    LIMIT ?
  `);

  return stmt.all(limit);
}

// ========================================
// ADMIN ANALYTICS
// ========================================

export function getTotalCommissions() {
  const stmt = db.prepare(`
    SELECT 
      SUM(amount_usd) as total_usd,
      coin,
      SUM(amount_crypto) as total_crypto
    FROM commissions
    GROUP BY coin
  `);

  return stmt.all();
}

export function getDealsStats() {
  const stmt = db.prepare(`
    SELECT 
      COUNT(*) as total_deals,
      SUM(deal_amount) as total_volume,
      SUM(service_fee) as total_fees,
      AVG(deal_amount) as avg_deal_size,
      coin
    FROM deals
    GROUP BY coin
  `);

  return stmt.all();
}

export function getRecentDeals(limit = 20) {
  const stmt = db.prepare(`
    SELECT * FROM deals
    ORDER BY completed_at DESC
    LIMIT ?
  `);

  return stmt.all(limit);
}

// ========================================
// SEARCH & FILTERS
// ========================================

export function searchDealsByTicket(ticketId) {
  const stmt = db.prepare(`
    SELECT * FROM deals WHERE ticket_id = ?
  `);

  return stmt.get(ticketId);
}

export function getDealsByCoin(coin, limit = 50) {
  const stmt = db.prepare(`
    SELECT * FROM deals 
    WHERE coin = ?
    ORDER BY completed_at DESC
    LIMIT ?
  `);

  return stmt.all(coin, limit);
}

export function getDealsByDateRange(startDate, endDate) {
  const stmt = db.prepare(`
    SELECT * FROM deals 
    WHERE completed_at BETWEEN ? AND ?
    ORDER BY completed_at DESC
  `);

  return stmt.all(startDate, endDate);
}
