# Telegram Account Seller Bot 🇪🇬

A powerful, automated Telegram bot built with Node.js and SQLite for selling Telegram accounts (Phone Number + OTP Link). Features a professional admin dashboard and integrated crypto payments.

## 🚀 Features

### **Bot Features**
- **Automated Sales**: Users can browse and buy Telegram accounts 24/7.
- **Instant Delivery**: Upon payment confirmation, the bot generates and sends a `.txt` file containing account details (Phone Number & OTP Link).
- **Balance System**: Includes a "Refunded Balance" system for users, allowing credits to be used for future purchases.
- **Real-time Stock**: Users can see how many accounts are available for purchase.
- **Pending Invoice Management**: Users can only have one active invoice at a time, with an easy "Cancel" option to start a new one.

### **Admin Dashboard**
- **Sleek Interface**: A modern, responsive SPA built with Bootstrap and SweetAlert2.
- **Inventory Management**:
    - **Single Add**: Add accounts one-by-one with dedicated fields.
    - **Bulk Add**: Import accounts in mass using the `Phone|Link` format.
- **Live Statistics**: Monitor total revenue, accounts sold, available stock, and user growth.
- **Financial Controls**:
    - **Update Pricing**: Set the global USD price per account.
    - **Manual Balance Adjustments**: Edit any user's refunded balance directly from the "Users" tab.
- **Order Tracking**: View detailed history of all orders, including payment status and delivery timestamps.

## 🛠️ Tech Stack
- **Bot Engine**: [grammY](https://grammy.dev/)
- **Backend**: Express.js
- **Database**: SQLite ([better-sqlite3](https://github.com/WiseLibs/better-sqlite3))
- **Payments**: [OxaPay API](https://oxapay.com/)
- **Frontend**: Vanilla JS + Bootstrap 5 + SweetAlert2

## 📦 Setup & Installation

### 1. Prerequisites
- Node.js (v18+)
- A [Telegram Bot Token](https://t.me/BotFather)
- An [OxaPay Merchant API Key](https://oxapay.com/)

### 2. Clone and Install
```bash
git clone https://github.com/nasirul786/Gift-Code-Seller-Bot.git
cd Gift-Code-Seller-Bot
npm install
```

### 3. Environment Variables
Create a `.env` file in the root directory:
```env
BOT_TOKEN=your_telegram_bot_token
OXAPAY_MERCHANT_API_KEY=your_oxapay_api_key
BASE_URL=https://your-domain.ngrok-free.dev
PORT=3001
```

### 4. Start the Application
```bash
node index.js
```

## 📂 Project Structure
```text
├── src/
│   ├── bot.js          # Bot logic, commands, and customer flows
│   ├── database.js     # SQLite schema and data access methods
│   ├── server.js       # Express server, Admin API, and Webhooks
│   └── oxapay.js       # OxaPay API integration wrapper
├── public/
│   └── admin/          # Admin Panel SPA (HTML/JS/CSS)
├── index.js            # Unified entry point
└── data.db             # SQLite database (generated on first run)
```

## 📜 License
MIT License. Feel free to use and modify!
