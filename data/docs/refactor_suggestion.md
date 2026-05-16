# 重構建議報告
## Refactoring Suggestions

---

## 目錄 Table of Contents

1. [執行摘要](#執行摘要)
2. [高耦合問題清單](#高耦合問題清單)
3. [模組拆分建議](#模組拆分建議)
4. [事件驅動重構機會](#事件驅動重構機會)
5. [訊息佇列引入機會](#訊息佇列引入機會)
6. [重複代碼問題](#重複代碼問題)
7. [技術債清單](#技術債清單)
8. [長期維護風險](#長期維護風險)
9. [漸進式重構可行性](#漸進式重構可行性)
10. [建議重構順序](#建議重構順序)
11. [建議與缺失資訊](#建議與缺失資訊)

---

## 執行摘要

系統存在嚴重的**架構耦合問題**，主要表現為：

1. **所有 40+ 服務共用同一 Node.js 代碼庫**（偽微服務架構）
2. **dbHelper.js 在每個進程初始化所有 30+ 個 MySQL 連線池**，無論服務是否使用
3. **廠商整合代碼分散**，無統一接口規範，每新增廠商需重複相同模式
4. **timerTask 與 vendor server 強耦合**，每廠商需要兩個服務（vendor + timerTask）

當前技術債指數評估：**嚴重（4/5）**

如果不進行重構，每新增一個廠商需：
- 新增一個 vendor server 進程
- 新增一個 timerTask 進程
- 在 dbHelper.js 新增連線池
- 在 servers.js 新增兩條配置
- 在 server_a.json 和 server_d.json 各新增一條 PM2 配置

這是不可持續的架構。

---

## 高耦合問題清單

### 問題 1: 共用連線池反模式（最嚴重）

```javascript
// core/db/dbHelper.js - 每個服務進程都執行這整個文件
module.exports.mysqlHelper = {
    apiSql: new baseDao(mysql.createPool(dbConfig.api_mysql_config)),         // ← 所有服務都建
    recordSql: new baseDao(mysql.createPool(dbConfig.record_mysql_config)),   // ← 所有服務都建
    getRecordSql: new baseDao(mysql.createPool(dbConfig.getRecord_mysql_config)),
    statisticsSql: new baseDao(mysql.createPool(dbConfig.statistics_mysql_config)),
    KYDBSql: new baseDao(mysql.createPool(dbConfig.KYDB_mysql_config)),
    walletSql: new baseDao(mysql.createPool(dbConfig.wallet_mysql_config)),
    // ... 30+ 個連線池全部初始化！
};
```

**實際需求 vs 實際建立**:

| 服務 | 實際需要的 DB | 實際建立的連線池 |
|-----|------------|--------------|
| channel | redis + playerInfo | 30+ |
| kys vendor | kys DB | 30+ |
| timerTask_kys | kys DB | 30+ |
| notification | - | 30+ |

**估算浪費**: 若有 40 個進程 × 30 個連線池 × 10 connections/pool = **12,000 個 MySQL 連線**，遠超實際需求。

### 問題 2: 廠商整合代碼無標準化接口

每個廠商實作方式不一致：
```
vendor/kys/     - 自行維護 timerTask 邏輯
vendor/kylab/   - 自行維護 timerTask 邏輯
vendor/fb/      - 自行維護 timerTask 邏輯
vendor/rising/  - 自行維護 timerTask 邏輯
...（20個廠商各自實作）
```

無統一的 Vendor Interface，新增廠商需從頭寫起。

### 問題 3: timerTask 與廠商服務 1:1 對應

每個廠商需要兩個獨立進程（vendor + timerTask），造成進程數量爆炸。

### 問題 4: 路由配置散落各處

```javascript
// channel/init.js
const BRAND_TYPE = (process.env.BRAND_TYPE) ? '/' + process.env.BRAND_TYPE : '';
httpServer.app.use('/', require(`./routes${BRAND_TYPE}/channelHandle`));
```

品牌邏輯通過路由前綴注入，難以維護多品牌差異。

### 問題 5: 舊版與新版依賴混用

```json
// package.json 同時使用:
"mysql": "^2.18.1",    // ← 舊版（deprecated）
"mysql2": "^3.12.0",   // ← 新版
"redis": "^3.1.2",     // ← 舊版
"moment": "^2.29.1",   // ← deprecated
"request": "^2.88.2",  // ← deprecated
```

---

## 模組拆分建議

### 建議拆分方向

```
當前（偽微服務）:
一個代碼庫 → 40+ PM2 進程

建議（真正的服務導向）:

core-services/
├── auth-service/        # Token 驗證、玩家認證
├── wallet-service/      # 所有錢包操作
├── game-record-service/ # 注單保存/查詢
├── player-service/      # 玩家資訊管理
└── notification-service/# 通知（Telegram/AWS）

vendor-gateway/
├── vendor-adapter/      # 統一廠商接口適配器
│   ├── interfaces/      # IVendorAdapter interface
│   └── adapters/
│       ├── KysAdapter.ts
│       ├── KyLabAdapter.ts
│       └── ... (每廠商一個 Adapter)
└── record-sync-service/ # 統一注單同步（取代 20 個 timerTask）

channel/
├── channel-service/     # 玩家入口路由

admin/
├── dashboard-api/       # 後台管理 API（現有 dashboard）
└── report-service/      # 複雜報表（獨立服務）
```

### 廠商適配器模式設計

```typescript
// 統一 Vendor Interface
interface IVendorAdapter {
    vendorId: string;
    
    // 玩家認證
    verifyToken(token: string, playerId: string): Promise<boolean>;
    
    // 錢包操作
    queryBalance(playerId: string): Promise<number>;
    placeBet(orderId: string, playerId: string, amount: number): Promise<void>;
    settlement(orderId: string, playerId: string, amount: number): Promise<void>;
    cancelBet(orderId: string): Promise<void>;
    
    // 注單同步
    pullRecords(from: Date, to: Date): Promise<BetRecord[]>;
}

// 每個廠商只需實作此 Interface
class KysAdapter implements IVendorAdapter {
    vendorId = 'kys';
    
    async pullRecords(from: Date, to: Date) {
        // KYS 特定邏輯
    }
}

// 統一的定時同步服務（取代 20 個 timerTask 進程）
class VendorSyncService {
    private adapters: Map<string, IVendorAdapter>;
    
    async syncAll() {
        for (const adapter of this.adapters.values()) {
            await this.syncVendor(adapter);
        }
    }
}
```

---

## 事件驅動重構機會

### 識別到的事件驅動場景

| 場景 | 現有實作 | 建議事件 |
|-----|---------|---------|
| 注單保存完成 | 同步 HTTP call | `bet.settled` 事件 |
| 玩家上分/下分 | 同步 HTTP call | `wallet.deposited` / `wallet.credited` 事件 |
| 廠商注單拉取 | 定時輪詢（timerTask）| `vendor.records.pulled` 事件 |
| 代理資料更新 | 同步廣播 | `agent.updated` 事件 |
| Jackpot 觸發 | 同步 HTTP call | `jackpot.triggered` 事件 |
| 風控告警 | 同步 Telegram | `risk.alert.triggered` 事件 |
| 玩家登入 | 同步更新統計 | `player.logged_in` 事件 |

### 建議事件架構

```
生產者（Producer）      事件佇列          消費者（Consumer）
─────────────────────────────────────────────────────
wallet-service ──────► wallet.events ──► statistics-service
                                     ──► audit-service
                                     ──► notification-service

game-record-service ─► bet.events ──────► statistics-service
                                     ──► risk-analysis-service
                                     ──► report-service

vendor-gateway ──────► vendor.events ──► record-sync-service
                                     ──► payout-service
```

---

## 訊息佇列引入機會

### 適合佇列化的場景

1. **廠商注單同步**（最高優先）
   - 現在：20 個 timerTask 進程輪詢各廠商 API
   - 建議：Bull Queue（Redis-backed）處理拉取任務

2. **通知發送**
   - 現在：同步呼叫 Telegram API
   - 建議：非同步佇列 + 重試機制

3. **大量導出（Excel 報表）**
   - 現在：同步執行可能超時
   - 建議：佇列化任務 + 完成通知

4. **統計資料更新**
   - 現在：同步寫入多個統計表
   - 建議：非同步佇列，不阻塞主流程

### 建議佇列方案

```javascript
// Bull Queue（Redis-backed）
const Bull = require('bull');

const vendorSyncQueue = new Bull('vendor-sync', { redis: redisConfig });

// 生產者（定時任務）
vendorSyncQueue.add({ vendor: 'kys', from: yesterday, to: now }, {
    repeat: { cron: '*/5 * * * *' },  // 每5分鐘
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
});

// 消費者（統一處理）
vendorSyncQueue.process(async (job) => {
    const adapter = adapterRegistry.get(job.data.vendor);
    const records = await adapter.pullRecords(job.data.from, job.data.to);
    await recordService.saveRecords(records);
});
```

---

## 重複代碼問題

### 已識別的重複模式

1. **每個廠商 timerTask 結構幾乎相同**
   ```
   timerTask/vendor/kys.js
   timerTask/vendor/kyLab.js
   timerTask/vendor/fb.js
   timerTask/vendor/rising.js
   # 推斷有 20 個幾乎相同的文件
   ```

2. **每個廠商 vendor server init.js 結構相同**
   ```javascript
   // 各廠商 init.js 幾乎相同
   module.exports.init = function(serverConfig, callback) {
       internalApiManager.initInternalApiInstances();
       httpServer.app.use('/xxx', require('./routes/xxxHandle'));
       httpServer.createHttpServer(serverConfig.httpPort);
       callback();
   };
   ```

3. **dashboard 各模組 controller 模式重複**
   ```
   每個 controller 都有: initData, create, update, delete
   大量 boilerplate 可以提取
   ```

4. **每個廠商在 dbHelper.js 新增獨立連線池**
   ```javascript
   // 每廠商都要新增:
   xjSql: new baseDao(mysql.createPool(dbConfig.xj_mysql_config)),
   dbgSql: new baseDao(mysql.createPool(dbConfig.dbg_mysql_config)),
   // ...
   ```

---

## 技術債清單

### 優先度 P0（立即處理）

| 項目 | 說明 | 影響 |
|-----|------|-----|
| `mysql` 舊版 | deprecated，替換為 `mysql2` | 安全性、維護性 |
| `redis` 舊版（v3）| 替換為 `ioredis` 或 `redis` v4+ | 安全性、功能 |
| `moment.js` | deprecated，替換為 `dayjs` | 包大小、維護性 |
| `request` | deprecated，替換為 `axios`/`undici` | 安全性 |
| Node.js v16 | EOL，升級至 v22 | 安全性 |

### 優先度 P1（1 個月內）

| 項目 | 說明 | 影響 |
|-----|------|-----|
| dbHelper 連線池優化 | 按需建立連線池 | 資源使用、性能 |
| timerTask 整合 | 合併為統一 Vendor Sync 服務 | 進程數量減少 |
| 廠商接口標準化 | 提取 IVendorAdapter 接口 | 開發效率 |
| 移除 PM2 log NULL | 恢復日誌記錄 | 可觀測性 |

### 優先度 P2（季度內）

| 項目 | 說明 | 影響 |
|-----|------|-----|
| 引入 TypeScript | 類型安全，減少 runtime 錯誤 | 代碼品質 |
| 引入訊息佇列（Bull） | 非同步化廠商同步和通知 | 性能、可靠性 |
| 引入 DI 容器 | 依賴注入，提升可測試性 | 可測試性 |
| 統一錯誤處理 | 各服務錯誤處理標準化 | 可靠性 |

### 優先度 P3（半年內）

| 項目 | 說明 | 影響 |
|-----|------|-----|
| 微服務真正拆分 | 按業務域拆分代碼庫 | 長期維護性 |
| 引入 OpenAPI 規範 | API 文件自動生成 | 開發效率 |
| 引入 Contract Testing | 服務間接口契約測試 | 穩定性 |

---

## 長期維護風險

### 高風險

1. **廠商數量持續增長** — 每增加一個廠商需新增 2 個 PM2 進程、1 套路由、N 個 Controller/DAO，線性增長導致系統越來越難維護

2. **缺乏單元測試** — dashboard 後端幾乎無單元測試，重構風險極高

3. **共用 dbHelper 難以優化** — 任何 DB 配置修改影響所有 40+ 服務

4. **品牌差異通過路由前綴注入** — 品牌越多，路由邏輯越複雜

### 中風險

5. **Moleculer 版本鎖定** — v0.14，最新為 v0.14.x，若需大版本升級有 breaking changes

6. **pomelo-rpc 幾乎無維護** — 依賴極老舊的 RPC 框架

---

## 漸進式重構可行性

### 可行方案：Strangler Fig Pattern

```
Phase 1: 在現有系統旁增加新模組（不破壞現有功能）
    └── 建立 vendor-gateway 微服務（新代碼，舊廠商保持不動）
    └── 新廠商使用新架構接入

Phase 2: 逐步遷移現有廠商
    └── 一次遷移一個廠商至新 vendor-gateway
    └── 驗證正確性後刪除舊進程

Phase 3: 核心服務重構
    └── wallet-service 獨立（最高優先）
    └── auth-service 獨立

Phase 4: 廢棄舊架構
    └── 所有廠商遷移完成後廢棄 vendor/* 舊服務
```

**優點**: 每一步都可以回滾，不影響生產穩定性

---

## 建議重構順序

### 第一優先：解決最大技術債

```
Week 1-2:
□ 升級所有 deprecated 套件（mysql → mysql2, moment → dayjs）
□ 修正 PM2 日誌配置（移除 NULL）

Month 1:
□ dbHelper 改為按需初始化連線池
□ 加入健康檢查端點

Month 2-3:
□ 建立統一 Vendor Interface
□ 建立 VendorSyncService（整合所有 timerTask）
□ 使用 Bull Queue 替換輪詢機制

Month 3-6:
□ 逐步遷移廠商至新接口
□ 引入 TypeScript
□ 補充單元測試

Month 6-12:
□ wallet-service 真正獨立
□ 引入 API Gateway
□ K8s 容器化
```

---

## 建議與缺失資訊

### 核心建議

1. **最優先**: 解決 dbHelper 連線池問題 — 直接影響系統資源消耗
2. **次優先**: 統一廠商接口 + 整合 timerTask — 大幅降低新廠商接入成本
3. **長期**: 真正的微服務拆分需要配合基礎設施改進（K8s、MQ）才有意義

### 缺失資訊

1. **各服務實際 DB 使用清單** — 需代碼審查確認每個服務實際用到哪些 DB
2. **廠商接入文件** — 確認各廠商技術規範差異
3. **業務優先排序** — 哪些廠商流量最大，重構優先級
4. **測試環境完整性** — 重構需要完整的測試環境驗證
