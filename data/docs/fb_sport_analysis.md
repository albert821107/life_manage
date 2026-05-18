# FB 體育（KySport2）完整流程分析
## FB Sport (KySport2) Comprehensive Flow Analysis

---

## 目錄 Table of Contents

1. [執行摘要](#執行摘要)
2. [系統定位與整體架構](#系統定位與整體架構)
3. [錢包類型雙軌制](#錢包類型雙軌制)
4. [玩家登入與進入遊戲流程](#玩家登入與進入遊戲流程)
5. [FB 回調端點清單](#fb-回調端點清單)
6. [請求認證機制 (validReqMiddleware)](#請求認證機制-validreqmiddleware)
7. [FB 帳號對應系統 (fbAccountMapping)](#fb-帳號對應系統-fbaccountmapping)
8. [transferType 完整對照表](#transfertype-完整對照表)
9. [各端點詳細請求格式與流程](#各端點詳細請求格式與流程)
   - [1. 查詢餘額 /balance](#1-查詢餘額-balance)
   - [2. 下注 /order_pay (BET)](#2-下注-order_pay-bet)
   - [3. 補查訂單 /check_order_pay](#3-補查訂單-check_order_pay)
   - [4. 批量流水同步 /sync_transaction](#4-批量流水同步-sync_transaction)
   - [5. 注單數據推送 /sync_orders](#5-注單數據推送-sync_orders)
   - [6. 提前結算推送 /sync_cashout](#6-提前結算推送-sync_cashout)
   - [7. 健康檢查 /health](#7-健康檢查-health)
10. [核心交易函數 transactionFunc 詳解](#核心交易函數-transactionfunc-詳解)
11. [walletType 對 wallet 呼叫的影響](#wallettype-對-wallet-呼叫的影響)
12. [結算流程 (sync_orders 結算路徑)](#結算流程-sync_orders-結算路徑)
13. [定時任務](#定時任務)
14. [FB MarketScore API（賽果補查）](#fb-marketscore-api賽果補查)
15. [資料庫結構](#資料庫結構)
16. [錯誤碼對照表](#錯誤碼對照表)
17. [walletHistoryType 體育類型完整對照](#wallethistorytype-體育類型完整對照)
18. [单一钱包 vs 一般錢包在 FB Sport 的差異](#单一钱包-vs-一般錢包在-fb-sport-的差異)
19. [缺失資訊](#缺失資訊)

---

## 執行摘要

FB 體育（代號 **KySport2**，Game ID `7470`）是本平台接入的第三方運動博彩廠商。其核心特性：

1. **雙向通訊**：玩家透過 kysport frontend (port 9528) 進入 FB 平台，FB 平台以 Webhook 方式回調本系統處理金流
2. **帳號映射**：FB 有獨立帳號系統（`merchantUserId`），需透過 `fbAccountMapping` 表對應到本系統 YL 帳號
3. **錢包雙軌制**：同時支援一般錢包（walletType=0）和單一錢包（walletType=2）
4. **非同步注單**：交易流水（order_pay/sync_transaction）與注單詳情（sync_orders）分開推送
5. **完整 transferType 系統**：16 種操作類型，涵蓋押注、派彩、提前結算、回滾等場景
6. **排程補單機制**：結算注單若交易流水未先到達，存入 Redis pending queue，排程重試

**對應廠商服務**: `fb` vendor server (port **1076**)，路由前綴 `/fbHandle`

---

## 系統定位與整體架構

```
玩家
  │ 開啟遊戲
  ▼
channel server (2090)
  │ getGameURL → JWT token
  ▼
kysport frontend (9528) [Next.js]
  │ 攜帶 kysportToken 進入 FB 平台
  ▼
┌──────────────────────────────────────┐
│         FB 體育平台（外部系統）        │
│  NewsPortsPro (sptapi.server.st-...  │
│  newsports.com)                      │
└─────────────────┬────────────────────┘
                  │ Webhook 回調
                  │ POST /fbHandle/fb/callback/*
                  ▼
┌──────────────────────────────────────┐
│     fb vendor server (port 1076)     │
│                                      │
│  /balance       → 查詢玩家餘額        │
│  /order_pay     → 下注扣款           │
│  /check_order_pay → 補查訂單         │
│  /sync_transaction → 批量流水        │
│  /sync_orders   → 注單詳情+結算      │
│  /sync_cashout  → 提前結算記錄       │
└────────────┬─────────────────────────┘
             │ 呼叫 wallet server
             ▼
wallet server (2100)
  │ walletType=0 或 walletType=2
  ▼
[walletType=2] → thirdParty:10010 → 代理 sbUrl（AES+MD5 加密）
[walletType=0] → 本系統 DB 直接帳變
```

---

## 錢包類型雙軌制

| 設定 | 說明 | wallet 操作 | 代理通知 |
|-----|------|-----------|--------|
| `agentData.walletType == 0` | 一般錢包 | 本系統 DB 帳變 | 無 |
| `agentData.walletType == 2` | 單一錢包 | 本地代理帳變 + 代理 sbUrl 通知 | AES+MD5 加密 GET 請求 |

```javascript
// fbService.js - transferType2orderType
const prefix = walletType === 0 ? 'KYSPORT_' : 'KYSPORT_SINGLEWALLET_';
const thisType = prefix + transferType; // e.g. "KYSPORT_SINGLEWALLET_BET"
return walletHistoryType[thisType]; // 對應 walletHistoryType 中的數字代碼
```

---

## 玩家登入與進入遊戲流程

```
1. 玩家在 channel server 請求 FB 遊戲 URL
   │
   ▼
2. channel server → fbCommonService.getGameURL({language, playerId, currencyType, member_ip, agentData})
   │
   ▼
3. 取得語言設定
   - langData = 從 Redis 查語言列表
   - sportLang = fbModel.langMap[language]（中文='CMN', 英文='ENG' 等）
   │
   ▼
4. 簽發 kysportToken (JWT)
   payload = {
       account: playerId,      // YL 帳號（不帶代理前綴）
       currency: currencyType, // 幣種
       lang: lang,             // 前端語言
       sportLang: sportLang,   // 體育語言
       clientIp: member_ip
   }
   kysportToken = issueKySportJwt(payload)
   │
   ▼
5. 返回遊戲 URL
   {
     code: 0,
     game_url: "{KYSPORT_FRONTEND}?kysportToken=TOKEN&lang=zh_cn&promo=0&chk=void"
   }
   │
   ▼
6. 玩家進入 kysport frontend (9528)
   kysport frontend 攜帶 kysportToken 向 FB 平台認證
   │
   ▼
7. FB 平台建立玩家 session
   FB 帳號 (merchantUserId) ↔ YL 帳號 (account) 透過 fbAccountMapping 表對應
   登入幣種儲存在 Redis: setFBAccountLoginData(merchantUserId, {currency, language})
```

---

## FB 回調端點清單

所有端點均掛載在 `/fbHandle` 路由前綴下，由 FB 平台主動 POST 至本系統。

| HTTP | 路徑 | 說明 | 維護檢查 | 需要 Redis 鎖 |
|-----|------|------|--------|------------|
| POST | `/fb/callback/balance` | 查詢玩家餘額 | ✅（中間件）| ❌ |
| POST | `/fb/callback/order_pay` | 下注扣款（單筆）| ✅ | ✅（businessId）|
| POST | `/fb/callback/check_order_pay` | 補查訂單狀態 | ✅ | ✅（businessId）|
| POST | `/fb/callback/sync_transaction` | 批量流水同步 | ❌（逐筆處理）| ✅（每筆 businessId）|
| POST | `/fb/callback/sync_orders` | 注單詳情+結算推送 | ❌ | ❌ |
| POST | `/fb/callback/sync_cashout` | 提前結算記錄推送 | ❌ | ❌ |
| POST | `/fb/callback/health` | 健康檢查 | ❌ | ❌ |

---

## 請求認證機制 (validReqMiddleware)

應用於 `balance`、`order_pay`、`check_order_pay` 三個端點：

```javascript
module.exports.validReqMiddleware = async (req, res, next) => {
    // 1. 記錄請求日誌
    walletLog(req.route.path, 'input', req.body, req[TRACE_ID_KEY]);
    // 2. 從 Redis 取得系統維護狀態
    req.maintainStatus = Number(await getMaintainStatus(COMPANYID.FB));
    next();
};
```

**維護狀態在各端點的使用**:
- `balance`: 不檢查維護狀態（查餘額不受維護影響）
- `order_pay`: `req.maintainStatus === 0 || agentData.fbStatus === 0 || fbAccountMapping.status !== 1` → 返回 GameMaint
- `check_order_pay`: 同 order_pay

> **注意**: `sync_transaction` 和 `sync_orders` 無中間件，但 sync_transaction 的 transactionFunc 內部也會走 wallet 操作（wallet 自行處理）

---

## FB 帳號對應系統 (fbAccountMapping)

### 帳號對應表結構

```sql
-- game_api.fbAccountMapping
CREATE TABLE fbAccountMapping (
    agent           INT,            -- 代理 ID
    account         VARCHAR(255),   -- YL 帳號（{agent}_{player}）
    lineCode        VARCHAR(255),   -- 線路碼
    fbAccount       VARCHAR(255),   -- FB 平台帳號（= merchantUserId）
    displayName     VARCHAR(255),   -- FB 前端顯示名稱
    status          TINYINT,        -- 0=關閉 1=開啟
    createDate      DATETIME,
    registerChannel TINYINT         -- 0=未提前結算 1=提前結算 2=兩者都有
);
```

### 帳號查詢方式

```javascript
// type=1: 用 FB 帳號（merchantUserId）查 YL 帳號
const [fbAccountMapping] = await fbDao.getAccountInFB(param.merchantUserId, 1);
// 結果: { agent: 70000, account: "70000_player001", fbAccount: "FB_USER_123", ... }
```

### Redis 登入資料

```javascript
// 玩家進入 FB 時儲存
await setFBAccountLoginData(merchantUserId, {
    currency: 'CNY',   // 幣別
    language: 1        // 語系 ID
});

// 查詢餘額時取用
const fbLoginData = await getFBAccountLoginData(param.merchantUserId);
// 取得幣種 ID 和語系 ID
```

---

## transferType 完整對照表

FB 定義的 `transferType` 與本系統 wallet 操作的對應關係：

| transferType | 中文說明 | wallet 操作 | transactionType |
|-------------|---------|-----------|----------------|
| `BET` | 押注（扣款）| `playerCredit` | OUT |
| `IN` | 轉入 | `playerCredit` | OUT |
| `RESERVE_BET` | 預約扣款 | `playerCredit` | OUT |
| `WIN` | 派彩（加款）| `playerDeposit` | IN |
| `OUT` | 轉出 | `playerDeposit` | IN |
| `REFUND` | 退款 | `playerDeposit` | IN |
| `CASHOUT` | 提前結算 | `playerDeposit` | IN |
| `CANCEL_RETURN` | 訂單取消返還 | `playerDeposit` | IN |
| `CASHOUT_CANCEL_RETURN` | 提前結算取消返還 | `playerDeposit` | IN |
| `CASHOUT_CANCEL_ROLLBACK_RETURN` | 提前結算取消回滾返還 | `playerDeposit` | IN |
| `BET/CANCEL_RETURN` | 投注取消返還（BET status=0）| `playerCancelBet` | — |
| `CANCEL_DEDUCT` | 訂單取消補扣 | `playerRollback` | OUT |
| `CASHOUT_CANCEL_DEDUCT` | 提前結算取消補扣 | `playerRollback` | OUT |
| `CASHOUT_CANCEL_ROLLBACK_DEDUCT` | 提前結算取消回滾補扣 | `playerRollback` | OUT |
| `SETTLEMENT_ROLLBACK_DEDUCT` | 結算回滾補扣 | `playerRollback` | OUT |

### transferType 特殊轉換規則

```javascript
// 當 transferType=BET 且 status=0（取消狀態）時，自動轉為 BET/CANCEL_RETURN
if (param.transferType === 'BET' && param.status === 0) {
    param.transferType = 'BET/CANCEL_RETURN';
}
```

### single_orders.type 映射（FB Sport 特有）

| transferType | FB_TYPE_MAPPING 值 | 說明 |
|-------------|------------------|------|
| IN, BET, RESERVE_BET | 3 (FB_BET) | 體育下注 |
| OUT, WIN, CASHOUT | 4 (FB_CASHOUT) | 體育結算/派彩 |
| SETTLEMENT_ROLLBACK_DEDUCT | 5 (FB_ROLLBACK) | 體育回滾 |
| CANCEL_DEDUCT, CANCEL_RETURN, REFUND, BET/CANCEL_RETURN, CASHOUT_CANCEL_* | 6 (FB_CANCEL) | 體育取消 |
| CASHOUT_BET | 7 (FB_CASHOUT_BET) | 結算本金返還 |

---

## 各端點詳細請求格式與流程

### 1. 查詢餘額 /balance

**觸發時機**: 玩家進入 FB 平台時、FB 需要顯示玩家餘額時

#### FB → 本系統 Request Body
```json
{
  "merchantUserId": "FB_ACCOUNT_123",
  "merchantId": "MERCHANT_001",
  "currencyId": 1
}
```

| 欄位 | 類型 | 必填 | 說明 |
|-----|------|-----|------|
| `merchantUserId` | String | ✅ | FB 平台玩家 ID |
| `merchantId` | String | ✅ | 渠道 ID |
| `currencyId` | Integer | ❌ | 幣種 ID（見幣種對照表）|

#### 處理流程
```
1. 取得 fbLoginData（幣種）: getFBAccountLoginData(merchantUserId)
2. 轉換幣種 ID: 從 currencyIdEnum 查找幣種代碼
3. 查 fbAccountMapping 取 YL 帳號
4. 取代理資料 agentData（含 walletType）
5. 呼叫 wallet/queryBalance
   → walletType=0: 查本地 DB
   → walletType=2: 呼叫 thirdParty/queryBalance → 代理 sbUrl
6. 轉換: 若 goldToMoney=true, 將 gold 轉為 money 格式返回
```

#### 本系統 → FB Response
```json
{
  "code": 0,
  "message": "success",
  "data": [{
    "balance": 100.00,
    "currencyId": 1
  }]
}
```

---

### 2. 下注 /order_pay (BET)

**觸發時機**: 玩家在 FB 平台下注時（單筆，即時處理）

#### FB → 本系統 Request Body
```json
{
  "transactionId": "TXN-20231101-001",
  "userId": "FB_USER_123",
  "merchantId": "MERCHANT_001",
  "merchantUserId": "FB_ACCOUNT_123",
  "businessId": "ORDER-20231101-001",
  "transactionType": "OUT",
  "transferType": "BET",
  "currencyId": 1,
  "amount": 10.00,
  "status": 1,
  "relatedId": null
}
```

| 欄位 | 類型 | 必填 | 說明 |
|-----|------|-----|------|
| `transactionId` | String | ✅ | 交易流水 ID（全服唯一）|
| `userId` | String | ✅ | FB 用戶 ID |
| `merchantId` | String | ✅ | 渠道 ID |
| `merchantUserId` | String | ✅ | FB 平台帳號 |
| `businessId` | String | ✅ | 業務 ID，即訂單 ID |
| `transactionType` | String | ✅ | `OUT`=轉出, `IN`=轉入 |
| `transferType` | String | ✅ | 只接受 `BET` |
| `currencyId` | Integer | ✅ | 幣種 ID |
| `amount` | Number | ✅ | 流水金額（絕對值，自動取絕對值）|
| `status` | Integer | ✅ | 1=成功; 0=取消 |
| `relatedId` | String | ❌ | 關聯 ID |

#### 處理流程
```
1. 參數校驗（jsonschema validator）
2. Redis 鎖 businessId（防重複）
3. 查 fbAccountMapping
4. 查代理 agentData
5. 維護檢查（maintainStatus=0 OR fbStatus=0 OR account.status≠1 → 返回 GameMaint）
6. 取 fbLoginData（幣種/語系）
7. 寫入 gameRecordInfo（businessId, currency, language）← 記錄此訂單的幣種語系
8. 呼叫 transactionFunc（詳見下方）
9. Redis Unlock businessId
```

#### 下注 transactionFunc 核心步驟
```javascript
// 取 gameRecordInfo（幣種）
// 檢查是否已有 BET/CANCEL_RETURN 記錄 → 若有返回失敗
// 檢查 transactionId 是否重複 → 若重複直接返回成功
// 呼叫 playerCredit（下注扣款）
//   walletType=0: 本地帳變
//   walletType=2: 本地代理帳變 + singleWalletPlayerBet(s=2002)
// 寫入 orderRecord
// 寫入 game_api.orders
```

#### wallet playerCredit 呼叫參數（下注）
```json
{
  "walletType": 2,
  "currency": "CNY",
  "account": "70000_player001",
  "agent": 70000,
  "type": 47,
  "orderId": "TXN-20231101-001",
  "gameNo": "ORDER-20231101-001",
  "gameId": "7470",
  "money": 1000,
  "isFBSport": true,
  "singleOrderFBType": "BET"
}
```

> `money` 單位為 gold（遊戲分）: `moneyToGold(10.00) = 1000`

#### 本系統 → FB Response
```json
{
  "code": 0,
  "message": "success",
  "data": {}
}
```

---

### 3. 補查訂單 /check_order_pay

**觸發時機**: FB 平台對 `order_pay` 未收到回應時，重試補查

#### FB → 本系統 Request Body
```json
{
  "transactionId": "TXN-20231101-001",
  "userId": "FB_USER_123",
  "merchantId": "MERCHANT_001",
  "merchantUserId": "FB_ACCOUNT_123",
  "businessId": "ORDER-20231101-001",
  "transactionType": "OUT",
  "transferType": "BET",
  "currencyId": 1,
  "amount": 10.00,
  "status": 1
}
```

#### 處理流程
```
1. 參數校驗
2. Redis 鎖 businessId
3. 查 fbAccountMapping + agentData
4. 維護檢查
5. _checkOrderRecord 比對狀態:
   │
   ├── [無訂單 + 錢包成功] MISS_ORDER_RECORD
   │     → 補建 orderRecord
   │     → 返回成功
   │
   ├── [有訂單 + 錢包成功] NO_MISS_RECORD
   │     → 直接返回成功（idempotent）
   │
   ├── [有訂單 + 錢包失敗] MISS_CASH_ORDER_RECORD
   │     → 返回失敗
   │
   └── [無訂單 + 錢包失敗] MISS_ALL_ORDER_RECORD
         → 返回失敗
6. Redis Unlock
```

#### _checkOrderRecord 查詢邏輯

```javascript
// 查 fb.orderRecord 確認訂單記錄
const [orderData] = await fbDao.readOrderRecord(businessId, 'BET');

// 查 wallet/getOrderStatus 確認錢包狀態
const pCheckOrder = await playerCheckOrder({
    account, orderId, walletType, type,
    isFBSport: true
});
const isWalletSuccess = (code === 0 && pCheckOrder.status === 1);
```

---

### 4. 批量流水同步 /sync_transaction

**觸發時機**: FB 平台批量推送交易記錄（可包含多種 transferType）

#### FB → 本系統 Request Body（Array）
```json
[
  {
    "transactionId": "TXN-20231101-001",
    "userId": "FB_USER_123",
    "merchantId": "MERCHANT_001",
    "merchantUserId": "FB_ACCOUNT_123",
    "businessId": "ORDER-20231101-001",
    "transactionType": "IN",
    "transferType": "WIN",
    "currencyId": 1,
    "amount": 15.00,
    "status": 1,
    "relatedId": null
  },
  { ... }
]
```

| 欄位 | 說明 |
|-----|------|
| `transactionId` | 唯一流水 ID |
| `businessId` | 對應 order_pay 的 businessId（同一場比賽的所有交易共用）|
| `transactionType` | OUT=轉出(扣款) / IN=轉入(加款) |
| `transferType` | 見 transferType 對照表 |
| `amount` | 金額（自動取絕對值）|
| `status` | 1=成功; 0=取消（BET status=0 自動轉為 BET/CANCEL_RETURN）|

#### 批量處理邏輯

```
for each transaction:
  1. 驗證參數
  2. BET + status=0 → 轉換為 BET/CANCEL_RETURN
  3. Redis 鎖 businessId
  4. 查 fbAccountMapping（有快取 tmpFbAccountMapping，同批次不重複查 DB）
  5. 查代理資料
  6. transactionFunc（同 order_pay 邏輯）
  7. Redis Unlock

返回:
{
  "code": 0（全成功）或 1（全失敗）,
  "data": [ { "transactionId": "失敗的流水ID" }, ... ]
}
```

#### 各 transferType 對應的 wallet 操作

| transferType | wallet 端點 | 說明 |
|-------------|-----------|------|
| BET, IN | `/player/credit` | 扣款（下注/轉入）|
| WIN, OUT, REFUND, CASHOUT, CANCEL_RETURN, CASHOUT_CANCEL_RETURN, CASHOUT_CANCEL_ROLLBACK_RETURN | `/player/deposit` | 加款（派彩/退款）|
| BET/CANCEL_RETURN | `/player/cancelBet` | 取消下注返還 |
| CANCEL_DEDUCT, CASHOUT_CANCEL_DEDUCT, CASHOUT_CANCEL_ROLLBACK_DEDUCT, SETTLEMENT_ROLLBACK_DEDUCT | `/player/rollback` | 回滾（補扣）|

---

### 5. 注單數據推送 /sync_orders

**觸發時機**: FB 平台推送注單詳細資料（下注後、結算後、狀態更新時均會推送）

#### FB → 本系統 Request Body
```json
{
  "id": "ORDER-20231101-001",
  "userId": "FB_USER_123",
  "merchantId": "MERCHANT_001",
  "merchantUserId": "FB_ACCOUNT_123",
  "currency": 1,
  "exchangeRate": "1.0000",
  "seriesType": 0,
  "betType": "SINGLE",
  "allUp": 1,
  "allUpAlive": 1,
  "stakeAmount": "10.00",
  "settleAmount": "15.00",
  "orderStatus": 5,
  "payStatus": 1,
  "oddsChange": 2,
  "device": "h5",
  "ip": "1.2.3.4",
  "settleTime": "1698800000000",
  "createTime": "1698799000000",
  "modifyTime": "1698800000000",
  "cancelTime": null,
  "itemCount": 1,
  "seriesValue": 1,
  "betNum": 1,
  "version": 3,
  "betList": [
    {
      "id": "BETITEM-001",
      "orderId": "ORDER-20231101-001",
      "sportId": 1,
      "matchId": "MATCH-12345",
      "matchName": "Manchester United vs Arsenal",
      "period": 0,
      "marketId": "MKT-001",
      "marketType": 1,
      "optionType": 1,
      "optionName": "Manchester United",
      "marketName": "全場獨贏",
      "tournamentId": "TOURNAMENT-001",
      "tournamentName": "英格蘭超級聯賽",
      "odds": "2.50",
      "oddsFormat": 1,
      "betOdds": "2.50",
      "settleStatus": 2,
      "settleResult": 1,
      "isInplay": false,
      "p1": 0,
      "p2": 0,
      "p3": 0,
      "matchTime": "1698800000000"
    }
  ],
  "walletType": 2,
  "validSettleStakeAmount": "10.00",
  "cashOutTotalStake": null,
  "cashOutPayoutStake": null
}
```

#### 主要注單欄位說明

| 欄位 | 說明 |
|-----|------|
| `id` | 訂單 ID（主鍵，= businessId）|
| `seriesType` | 0=單關 1=串關 |
| `betType` | 投注類型（如 "SINGLE"）|
| `allUp` | 總關數 |
| `stakeAmount` | 投注額（本金）|
| `settleAmount` | 結算派獎金額 |
| `orderStatus` | 見 orderStatus 對照表 |
| `version` | 版本號，新版本覆蓋舊版本 |
| `betList` | 注單明細陣列 |
| `walletType` | FB 定義的錢包類型（本系統記錄用）|

#### orderStatus 對照

| 值 | 說明 |
|----|------|
| `0` | 創建 |
| `1` | 確認中 |
| `2` | 已拒絕 |
| `3` | 取消 |
| `4` | 已確認 |
| `5` | 已結算 ← **觸發寫入 gameRecord** |

#### betList 明細欄位說明

| 欄位 | 說明 |
|-----|------|
| `sportId` | 運動 ID（1=足球）|
| `matchId` | 比賽 ID |
| `period` | 階段 ID（0=全場）|
| `marketType` | 玩法類型 |
| `optionType` | 投注項類型 |
| `settleResult` | 結算結果（1=赢 2=輸 3=退款/平局 4=半贏 5=半輸 6=繼續）|
| `isInplay` | 是否滾球 |
| `odds` | 歐式賠率 |
| `extendedParameter` | 亞洲讓球線 |
| `extraInfo` | 當前比分（賽後補查）|

#### 處理流程
```
1. 參數校驗
2. 查 fbAccountMapping
3. 查代理
4. 查 gameRecordInfo（businessId 的幣種/語系）
5. 版本號控制: if (param.version < orderData.version) → 直接返回（已有更新版本）
6. 若訂單已結算但 DB 未更新結算時間:
   → 提取 betList 中的 matchId, period, marketType
   → 寫入 pendingMatches 等待補查賽果
7. 取幣種資料（中文名稱 + 匯率）
8. 寫入/更新 fb.orders（主訂單）
9. 寫入/更新 fb.betlist（注單明細，逐條）
10. 若 orderStatus=5（已結算）:
    → 查 fb.orderRecord（BET 記錄）取 takeScore
    → 若 takeScore 存在:
        createGameOrder → 寫入 KYSport2_gameRecord
    → 若 takeScore 不存在（交易流水未先到）:
        setFBResetOrder(orderId, data) → 存 Redis 等排程重試
```

---

### 6. 提前結算推送 /sync_cashout

**觸發時機**: 玩家發起提前結算（CashOut）時，FB 推送提前結算記錄

#### FB → 本系統 Request Body
```json
{
  "id": "CASHOUT-20231101-001",
  "orderId": "ORDER-20231101-001",
  "userId": "FB_USER_123",
  "merchantId": "MERCHANT_001",
  "merchantUserId": "FB_ACCOUNT_123",
  "walletType": 2,
  "currency": 1,
  "exchangeRate": 1.0000,
  "cashoutTime": "1698799500000",
  "betTime": "1698799000000",
  "cashOutStake": 10.00,
  "orderStatus": 4,
  "cashOutPayoutStake": 8.50,
  "acceptOddsChange": true,
  "seriesType": 0,
  "betType": "SINGLE",
  "orderStakeAmount": 10.00,
  "version": 1
}
```

#### 主要欄位說明

| 欄位 | 說明 |
|-----|------|
| `id` | 提前結算訂單 ID |
| `orderId` | 原始投注訂單 ID |
| `cashOutStake` | 提前結算本金 |
| `cashOutPayoutStake` | 提前結算派獎額 |
| `orderStatus` | 提前結算訂單狀態（0=創建 1=確認中 2=已拒絕 3=取消 4=已確認 5=已結算）|
| `acceptOddsChange` | 是否接受賠率變動 |

#### 處理邏輯
```
僅寫入 fb.cashOutRecord，不做金流操作
（金流由 sync_transaction 的 CASHOUT transferType 觸發）
```

---

### 7. 健康檢查 /health

FB 定期 ping 此端點確認服務可用：

```json
// Response
{
  "code": 0,
  "message": "",
  "data": {}
}
```

---

## 核心交易函數 transactionFunc 詳解

`transactionFunc` 是所有金流操作（order_pay / sync_transaction）的核心：

```
輸入: param（交易參數）, fbAccountMapping, agentData, ip, traceId

步驟:
1. orderType = transferType2orderType(walletType, transferType)
   e.g. walletType=2, BET → KYSPORT_SINGLEWALLET_BET (=47)

2. 查 fb.gameRecordInfo(businessId) 取幣種/語系
   → 若無記錄 → 返回失敗

3. 檢查是否已有 BET/CANCEL_RETURN 記錄
   → 若有 → 返回「此單已取消下注」

4. 若 transferType ≠ BET/CANCEL_RETURN
   → 檢查 transactionId 是否已在 orderRecord
   → 若已存在 → 直接返回成功（idempotent）

5. 特殊情況：BET/CANCEL_RETURN 但 orderRecord 為空
   → 只寫入 orderRecord，不做金流
   → 返回失敗（等 order_pay 先到）

6. WIN 狀態特殊檢查：最新 orderRecord 不能連續兩次 WIN
   → 防止重複派彩

7. 根據 transferType 選擇 wallet 操作:
   ┌─── BET/IN → playerCredit
   ├─── WIN/OUT/REFUND/CASHOUT/CANCEL_RETURN → playerDeposit（allowedDuplicateAward=true）
   ├─── BET/CANCEL_RETURN → playerCancelBet + 補查餘額
   └─── CANCEL_DEDUCT/CASHOUT_CANCEL_DEDUCT/* → playerRollback

8. wallet 操作失敗 → 返回對應錯誤碼
   INSUFFICIENT_BALANCE → code=9 (NotEnoughBalance)
   其他 → code=6 (InternalError)

9. 成功後:
   → 寫入 fb.orderRecord (takeScore = balance + goldAmount)
   → 寫入 game_api.orders (帳變記錄)
```

### takeScore 計算

```javascript
// 記錄帳變後的餘額（gold 單位）
orderRecordParam.takeScore = accAdd(balance, moneyToGold(moneyFormate(param.amount)));
// takeScore = 交易後餘額(gold) + 交易金額(gold)
// 即：交易前的餘額（用於之後生成 gameRecord 的 CurScore）
```

---

## walletType 對 wallet 呼叫的影響

### 下注（playerCredit / BET）

| walletType | 呼叫路徑 |
|-----------|--------|
| 0（一般）| wallet:credit → 本地帳變 |
| 2（單一）| wallet:credit → 代理帳變 → thirdParty:playerBet(s=2002) → 代理 sbUrl |

### 派彩（playerDeposit / WIN）

| walletType | 呼叫路徑 |
|-----------|--------|
| 0（一般）| wallet:deposit → 本地帳變 |
| 2（單一）| wallet:deposit → 代理帳變 → thirdParty:playerAward(s=2003) → 代理 sbUrl |

### 取消下注（playerCancelBet / BET/CANCEL_RETURN）

| walletType | 呼叫路徑 |
|-----------|--------|
| 0（一般）| wallet:cancelBet → 本地帳變 |
| 2（單一）| wallet:cancelBet → 代理帳變 → thirdParty:cancelBet(s=2005) → 代理 sbUrl |

### singleOrderFBType 傳遞路徑

```javascript
// fbService.js → wallet → thirdParty → singleWalletService
playerCreditParam.singleOrderFBType = param.transferType;  // e.g. "BET"
// singleWalletService 收到後:
sbParam.transferType = param.singleOrderFBType;  // 附加到代理 querystring
```

---

## 結算流程 (sync_orders 結算路徑)

當 `sync_orders` 中 `orderStatus=5` 時，觸發 **生成遊戲注單**：

```
sync_orders (orderStatus=5)
  │
  ▼
查 fb.orderRecord (BET 記錄) 取 takeScore
  │
  ├── takeScore 存在 → createGameOrder
  │       │
  │       ▼
  │   取 gameRecordInfo (幣種/語系)
  │   查 wallet 取當前餘額 playerQueryBalance
  │       │
  │       ▼
  │   計算損益:
  │   oriProfit = (settleAmount + cashOutPayoutStake) - stakeAmount
  │   CellScore = moneyToGold(validSettleStakeAmount)
  │   AllBet    = moneyToGold(stakeAmount)
  │   Profit    = moneyToGold(oriProfit)
  │   TakeScore = takeScore（下注時餘額，已在 orderRecord 存好）
  │       │
  │       ▼
  │   INSERT INTO detail_record.KYSport2_gameRecord
  │   INSERT INTO game_record.allGames_gameRecord
  │       │
  │       ▼
  │   更新 fb.orders.profitReportDate
  │   若日期不同 → 寫入 restatic 排程重新統計
  │
  └── takeScore 不存在（交易流水未先到達）
          → setFBResetOrder(orderId, data) 存 Redis
          → 等待 syncOrdersReport 排程重試
```

### KYSport2_gameRecord 欄位對照

| 欄位 | 值 |
|-----|---|
| `GameID` | 7470 |
| `KindID` | 7470 |
| `ServerID` | 7470 |
| `GameUserNO` | 訂單 ID (orderId) |
| `CellScore` | `moneyToGold(validSettleStakeAmount)`（有效結算投注額）|
| `AllBet` | `moneyToGold(stakeAmount)`（投注本金）|
| `Profit` | `moneyToGold(settleAmount + cashOutPayoutStake - stakeAmount)`（輸贏）|
| `TakeScore` | `orderRecord.takeScore`（下注前餘額 gold）|
| `GameStartTime` | `createTime`（下注時間）|
| `GameEndTime` | `settleTime`（結算時間）|
| `ChannelID` | 代理 ID |
| `LineCode` | 線路碼 |
| `currency` | 幣別 |
| `language` | 語系 |

---

## 定時任務

### 1. syncOrdersReport（排程間隔由 `.env` 的 `fbReportTimer` 設定）

```
執行條件: 有 Redis key 記錄待重試的結算注單
├── getAllFBResetOrder()
├── for each pending order:
│     查 fb.orderRecord 取 takeScore
│     若 takeScore 存在:
│       createGameOrder（生成 KYSport2_gameRecord）
│       delFBResetOrder（清除 Redis）
│     若不存在: 等下次排程
```

### 2. syncMissingMatchScores（每5分鐘）

```
執行條件: pendingMatches 表有待補查記錄

重試策略（使用左閉右開時間窗口避免邊界重疊）:
- retryCount=0: [now-5min, now)    首次處理
- retryCount=1: [now-10min, now-5min) 第一次重試
- retryCount=2: [now-30min, now-25min) 第二次重試
- retryCount=3: [now-180min, now-175min) 第三次重試（最後一次）

批次處理（每批 50 筆）:
1. 查 matchId → agent 對應關係
2. 依 agent 的 sportCashout 分組
3. 呼叫 FB MarketScore API 查賽果
4. 更新 fb.betlist.extraInfo（比分）
5. 成功 → retryCount=-1（標記完成）
6. 失敗 → retryCount+1（等下次重試）
```

---

## FB MarketScore API（賽果補查）

本系統主動呼叫 FB 的 API 補查比分：

### 請求格式

```
POST {fbURL}/fb/data/api/v2/marketScore/list
Headers:
  sign: MD5(JSON.stringify(body) + '.' + merchantId + '.' + timestamp + '.' + merchantApiSecret)
  timestamp: {Unix ms}
  merchantId: {merchantId}

Body (JSON):
{
  "scores": [
    { "marketType": 1, "matchId": 12345, "period": 0 },
    { "marketType": 1, "matchId": 12346, "period": 0 }
  ]
}
```

### 認證簽名計算

```javascript
const stringThatNeedsToBeSigned = JSON.stringify(body) + '.' + merchantId + '.' + timestamp + '.' + merchantApiSecret;
const sign = createHash('md5').update(stringThatNeedsToBeSigned).digest('hex');
```

### 渠道資訊

```sql
-- fb.channelInfo 表
SELECT * FROM fb.channelInfo WHERE sportCashout = ?
-- sportCashout: 0=一般渠道, 1=提前結算渠道
```

### 回應格式（推斷）

```json
{
  "code": 0,
  "data": [
    { "matchId": 12345, "marketType": 1, "period": 0, "score": "1-0" }
  ]
}
```

---

## 資料庫結構

### game_api DB

| 表名 | 說明 |
|-----|------|
| `fbAccountMapping` | FB帳號 ↔ YL帳號對應 |
| `orders` | game_api 帳變記錄（含 FB 交易）|

### fb DB（獨立 FB 資料庫）

| 表名 | 說明 |
|-----|------|
| `orderRecord` | 交易流水記錄（每筆 transactionId 一條）|
| `orders` | 訂單主表（每個 businessId 一條）|
| `betlist` | 注單明細（每個投注項一條）|
| `cashOutRecord` | 提前結算記錄 |
| `gameRecordInfo` | 每訂單的幣種/語系（為生成 gameRecord 用）|
| `pendingMatches` | 待補查賽果的比賽 |
| `channelInfo` | 體育渠道設定（merchantId, merchantApiSecret）|
| `restatic` | 待重新統計排程 |

### detail_record DB

| 表名 | 說明 |
|-----|------|
| `KYSport2_gameRecord` | FB 體育遊戲注單（結算後寫入）|

### game_record DB

| 表名 | 說明 |
|-----|------|
| `allGames_gameRecord` | 跨廠商全局注單記錄 |

### orderRecord 表結構（推斷）

```sql
CREATE TABLE fb.orderRecord (
    transactionId   VARCHAR(255),   -- 交易流水 ID（主鍵之一）
    agent           INT,            -- 代理 ID
    account         VARCHAR(255),   -- YL 帳號
    userId          VARCHAR(255),   -- FB 用戶 ID
    merchantId      VARCHAR(255),   -- 渠道 ID
    merchantUserId  VARCHAR(255),   -- FB 帳號
    businessId      VARCHAR(255),   -- 訂單 ID（外鍵）
    transactionType VARCHAR(10),    -- OUT/IN
    transferType    VARCHAR(50),    -- BET/WIN/REFUND 等
    currencyId      INT,
    amount          DECIMAL(16,4),
    status          INT,
    relatedId       VARCHAR(255),
    orderPayParam   TEXT,
    rowCreateTime   DATETIME,
    takeScore       BIGINT,         -- 帳變後餘額+金額（下注前餘額，用於 gameRecord）
    PRIMARY KEY (transactionId)
);
```

---

## 錯誤碼對照表

### FB 回調回應碼（fbErrorCode.js）

| code | 說明 |
|-----|------|
| `0` | success |
| `1` | fail |
| `6` | system error (InternalError) |
| `9` | channel user balance not enough (NotEnoughBalance) |
| `12` | Game Maint |

### 詳細錯誤情境對照

| 情境 | code | message |
|-----|------|---------|
| 成功 | 0 | success |
| 參數驗證失敗 | 6 | 参数验证失败 |
| 查無 FB 帳號 | 6 | 查无此帐号 |
| 查無代理 | 6 | 查无此代理 |
| 系統維護中 | 12 | 游戏维护中 |
| 未取得玩家登入資訊 | 1 | 未取得玩家登入资讯 |
| 餘額不足 | 9 | channel user balance not enough |
| 未取得此單資訊（gameRecordInfo）| 1 | 未取得此单资讯 |
| 此單已取消下注 | 1 | 此单已取消下注 |
| 此單最新狀態為已結算，不得再次結算 | 1 | 此单最新状态为已结算，不得再次结算 |
| 訂單執行中（Redis 鎖中）| 6 | 订单执行中 |

---

## walletHistoryType 體育類型完整對照

### 一般錢包（walletType=0）

| 代碼 | 值 | transferType |
|-----|---|------------|
| KYSPORT_IN | 27 | IN |
| KYSPORT_OUT | 28 | OUT |
| KYSPORT_BET | 29 | BET |
| KYSPORT_WIN | 30 | WIN |
| KYSPORT_REFUND | 31 | REFUND |
| KYSPORT_CASHOUT | 32 | CASHOUT |
| KYSPORT_CANCEL_DEDUCT | 33 | CANCEL_DEDUCT |
| KYSPORT_CANCEL_RETURN | 34 | CANCEL_RETURN |
| KYSPORT_SETTLEMENT_ROLLBACK_DEDUCT | 35 | SETTLEMENT_ROLLBACK_DEDUCT |
| KYSPORT_CASHOUT_CANCEL_DEDUCT | 36 | CASHOUT_CANCEL_DEDUCT |
| KYSPORT_CASHOUT_CANCEL_RETURN | 37 | CASHOUT_CANCEL_RETURN |
| KYSPORT_CASHOUT_CANCEL_ROLLBACK_DEDUCT | 38 | CASHOUT_CANCEL_ROLLBACK_DEDUCT |
| KYSPORT_CASHOUT_CANCEL_ROLLBACK_RETURN | 39 | CASHOUT_CANCEL_ROLLBACK_RETURN |
| KYSPORT_RESERVE_BET | 40 | RESERVE_BET |
| KYSPORT_BET/CANCEL_RETURN | 44 | BET/CANCEL_RETURN |

### 單一錢包（walletType=2）

| 代碼 | 值 | transferType |
|-----|---|------------|
| KYSPORT_SINGLEWALLET_IN | 45 | IN |
| KYSPORT_SINGLEWALLET_OUT | 46 | OUT |
| KYSPORT_SINGLEWALLET_BET | 47 | BET |
| KYSPORT_SINGLEWALLET_WIN | 48 | WIN |
| KYSPORT_SINGLEWALLET_REFUND | 49 | REFUND |
| KYSPORT_SINGLEWALLET_CASHOUT | 50 | CASHOUT |
| KYSPORT_SINGLEWALLET_CANCEL_DEDUCT | 51 | CANCEL_DEDUCT |
| KYSPORT_SINGLEWALLET_CANCEL_RETURN | 52 | CANCEL_RETURN |
| KYSPORT_SINGLEWALLET_SETTLEMENT_ROLLBACK_DEDUCT | 53 | SETTLEMENT_ROLLBACK_DEDUCT |
| KYSPORT_SINGLEWALLET_CASHOUT_CANCEL_DEDUCT | 54 | CASHOUT_CANCEL_DEDUCT |
| KYSPORT_SINGLEWALLET_CASHOUT_CANCEL_RETURN | 55 | CASHOUT_CANCEL_RETURN |
| KYSPORT_SINGLEWALLET_CASHOUT_CANCEL_ROLLBACK_DEDUCT | 56 | CASHOUT_CANCEL_ROLLBACK_DEDUCT |
| KYSPORT_SINGLEWALLET_CASHOUT_CANCEL_ROLLBACK_RETURN | 57 | CASHOUT_CANCEL_ROLLBACK_RETURN |
| KYSPORT_SINGLEWALLET_BET/CANCEL_RETURN | 62 | BET/CANCEL_RETURN |

---

## 单一钱包 vs 一般錢包在 FB Sport 的差異

| 比較項目 | walletType=0（一般）| walletType=2（單一）|
|---------|------------------|------------------|
| 玩家餘額位置 | 本系統 DB | 代理端 |
| wallet 帳變 | 本地 player_wallets | 本地代理帳變 + 代理 sbUrl |
| 通知代理 | 無 | AES+MD5 加密 GET → 代理 sbUrl |
| 單一錢包 action s 值 | — | BET=2002, WIN=2003, ORDER=2004, CANCEL=2005 |
| walletHistoryType 前綴 | `KYSPORT_` | `KYSPORT_SINGLEWALLET_` |
| 失敗回滾 | wallet 自行回滾 | wallet + thirdParty 雙重回滾 |
| BET/CANCEL_RETURN 特殊處理 | playerCancelBet | playerCancelBet → 補查餘額（因 cancelBet 不返回 money）|

### BET/CANCEL_RETURN 特殊處理（單一錢包）

```javascript
// fbService.js
case 'BET/CANCEL_RETURN': {
    transactionResult = await playerCancelBet({...});

    // playerCancelBet 不返回 money，需額外查詢
    const playerBalanceResult = await playerQueryBalance({...});
    transactionResult.money = playerBalanceResult.money;
    break;
}
```

---

## FB 幣種 ID 對照表

| currencyId | 幣種 |
|-----------|------|
| 1 | CNY |
| 2 | USD |
| 3 | EUR |
| 6 | TWD |
| 7 | MYR |
| 9 | THB |
| 10 | VND |
| 13 | PHP |
| 14 | IDR |
| 200 | USDT |
| 201 | BTC |
| 209 | USDC |
| 1000 | VNDK |
| 1001 | IDRK |
（完整列表見 fbModel.js currencyIdEnum，共 35 種）

---

## 缺失資訊

1. **kysport frontend 源碼未讀取** — 玩家進入 FB 後，前端與 FB 平台的認證流程（如何使用 kysportToken 建立 session）未確認
2. **`agentData.fbStatus` 欄位來源** — 代理的 FB 功能開關欄位，但代理資料的完整結構（Redis 中的 agentData 格式）未讀取
3. **`agentData.sportCashout`** — 是否支援提前結算的代理設定，影響 MarketScore API 渠道選擇
4. **fb.channelInfo 的 merchantId/merchantApiSecret 管理** — 誰維護這個配置、如何更新
5. **`agentData.fbPromo`** — 控制 FB 前端是否顯示活動的設定，但來源不明
6. **JWT 簽名密鑰**（`issueKySportJwt`）— 簽名密鑰和算法未確認
7. **訂單推送時序保證** — `order_pay` 和 `sync_orders` 哪個先到達是不確定的，依賴排程補單機制，若 Redis 清空則 pending order 遺失
8. **`fbRecordSql`**（`fb.restatic` 連線）與 `fbSql`（`fb`庫）的物理分離情況 — 是否是同一 MySQL 實例的不同 DB
9. **pending order 遺失風險** — Redis 重啟後 `fbResetOrder` 數據遺失，對應注單永遠不會寫入 `KYSport2_gameRecord`（無持久化保護）
