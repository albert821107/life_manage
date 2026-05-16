# 系統架構分析報告
## System Architecture Analysis

---

## 目錄 Table of Contents

1. [執行摘要](#執行摘要)
2. [整體架構概覽](#整體架構概覽)
3. [各模組職責分析](#各模組職責分析)
4. [服務啟動流程](#服務啟動流程)
5. [技術棧分析](#技術棧分析)
6. [資料庫架構](#資料庫架構)
7. [Port 分配一覽](#port-分配一覽)
8. [第三方廠商整合清單](#第三方廠商整合清單)
9. [業務流程推斷](#業務流程推斷)
10. [危險架構模式](#危險架構模式)
11. [風險評估](#風險評估)
12. [建議](#建議)
13. [缺失資訊](#缺失資訊)

---

## 執行摘要

本系統是一個**大型博弈/遊戲平台（B2B/B2C）**，採用「偽微服務」架構：同一份 Node.js 代碼庫（`server/src/app.js`）透過命令列參數 `serverId` 區分不同服務，以 PM2 cluster/fork 模式啟動 **40+ 個獨立 HTTP 服務**，分佈在不同端口。

系統整合超過 **20 家第三方遊戲廠商**（KYS、XPG、KYLab、CSLay、RedCat 等），支援多品牌部署（YL、LY、KX、NW、V8 等），具備完整的後台管理系統、財務報表、風控機制、Jackpot 管理等功能。

**核心技術**: Node.js + Express.js + MySQL（多庫主從）+ Redis + Moleculer RPC

---

## 整體架構概覽

```
┌─────────────────────────────────────────────────────────────────────┐
│                         外部用戶 / 遊戲客戶端                          │
└─────────────────────┬───────────────────────────────────────────────┘
                      │ HTTPS / WebSocket
                      ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Nginx (Port 80 / 443)                             │
│            dashboard-frontend/scripts/nginx.conf                    │
│         → 靜態資源: /usr/share/nginx/html                            │
│         → API Proxy: /api/* → 19200                                 │
│         → 後台功能: 各路徑 → 19200                                    │
└──────────────┬──────────────────────────────────────────────────────┘
               │
       ┌───────┴──────────────────────────────────────────┐
       │                                                  │
       ▼                                                  ▼
┌──────────────────┐                        ┌────────────────────���───┐
│  dashboard-      │                        │  kysport (Next.js)     │
│  frontend        │                        │  Port: 9528 (PM2 fork) │
│  (Vue.js SPA)    │                        └────────────────────────┘
└──────────┬───────┘
           │ HTTP to dashboard backend
           ▼
┌──────────────────────────────────────────────────────────────────────┐
│              dashboard (Admin Backend)                               │
│              Port: 19200 (PLATFORM_PORT)                             │
│              Node.js + Express.js                                    │
│              JWT + RBAC + 2FA + Rate Limiter                         │
└──────┬─────────────────────────────────────────────────────────────┘
       │ HTTP Internal APIs
       ├──────────────────────► game_api :1029 (dataService)
       ├──────────────────────► game_api :3050 (platform)
       ├──────────────────────► game_api :4000 (statistics)
       ├──────────────────────► game_record_parser :19453
       └──────────────────────► game_api :7999 (logoServer)

┌──────────────────────────────────────────────────────────────────────┐
│                        game_api (核心遊戲 API)                        │
│                  40+ PM2 Processes, Shared Codebase                  │
│                                                                      │
│  [A 群組 - server_a.json]                                            │
│  ├── channel        :2090  (玩家入口/灰度發布路由)                      │
│  ├── game           :10000 (遊戲核心邏輯)                              │
│  ├── thirdParty     :10010 (第三方錢包整合)                            │
│  ├── vendorCommon   :2400  (廠商通用接口)                              │
│  ├── notification   :8200  (通知系統)                                  │
│  ├── kys            :1087  (KY Sport)                                │
│  ├── kyLab          :1089  (KY Lab)                                  │
│  ├── astar          :1091  (Astar)                                   │
│  ├── fb             :1076  (Football)                                 │
│  ├── rising         :1090  (Rising)                                  │
│  ├── advantplay     :1092  (Advantplay)                              │
│  ├── whitecliff     :1093  (Whitecliff)                              │
│  ├── minigame       :1096  (Mini Game)                               │
│  ├── cslaySport     :1094  (CSLay Sport)                             │
│  ├── redcat         :1095  (RedCat)                                  │
│  ├── mggo           :1097  (MGGO)                                    │
│  ├── shogun         :1098  (Shogun)                                  │
│  ├── taishan        :1099  (TaiShan)                                 │
│  ├── idg            :1100  (IDG)                                     │
│  ├── xj             :1101  (XJ)                                      │
│  ├── dbg            :1102  (DBG)                                     │
│  ├── mgp            :1103  (MGP)                                     │
│  ├── ibex           :1104  (IBEX)                                    │
│  └── vgame          :1105  (VGame)                                   │
│                                                                      │
│  [B 群組 - server_b.json]                                            │
│  └── manage         :3000  (代理後台管理)                              │
│                                                                      │
│  [C 群組 - server_c.json]                                            │
│  ├── dataService    :1029  (資料匯聚層/主要內部 API)                    │
│  ├── wallet         :2100  (錢包服務)                                  │
│  ├── gameRecord     :5000  (遊戲紀錄保存)                              │
│  ├── platform       :3050  (後台管理接入)                              │
│  └── statistics     :4000  (統計接口)                                  │
│                                                                      │
│  [D 群組 - server_d.json]                                            │
│  ├── channelRecord     :2290 (Channel 注單紀錄)                        │
│  ├── channelRecordSport:2390 (Channel 體育注單)                        │
│  ├── timerTask_kys     :8300 (KYS 定時任務)                            │
│  ├── timerTask_kyLab   :8500 (KYLab 定時任務)                          │
│  ├── timerTask_fb      :8600 (FB 定時任務)                             │
│  ├── timerTask_rising  :8700 (Rising 定時任務)                         │
│  ├── timerTask_cslaySport:8800                                       │
│  ├── timerTask_redcat  :8900                                         │
│  ├── timerTask_common  :9000                                         │
│  ├── timerTask_mggo    :9100                                         │
│  ├── timerTask_taishan :9200                                         │
│  ├── timerTask_shogun  :9300                                         │
│  ├── timerTask_idg     :9400                                         │
│  ├── timerTask_xj      :9500                                         │
│  ├── timerTask_dbg     :9600                                         │
│  ├── timerTask_mgp     :9700                                         │
│  ├── timerTask_ibex    :9800                                         │
│  └── timerTask_vgame   :9900                                         │
│                                                                      │
│  [C_Statistic - Moleculer RPC Nodes]                                 │
│  ├── playerInfo   :7000 (每日玩家統計)                                 │
│  ├── gameInfo     :7500 (代理統計)                                     │
│  ├── robotInfo    :7600 (機器人統計)                                   │
│  ├── bonusInfo    :7700 (百人遊戲統計)                                  │
│  ├── userRouter   :7800 (用戶路徑統計)                                  │
│  ├── roomKDValue  :7900 (房間追放監控)                                  │
│  ├── agentJump    :7940 (代理跳線統計)                                  │
│  ├── login        :7950 (登入資訊統計)                                  │
│  └── gossiper     :7777 (Gossip Node)                                │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│                      資料層 Data Layer                                │
│  MySQL 主從架構 (多資料庫)                                              │
│  ├── game_api (主業務)                                                │
│  ├── game_record (注單紀錄)                                           │
│  ├── game_statistics (統計)                                           │
│  ├── game_manage (管理)                                               │
│  ├── KYDB_NEW (平台核心)                                               │
│  ├── wallet (錢包)                                                    │
│  ├── 各廠商獨立 DB (fb, whitecliff, ibex, taishan...)                  │
│  Redis (主要快取)                                                      │
│  ├── redis_config (主 Redis)                                          │
│  └── redis_playerinfo_config (玩家資訊 Redis)                          │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│                  game_record_parser                                  │
│  Port: 19453  TypeScript + Express + TSOA + Vue.js SSR               │
│  功能: 遊戲紀錄解析/展示  Swagger 文件                                   │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 各模組職責分析

### 1. game_api（核心遊戲 API）

**定位**: 整個平台的業務核心，承載所有遊戲邏輯、錢包交易、廠商整合

**關鍵子服務**:

| 服務名稱 | Port | 職責 |
|---------|------|------|
| channel | 2090 | 玩家入口、灰度發布路由分發、Token 驗證 |
| game | 10000 | 核心遊戲邏輯、Agent 快取、黑名單管理 |
| thirdParty | 10010 | 第三方單一錢包整合、查詢餘額、投注/結算 |
| dataService | 1029 | 資料匯聚層：提供 wallet/statistics/platform/gameHandle 統一接口 |
| wallet | 2100 | 玩家/代理錢包操作（存款、取款、轉帳） |
| gameRecord | 5000 | 遊戲注單保存 |
| platform | 3050 | 後台管理接入點（代理更新、封禁、Jackpot 等） |
| statistics | 4000 | 統計查詢接口 |
| manage | 3000 | 代理後台管理 |
| notification | 8200 | Telegram / AWS 通知系統 |
| logoServer | 7999 | Logo 圖檔上傳/管理 |
| 各廠商 | 1076-1105 | 對接各第三方廠商 API |
| timerTask/* | 8300-9900 | 各廠商定時同步任務（注單拉取） |
| playerInfo/* | 7000-7950 | Moleculer RPC 節點（玩家統計資料） |

### 2. dashboard（後台管理）

**定位**: 完整的 B2B 後台管理系統，供平台管理員/代理商使用

**功能模組**:
- 帳號管理（代理商帳號、會員資訊、黑名單）
- 報表管理（盈虧報表、注單明細、資金明細）
- 財務管理（交收報表、匯率管理、代理層級）
- 風控管理（Kill Rate 調整、房間監控、IP Kill、機器人監控）
- 遊戲管理（Banner、公告、遊戲資訊、熱更新代碼）
- 活動管理（活動設置、活動日誌、多幣種活動）
- 系統設置（角色管理、授權管理）
- 運營管理（資料總覽、自定義在線人數、藍綠部署）

**認證機制**: JWT（Access Token 10m + Refresh Token 10h）+ 2FA（TOTP）

### 3. dashboard-frontend（前台管理介面）

**定位**: Vue.js SPA 管理後台，透過 Nginx 反向代理至 dashboard 後端

**技術**: Vue.js + rspack + Element Plus + ECharts + Cypress E2E

### 4. game_record_parser（遊戲紀錄解析器）

**定位**: 遊戲注單/紀錄的解析、展示、SSR 渲染服務

**技術**: TypeScript + Express + TSOA（API 文件生成）+ Vue.js（SSR）

**特性**: 多品牌 env 支援（yl/kx/ly/nw/v8/cu/vp/cu）

### 5. kysport（體育賽事整合）

**定位**: Next.js 15 應用，負責第三方體育賽事的轉導/整合

**技術**: Next.js 15 + Turbopack + Tailwind CSS + TypeScript

---

## 服務啟動流程

```
start_all.sh
├── cd game_api/
│   ├── pm2 start server_a.json  → 24 個廠商/核心服務
│   ├── pm2 start server_b.json  → 1 個管理服務
│   ├── pm2 start server_c.json  → 5 個資料服務
│   ├── pm2 start server_d.json  → 18 個定時任務/紀錄服務
│   └── pm2 start server_c_statistic.json → Moleculer RPC 節點
├── cd dashboard/
│   └── pm2 start platform.json  → 後台管理後端
└── cd dashboard_frontend_build/
    └── pm2 start client.json    → 前端靜態服務 (Web Server)
```

每個服務啟動時 (`init.js`):
1. 初始化內部 API 實例 (`internalApiManager.initInternalApiInstances()`)
2. 載入 Redis 快取資料（Agent 清單、黑名單等）
3. 掛載路由
4. 啟動 HTTP Server
5. 向 PM2 發送 `ready` 訊號

---

## 技術棧分析

| 層級 | 技術 | 版本/說明 |
|-----|------|---------|
| 執行環境 | Node.js | v16 (Docker: node:16-alpine3.15，**已 EOL**) |
| Web 框架 | Express.js | 4.x |
| 前端框架 | Vue.js | 3.x (SPA) |
| SSR 框架 | Next.js | 15.5 (kysport) |
| 打包工具 | rspack | (dashboard-frontend) |
| RPC 框架 | Moleculer | 0.14.35 |
| 程序管理 | PM2 | cluster/fork mode |
| 資料庫 | MySQL | 2.x (mysql legacy) + mysql2 3.x |
| 快取 | Redis | 3.x (legacy redis client) |
| 認證 | JWT (jsonwebtoken) | 9.0.2 |
| 2FA | TOTP (otpauth) | 9.5 |
| 加密 | crypto-js, bcrypt, crypto (Node built-in) |
| ORM | 無 (原生 SQL) | - |
| API 文件 | Swagger (swagger-autogen) | dataService 環境限定 |
| 容器化 | Docker + docker-compose | 僅 game_api 有 Dockerfile |
| CI/CD | Jenkins (Jenkinsfile) | dashboard 有 |
| 日誌 | Winston + winston-daily-rotate-file |
| 測試 | Cypress (E2E), Vitest (unit) |
| 代碼品質 | Biome (linter) |
| XSS 防護 | xss 套件 |
| 速率限制 | rate-limiter-flexible |
| 通知 | Telegram Bot API, AWS SES |
| IP 地理 | ip2region |

---

## 資料庫架構

### MySQL 資料庫清單（推斷）

| 資料庫名稱 | 用途 | 主從 |
|---------|------|-----|
| game_api | 代理商帳號、遊戲配置、事件資料 | 主從 |
| game_record | 遊戲注單紀錄 | 主從 |
| game_statistics | 統計資料 | 主從 |
| game_manage | 管理平台資料 | 無（推斷） |
| KYDB_NEW | 平台核心（bgDeployment、角色等） | 主從 |
| wallet | 錢包交易紀錄 | 主從 |
| detail_record | 詳細操作紀錄 | 主從 |
| jackpot | Jackpot 獎池資料 | 無 |
| lottery | 彩票資料 | 無 |
| fb_mysql (主/從) | Football Betting 資料 | 主從 |
| fb_record | FB 注單紀錄 | 主從 |
| manage_mysql | 管理相關 | 無 |
| KYStatis | KY 統計 | 主從 |
| whitecliff | Whitecliff 廠商 | 主從 |
| ibex | IBEX 廠商 | 主從 |
| taishan | TaiShan 廠商 | 主從 |
| cslay | CSLay 廠商 | 主從 |
| event_manage | 活動管理 | 主從 |
| redcat | RedCat 廠商 | 主從 |
| shogun | Shogun 廠商 | 主從 |
| orders_record | 訂單紀錄 | 主從 |
| xj | XJ 廠商 | 主從 |
| dbg | DBG 廠商 | 主從 |
| mgp | MGP 廠商 | 主從 |
| vgame | VGame 廠商 | 主從 |

**問題**: MySQL 連線池在每個服務啟動時全部創建（`dbHelper.js`），即使某服務只需其中幾個，所有連線池均被初始化 → **嚴重的連線浪費**

---

## Port 分配一覽

| Port 範圍 | 用途 |
|---------|------|
| 1029 | dataService（主要內部 API）|
| 1076 | FB (Football) |
| 1087-1105 | 各廠商服務 |
| 2090-2093 | channel（灰度） |
| 2100 | wallet |
| 2290 | channelRecord |
| 2390 | channelRecordSport |
| 2400 | vendorCommon |
| 3000 | manage |
| 3050 | platform |
| 4000 | statistics |
| 5000 | gameRecord |
| 6379 | Redis |
| 7000-7950 | Moleculer playerInfo RPC |
| 7999 | logoServer |
| 8200 | notification |
| 8300-9900 | timerTask 各廠商 |
| 9528 | kysport (Next.js) |
| 10000 | game |
| 10010 | thirdParty |
| 19200 | dashboard (後台管理) |
| 19453 | game_record_parser |

---

## 第三方廠商整合清單

| 廠商代號 | 遊戲類型 | 整合方式 |
|--------|---------|---------|
| KYS (kys) | 老虎機 | HTTP API + timerTask |
| KYLab | 老虎機 | HTTP API + timerTask |
| FB | 體育博彩 | HTTP API + timerTask |
| Rising | 老虎機 | HTTP API + timerTask |
| Astar | 老虎機 | HTTP API + timerTask |
| Advantplay | 老虎機/桌遊 | HTTP API |
| Whitecliff | 桌遊/老虎機 | HTTP API + 獨立 MySQL |
| CSLay Sport | 體育博彩 | HTTP API + timerTask |
| RedCat | 老虎機 | HTTP API + timerTask |
| Minigame | 小遊戲 | HTTP API |
| MGGO | 老虎機 | HTTP API + timerTask |
| Shogun | 桌遊 | HTTP API + timerTask |
| TaiShan | 桌遊 | HTTP API + timerTask |
| IDG | 桌遊 | HTTP API + timerTask |
| XJ | 老虎機 | HTTP API + timerTask |
| DBG | 桌遊 | HTTP API + timerTask |
| MGP | 老虎機 | HTTP API + timerTask |
| IBEX | 老虎機 | HTTP API + timerTask |
| VGame | 虛擬遊戲 | HTTP API + timerTask |
| XPG | 老虎機 | HTTP API |

---

## 業務流程推斷

### 玩家登入流程
```
1. 玩家客戶端 → channel server (2090)
2. channel 驗證 token（HMAC-SHA256 自定義格式）
3. 查詢 Redis: 黑名單、Agent 資訊、上下分狀態
4. 查詢 MySQL: 玩家資訊、帳號資料
5. 驗證成功 → 返回遊戲入場資料
6. 玩家資訊記錄至 playerInfo Moleculer RPC 節點
```

### 遊戲結算流程（自有遊戲）
```
1. game_server（未知）→ gameRecord server (5000) 保存注單
2. gameRecord → wallet server (2100) 進行資金異動
3. wallet → MySQL (wallet DB) 更新餘額
4. 若有 Jackpot → platform server (3050) 更新獎池
5. 統計資料 → statistics server (4000) 更新
6. channelRecord (2290) 記錄 channel 層注單
```

### 第三方廠商結算流程
```
1. 廠商 → 對應 vendor server (1076~1105) 回調
2. vendor server 驗證簽名
3. → thirdParty server (10010) 錢包異動
4. → channelRecord / 獨立 MySQL 保存注單
5. timerTask → 廠商 API 定期拉取缺漏注單
```

### 後台管理員操作流程
```
1. 管理員 → Nginx → dashboard-frontend (Vue.js)
2. Vue.js → dashboard backend (19200) HTTP API
3. dashboard → JWT 驗證（access token）
4. → RBAC 權限檢查（roleLibrary.authorizationVerification）
5. 敏感操作 → IP 白名單檢查
6. → 呼叫 game_api dataService (1029) / platform (3050)
7. → 直接查詢 MySQL（複雜報表）
8. → Redis 快取（高頻查詢）
```

### 支付流程（單一錢包）
```
1. 廠商 → thirdParty server (10010)
2. /queryBalance → wallet server (2100) 查詢餘額
3. /playerBet → wallet server 扣款
4. /playerAward → wallet server 加款
5. /cancelBet → wallet server 回滾
```

---

## 危險架構模式

### 1. 所有服務共用同一代碼庫
- 任何代碼漏洞影響所有 40+ 服務
- 無真正的服務隔離邊界

### 2. dbHelper 在每個進程中建立所有連線池
```javascript
// dbHelper.js - 每個服務進程都執行此檔案
module.exports.mysqlHelper = {
    apiSql: new baseDao(mysql.createPool(dbConfig.api_mysql_config)),
    recordSql: new baseDao(...),
    // 30+ 個連線池全部初始化
}
```
一個服務需要 2 個 DB，卻建立 30+ 個連線池 → **資源浪費 + 安全邊界消失**

### 3. eval 執行 PM2 命令
```bash
# start_all.sh
for cmd in "${pm2_commands[@]}"
do
    eval "${cmd}"
done
```
若 `pm2_commands` 陣列內容可被外部控制 → **Shell Injection**（目前硬編碼故無直接風險）

### 4. 無 API Gateway
全部端口直接對外暴露（docker-compose ports 映射 40+ 個端口）

### 5. 內部 API 無認證
`wallet/player`、`platform/updateAgent` 等高危端點僅依賴網路隔離

### 6. multipleStatements: true
MySQL 連接池允許多語句執行 → SQL Injection 危害倍增

---

## 風險評估

| 風險項目 | 嚴重度 | 說明 |
|--------|-------|------|
| 無 API Gateway | 高 | 40+ 端口直接暴露 |
| 內部 API 無認證 | 嚴重 | 錢包/代理端點可直接存取 |
| MySQL multipleStatements | 高 | SQL Injection 危害放大 |
| Node.js v16 EOL | 高 | 已停止安全更新 |
| 共用連線池 | 中 | 資源浪費、安全邊界模糊 |
| 單體式共用代碼 | 中 | 橫向移動風險高 |
| 缺乏服務熔斷機制 | 中 | 單一廠商故障可能級聯 |

---

## 建議

1. **引入 API Gateway**（Kong/Nginx Plus/AWS API Gateway）統一管理所有外部端口
2. **內部服務間加入 mutual TLS 或 shared secret 認證**
3. **升級 Node.js 至 v22 LTS**（v16 已 EOL）
4. **關閉 multipleStatements**
5. **各服務獨立 DB 連線池**（不全部初始化）
6. **引入服務熔斷**（如 Opossum）防止廠商故障級聯

---

## 缺失資訊

1. **game_server 原始碼** — 遊戲結果生成邏輯、RNG 機制、賠率計算完全未知
2. **Nginx 完整生產配置** — 僅有 dev dockerfile 版本
3. **MySQL schema** — 資料表結構、索引設計未知
4. **Moleculer transport 配置** — RPC 節點間通訊細節未知
5. **負載均衡配置** — 是否有多台機器部署未知
6. **gameServer 通訊協議** — WebSocket/TCP 細節未知
7. **pomelo-rpc 使用細節** — 依賴存在但使用位置未確認
