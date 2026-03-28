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

  // Accounts
  app.get('/api/admin/accounts', requireAuth, (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const data = db.getAllAccounts(page, limit);
    res.json({ success: true, data });
  });

  app.post('/api/admin/accounts', requireAuth, (req, res) => {
    const { accounts } = req.body;
    if (!accounts || !Array.isArray(accounts) || accounts.length === 0) {
      return res.status(400).json({ success: false, message: 'Accounts array required' });
    }
    const added = db.addAccounts(accounts);
    res.json({
      success: true,
      message: `${added} account(s) added successfully`,
      data: { added, duplicates: accounts.length - added },
    });
  });

  app.delete('/api/admin/accounts/:id', requireAuth, (req, res) => {
    const accountId = parseInt(req.params.id, 10);
    if (!accountId) return res.status(400).json({ success: false, message: 'Invalid account ID' });
    const result = db.deleteAccount(accountId);
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

  app.post('/api/admin/users/:telegramId/balance', requireAuth, (req, res) => {
    const telegramId = req.params.telegramId;
    const { amount } = req.body;
    if (amount === undefined || isNaN(parseFloat(amount))) {
      return res.status(400).json({ success: false, message: 'Valid amount required' });
    }
    db.setRefundedBalance(telegramId, parseFloat(amount));
    res.json({ success: true, message: 'User balance updated' });
  });

  // Broadcast
  app.post('/api/admin/broadcast', requireAuth, async (req, res) => {
    const { message } = req.body;
    if (!message) return res.status(400).json({ success: false, message: 'Message required' });

    const users = db.getAllUsers();
    res.json({ success: true, message: `Broadcast started for ${users.length} users` });

    // Background sending
    (async () => {
      let sent = 0;
      let failed = 0;
      for (const user of users) {
        try {
          await bot.api.sendMessage(user.telegram_id, message, { parse_mode: 'HTML' });
          sent++;
        } catch (err) {
          failed++;
        }
        await new Promise(r => setTimeout(r, 50)); // rate limit safety
      }
      console.log(`[Broadcast] Done! Sent: ${sent}, Failed: ${failed}`);
    })();
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

        // Get available accounts
        const availableAccounts = db.getAvailableAccounts(order.quantity_requested);
        const deliveredCount = availableAccounts.length;

        if (deliveredCount === 0) {
          // No accounts available, refund everything
          db.updateRefundedBalance(order.user_id, order.amount_usd);
          db.markOrderDelivered(trackId, 0, order.amount_usd);

          try {
            await bot.api.sendMessage(
              order.user_id,
              `⚠️ <b>Order Update</b>\n\n` +
                `Unfortunately, there are no Telegram accounts in stock right now.\n\n` +
                `💳 <b>$${order.amount_usd.toFixed(2)} USD</b> has been added to your refunded balance.\n` +
                `This will be automatically applied to your next purchase.`,
              { parse_mode: 'HTML' }
            );
          } catch (e) {
            console.error('[Webhook] Failed to send message:', e.message);
          }
          return res.status(200).json({ status: 'ok' });
        }

        // Mark accounts as sold
        db.markAccountsSold(
          availableAccounts.map((a) => a.id),
          order.id
        );

        // Calculate refund if not enough accounts
        const settings = db.getAllSettings();
        const pricePerAccount = parseFloat(settings.price_per_account);
        let refundedAmount = 0;

        if (deliveredCount < order.quantity_requested) {
          const undeliveredCount = order.quantity_requested - deliveredCount;
          refundedAmount = undeliveredCount * pricePerAccount;
          db.updateRefundedBalance(order.user_id, refundedAmount);
        }

        db.markOrderDelivered(trackId, deliveredCount, refundedAmount);

        let accountList = '';
        availableAccounts.forEach((a, index) => {
          accountList += `${index + 1}. Number: ${a.number}\n   Link: ${a.otp_link}\n   (Visit the link for the account OTP)\n\n`;
        });

        // Create temp file
        const fileContent =
          `Telegram Egypt Accounts 🇪🇬 (+20)\n\n` +
          `You have received ${deliveredCount} account${deliveredCount > 1 ? 's' : ''}.\n\n` +
          `Account List:\n\n${accountList}` +
          `Enjoy!`;

        const tmpDir = path.join(__dirname, '..', 'tmp');
        if (!fs.existsSync(tmpDir)) {
          fs.mkdirSync(tmpDir, { recursive: true });
        }

        const tmpFile = path.join(
          tmpDir,
          `tg_accounts_${order.user_id}_${Date.now()}.txt`
        );
        fs.writeFileSync(tmpFile, fileContent, 'utf8');

        try {
          let message =
            `✅ <b>Payment Received!</b>\n\n` +
            `📱 <b>${deliveredCount}</b> Telegram account${deliveredCount > 1 ? 's' : ''}\n` +
            `💰 <b>Amount Paid:</b> $${order.amount_usd.toFixed(2)} USD\n`;

          if (refundedAmount > 0) {
            message +=
              `\n⚠️ <b>Note:</b> Only ${deliveredCount} of ${order.quantity_requested} accounts were available.\n` +
              `💳 <b>$${refundedAmount.toFixed(2)} USD</b> has been added to your refunded balance.\n`;
          }

          message += `\nYour accounts + OTP links are in the file below. Enjoy! 🎉`;

          await bot.api.sendMessage(order.user_id, message, {
            parse_mode: 'HTML',
          });

          await bot.api.sendDocument(
            order.user_id,
            new InputFile(tmpFile, `tg_accounts_${deliveredCount}.txt`)
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
