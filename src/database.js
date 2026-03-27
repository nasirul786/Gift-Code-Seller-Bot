const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'data.db');
const db = new Database(dbPath);

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function initialize() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id TEXT UNIQUE NOT NULL,
      username TEXT,
      first_name TEXT,
      last_name TEXT,
      refunded_balance REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS gift_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      is_sold INTEGER DEFAULT 0,
      order_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      sold_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      quantity_requested INTEGER NOT NULL,
      quantity_delivered INTEGER DEFAULT 0,
      amount_usd REAL NOT NULL,
      refunded_amount REAL DEFAULT 0,
      track_id TEXT,
      payment_url TEXT,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      paid_at DATETIME,
      delivered_at DATETIME
    );
  `);

  // Insert default settings if not exist
  const defaults = {
    admin_password: 'admin123',
    price_per_code: '1.00',
    worth_per_code: '10',
  };

  const insertSetting = db.prepare(
    'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)'
  );

  for (const [key, value] of Object.entries(defaults)) {
    insertSetting.run(key, value);
  }
}

// ─── Settings ────────────────────────────────────────

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?'
  ).run(key, value, value);
}

function getAllSettings() {
  const rows = db.prepare('SELECT * FROM settings').all();
  const settings = {};
  for (const row of rows) {
    settings[row.key] = row.value;
  }
  return settings;
}

// ─── Users ───────────────────────────────────────────

function getOrCreateUser(telegramId, username, firstName, lastName) {
  let user = db
    .prepare('SELECT * FROM users WHERE telegram_id = ?')
    .get(telegramId);
  if (!user) {
    db.prepare(
      'INSERT INTO users (telegram_id, username, first_name, last_name) VALUES (?, ?, ?, ?)'
    ).run(telegramId, username || null, firstName || null, lastName || null);
    user = db
      .prepare('SELECT * FROM users WHERE telegram_id = ?')
      .get(telegramId);
  } else {
    // Update user info
    db.prepare(
      'UPDATE users SET username = ?, first_name = ?, last_name = ? WHERE telegram_id = ?'
    ).run(username || null, firstName || null, lastName || null, telegramId);
  }
  return user;
}

function getUser(telegramId) {
  return db
    .prepare('SELECT * FROM users WHERE telegram_id = ?')
    .get(telegramId);
}

function getAllUsers() {
  return db.prepare('SELECT * FROM users ORDER BY created_at DESC').all();
}

function getUserCount() {
  return db.prepare('SELECT COUNT(*) as count FROM users').get().count;
}

function updateRefundedBalance(telegramId, amount) {
  db.prepare(
    'UPDATE users SET refunded_balance = refunded_balance + ? WHERE telegram_id = ?'
  ).run(amount, telegramId);
}

function setRefundedBalance(telegramId, amount) {
  db.prepare(
    'UPDATE users SET refunded_balance = ? WHERE telegram_id = ?'
  ).run(amount, telegramId);
}

// ─── Gift Codes ──────────────────────────────────────

function addGiftCodes(codes) {
  const insert = db.prepare('INSERT OR IGNORE INTO gift_codes (code) VALUES (?)');
  const insertMany = db.transaction((codes) => {
    let added = 0;
    for (const code of codes) {
      const trimmed = code.trim();
      if (trimmed) {
        const result = insert.run(trimmed);
        if (result.changes > 0) added++;
      }
    }
    return added;
  });
  return insertMany(codes);
}

function getAvailableCodes(limit) {
  return db
    .prepare(
      'SELECT * FROM gift_codes WHERE is_sold = 0 ORDER BY id ASC LIMIT ?'
    )
    .all(limit);
}

function getAvailableCodeCount() {
  return db
    .prepare('SELECT COUNT(*) as count FROM gift_codes WHERE is_sold = 0')
    .get().count;
}

function getTotalCodeCount() {
  return db.prepare('SELECT COUNT(*) as count FROM gift_codes').get().count;
}

function getSoldCodeCount() {
  return db
    .prepare('SELECT COUNT(*) as count FROM gift_codes WHERE is_sold = 1')
    .get().count;
}

function markCodesSold(codeIds, orderId) {
  const update = db.prepare(
    'UPDATE gift_codes SET is_sold = 1, order_id = ?, sold_at = CURRENT_TIMESTAMP WHERE id = ?'
  );
  const updateMany = db.transaction((ids) => {
    for (const id of ids) {
      update.run(orderId, id);
    }
  });
  updateMany(codeIds);
}

function getAllGiftCodes(page = 1, limit = 50) {
  const offset = (page - 1) * limit;
  const codes = db
    .prepare('SELECT * FROM gift_codes ORDER BY id DESC LIMIT ? OFFSET ?')
    .all(limit, offset);
  const total = getTotalCodeCount();
  return { codes, total, page, totalPages: Math.ceil(total / limit) };
}

// ─── Orders ──────────────────────────────────────────

function getUserPendingOrder(telegramId) {
  const order = db
    .prepare(
      "SELECT * FROM orders WHERE user_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1"
    )
    .get(telegramId);

  if (!order) return null;

  // Check if expired (60 minutes)
  const createdAt = new Date(order.created_at + 'Z').getTime();
  const now = Date.now();
  const sixtyMinMs = 60 * 60 * 1000;

  if (now - createdAt >= sixtyMinMs) {
    // Auto-expire
    db.prepare("UPDATE orders SET status = 'expired' WHERE id = ?").run(order.id);
    return null;
  }

  return order;
}

function cancelOrder(orderId, userId) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(orderId, userId);
  if (!order || order.status !== 'pending') return false;
  db.prepare("UPDATE orders SET status = 'cancelled' WHERE id = ?").run(orderId);
  // Restore refunded balance if it was deducted when order was created
  return true;
}

function getUserPurchasedCodes(telegramId) {
  return db
    .prepare(
      `SELECT gc.code, gc.sold_at, o.quantity_requested
       FROM gift_codes gc
       JOIN orders o ON gc.order_id = o.id
       WHERE o.user_id = ? AND gc.is_sold = 1
       ORDER BY gc.sold_at DESC`
    )
    .all(telegramId);
}

function deleteGiftCode(codeId) {
  const code = db.prepare('SELECT * FROM gift_codes WHERE id = ?').get(codeId);
  if (!code) return { success: false, message: 'Code not found' };
  if (code.is_sold) return { success: false, message: 'Cannot delete sold code' };
  db.prepare('DELETE FROM gift_codes WHERE id = ?').run(codeId);
  return { success: true, message: 'Code deleted' };
}

function createOrder(userId, quantity, amountUsd, trackId, paymentUrl) {
  const result = db
    .prepare(
      'INSERT INTO orders (user_id, quantity_requested, amount_usd, track_id, payment_url) VALUES (?, ?, ?, ?, ?)'
    )
    .run(userId, quantity, amountUsd, trackId, paymentUrl);
  return result.lastInsertRowid;
}

function getOrderByTrackId(trackId) {
  return db.prepare('SELECT * FROM orders WHERE track_id = ?').get(trackId);
}

function updateOrderStatus(trackId, status) {
  db.prepare('UPDATE orders SET status = ? WHERE track_id = ?').run(
    status,
    trackId
  );
}

function markOrderPaid(trackId) {
  db.prepare(
    "UPDATE orders SET status = 'paid', paid_at = CURRENT_TIMESTAMP WHERE track_id = ?"
  ).run(trackId);
}

function markOrderDelivered(trackId, quantityDelivered, refundedAmount) {
  db.prepare(
    "UPDATE orders SET status = 'delivered', quantity_delivered = ?, refunded_amount = ?, delivered_at = CURRENT_TIMESTAMP WHERE track_id = ?"
  ).run(quantityDelivered, refundedAmount, trackId);
}

function getUserOrders(telegramId) {
  return db
    .prepare(
      "SELECT * FROM orders WHERE user_id = ? AND status = 'delivered' ORDER BY created_at DESC"
    )
    .all(telegramId);
}

function getAllOrders(page = 1, limit = 50) {
  const offset = (page - 1) * limit;
  const orders = db
    .prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT ? OFFSET ?')
    .all(limit, offset);
  const total = db.prepare('SELECT COUNT(*) as count FROM orders').get().count;
  return { orders, total, page, totalPages: Math.ceil(total / limit) };
}

function getOrderStats() {
  const totalOrders = db
    .prepare('SELECT COUNT(*) as count FROM orders')
    .get().count;
  const paidOrders = db
    .prepare(
      "SELECT COUNT(*) as count FROM orders WHERE status IN ('paid', 'delivered')"
    )
    .get().count;
  const deliveredOrders = db
    .prepare("SELECT COUNT(*) as count FROM orders WHERE status = 'delivered'")
    .get().count;
  const pendingOrders = db
    .prepare("SELECT COUNT(*) as count FROM orders WHERE status = 'pending'")
    .get().count;
  const totalRevenue = db
    .prepare(
      "SELECT COALESCE(SUM(amount_usd), 0) as total FROM orders WHERE status IN ('paid', 'delivered')"
    )
    .get().total;
  const totalRefunded = db
    .prepare(
      "SELECT COALESCE(SUM(refunded_amount), 0) as total FROM orders WHERE status = 'delivered'"
    )
    .get().total;
  const totalCodesSold = db
    .prepare(
      "SELECT COALESCE(SUM(quantity_delivered), 0) as total FROM orders WHERE status = 'delivered'"
    )
    .get().total;

  return {
    totalOrders,
    paidOrders,
    deliveredOrders,
    pendingOrders,
    totalRevenue,
    totalRefunded,
    totalCodesSold,
  };
}

// ─── Statistics ──────────────────────────────────────

function getDashboardStats() {
  const orderStats = getOrderStats();
  const totalCodes = getTotalCodeCount();
  const availableCodes = getAvailableCodeCount();
  const soldCodes = getSoldCodeCount();
  const totalUsers = getUserCount();
  const settings = getAllSettings();

  // Revenue by day (last 30 days)
  const revenueByDay = db
    .prepare(
      `SELECT DATE(paid_at) as date, SUM(amount_usd) as revenue, COUNT(*) as orders
       FROM orders
       WHERE status IN ('paid', 'delivered') AND paid_at >= datetime('now', '-30 days')
       GROUP BY DATE(paid_at)
       ORDER BY date DESC`
    )
    .all();

  // Codes sold by day (last 30 days)
  const codesSoldByDay = db
    .prepare(
      `SELECT DATE(delivered_at) as date, SUM(quantity_delivered) as codes_sold
       FROM orders
       WHERE status = 'delivered' AND delivered_at >= datetime('now', '-30 days')
       GROUP BY DATE(delivered_at)
       ORDER BY date DESC`
    )
    .all();

  // Recent orders
  const recentOrders = db
    .prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 10')
    .all();

  // Top buyers
  const topBuyers = db
    .prepare(
      `SELECT user_id, 
              COUNT(*) as total_orders, 
              SUM(quantity_delivered) as total_codes,
              SUM(amount_usd) as total_spent
       FROM orders 
       WHERE status = 'delivered'
       GROUP BY user_id 
       ORDER BY total_spent DESC 
       LIMIT 10`
    )
    .all();

  // Total refunded balance across all users
  const totalRefundedBalance = db
    .prepare(
      'SELECT COALESCE(SUM(refunded_balance), 0) as total FROM users WHERE refunded_balance > 0'
    )
    .get().total;

  return {
    ...orderStats,
    totalCodes,
    availableCodes,
    soldCodes,
    totalUsers,
    settings,
    revenueByDay,
    codesSoldByDay,
    recentOrders,
    topBuyers,
    totalRefundedBalance,
  };
}

module.exports = {
  db,
  initialize,
  getSetting,
  setSetting,
  getAllSettings,
  getOrCreateUser,
  getUser,
  getAllUsers,
  getUserCount,
  updateRefundedBalance,
  setRefundedBalance,
  addGiftCodes,
  getAvailableCodes,
  getAvailableCodeCount,
  getTotalCodeCount,
  getSoldCodeCount,
  markCodesSold,
  getAllGiftCodes,
  getUserPendingOrder,
  cancelOrder,
  getUserPurchasedCodes,
  deleteGiftCode,
  createOrder,
  getOrderByTrackId,
  updateOrderStatus,
  markOrderPaid,
  markOrderDelivered,
  getUserOrders,
  getAllOrders,
  getOrderStats,
  getDashboardStats,
};
