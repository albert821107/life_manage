# CLAUDE.md — 個人人生管理系統 (life_manage)

> 此檔案供 Claude Code AI 快速了解專案背景，任何電腦 clone 後請先閱讀此檔。

---

## 專案概述

**個人人生管理系統** — 單人使用的本地端全功能生活管理 SPA。
開發者在多台電腦間輪流開發，使用繁體中文。

- **倉庫位置（本機）：** `c:\Project\life_manage`（Windows）
- **執行 Port：** 3100
- **語言：** 繁體中文（UI、commit、討論全為中文）
- **當前版本：** v1.0（見 ROADMAP.md）

---

## Tech Stack

| 層 | 技術 |
|----|------|
| Backend | Node.js + Express 4.x |
| Database | SQLite via **sql.js**（WebAssembly，零 native 編譯） |
| Real-time | Socket.io 4.x |
| Scheduling | node-cron |
| Frontend | Vanilla HTML/CSS/JS（`public/index.html` 單檔 SPA，~129KB） |
| 圖表/地圖 | Chart.js + Leaflet.js |
| 部署 | PM2（`ecosystem.pm2.config.js`） |

---

## 目錄結構

```
life_manage/
├── js/
│   ├── server.js          # Express 主程式 + Socket.io
│   ├── db.js              # SQLite wrapper & schema 初始化
│   └── modules/           # 功能模組（各自獨立 router）
│       ├── accounting.js
│       ├── tasks.js
│       ├── fitness.js
│       ├── investment.js  # ← 近期最活躍
│       ├── ai.js
│       ├── line_notify.js
│       ├── telegram.js
│       └── travel.js
├── public/
│   └── index.html         # 全部前端（一個大檔案）
├── data/                  # SQLite DB（gitignore，本機產生）
├── scripts/               # seed_geojson.js 等工具腳本
├── .env                   # 環境變數（gitignore）
├── .env.example           # 環境變數範本
├── ROADMAP.md             # 功能規劃
└── CLAUDE.md              # 本檔
```

---

## 功能模組

| 模組 | 說明 |
|------|------|
| 記帳 | 收入/支出、類別、月度統計 |
| 任務 | Kanban 看板（待辦/進行中/完成）、優先級、到期日 |
| 健身 | 運動紀錄、時長、熱量 |
| **投資** | 台股/美股/外匯/借券持倉管理、損益計算（**近期主力開發**） |
| AI 助理 | OpenAI 整合，mock 模式（無需 API Key） |
| LINE 通知 | 自訂推播、每日摘要、排程 |
| Telegram | Bot 推播（同 LINE 架構） |
| 旅遊足跡 | 國家/地區打卡、GeoJSON 地圖（存 SQLite） |

---

## 資料庫重要表格

| 表格 | 用途 |
|------|------|
| `accounting` | 收支記錄 |
| `tasks` | 任務 |
| `fitness` | 健身記錄 |
| `investments` | 持倉（台股、美股、加密貨幣、債券） |
| `investment_txns` | 買賣交易紀錄 |
| `tw_shorts` | 台股借券 |
| `forex` | 外匯部位 |
| `assets_accounts` | 資產帳戶（存款等） |
| `assets_rates` | 匯率 |
| `assets_snapshots` | 每日資產快照 |
| `ai_chats` | AI 對話歷史 |
| `travel_visited` | 旅遊足跡 |
| `travel_geojson` | 地圖 GeoJSON 快取 |
| `nav_order` | 側邊欄排序 |

---

## 近期開發重點（依 git log）

1. **投資模組大幅重構**：
   - 庫存 / 借券總市值分離
   - 存款重構（assets 模組）
   - 美股儀表板 TWD 統一顯示
   - 借券拖曳刪除、美股字典、外匯 autocomplete
   - 損益公式：標準未實現損益，賣出費用移至 tooltip
2. **旅遊模組**：靜態國旗、GeoJSON 存 SQLite、中文地名切換
3. **資產模組**：UI 統一化、Windows 相容性修正

---

## 環境設定

```bash
# 複製環境變數
cp .env.example .env
# 填入（可選）：OPENAI_API_KEY, LINE_NOTIFY_TOKEN, TELEGRAM_BOT_TOKEN/CHAT_ID

# 安裝依賴
npm install

# 開發模式
npm run dev       # nodemon，Port 3100

# 生產模式
pm2 start ecosystem.pm2.config.js
```

---

## AI 模型設定 & 跨機記憶同步

Memory 檔案存於 `.claude/memory/`（git tracked），透過 git push/pull 自動跨機同步。

每台電腦需建立 `~/.claude/settings.json`：

**Windows：**
```json
{
  "model": "claude-sonnet-4-6",
  "autoMemoryDirectory": "c:\\Project\\life_manage\\.claude\\memory"
}
```

**Mac / Linux：**
```json
{
  "model": "claude-sonnet-4-6",
  "autoMemoryDirectory": "/Users/<username>/Desktop/project/life_manager/.claude/memory"
}
```

---

## 開發慣例

- Commit 訊息用**繁體中文**，格式：`feat/fix/chore(模組): 說明`
- 前端全在 `public/index.html` 單一檔案，不拆分
- 後端各模組獨立 Express router，在 `server.js` 掛載
- Socket.io 用於所有 CRUD 操作後的即時 UI 更新
- 無使用者認證系統（單人本地使用）
