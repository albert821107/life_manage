# 服務依賴圖
## Service Dependency Graph

---

## 目錄 Table of Contents

1. [執行摘要](#執行摘要)
2. [服務依賴關係圖](#服務依賴關係圖)
3. [外部依賴清單](#外部依賴清單)
4. [資料庫依賴矩陣](#資料庫依賴矩陣)
5. [啟動依賴順序](#啟動依賴順序)
6. [單點故障分析](#單點故障分析)
7. [缺失資訊](#缺失資訊)

---

## 執行摘要

系統共有 **48+ 個服務節點**（含 PM2 進程），依賴關係如下：
- 所有服務依賴 **Redis**（單點故障風險）
- 所有服務依賴 **MySQL Master**（單點故障風險）
- `game` server 與 `game_server`（未知）有強依賴
- `dashboard` 依賴 `game_api dataService (1029)` 作為中間層

---

## 服務依賴關係圖

### 核心服務依賴

```
╔═══════════════════════════════════════════════════════════════╗
║                  外部用戶 / 遊戲客戶端                          ║
╚═══════════════════════╤═══════════════════════════════════════╝
                        │
                        ▼
              ┌─────────────────┐
              │   Nginx Proxy   │
              └────────┬────────┘
                       │
         ┌─────────────┼──────────────────┐
         │             │                  │
         ▼             ▼                  ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│   channel    │ │  dashboard   │ │   kysport    │
│   (2090)     │ │  (19200)     │ │   (9528)     │
│  玩家入口     │ │  管理後台    │ │  體育賽事    │
└──────┬───────┘ └──────┬───────┘ └──────────────┘
       │                │
       │         ┌──────┼──────┬──────────────────┐
       │         │      │      │                  │
       │         ▼      │      ▼                  ▼
       │  ┌───────────┐ │ ┌─────────┐  ┌──────────────────┐
       │  │dataService│ │ │platform │  │ game_record_parser│
       │  │  (1029)   │ │ │ (3050)  │  │    (19453)       │
       │  └───────────┘ │ └─────────┘  └──────────────────┘
       │         │      │
       │    ┌────┴────┐ │
       │    │         │ │
       │    ▼         ▼ ▼
       │ ┌──────┐ ┌─────────┐
       │ │wallet│ │statistics│
       │ │(2100)│ │ (4000)  │
       │ └──┬───┘ └─────────┘
       │    │
       │    ▼
       │ ┌────────────┐
       │ │ gameRecord │
       │ │   (5000)   │
       │ └────────────┘
       │
       ▼
┌─────────────┐
│    game     │◄──────────────────────────────┐
│   (10000)   │                               │
└──────┬──────┘                               │
       │                                      │
       ▼                                      │
┌─────────────┐    ┌──────────────────────────┤
│ game_server │    │   playerInfo Moleculer    │
│  （未知）   │    │   RPC Nodes (7000-7950)   │
└─────────────┘    └──────────────────────────┘
```

### 廠商服務依賴

```
外部廠商 API
    │
    ▼
┌──────────────────────────────────────────────────────┐
│              廠商 Vendor Servers (1076-1105)           │
│  kys(1087) kyLab(1089) rising(1090) astar(1091)      │
│  advantplay(1092) whitecliff(1093) cslaySport(1094)  │
│  redcat(1095) minigame(1096) mggo(1097) shogun(1098) │
│  taishan(1099) idg(1100) xj(1101) dbg(1102)         │
│  mgp(1103) ibex(1104) vgame(1105) fb(1076)           │
└──────────────────────┬───────────────────────────────┘
                       │ 回調/Webhook
                       ▼
              ┌─────────────────┐
              │  thirdParty     │
              │   (10010)       │   ← 第三方單一錢包接口
              └─────────┬───────┘
                        │
                        ▼
              ┌─────────────────┐
              │  wallet (2100)  │
              └─────────────────┘

timerTask 定時任務 (8300-9900)
    │  每5分鐘拉取注單
    ▼
外部廠商 API
    │
    ▼ 保存至
各廠商獨立 MySQL DB / channelRecord (2290/2390)
```

### 通知服務依賴

```
任意服務 (dashboard/game_api)
    │ 觸發通知
    ▼
┌─────────────────┐
│  notification   │
│    (8200)       │
└────────┬────────┘
         │
    ┌────┴────┐
    │         │
    ▼         ▼
Telegram  AWS SES
  Bot      Email
```

---

## 外部依賴清單

### 基礎設施依賴

| 依賴服務 | 類型 | 依賴服務清單 | 風險 |
|--------|------|-----------|-----|
| Redis | 快取/Session | 全部 40+ 服務 | CRITICAL（單點）|
| MySQL Master | 主資料庫 | 全部服務（寫入）| CRITICAL（單點）|
| MySQL Slave | 讀取副本 | 多數服務（讀取）| HIGH |
| Telegram Bot API | 通知 | notification, dashboard | LOW（非核心）|
| AWS SES | Email 通知 | notification | LOW（非核心）|

### 第三方廠商 API 依賴

| 廠商 | 端點 | 依賴服務 | 風險等級 |
|-----|------|---------|---------|
| KYS | stage-api.kyslot168.com | kys vendor + timerTask | HIGH |
| XPG | 未知 | xpg vendor | MEDIUM |
| KYLab | 未知 | kyLab vendor + timerTask | HIGH |
| CSLay Sport | 未知 | cslaySport vendor + timerTask | HIGH |
| RedCat | 未知 | redcat vendor + timerTask | HIGH |
| FB (Football) | sptapi.server.st-newsports.com | fb vendor + timerTask | HIGH |
| Rising | 未知 | rising vendor + timerTask | MEDIUM |
| Astar | 未知 | astar vendor | MEDIUM |
| Advantplay | 未知 | advantplay vendor | LOW |
| Whitecliff | 獨立 MySQL | whitecliff vendor | MEDIUM |
| IBEX | 獨立 MySQL | ibex vendor + timerTask | MEDIUM |
| TaiShan | 獨立 MySQL | taishan vendor + timerTask | MEDIUM |
| MGGO | 未知 | mggo vendor + timerTask | LOW |
| Shogun | 獨立 MySQL | shogun vendor + timerTask | LOW |
| IDG | 未知 | idg vendor + timerTask | LOW |
| XJ | 獨立 MySQL | xj vendor + timerTask | LOW |
| DBG | 獨立 MySQL | dbg vendor + timerTask | LOW |
| MGP | 獨立 MySQL | mgp vendor + timerTask | LOW |
| IBEX | 獨立 MySQL | ibex vendor + timerTask | LOW |
| VGame | 獨立 MySQL | vgame vendor + timerTask | LOW |
| Minigame | 未知 | minigame vendor | LOW |
| Bridge Service | tazhy987.com | 未知模組 | MEDIUM |
| GitLab | git-ewwk.qyrc452.com | 熱更新服務 | MEDIUM |

---

## 資料庫依賴矩陣

| 服務 | game_api DB | game_record | wallet DB | KYDB_NEW | 廠商 DB | Redis |
|-----|-----------|------------|---------|---------|--------|-------|
| channel | ✅ | - | - | - | - | ✅ |
| game | ✅ | - | - | ✅ | - | ✅ |
| wallet | - | - | ✅ | - | - | ✅ |
| gameRecord | - | ✅ | - | - | - | ✅ |
| dataService | ✅ | ✅ | ✅ | ✅ | - | ✅ |
| platform | - | - | - | ✅ | - | ✅ |
| statistics | ✅ | ✅ | - | - | - | ✅ |
| manage | ✅ | - | - | - | - | ✅ |
| kys vendor | - | - | - | - | ✅ KYS | ✅ |
| whitecliff | - | - | - | - | ✅ WC | ✅ |
| fb vendor | - | - | - | - | ✅ FB | ✅ |
| dashboard | ✅ | ✅ | - | ✅ | - | ✅ |
| game_record_parser | - | ✅ | - | - | - | ✅ |

**注意**: 實際上 dbHelper.js 讓所有服務初始化所有連線池，上表為「理論上應該」的依賴。

---

## 啟動依賴順序

```
必須先啟動:
1. MySQL（主從）
2. Redis

然後啟動（可並行）:
3. game_api/server 群組
   ├── 3a. core services: dataService(1029), wallet(2100)
   ├── 3b. game services: game(10000), gameRecord(5000)
   ├── 3c. channel: channel(2090)
   └── 3d. vendor services (1076-1105)

然後啟動:
4. timerTask services (8300-9900)
5. playerInfo Moleculer nodes (7000-7950)

然後啟動:
6. dashboard (19200)
7. dashboard-frontend web server
8. game_record_parser (19453)
9. kysport (9528)
```

**問題**: `start_all.sh` 沒有依賴順序保證，全部並行啟動可能導致：
- channel 在 dataService 就緒前啟動 → 玩家登入失敗
- dashboard 在 MySQL 就緒前啟動 → 初始化失敗

---

## 單點故障分析

### 單點故障（SPOF）清單

| 組件 | 影響範圍 | 恢復時間（估） | 現有冗余 |
|-----|---------|-------------|---------|
| Redis | 全平台（100%）| 手動 5-10 分鐘 | ❌ 無 |
| MySQL Master | 所有寫入操作（100%）| 手動 15-30 分鐘 | ⚠️ 有從庫但無自動切換 |
| channel server | 玩家無法進入遊戲 | PM2 自動重啟 30s | ⚠️ 僅 PM2 重啟 |
| wallet server | 所有金融操作中斷 | PM2 自動重啟 | ⚠️ 僅 PM2 重啟 |
| game server | 遊戲無法進行 | 未知（與 game_server 相關）| ❌ 不明 |
| dashboard | 後台管理不可用 | PM2 自動重啟 | ⚠️ 可接受（非實時）|

### 故障影響分析

```
Redis 故障 (最嚴重)
├── 所有 Token 驗證失敗 → 玩家無法登入
├── 代理資料快取消失 → 重新載入需要時間
├── 速率限制失效 → 可能被暴力攻擊
└── 通知系統故障

MySQL Master 故障
├── 注單無法保存 → 遊戲被迫停止
├── 錢包操作無法寫入 → 財務風險
└── 代理資料無法更新

廠商 API 故障（例: KYS）
├── KYS 遊戲無法進行
├── timerTask 拉取失敗 → 注單可能丟失（若重試失敗）
└── 影響範圍：僅 KYS 遊戲（部分影響）
```

---

## 缺失資訊

1. **game_server 與 game_api 的實際通訊方式** — 依賴關係無法完整建立
2. **網路拓撲** — 服務實際部署在幾台機器上
3. **MySQL Replication 延遲** — 從庫資料延遲可能影響讀取一致性
4. **Redis Sentinel/Cluster 配置** — 是否有任何高可用設定
5. **各廠商 SLA** — 廠商 API 可用性保證
6. **負載均衡設定** — Nginx 上游配置
7. **Gossiper 節點用途** — `serverId: 7777, nodeType: 'gossiper'` 未知功能
