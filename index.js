require('dotenv').config();

const db = require('./src/database');
const { createBot } = require('./src/bot');
const { createServer } = require('./src/server');

// Initialize database
db.initialize();
console.log('✅ Database initialized');

// Create bot
const bot = createBot();

// Create server
const app = createServer(bot);

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`📊 Admin panel: ${process.env.BASE_URL}/admin`);
  console.log(`🔗 Webhook URL: ${process.env.BASE_URL}/api/webhook/oxapay`);
});

// Start bot
bot.start({
  onStart: (botInfo) => {
    console.log(`✅ Bot @${botInfo.username} is running!`);
  },
});

// Graceful shutdown
process.once('SIGINT', () => {
  bot.stop();
  process.exit(0);
});
process.once('SIGTERM', () => {
  bot.stop();
  process.exit(0);
});
