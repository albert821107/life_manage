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

## 前端導航結構（新增功能位置參考）

> 每次新增功能請對照此表確認要放在哪一層。
> **位置表示法**：`{群組}-{頁籤}` 或 `{群組}-{頁籤}-{子頁籤}`，依左側清單的**顯示順序**編號。
> 群組：`1` = 基本功能，`2` = 進階功能

```
左側導航欄 (sidebar)
├── [基本功能]  #nav-basic
│   ├── 1-1  概覽       data-sec="dashboard"   → #section-dashboard
│   ├── 1-2  記帳       data-sec="accounting"  → #section-accounting
│   ├── 1-3  任務       data-sec="tasks"       → #section-tasks
│   ├── 1-4  健身       data-sec="fitness"     → #section-fitness
│   ├── 1-5  資產       data-sec="investment"  → #section-investment
│   │         └── 子頁籤 (switchInvTab)
│   │             ├── 1-5-1  資產總覽   tab='assets'  → #inv-sub-assets
│   │             ├── 1-5-2  台股       tab='tw'      → #inv-sub-market
│   │             ├── 1-5-3  美股       tab='us'      → #inv-sub-market
│   │             ├── 1-5-4  加密貨幣   tab='crypto'  → #inv-sub-market
│   │             └── 1-5-5  存款       tab='forex'   → #inv-sub-forex
│   ├── 1-6  AI助理     data-sec="ai"          → #section-ai
│   ├── 1-7  通知       data-sec="line"        → #section-line
│   ├── 1-8  旅遊       data-sec="travel"      → #section-travel
│   │         └── 子頁籤 (switchTravelTab)
│   │             ├── 1-8-1  總覽       tab='weekly'    → #travel-sub-weekly
│   │             ├── 1-8-2  行程       tab='trips'     → #travel-sub-trips
│   │             ├── 1-8-3  回憶       tab='memories'  → #travel-sub-memories
│   │             └── 1-8-4  足跡       tab='footprint' → #travel-sub-footprint
│   └── 1-9  遊戲       data-sec="games"       → #section-games
│
└── [進階功能]  #nav-advanced
    ├── 2-1  工作       data-sec="work"        → #section-work
    │         └── 子頁籤 (switchWorkTab)
    │             └── 2-1-1  Jira工單   tab='jira'      → #work-sub-jira
    ├── 2-2  投資       data-sec="investpro"   → #section-investpro
    │         └── 子頁籤 (switchInvestproTab)
    │             └── 2-2-1  年度損益   tab='yearlypnl' → #investpro-sub-yearlypnl
    ├── 2-3  分析       data-sec="analysis"    → #section-analysis
    └── 2-4  操盤       data-sec="trading"     → #section-trading
```

### 位置表示法範例

| 描述 | 表示法 |
|------|--------|
| 旅遊 → 足跡 | `1-8-4` |
| 資產 → 台股 | `1-5-2` |
| 工作 → Jira | `2-1-1` |
| 遊戲（無子頁籤） | `1-9` |

### 新增功能 SOP

| 要加在哪 | 需要動的地方 |
|----------|-------------|
| **新大頁籤（左側）** | ① nav-item HTML ② `#section-xxx` HTML block ③ `PAGE_META` 加一行 ④ 有 load 邏輯則加入 `LOADERS` |
| **現有大頁籤的子頁籤** | ① `inv-tab` HTML ② 子內容 HTML block ③ `switchXxxTab()` 加 case ④ JS load 函式 |
| **後端 API** | ① `js/modules/xxx.js` 新 router ② `js/server.js` require + use ③ `js/db.js` SCHEMA 加表格 |

---

## 開發慣例

- Commit 訊息用**繁體中文**，格式：`feat/fix/chore(模組): 說明`
- 前端全在 `public/index.html` 單一檔案，不拆分
- 後端各模組獨立 Express router，在 `server.js` 掛載
- Socket.io 用於所有 CRUD 操作後的即時 UI 更新
- 無使用者認證系統（單人本地使用）
