const express = require('express');
const path = require('path');
const fs = require('fs');
const { InputFile } = require('grammy');
const db = require('./database');

function createServer(bot) {
  const app = express();

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Serve static files
  app.use('/assets', express.static(path.join(__dirname, '..', 'public', 'assets')));

  // Simple health / debug endpoint
  app.get('/api/health', (req, res) => {
    res.json({ ok: true, time: new Date().toISOString() });
  });
  // ─── Auth Middleware ──────────────────────────────────

  function requireAuth(req, res, next) {
    const token = req.headers['authorization'];
    const adminPassword = db.getSetting('admin_password');
    if (token !== `Bearer ${adminPassword}`) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    next();
  }

  // ─── Admin API Routes ────────────────────────────────

  // Login
  app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;
    const adminPassword = db.getSetting('admin_password');
    if (password === adminPassword) {
      return res.json({ success: true, token: adminPassword });
    }
    return res.status(401).json({ success: false, message: 'Invalid password' });
  });

  // Dashboard stats
  app.get('/api/admin/dashboard', requireAuth, (req, res) => {
    const stats = db.getDashboardStats();
    res.json({ success: true, data: stats });
  });

  // Settings
  app.get('/api/admin/settings', requireAuth, (req, res) => {
    const settings = db.getAllSettings();
    res.json({ success: true, data: settings });
  });

  app.post('/api/admin/settings', requireAuth, (req, res) => {
    const { key, value } = req.body;
    if (!key || value === undefined) {
      return res.status(400).json({ success: false, message: 'Key and value required' });
    }
    db.setSetting(key, value);
    res.json({ success: true, message: 'Setting updated' });
  });

  // Gift codes
  app.get('/api/admin/gift-codes', requireAuth, (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const data = db.getAllGiftCodes(page, limit);
    res.json({ success: true, data });
  });

  app.post('/api/admin/gift-codes', requireAuth, (req, res) => {
    const { codes } = req.body;
    if (!codes || !Array.isArray(codes) || codes.length === 0) {
      return res.status(400).json({ success: false, message: 'Codes array required' });
    }
    const added = db.addGiftCodes(codes);
    res.json({
      success: true,
      message: `${added} code(s) added successfully`,
      data: { added, duplicates: codes.length - added },
    });
  });

  app.delete('/api/admin/gift-codes/:id', requireAuth, (req, res) => {
    const codeId = parseInt(req.params.id, 10);
    if (!codeId) return res.status(400).json({ success: false, message: 'Invalid code ID' });
    const result = db.deleteGiftCode(codeId);
    if (result.success) {
      res.json({ success: true, message: result.message });
    } else {
      res.status(400).json({ success: false, message: result.message });
    }
  });

  // Users
  app.get('/api/admin/users', requireAuth, (req, res) => {
    const users = db.getAllUsers();
    res.json({ success: true, data: users });
  });

  // Orders
  app.get('/api/admin/orders', requireAuth, (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const data = db.getAllOrders(page, limit);
    res.json({ success: true, data });
  });

  // ─── OxaPay Webhook ──────────────────────────────────

  app.post('/api/webhook/oxapay', async (req, res) => {
    try {
      const payload = req.body;
      console.log('[Webhook] Received:', JSON.stringify(payload));

      // OxaPay sends status updates
      const trackId = payload.track_id;
      const status = payload.status;

      if (!trackId) {
        return res.status(200).json({ status: 'ok' });
      }

      const order = db.getOrderByTrackId(trackId);
      if (!order) {
        console.log(`[Webhook] Order not found for track_id: ${trackId}`);
        return res.status(200).json({ status: 'ok' });
      }

      // Only process if order is still pending
      if (order.status !== 'pending') {
        console.log(`[Webhook] Order ${trackId} already processed (${order.status})`);
        return res.status(200).json({ status: 'ok' });
      }

      // Check if payment is confirmed
      if (status === 'Paid' || status === 'Confirming' || status === 'Complete') {
        // Mark as paid first
        db.markOrderPaid(trackId);

        // Get available codes
        const availableCodes = db.getAvailableCodes(order.quantity_requested);
        const deliveredCount = availableCodes.length;

        if (deliveredCount === 0) {
          // No codes available, refund everything
          db.updateRefundedBalance(order.user_id, order.amount_usd);
          db.markOrderDelivered(trackId, 0, order.amount_usd);

          try {
            await bot.api.sendMessage(
              order.user_id,
              `⚠️ <b>Order Update</b>\n\n` +
                `Unfortunately, there are no gift codes in stock right now.\n\n` +
                `💳 <b>$${order.amount_usd.toFixed(2)} USD</b> has been added to your refunded balance.\n` +
                `This will be automatically applied to your next purchase.`,
              { parse_mode: 'HTML' }
            );
          } catch (e) {
            console.error('[Webhook] Failed to send message:', e.message);
          }
          return res.status(200).json({ status: 'ok' });
        }

        // Mark codes as sold
        db.markCodesSold(
          availableCodes.map((c) => c.id),
          order.id
        );

        // Calculate refund if not enough codes
        const settings = db.getAllSettings();
        const pricePerCode = parseFloat(settings.price_per_code);
        const worthPerCode = parseFloat(settings.worth_per_code);
        let refundedAmount = 0;

        if (deliveredCount < order.quantity_requested) {
          const undeliveredCount = order.quantity_requested - deliveredCount;
          refundedAmount = undeliveredCount * pricePerCode;
          db.updateRefundedBalance(order.user_id, refundedAmount);
        }

        db.markOrderDelivered(trackId, deliveredCount, refundedAmount);

        const totalWorth = deliveredCount * worthPerCode;
        const codeList = availableCodes.map((c) => c.code).join('\n');

        // Create temp file
        const fileContent =
          `Fawry Gift Card – ${worthPerCode} EGP\n\n` +
          `You have received ${deliveredCount} Fawry gift card${deliveredCount > 1 ? 's' : ''} worth ${totalWorth} EGP.\n\n` +
          `Gift Code(s):\n${codeList}\n\n` +
          `Use this code to redeem your balance through Fawry services.\n\n` +
          `Enjoy!`;

        const tmpDir = path.join(__dirname, '..', 'tmp');
        if (!fs.existsSync(tmpDir)) {
          fs.mkdirSync(tmpDir, { recursive: true });
        }

        const tmpFile = path.join(
          tmpDir,
          `gift_codes_${order.user_id}_${Date.now()}.txt`
        );
        fs.writeFileSync(tmpFile, fileContent, 'utf8');

        try {
          let message =
            `✅ <b>Payment Received!</b>\n\n` +
            `🎁 <b>${deliveredCount}</b> gift code${deliveredCount > 1 ? 's' : ''} worth <b>${totalWorth} EGP</b>\n` +
            `💰 <b>Amount Paid:</b> $${order.amount_usd.toFixed(2)} USD\n`;

          if (refundedAmount > 0) {
            message +=
              `\n⚠️ <b>Note:</b> Only ${deliveredCount} of ${order.quantity_requested} codes were available.\n` +
              `💳 <b>$${refundedAmount.toFixed(2)} USD</b> has been added to your refunded balance.\n`;
          }

          message += `\nYour codes are in the file below. Enjoy! 🎉`;

          await bot.api.sendMessage(order.user_id, message, {
            parse_mode: 'HTML',
          });

          await bot.api.sendDocument(
            order.user_id,
            new InputFile(tmpFile, `fawry_gift_codes_${deliveredCount}x${worthPerCode}EGP.txt`)
          );
        } catch (e) {
          console.error('[Webhook] Failed to send message:', e.message);
        }

        // Cleanup
        try {
          fs.unlinkSync(tmpFile);
        } catch (e) {}
      } else if (status === 'Expired' || status === 'Failed') {
        db.updateOrderStatus(trackId, 'expired');

        // Restore balance if it was deducted
        // Balance was already deducted in the bot when order was created
        // We need to check if balance was used
      }

      res.status(200).json({ status: 'ok' });
    } catch (err) {
      console.error('[Webhook] Error:', err);
      res.status(200).json({ status: 'ok' });
    }
  });

  // ─── Payment Success Page ────────────────────────────

  app.get('/payment/success', (req, res) => {
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Payment Successful</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            font-family: 'Segoe UI', system-ui, sans-serif;
            background: linear-gradient(135deg, #0f0c29, #302b63, #24243e);
            min-height: 100vh; display: flex; align-items: center; justify-content: center;
            color: #fff;
          }
          .card {
            background: rgba(255,255,255,0.05);
            backdrop-filter: blur(20px);
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 24px; padding: 48px; text-align: center;
            max-width: 420px; width: 90%;
          }
          .icon { font-size: 64px; margin-bottom: 16px; }
          h1 { font-size: 24px; margin-bottom: 12px; }
          p { color: rgba(255,255,255,0.7); line-height: 1.6; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="icon">✅</div>
          <h1>Payment Successful!</h1>
          <p>Your gift codes will be delivered to you on Telegram shortly. You can close this page now.</p>
        </div>
      </body>
      </html>
    `);
  });

  // ─── Admin Panel Page ────────────────────────────────

  app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'admin', 'index.html'));
  });

  return app;
}

module.exports = { createServer };
