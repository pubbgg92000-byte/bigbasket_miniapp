# BigBasket Telegram Mini App

A Telegram Mini App that provides BigBasket grocery shopping experience directly within Telegram. The app reverse-engineers BigBasket's mobile API endpoints and proxies them through a custom backend, with authentication handled via the Telegram bot chat.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     TELEGRAM CLIENT                         │
├────────────────────────┬────────────────────────────────────┤
│   Telegram Bot Chat    │      Telegram Mini App (WebApp)    │
│   - Phone number       │      - Home / Banners              │
│   - OTP verification   │      - Categories                  │
│   - Session mgmt       │      - Products / Search           │
│                        │      - Cart                        │
│                        │      - Orders                      │
│                        │      - Profile                     │
└────────────┬───────────┴──────────────────┬─────────────────┘
             │                              │
             ▼                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    EXPRESS BACKEND                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ Telegram Bot │  │  API Routes  │  │  Static Server   │  │
│  │  Handler     │  │  /api/*      │  │  /miniapp/*      │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────────────┘  │
│         │                  │                                 │
│         ▼                  ▼                                 │
│  ┌──────────────────────────────────┐                       │
│  │     BigBasket API Service        │                       │
│  │   (Proxies to BB Mobile API)     │                       │
│  └──────────────┬───────────────────┘                       │
│                 │                                            │
│  ┌──────────────┴───────────────────┐                       │
│  │     SQLite Database              │                       │
│  │  - Users & Sessions              │                       │
│  │  - Sections Cache                │                       │
│  │  - Cart State                    │                       │
│  │  - Order History                 │                       │
│  └──────────────────────────────────┘                       │
└─────────────────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────┐
│              BIGBASKET MOBILE API                            │
│     https://www.bigbasket.com/mapi/v3.1.0/                  │
│  - /login/send-otp/      - /category/list/                  │
│  - /login/verify-otp/    - /product/search/                 │
│  - /home/page/           - /cart/add/                       │
│  - /order/list/          - /order/place/                    │
└─────────────────────────────────────────────────────────────┘
```

## Features

- **Phone + OTP Login** - Users authenticate via Telegram bot chat
- **Home Page** - Banners, categories, top picks
- **Categories** - Full category tree browsing
- **Product Search** - Real-time search with suggestions
- **Cart Management** - Add/remove/update items synced with BigBasket
- **Orders** - View order history, track orders
- **Addresses** - Manage delivery addresses
- **Delivery Slots** - View available time slots
- **Offers** - Apply coupon codes
- **Offline/Demo Mode** - Works without BigBasket auth for testing

## Project Structure

```
bigbasket_miniapp/
├── public/                    # Mini App frontend (served as Telegram WebApp)
│   ├── index.html             # Main HTML
│   ├── css/style.css          # Responsive CSS (Telegram theme aware)
│   └── js/app.js              # Frontend JS controller
├── src/
│   ├── index.js               # Express server entry point
│   ├── config/
│   │   └── constants.js       # API endpoints, headers, user states
│   ├── bot/
│   │   └── telegram.js        # Telegram bot (login flow, commands)
│   ├── services/
│   │   └── bigbasket-api.js   # BigBasket API proxy service
│   ├── routes/
│   │   └── api.js             # Express API routes (/api/*)
│   └── db/
│       ├── database.js        # SQLite database layer
│       └── setup.js           # DB initialization script
├── data/                      # SQLite database files (gitignored)
├── .env.example               # Environment variables template
├── package.json
└── README.md
```

## Setup

### 1. Clone & Install

```bash
git clone <this-repo>
cd bigbasket_miniapp
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your values:
# - TELEGRAM_BOT_TOKEN (from @BotFather)
# - MINI_APP_URL (your public URL for the mini app)
```

### 3. Create Telegram Bot

1. Talk to [@BotFather](https://t.me/BotFather) on Telegram
2. Create a new bot with `/newbot`
3. Copy the token to `.env`
4. Set up the Mini App:
   - `/setmenubutton` → Select your bot → Enter your Mini App URL

### 4. Initialize Database

```bash
npm run setup-db
```

### 5. Run

```bash
# Development
npm run dev

# Production
npm start
```

## API Endpoints (Backend Proxy)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/session/create` | Create Mini App session |
| GET | `/api/auth/status` | Check auth status |
| GET | `/api/home` | Home page data |
| GET | `/api/banners` | Promotional banners |
| GET | `/api/categories` | All categories |
| GET | `/api/categories/:id/sub` | Sub-categories |
| GET | `/api/categories/:id/products` | Products by category |
| GET | `/api/products/search?q=` | Search products |
| GET | `/api/products/suggestions?q=` | Search suggestions |
| GET | `/api/products/:id` | Product details |
| GET | `/api/cart` | Get cart |
| POST | `/api/cart/add` | Add to cart |
| POST | `/api/cart/remove` | Remove from cart |
| POST | `/api/cart/update` | Update quantity |
| GET | `/api/orders` | Order history |
| POST | `/api/orders/place` | Place order |
| GET | `/api/addresses` | Saved addresses |
| GET | `/api/slots` | Delivery slots |
| GET | `/api/offers` | Available offers |
| POST | `/api/offers/apply` | Apply coupon |

## Authentication Flow

1. User starts the Telegram bot with `/start`
2. Bot asks for phone number (via contact share or text)
3. Bot calls BigBasket's `/login/send-otp/` API
4. User enters OTP received on phone
5. Bot calls `/login/verify-otp/` → receives access token
6. Token stored in SQLite, session created
7. User opens Mini App → session validated → full access

## BigBasket API Headers (Android App Simulation)

```
User-Agent: BigBasket/7.10.2 (Android; SDK 33; arm64-v8a)
X-Channel: bb-android
X-Caller: app
X-App-Version: 7.10.2
X-Build-Version: 25800
X-BB-Token: <access_token>
```

## Deployment

For production, deploy on any Node.js hosting with HTTPS:
- **Railway** / **Render** / **Fly.io** for backend
- Set `MINI_APP_URL` to your deployed HTTPS URL
- Configure bot webhook for production (instead of polling)

## Tech Stack

- **Runtime**: Node.js 22
- **Backend**: Express.js
- **Bot**: node-telegram-bot-api
- **Database**: better-sqlite3 (SQLite)
- **HTTP Client**: axios
- **Frontend**: Vanilla HTML/CSS/JS (Telegram WebApp SDK)

## License

Private - Educational/Research purposes only.
