# 🎁 Gift Code Seller Telegram Bot

A robust and professional Telegram bot for selling gift codes (like Fawry) using Node.js, SQLite, and the Grammy framework. It features OxaPay crypto payment integration, an automated delivery system, and a premium web-based admin panel.

## 🚀 Features

### 🤖 Telegram Bot
- **Buy Gift Codes**: Simple flow to purchase codes with real-time stock validation.
- **Crypto Payments**: Integrated with **OxaPay** for secure cryptocurrency payments.
- **Automated Delivery**: Codes are delivered instantly via a `.txt` file upon payment confirmation.
- **Pending Order Management**: Prevents multiple pending orders; users can view or cancel active invoices.
- **Refund System**: If stock runs out mid-order, the remaining balance is added to the user's "Refunded Balance" for their next purchase.
- **Account Management**: View purchase history, total spent, and download all previously purchased codes.

### 📊 Admin Panel
- **Modern UI**: Professional white-themed dashboard built with Bootstrap 5 and Bootstrap Icons.
- **Real-time Stats**: Track total revenue, orders, stock levels, and user growth.
- **Inventory Management**: Add codes in bulk (one per line) and delete available codes.
- **Order Tracking**: Detailed list of all orders with status tracking (Pending, Paid, Delivered, Expired, Cancelled).
- **User Management**: View all registered users and their refunded balances.
- **Settings**: Easily change admin password, pricing, and gift code worth.

## 🛠️ Technology Stack
- **Backend**: Node.js, Express
- **Bot Framework**: Grammy
- **Database**: SQLite (using `better-sqlite3`)
- **Payments**: OxaPay API
- **Admin Frontend**: HTML5, Vanilla JS (ES5 compatible), Bootstrap 5, Bootstrap Icons

## ⚙️ Setup & Installation

### 1. Clone the repository
```bash
git clone https://github.com/nasirul786/Gift-Code-Seller-Bot.git
cd Gift-Code-Seller-Bot
```

### 2. Install dependencies
```bash
npm install
```

### 3. Configure environment variables
Create a `.env` file in the root directory:
```env
BOT_TOKEN=your_telegram_bot_token
OXAPAY_MERCHANT_API_KEY=your_oxapay_api_key
BASE_URL=https://your-domain.ngrok-free.dev
PORT=3000
```

### 4. Run the application
```bash
npm start
```

## 🔐 Security
- Admin panel is protected by a password defined in the database (default: `admin123`).
- Webhook endpoints are designed to handle OxaPay status updates securely.
- Sensitive environment variables are managed via `.env`.

## 📄 License
This project is for demonstration purposes. Use responsibly.
