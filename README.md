# 個人人生管理系統 v1

> 基於 Node.js + SQLite 的個人生活管理後台工具，以 PM2 管理程序

## 功能模組

| 模組 | 說明 |
|------|------|
| 💰 記帳 | 收支記錄、分類統計、月度結餘分析 |
| ✅ 任務 | 待辦管理、優先級 Kanban 看板、到期提醒 |
| 💪 健身 | 運動日誌、本週/月統計、熱量追蹤 |
| 📈 投資 | 持倉管理、買賣交易記錄、損益計算 |
| 🤖 AI 助理 | OpenAI 整合（含模擬模式）、上下文感知問答 |
| 🔔 LINE 通知 | LINE Notify 即時推播、每日摘要排程 |
| ✈️ Telegram | Telegram Bot 即時推播、每日摘要排程 |
| 🗺️ 旅遊足跡 | 多國地圖、點擊記錄造訪區域、進度統計 |

---

## 快速開始

### 1. 安裝依賴

```bash
cd life_manager
npm install
```

### 2. 設定環境變數

```bash
cp .env.example .env
# 用編輯器開啟 .env 填入你的設定
```

### 3. 啟動服務

```bash
# 一般啟動
npm start

# 開發模式（自動重啟）
npm run dev
```

### 4. 開啟瀏覽器

```
http://localhost:3100
```

---

## 環境變數說明

| 變數 | 說明 | 預設值 |
|------|------|--------|
| `PORT` | 服務埠口 | `3100` |
| `DB_PATH` | SQLite 資料庫路徑 | `./data/life_manager.db` |
| `OPENAI_API_KEY` | OpenAI API Key（不設定則模擬模式）| - |
| `OPENAI_MODEL` | AI 模型 | `gpt-4o-mini` |
| `LINE_NOTIFY_TOKEN` | LINE Notify Token | - |
| `DAILY_NOTIFY_ENABLED` | 啟用每日摘要推播 | `false` |
| `DAILY_NOTIFY_CRON` | 推播時間（Cron 格式）| `0 8 * * *` |
| `TELEGRAM_BOT_TOKEN` | Telegram Bot Token | - |
| `TELEGRAM_CHAT_ID` | Telegram 接收者 Chat ID | - |

---

## API 文件

### 記帳 `/api/accounting`
| 方法 | 路徑 | 說明 |
|------|------|------|
| GET | `/` | 取得交易記錄 (`?month=YYYY-MM`) |
| GET | `/summary` | 月度收支摘要 |
| GET | `/monthly` | 近 12 個月趨勢（圖表用）|
| POST | `/` | 新增記錄 |
| DELETE | `/:id` | 刪除記錄 |

### 任務 `/api/tasks`
| 方法 | 路徑 | 說明 |
|------|------|------|
| GET | `/` | 取得任務清單 (`?status=pending\|in_progress\|done`) |
| GET | `/summary` | 各狀態數量統計 |
| POST | `/` | 新增任務 |
| PUT | `/:id` | 更新任務 |
| PATCH | `/:id/status` | 更新狀態 |
| DELETE | `/:id` | 刪除任務 |

### 健身 `/api/fitness`
| 方法 | 路徑 | 說明 |
|------|------|------|
| GET | `/` | 取得運動記錄 (`?month=YYYY-MM`) |
| GET | `/summary` | 週/月統計 |
| GET | `/daily` | 近 30 天每日統計 |
| POST | `/` | 新增運動記錄 |
| DELETE | `/:id` | 刪除記錄 |

### 投資 `/api/investment`
| 方法 | 路徑 | 說明 |
|------|------|------|
| GET | `/holdings` | 持倉列表 |
| GET | `/summary` | 組合損益摘要 |
| GET | `/txns` | 交易記錄 (`?symbol=`) |
| POST | `/txns` | 新增交易（自動更新持倉）|
| PUT | `/holdings/:symbol` | 手動更新持倉 |
| PATCH | `/holdings/:symbol/price` | 更新現價 |
| DELETE | `/holdings/:symbol` | 刪除持倉 |

### AI 助理 `/api/ai`
| 方法 | 路徑 | 說明 |
|------|------|------|
| GET | `/history` | 取得對話歷史 |
| POST | `/chat` | 發送訊息 |
| DELETE | `/history` | 清除對話 |

### LINE 通知 `/api/line`
| 方法 | 路徑 | 說明 |
|------|------|------|
| GET | `/status` | 檢查 Token 設定 |
| GET | `/history` | 通知發送歷史 |
| POST | `/notify` | 發送自訂通知 |
| POST | `/notify/summary` | 發送今日摘要 |

### Telegram 通知 `/api/telegram`
| 方法 | 路徑 | 說明 |
|------|------|------|
| GET | `/status` | 檢查 Bot 設定 |
| GET | `/history` | 通知發送歷史 |
| POST | `/notify` | 發送自訂通知 |
| POST | `/notify/summary` | 發送今日摘要 |

### 旅遊足跡 `/api/travel`
| 方法 | 路徑 | 說明 |
|------|------|------|
| GET | `/summary` | 各國已造訪區域數量 |
| GET | `/visited` | 取得某國造訪記錄 (`?country=`) |
| GET | `/geojson/:country` | 取得國家 GeoJSON 地圖資料 |
| POST | `/visited` | 切換區域造訪狀態（已訪則移除）|

---

## PM2 部署

```bash
# 安裝 PM2
npm install -g pm2

# 啟動
npm run pm2:start

# 查看狀態
pm2 status

# 查看日誌
npm run pm2:logs

# 重啟
npm run pm2:restart
```

---

## 目錄結構

```
life_manager/
├── js/
│   ├── server.js            # 主伺服器
│   ├── db.js                # SQLite 資料庫初始化
│   └── modules/
│       ├── accounting.js    # 記帳模組
│       ├── tasks.js         # 任務模組
│       ├── fitness.js       # 健身模組
│       ├── investment.js    # 投資模組
│       ├── ai.js            # AI 助理模組
│       ├── line_notify.js   # LINE 通知模組
│       ├── telegram.js      # Telegram Bot 模組
│       └── travel.js        # 旅遊足跡模組
├── public/
│   └── index.html           # 前端 SPA
├── data/                    # SQLite 資料庫（自動建立）
├── logs/                    # 日誌（自動建立）
├── scripts/
│   └── seed_geojson.js      # 預先下載地圖 GeoJSON 至 SQLite
├── .env.example             # 環境變數範本
├── .env                     # 你的環境變數（不上傳 git）
├── package.json
├── ecosystem.pm2.config.js
├── README.md
└── ROADMAP.md
```

---

## 技術架構

- **後端**: Node.js + Express 4.x + Socket.io 4.x
- **資料庫**: SQLite（better-sqlite3，無需額外安裝 DB server）
- **排程**: node-cron
- **AI**: OpenAI API（gpt-4o-mini）
- **通知**: LINE Notify API、Telegram Bot API
- **地圖**: Leaflet.js + GeoJSON（快取於 SQLite）
- **前端**: Vanilla HTML/CSS/JS + Socket.io + Chart.js
- **流程管理**: PM2
# life_manage
