const { Bot, Keyboard, InlineKeyboard, InputFile, session } = require('grammy');
const db = require('./database');
const oxapay = require('./oxapay');
const fs = require('fs');
const path = require('path');

function createBot() {
  const bot = new Bot(process.env.BOT_TOKEN);

  // Session middleware for conversation state
  bot.use(
    session({
      initial: () => ({
        step: null,
      }),
    })
  );

  // ─── /start Command ──────────────────────────────────

  bot.command('start', async (ctx) => {
    const user = db.getOrCreateUser(
      String(ctx.from.id),
      ctx.from.username,
      ctx.from.first_name,
      ctx.from.last_name
    );

    const availableCodes = db.getAvailableCodeCount();
    const settings = db.getAllSettings();
    const pricePerCode = parseFloat(settings.price_per_code);
    const worthPerCode = parseFloat(settings.worth_per_code);

    const keyboard = new Keyboard()
      .text('🛒 Buy Gift Code')
      .text('👤 My Account')
      .row()
      .resized();

    await ctx.reply(
      `🎁 <b>Welcome to Fawry Gift Code Shop!</b>\n\n` +
        `Hello, <b>${ctx.from.first_name || 'there'}</b>! 👋\n\n` +
        `Here you can purchase Fawry gift codes instantly using cryptocurrency.\n\n` +
        `📦 <b>Available Stock:</b> ${availableCodes} codes\n` +
        `💰 <b>Price per Code:</b> $${pricePerCode} USD\n` +
        `🎯 <b>Each Code Worth:</b> ${worthPerCode} EGP\n\n` +
        `Use the buttons below to get started!`,
      { parse_mode: 'HTML', reply_markup: keyboard }
    );

    // Reset session
    ctx.session.step = null;
  });

  // ─── Buy Gift Code ───────────────────────────────────

  bot.hears('🛒 Buy Gift Code', async (ctx) => {
    // Check for existing pending order
    const pendingOrder = db.getUserPendingOrder(String(ctx.from.id));
    if (pendingOrder) {
      const settings = db.getAllSettings();
      const worthPerCode = parseFloat(settings.worth_per_code);
      const totalWorth = pendingOrder.quantity_requested * worthPerCode;

      const keyboard = new InlineKeyboard()
        .url('💳 Pay Now', pendingOrder.payment_url)
        .row()
        .text('❌ Cancel Invoice', 'cancel_order_' + pendingOrder.id);

      return ctx.reply(
        `⚠️ <b>You already have a pending invoice!</b>\n\n` +
          `🎁 <b>Quantity:</b> ${pendingOrder.quantity_requested} gift code${pendingOrder.quantity_requested > 1 ? 's' : ''}\n` +
          `🎯 <b>Total Worth:</b> ${totalWorth} EGP\n` +
          `💰 <b>Amount:</b> $${pendingOrder.amount_usd.toFixed(2)} USD\n\n` +
          `Please complete or cancel this invoice before creating a new one.`,
        { parse_mode: 'HTML', reply_markup: keyboard }
      );
    }

    const availableCodes = db.getAvailableCodeCount();
    const settings = db.getAllSettings();
    const pricePerCode = parseFloat(settings.price_per_code);
    const worthPerCode = parseFloat(settings.worth_per_code);

    if (availableCodes === 0) {
      return ctx.reply(
        '❌ <b>Out of Stock!</b>\n\nSorry, there are no gift codes available at the moment. Please check back later.',
        { parse_mode: 'HTML' }
      );
    }

    const user = db.getUser(String(ctx.from.id));
    let balanceInfo = '';
    if (user && user.refunded_balance > 0) {
      balanceInfo = `\n💳 <b>Your Balance:</b> $${user.refunded_balance.toFixed(2)} USD (will be applied automatically)\n`;
    }

    ctx.session.step = 'awaiting_quantity';

    await ctx.reply(
      `🛒 <b>Buy Gift Codes</b>\n\n` +
        `📦 <b>Available Stock:</b> ${availableCodes} codes\n` +
        `💰 <b>Price per Code:</b> $${pricePerCode} USD\n` +
        `🎯 <b>Each Code Worth:</b> ${worthPerCode} EGP\n` +
        balanceInfo +
        `\nPlease enter the number of gift codes you want to buy:\n\n` +
        `<i>Type a number or send /cancel to cancel.</i>`,
      { parse_mode: 'HTML' }
    );
  });

  // ─── My Account ──────────────────────────────────────

  bot.hears('👤 My Account', async (ctx) => {
    const user = db.getOrCreateUser(
      String(ctx.from.id),
      ctx.from.username,
      ctx.from.first_name,
      ctx.from.last_name
    );
    const orders = db.getUserOrders(String(ctx.from.id));
    const totalCodesPurchased = orders.reduce(
      (sum, o) => sum + o.quantity_delivered,
      0
    );
    const totalSpent = orders.reduce((sum, o) => sum + o.amount_usd, 0);

    let message =
      `👤 <b>My Account</b>\n\n` +
      `🆔 <b>User ID:</b> <code>${ctx.from.id}</code>\n` +
      `👤 <b>Name:</b> ${ctx.from.first_name || ''} ${ctx.from.last_name || ''}\n`;

    if (ctx.from.username) {
      message += `📛 <b>Username:</b> @${ctx.from.username}\n`;
    }

    message +=
      `\n📊 <b>Purchase History</b>\n` +
      `🛒 <b>Total Orders:</b> ${orders.length}\n` +
      `🎁 <b>Total Codes Purchased:</b> ${totalCodesPurchased}\n` +
      `💵 <b>Total Spent:</b> $${totalSpent.toFixed(2)} USD\n`;

    const inlineKeyboard = new InlineKeyboard();

    if (totalCodesPurchased > 0) {
      inlineKeyboard.text('📥 Download All Codes', 'download_all_codes').row();
    }

    if (user.refunded_balance > 0) {
      message += `\n💳 <b>Refunded Balance:</b> $${user.refunded_balance.toFixed(2)} USD\n`;
      inlineKeyboard.text('❓ What is refunded balance?', 'explain_refund');
    }

    const hasButtons = totalCodesPurchased > 0 || user.refunded_balance > 0;

    await ctx.reply(message, {
      parse_mode: 'HTML',
      reply_markup: hasButtons ? inlineKeyboard : undefined,
    });
  });

  // ─── Explain Refunded Balance ─────────────────────────

  bot.callbackQuery('explain_refund', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(
      `💳 <b>What is Refunded Balance?</b>\n\n` +
        `When you purchase gift codes, sometimes there might not be enough codes in stock to fulfill your entire order.\n\n` +
        `In that case, the remaining amount for the undelivered codes is added to your <b>Refunded Balance</b>.\n\n` +
        `This balance will be <b>automatically applied</b> to your next purchase, reducing the amount you need to pay.\n\n` +
        `<i>Example: If you ordered 10 codes but only 8 were available, the cost of the 2 missing codes is added to your refunded balance.</i>`,
      { parse_mode: 'HTML' }
    );
  });

  // ─── Download All Codes ───────────────────────────────

  bot.callbackQuery('download_all_codes', async (ctx) => {
    await ctx.answerCallbackQuery();

    const codes = db.getUserPurchasedCodes(String(ctx.from.id));
    if (!codes || codes.length === 0) {
      return ctx.reply('❌ You have no purchased codes.', { parse_mode: 'HTML' });
    }

    const settings = db.getAllSettings();
    const worthPerCode = parseFloat(settings.worth_per_code);
    const totalWorth = codes.length * worthPerCode;
    const codeList = codes.map((c) => c.code).join('\n');

    const fileContent =
      `Fawry Gift Card – ${worthPerCode} EGP\n\n` +
      `You have received ${codes.length} Fawry gift card${codes.length > 1 ? 's' : ''} worth ${totalWorth} EGP.\n\n` +
      `Gift Code(s):\n${codeList}\n\n` +
      `Use this code to redeem your balance through Fawry services.\n\n` +
      `Enjoy!`;

    const tmpDir = path.join(__dirname, '..', 'tmp');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const tmpFile = path.join(tmpDir, `all_codes_${ctx.from.id}_${Date.now()}.txt`);
    fs.writeFileSync(tmpFile, fileContent, 'utf8');

    await ctx.reply(
      `📥 Here are all your <b>${codes.length}</b> purchased gift codes:`,
      { parse_mode: 'HTML' }
    );

    await ctx.replyWithDocument(
      new InputFile(tmpFile, `my_fawry_gift_codes_${codes.length}x${worthPerCode}EGP.txt`)
    );

    try { fs.unlinkSync(tmpFile); } catch (e) {}
  });


  bot.callbackQuery(/^cancel_order_(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const orderId = parseInt(ctx.match[1], 10);
    const cancelled = db.cancelOrder(orderId, String(ctx.from.id));

    if (cancelled) {
      await ctx.editMessageText(
        `✅ <b>Invoice cancelled successfully!</b>\n\nYou can now create a new order by tapping "🛒 Buy Gift Code".`,
        { parse_mode: 'HTML' }
      );
    } else {
      await ctx.editMessageText(
        `ℹ️ <b>This invoice is no longer active.</b>\n\nIt may have already been paid, cancelled, or expired.`,
        { parse_mode: 'HTML' }
      );
    }
  });

  // ─── Cancel Command ──────────────────────────────────

  bot.command('cancel', async (ctx) => {
    ctx.session.step = null;
    await ctx.reply('❌ Operation cancelled.', { parse_mode: 'HTML' });
  });

  // ─── Handle Text Messages (quantity input) ────────────

  bot.on('message:text', async (ctx) => {
    // Ignore keyboard button hits that are already handled
    if (
      ctx.message.text === '🛒 Buy Gift Code' ||
      ctx.message.text === '👤 My Account'
    ) {
      return;
    }

    if (ctx.session.step === 'awaiting_quantity') {
      const text = ctx.message.text.trim();

      // Allow /cancel
      if (text === '/cancel') {
        ctx.session.step = null;
        return ctx.reply('❌ Purchase cancelled.');
      }

      const quantity = parseInt(text, 10);

      // Validate input
      if (isNaN(quantity)) {
        return ctx.reply(
          '❌ <b>Invalid input!</b>\n\nPlease enter a valid number.\n\n<i>Type a number or send /cancel to cancel.</i>',
          { parse_mode: 'HTML' }
        );
      }

      if (quantity <= 0) {
        return ctx.reply(
          '❌ <b>Invalid amount!</b>\n\nYou must purchase at least 1 gift code.\n\n<i>Type a number or send /cancel to cancel.</i>',
          { parse_mode: 'HTML' }
        );
      }

      const availableCodes = db.getAvailableCodeCount();

      if (quantity > availableCodes) {
        return ctx.reply(
          `❌ <b>Not enough stock!</b>\n\n` +
            `You requested <b>${quantity}</b> codes, but only <b>${availableCodes}</b> are available.\n\n` +
            `Please enter a number between 1 and ${availableCodes}, or send /cancel to cancel.`,
          { parse_mode: 'HTML' }
        );
      }

      // Calculate price
      const settings = db.getAllSettings();
      const pricePerCode = parseFloat(settings.price_per_code);
      const worthPerCode = parseFloat(settings.worth_per_code);
      let totalAmount = quantity * pricePerCode;

      // Apply refunded balance
      const user = db.getUser(String(ctx.from.id));
      let balanceUsed = 0;
      if (user && user.refunded_balance > 0) {
        balanceUsed = Math.min(user.refunded_balance, totalAmount);
        totalAmount -= balanceUsed;
      }

      // If total is 0 (fully covered by balance), deliver codes directly
      if (totalAmount <= 0) {
        ctx.session.step = null;

        // Deduct balance
        db.setRefundedBalance(
          String(ctx.from.id),
          user.refunded_balance - balanceUsed
        );

        // Get codes and mark sold
        const codes = db.getAvailableCodes(quantity);
        const balanceTrackId = 'balance_' + Date.now();
        const orderId = db.createOrder(
          String(ctx.from.id),
          quantity,
          balanceUsed,
          balanceTrackId,
          ''
        );

        db.markCodesSold(
          codes.map((c) => c.id),
          orderId
        );
        db.markOrderDelivered(
          balanceTrackId,
          codes.length,
          0
        );

        const totalWorth = codes.length * worthPerCode;
        const codeList = codes.map((c) => c.code).join('\n');

        // Send text file
        const fileContent =
          `Fawry Gift Card – ${worthPerCode} EGP\n\n` +
          `You have received ${codes.length} Fawry gift card${codes.length > 1 ? 's' : ''} worth ${totalWorth} EGP.\n\n` +
          `Gift Code(s):\n${codeList}\n\n` +
          `Use this code to redeem your balance through Fawry services.\n\n` +
          `Enjoy!`;

        const tmpDir = path.join(__dirname, '..', 'tmp');
        if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
        const tmpFile = path.join(tmpDir, `gift_codes_${ctx.from.id}_${Date.now()}.txt`);
        fs.writeFileSync(tmpFile, fileContent, 'utf8');

        await ctx.reply(
          `✅ <b>Order Completed!</b> (Paid with balance)\n\n` +
            `🎁 <b>${codes.length}</b> gift code${codes.length > 1 ? 's' : ''} worth <b>${totalWorth} EGP</b>\n` +
            `💳 <b>Balance Used:</b> $${balanceUsed.toFixed(2)} USD\n\n` +
            `Your codes are in the file below. Enjoy! 🎉`,
          { parse_mode: 'HTML' }
        );

        await ctx.replyWithDocument(
          new InputFile(tmpFile, `fawry_gift_codes_${codes.length}x${worthPerCode}EGP.txt`)
        );

        // Clean up temp file
        try {
          fs.unlinkSync(tmpFile);
        } catch (e) {}

        return;
      }

      // Generate OxaPay invoice
      ctx.session.step = null;

      await ctx.reply('⏳ <b>Generating payment invoice...</b>', {
        parse_mode: 'HTML',
      });

      try {
        const baseUrl = process.env.BASE_URL;
        const invoice = await oxapay.createInvoice({
          amount: parseFloat(totalAmount.toFixed(2)),
          orderId: `${ctx.from.id}_${Date.now()}`,
          description: `Purchase of ${quantity} Fawry Gift Code(s)`,
          callbackUrl: `${baseUrl}/api/webhook/oxapay`,
          returnUrl: `${baseUrl}/payment/success`,
        });

        if (!invoice.success) {
          return ctx.reply(
            `❌ <b>Payment Error!</b>\n\n${invoice.error}\n\nPlease try again later.`,
            { parse_mode: 'HTML' }
          );
        }

        // Create order in database
        const orderId = db.createOrder(
          String(ctx.from.id),
          quantity,
          parseFloat(totalAmount.toFixed(2)),
          invoice.trackId,
          invoice.paymentUrl
        );

        // If balance was used, deduct it now
        if (balanceUsed > 0) {
          db.setRefundedBalance(
            String(ctx.from.id),
            user.refunded_balance - balanceUsed
          );
        }

        const totalWorth = quantity * worthPerCode;

        const payKeyboard = new InlineKeyboard().url(
          '💳 Pay Now',
          invoice.paymentUrl
        );

        await ctx.reply(
          `📄 <b>Invoice Generated!</b>\n\n` +
            `🎁 <b>Quantity:</b> ${quantity} gift code${quantity > 1 ? 's' : ''}\n` +
            `🎯 <b>Total Worth:</b> ${totalWorth} EGP\n` +
            `💰 <b>Amount to Pay:</b> $${totalAmount.toFixed(2)} USD\n` +
            (balanceUsed > 0
              ? `💳 <b>Balance Applied:</b> -$${balanceUsed.toFixed(2)} USD\n`
              : '') +
            `\n⏰ <b>Expires in:</b> 60 minutes\n\n` +
            `Click the button below to complete your payment.\n` +
            `Your gift codes will be delivered automatically after payment! 🚀`,
          { parse_mode: 'HTML', reply_markup: payKeyboard }
        );
      } catch (err) {
        console.error('Invoice creation error:', err.message);
        await ctx.reply(
          '❌ <b>Something went wrong!</b>\n\nFailed to generate the payment invoice. Please try again later.',
          { parse_mode: 'HTML' }
        );
      }
    }
  });

  return bot;
}

module.exports = { createBot };
