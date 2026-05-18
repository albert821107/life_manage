# 單一錢包（walletType=2）完整行為分析
## Single Wallet (walletType=2) Comprehensive Analysis

---

## 目錄 Table of Contents

1. [執行摘要](#執行摘要)
2. [架構概覽](#架構概覽)
3. [錢包類型對照](#錢包類型對照)
4. [服務端點清單](#服務端點清單)
5. [AES+MD5 加密機制詳解](#aesmd5-加密機制詳解)
6. [金額單位換算規則](#金額單位換算規則)
7. [五大核心操作詳細資料格式](#五大核心操作詳細資料格式)
   - [1. 查詢餘額 queryBalance (s=1001)](#1-查詢餘額-querybalance-s1001)
   - [2. 玩家下注 playerBet (s=1002)](#2-玩家下注-playerbet-s1002)
   - [3. 玩家派獎 playerAward (s=1003)](#3-玩家派獎-playeraward-s1003)
   - [4. 查詢訂單狀態 getOrderStatus (s=1004)](#4-查詢訂單狀態-getorderstatus-s1004)
   - [5. 取消下注 cancelBet (s=1005)](#5-取消下注-cancelbet-s1005)
8. [FB Sport 特殊分支 (s=2002~2005)](#fb-sport-特殊分支-s20022005)
9. [XinStars 特殊分支](#xinstars-特殊分支)
10. [下注完整資料流程 (wallet:credit)](#下注完整資料流程-walletcredit)
11. [派獎完整資料流程 (wallet:deposit)](#派獎完整資料流程-walletdeposit)
12. [取消下注完整資料流程 (wallet:cancelBet)](#取消下注完整資料流程-walletcancelbet)
13. [查詢餘額完整資料流程 (wallet:queryBalance)](#查詢餘額完整資料流程-walletquerybalance)
14. [查詢訂單完整資料流程 (wallet:getOrderStatus)](#查詢訂單完整資料流程-walletgetorderstatus)
15. [錯誤碼對照表](#錯誤碼對照表)
16. [資料庫結構 (single_orders)](#資料庫結構-single_orders)
17. [失敗追蹤機制](#失敗追蹤機制)
18. [離線通知 (userLogout / notifyBurst)](#離線通知-userlogout--notifyburst)
19. [回滾機制](#回滾機制)
20. [與內轉錢包 (walletType=1) 的差異對照](#與內轉錢包-wallettype1-的差異對照)
21. [缺失資訊](#缺失資訊)

---

## 執行摘要

單一錢包（`walletType=2`）是一種**玩家餘額由代理端（外部系統）持有**的錢包模式。本系統不儲存玩家餘額，而是在每次金融操作（下注/派獎）時，透過 AES+MD5 加密的 HTTP GET 請求通知代理端進行帳變，由代理端實際管理玩家金額。

**核心架構**：
```
game_server → wallet server (2100) → thirdParty server (10010) → 代理 sbUrl（外部）
```

**關鍵特性**：
- 玩家金額儲存在**代理端**，非本系統
- 每次操作需即時呼叫代理 API（sbUrl）
- 請求使用 **AES 加密 + MD5 簽名**保護
- 有完整的**重複訂單防護**（Redis 鎖 + DB 查詢）
- 有**回滾機制**（代理 API 失敗時還原代理帳變）
- 有**失敗追蹤表** `tracking_single_fail_order`
- **XinStars** 代理使用完全不同的 POST JSON 協議
- **FB Sport** 使用不同的 action 代碼（2002~2005）

---

## 架構概覽

```
                  ┌──────────────────────────────────────────────┐
                  │           game_server（未知）                 │
                  │  下注/派獎/查詢 → HTTP POST → wallet:2100    │
                  └────────────────────┬─────────────────────────┘
                                       │ HTTP POST
                                       │ body: {walletType:2, orderId, agent, account,
                                       │         currency, money(gold), ...}
                                       ▼
                  ┌──────────────────────────────────────────────┐
                  │           wallet server (port 2100)           │
                  │                                              │
                  │  ① Redis 鎖（防重複並發）                    │
                  │  ② DB 查重複訂單                            │
                  │  ③ 代理帳變（agentService.credit/deposit）   │
                  │  ④ 呼叫 thirdParty server                   │
                  │  ⑤ 失敗回滾 + 記錄                         │
                  └────────────────────┬─────────────────────────┘
                                       │ HTTP POST (內部呼叫)
                                       ▼
                  ┌──────────────────────────────────────────────┐
                  │        thirdParty server (port 10010)         │
                  │                                              │
                  │  ① Redis 取代理資訊 (sbUrl, aesKey, md5Key) │
                  │  ② AES 加密參數                             │
                  │  ③ 計算 MD5 簽名                           │
                  │  ④ HTTP GET 請求代理 sbUrl                  │
                  └────────────────────┬─────────────────────────┘
                                       │ HTTP GET (外部呼叫, 60s timeout)
                                       │ ?agent=X&timestamp=X&param=AES(data)&key=MD5
                                       ▼
                  ┌──────────────────────────────────────────────┐
                  │         代理 sbUrl（外部系統）                │
                  │  解密 AES 參數 → 執行帳變 → 返回餘額         │
                  └──────────────────────────────────────────────┘
```

---

## 錢包類型對照

| walletType | 名稱 | 玩家餘額位置 | 通知代理 URL | 說明 |
|-----------|------|------------|------------|------|
| `0` | 一般錢包 | 本系統 DB | 無需通知代理 | 本系統自管帳變 |
| `1` | 內轉錢包 (freeTransfer) | 本系統 DB | `rechargeUrl` | 先本系統帳變，再通知代理 |
| `2` | 單一錢包 (singleWallet) | 代理端 | `sbUrl` | 直接通知代理帳變，代理持有餘額 |

---

## 服務端點清單

### thirdParty server (port 10010) — 單一錢包相關端點

| HTTP 方法 | 路徑 | Controller 方法 | 說明 |
|---------|------|----------------|------|
| POST | `/queryBalance` | `singleWallet.queryBalance` | 查詢玩家在代理端餘額 |
| POST | `/playerBet` | `singleWallet.playerBet` | 玩家下注通知代理 |
| POST | `/playerAward` | `singleWallet.playerAward` | 玩家派獎通知代理 |
| POST | `/getOrderStatus` | `singleWallet.getOrderStatus` | 查詢代理端訂單狀態 |
| POST | `/cancelBet` | `singleWallet.cancelBet` | 取消下注通知代理 |
| POST | `/userLogout` | `offlineNotify.userLogout` | 玩家下線通知代理 |
| POST | `/notify/burst` | `offlineNotify.notifyBurst` | 玩家爆獎通知代理 |

> **注意**: 上述端點皆為 game_server 或 wallet server 的**內部呼叫**，非直接對外暴露（依 Nginx 路由配置而定）。

### wallet server (port 2100) — walletType=2 相關端點

| HTTP 方法 | 路徑 | Controller 方法 | walletType=2 行為 |
|---------|------|----------------|-----------------|
| POST | `/player/queryBalance` | `player.queryBalance` | → singleWalletQueryBalance |
| POST | `/player/deposit` | `player.deposit` | → 代理帳變 + singleWalletPlayerAward |
| POST | `/player/credit` | `player.credit` | → 代理帳變 + singleWalletPlayerBet |
| POST | `/player/getOrderStatus` | `player.getOrderStatus` | → DB查詢 + singleWalletGetOrderStatus |
| POST | `/player/cancelBet` | `player.cancelBet` | → 代理帳變 + singleWalletCancelBet |
| POST | `/player/rollback` | `player.rollback` | → 與 credit 相同流程（重送下注） |

---

## AES+MD5 加密機制詳解

### 加密流程 (getEncodeSbUrl)

```
輸入: agentInfo = { id, sbUrl, aesKey, md5Key }
      params = { s: 1001, account: 'player001', currency: 'CNY', ... }

Step 1: 序列化參數為 querystring
  qsParam = qs.stringify(params)
  例: "s=1001&account=player001&currency=CNY"

Step 2: AES 加密 (utils.desEncode)
  encryptedParam = AES(aesKey, qsParam)
  注: 實際使用 DES-ECB 模式（由 utils.desEncode 實現）

Step 3: 計算 MD5 簽名
  timestamp = moment().utcOffset(8).unix() * 1000  // UTC+8 Unix毫秒
  key = md5( agent + timestamp + md5Key )
  例: md5("70000" + "1700000000000" + "md5secret")

Step 4: 組合 URL
  url = sbUrl + "?" + qs.stringify({
      agent: agentInfo.id.toString(),
      timestamp: timestamp,
      param: encryptedParam,
      key: key
  })

最終 URL 範例:
  https://agent-api.example.com/wallet?agent=70000&timestamp=1700000000000&param=AES_ENCRYPTED_DATA&key=MD5_HASH
```

### 加密金鑰來源

```javascript
// 從 Redis 取代理資訊
const agentInfo = await redisDao.getAgents(agent);
// agentInfo = {
//   id: 70000,            // 代理 ID
//   sbUrl: 'https://...', // 單一錢包回調 URL
//   aesKey: 'xxxxx',      // AES 加密金鑰（每個代理不同）
//   md5Key: 'xxxxx',      // MD5 簽名金鑰（每個代理不同）
//   rechargeUrl: '...',   // 內轉錢包用（walletType=1）
//   offlineBackUrl: '...', // 下線通知用
//   currency: 'CNY',
//   lineCodes: [...],
// }
```

### 代理端解密步驟（推斷）

代理端接收請求後需：
1. 以 `md5Key` 驗證 `key = md5(agent + timestamp + md5Key)` 是否正確
2. 以 `aesKey` 解密 `param` 得到原始 querystring
3. 解析 querystring，依 `s` 參數判斷操作類型
4. 執行帳變邏輯，返回 JSON `{ d: { code: 0, money: 100.00 } }`

### 請求超時設定

```javascript
const [error, result] = await safeAwait(requestAsync({ url, timeout: 60000 }));
// 固定 60 秒超時，無重試機制
// 超時直接記錄 tracking_single_fail_order
```

---

## 金額單位換算規則

系統內部有兩種金額單位：

| 單位 | 說明 | 使用位置 |
|-----|------|---------|
| **gold（遊戲分）** | 整數，1 gold = 0.01 money（百分之一）| game_server ↔ wallet server 傳遞 |
| **money（元）** | 浮點數，代理端使用的真實金額 | wallet server ↔ 代理 sbUrl 傳遞 |

```javascript
// Gold → Money 轉換（傳給代理前）
const money = utils.goldToMoney(gold);
// 例: gold=10000 → money=100.00

// Money → Gold 轉換（代理返回後）
result.money = utils.moneyToGold(callAgentResult.money);
// 例: money=100.00 → gold=10000

// 多幣種換算（考慮匯率）
const goldByAgentOpenCurrency = utils.goldMutiCurrency(gold, exchange);
// exchange 從 exchangeService.getExchange(currency) 取得
```

---

## 五大核心操作詳細資料格式

### 操作代碼對照

| 操作 | 一般遊戲 s 值 | FB Sport s 值 | 說明 |
|-----|------------|-------------|------|
| GET_BALANCE | 1001 | — | 查詢餘額 |
| PLAYER_BET | 1002 | 2002 | 玩家下注 |
| PLAYER_AWARD | 1003 | 2003 | 玩家派獎 |
| GET_ORDER_STATUS | 1004 | 2004 | 查詢訂單 |
| CANCEL_BET | 1005 | 2005 | 取消下注 |

---

### 1. 查詢餘額 queryBalance (s=1001)

#### 呼叫來源
```
game_server → wallet:2100 /player/queryBalance
wallet:2100 → thirdParty:10010 /queryBalance
thirdParty:10010 → 代理 sbUrl (GET)
```

#### wallet server 接收參數 (from game_server)
```json
{
  "walletType": 2,
  "agent": "70000",
  "account": "70000_player001",
  "currency": "CNY",
  "trace_id": "uuid-xxx"
}
```

#### thirdParty server 接收參數 (from wallet server)
```json
{
  "agent": "70000",
  "account": "70000_player001",
  "currency": "CNY",
  "trace_id": "uuid-xxx"
}
```

#### 傳給代理 sbUrl 的原始 querystring（加密前）
```
s=1001&account=player001&currency=CNY
```
> 注意：`account` 已透過 `handleParams()` 移除代理前綴 `{agent}_`

#### 代理 sbUrl GET 請求 URL
```
https://agent.example.com/wallet?
  agent=70000&
  timestamp=1700000000000&
  param=AES_ENCRYPTED(s%3D1001%26account%3Dplayer001%26currency%3DCNY)&
  key=MD5(70000+1700000000000+md5Key)
```

#### 代理返回格式（期望）
```json
{
  "d": {
    "code": 0,
    "money": 100.00
  }
}
```

#### wallet server 回 game_server 格式
```json
{
  "code": 0,
  "money": 10000
}
```
> `money` 已從 100.00 轉換為 gold（10000 分），`moneyToGold` 換算

---

### 2. 玩家下注 playerBet (s=1002)

#### 呼叫來源
```
game_server → wallet:2100 /player/credit
wallet:2100 → agentService.credit (本地代理帳變，先下分)
wallet:2100 → thirdParty:10010 /playerBet
thirdParty:10010 → 代理 sbUrl (GET)
```

#### wallet server 接收參數 (from game_server)
```json
{
  "walletType": 2,
  "orderId": "order-20231101-001",
  "agent": "70000",
  "account": "70000_player001",
  "currency": "CNY",
  "money": 1000,
  "x_real_ip": "1.2.3.4",
  "gameNo": "20231101001",
  "gameId": 101,
  "roomMode": 1,
  "isFBSport": false,
  "singleOrderFBType": null,
  "trace_id": "uuid-xxx"
}
```

#### 傳給代理 sbUrl 的原始 querystring（加密前）
```
s=1002&account=player001&orderId=order-20231101-001&gameNo=20231101001&kindId=101&money=10.00&currency=CNY&gameId=20231101001&roomMode=1
```

| 欄位 | 說明 | 值示例 |
|-----|------|-------|
| `s` | 操作類型 | `1002` |
| `account` | 玩家帳號（無代理前綴）| `player001` |
| `orderId` | 訂單號（唯一） | `order-20231101-001` |
| `gameNo` | 局號 | `20231101001` |
| `kindId` | 遊戲 ID | `101` |
| `money` | 下注金額（money 單位，元）| `10.00` |
| `currency` | 幣別 | `CNY` |
| `gameId` | 同 gameNo（重複傳入）| `20231101001` |
| `roomMode` | 遊戲模式 1=匹配場 2=百人場 3=單人場 4=捕魚 | `1` |

#### 代理返回格式（期望）
```json
{
  "d": {
    "code": 0,
    "money": 90.00
  }
}
```
> `money` 為扣款後代理端剩餘餘額

#### wallet server 回 game_server 格式
```json
{
  "code": 0,
  "account": "70000_player001",
  "money": 9000,
  "msg": "成功"
}
```

---

### 3. 玩家派獎 playerAward (s=1003)

#### 呼叫來源
```
game_server → wallet:2100 /player/deposit
wallet:2100 → agentService.deposit (本地代理帳變，先上分)
wallet:2100 → thirdParty:10010 /playerAward
thirdParty:10010 → 代理 sbUrl (GET)
```

#### wallet server 接收參數 (from game_server)
```json
{
  "walletType": 2,
  "orderId": "order-20231101-001-award",
  "agent": "70000",
  "account": "70000_player001",
  "currency": "CNY",
  "money": 1500,
  "totalBet": 1000,
  "validBet": 1000,
  "totalWithdraw": 500,
  "revenue": 50,
  "betCount": 1,
  "gameNo": "20231101001",
  "gameId": 101,
  "roomMode": 1,
  "actionType": 0,
  "lineCode": "",
  "isFBSport": false,
  "singleOrderFBType": null,
  "x_real_ip": "1.2.3.4",
  "trace_id": "uuid-xxx"
}
```

#### 傳給代理 sbUrl 的原始 querystring（加密前）
```
s=1003&account=player001&orderId=order-20231101-001-award&gameNo=20231101001&kindId=101&money=15.00&currency=CNY&gameId=20231101001&roomMode=1&betCount=1&totalBet=10.00&validBet=10.00&totalWithdraw=5.00&revenue=0.50&lineCode=
```

| 欄位 | 說明 | 值示例 |
|-----|------|-------|
| `s` | 操作類型 | `1003` |
| `account` | 玩家帳號（無代理前綴）| `player001` |
| `orderId` | 訂單號 | `order-20231101-001-award` |
| `gameNo` | 局號 | `20231101001` |
| `kindId` | 遊戲 ID | `101` |
| `money` | 派獎金額（money 單位，元）| `15.00` |
| `currency` | 幣別 | `CNY` |
| `gameId` | 同 gameNo | `20231101001` |
| `roomMode` | 遊戲模式 0=活動 1=匹配場... | `1` |
| `betCount` | 投注成功總筆數 | `1` |
| `totalBet` | 下注金額（元）| `10.00` |
| `validBet` | 有效投注（元）| `10.00` |
| `totalWithdraw` | 遊戲輸贏金額（元）| `5.00` |
| `revenue` | 抽水金額（元）| `0.50` |
| `lineCode` | 線路碼（可為空）| `""` |

#### 代理返回格式（期望）
```json
{
  "d": {
    "code": 0,
    "money": 105.00
  }
}
```
> `money` 為派獎後代理端剩餘餘額

#### wallet server 回 game_server 格式
```json
{
  "code": 0,
  "account": "70000_player001",
  "money": 10500,
  "msg": "成功"
}
```

#### 特殊情況：actionType=4（贏分補發）
當 `actionType=4` 時，即使代理返回成功，也會記錄 `tracking_single_fail_order`，用於追蹤補發記錄。

---

### 4. 查詢訂單狀態 getOrderStatus (s=1004)

#### 呼叫來源
```
game_server → wallet:2100 /player/getOrderStatus
wallet:2100 → 本地 DB 查詢 single_orders
  → 若已成功 → 直接返回
  → 若未成功 → thirdParty:10010 /getOrderStatus
                thirdParty:10010 → 代理 sbUrl (GET)
```

#### wallet server 接收參數 (from game_server)
```json
{
  "walletType": 2,
  "orderId": "order-20231101-001",
  "agent": "70000",
  "account": "70000_player001",
  "gameNo": "20231101001",
  "gameId": 101,
  "walletLog": "{\"gameInfo\":{\"betInfos\":{\"gameNo\":\"20231101001\",\"gameId\":101}}}",
  "trace_id": "uuid-xxx"
}
```

#### 傳給代理 sbUrl 的原始 querystring（加密前）
```
s=1004&orderId=order-20231101-001&account=player001&gameNo=20231101001&kindId=101
```

| 欄位 | 說明 |
|-----|------|
| `s` | `1004` |
| `orderId` | 要查詢的訂單號 |
| `account` | 玩家帳號（無代理前綴）|
| `gameNo` | 局號（從 walletLog JSON 解析）|
| `kindId` | 遊戲 ID（從 walletLog JSON 解析）|

#### 代理返回格式（期望）
```json
{
  "d": {
    "code": 0,
    "status": 1
  }
}
```

| status 值 | 說明 |
|---------|------|
| `1` | 訂單成功 |
| 其他 | 其他狀態（失敗/處理中）|
| `4` | 查無訂單（本地 DB 沒有資料時返回）|

#### wallet server 回 game_server 格式（本地 DB 成功）
```json
{
  "code": 0,
  "status": 1
}
```

#### wallet server 回 game_server 格式（查無訂單）
```json
{
  "code": 0,
  "status": 4
}
```

---

### 5. 取消下注 cancelBet (s=1005)

#### 呼叫來源
```
game_server → wallet:2100 /player/cancelBet
wallet:2100 → 查詢原始訂單是否成功
  → 若已有成功取消記錄 → 直接返回成功
  → 若原始訂單成功 → agentService.deposit（退款到代理）
wallet:2100 → thirdParty:10010 /cancelBet
thirdParty:10010 → 代理 sbUrl (GET)
```

#### wallet server 接收參數 (from game_server)
```json
{
  "walletType": 2,
  "orderId": "order-20231101-001",
  "agent": "70000",
  "account": "70000_player001",
  "currency": "CNY",
  "money": 1000,
  "gameNo": "20231101001",
  "gameId": 101,
  "isFBSport": false,
  "singleOrderFBType": null,
  "x_real_ip": "1.2.3.4",
  "actionType": 3,
  "trace_id": "uuid-xxx"
}
```

#### 取消訂單 ID 生成規則
```javascript
const random = Math.random().toString(36).substring(2, 7); // 5位隨機字串
const newOrderId = orderId + '_' + random;
// 例: "order-20231101-001_abc12"
```

#### 傳給代理 sbUrl 的原始 querystring（加密前）
```
s=1005&account=player001&orderId=order-20231101-001&gameNo=20231101001&kindId=101&money=10.00&currency=CNY&gameId=20231101001
```

#### 代理返回格式（期望）
```json
{
  "d": {
    "code": 0,
    "status": 1
  }
}
```

#### wallet server 回 game_server 格式
```json
{
  "code": 0,
  "status": 1,
  "msg": "成功"
}
```

---

## FB Sport 特殊分支 (s=2002~2005)

當 `param.isFBSport == true` 時，action 代碼切換為 FB Sport 版本，並附加 `transferType` 欄位。

### FB Sport 觸發條件
```javascript
// singleWalletService.js
const isFBSport = param.isFBSport || false;
const sbParam = {
    s: isFBSport ? SINGLEWALLET_ACTION.PLAYER_BET_FB_SPORT : SINGLEWALLET_ACTION.PLAYER_BET,
    // ...
};
if (isFBSport) {
    sbParam.transferType = param.singleOrderFBType;
}
```

### FB Sport 操作代碼對照

| 操作 | 標準代碼 | FB Sport 代碼 |
|-----|--------|------------|
| playerBet | 1002 | 2002 |
| playerAward | 1003 | 2003 |
| getOrderStatus | 1004 | 2004 |
| cancelBet | 1005 | 2005 |

### FB Sport 額外欄位（querystring 加密前）
```
s=2002&...&transferType=1
```

| `singleOrderFBType` 值 | 說明（推斷）|
|---------------------|----------|
| `1` | 一般投注 |
| `2` | 結算 |
| 其他 | 視代理端定義 |

### DB 訂單類型映射 (wallet/controller/player.js)
```javascript
// FB Sport 特殊 type 轉換
function _switchSingleOrderTypeForFB ({ isFBSport, singleOrderFBType, type }) {
    return isFBSport ? SINGLE_ORDERS.FB_TYPE_MAPPING[singleOrderFBType] : type;
}
```
> `SINGLE_ORDERS.FB_TYPE_MAPPING` 的完整映射需參考 `api_config/single_orders.js`（本次未讀取）

---

## XinStars 特殊分支

XinStars 代理使用**完全不同的通訊協議**，識別方式為代理 ID 比對 `.env` 中的 `XINSTARS_AGENT`。

### 觸發條件 (singleWallet.js controller)
```javascript
if (param.agent == process.env.XINSTARS_AGENT) {
    // 使用 XinStars 特殊方法
    const resObj = await singleWalletService.queryBalanceXinStars(param);
} else {
    // 使用標準方法
    const resObj = await singleWalletService.queryBalance(param);
}
```

### 協議對比

| 項目 | 標準協議 | XinStars 協議 |
|-----|--------|-------------|
| HTTP 方法 | GET | POST |
| 請求格式 | querystring (AES加密) | JSON body |
| URL 格式 | `sbUrl?agent=X&timestamp=X&param=AES&key=MD5` | `sbUrl/{action}` |
| 認證方式 | AES 加密 + MD5 簽名 | Xinkey（直接傳入）|
| 下注/派獎端點 | 不同 s 值 (1002/1003) | 統一 `api_spin` |
| 查詢餘額端點 | s=1001 | `api_show` |

### XinStars 操作對應

| 操作 | 端點 action | 說明 |
|-----|-----------|------|
| 查詢餘額 | `api_show` | POST body: `{Xinkey}` |
| 下注 | `api_spin` | POST body: `{Xinkey, tid, bet, win:0}` |
| 派獎 | `api_spin` | POST body: `{Xinkey, tid, bet:0, win}` |

### XinStars 查詢餘額 (queryBalanceXinStars)

**POST 請求 URL**: `{sbUrl}/api_show`

**Request Body**:
```json
{
  "Xinkey": "player_xinkey_token"
}
```

**Response**:
```json
{
  "err": "0",
  "tol": 100.00
}
```
> 注意: `err` 為字串格式，需 `Number()` 轉換

### XinStars 下注 (playerBetXinStars)

**POST 請求 URL**: `{sbUrl}/api_spin`

**Request Body**:
```json
{
  "Xinkey": "player_xinkey_token",
  "tid": "order-20231101-001",
  "bet": 10.00,
  "win": 0
}
```

**Response**:
```json
{
  "err": "0",
  "tol": 90.00
}
```

### XinStars 派獎 (playerAwardXinStars)

**POST 請求 URL**: `{sbUrl}/api_spin`

**Request Body**:
```json
{
  "Xinkey": "player_xinkey_token",
  "tid": "order-20231101-001-award",
  "bet": 0,
  "win": 15.00
}
```

**Response**:
```json
{
  "err": "0",
  "tol": 105.00
}
```

---

## 下注完整資料流程 (wallet:credit)

### 完整流程圖

```
game_server → POST wallet:2100/player/credit
  │
  │ {walletType:2, orderId, agent, account, currency, money(gold), gameNo, gameId, roomMode, isFBSport, ...}
  │
  ▼
[1] Redis 鎖檢查 isOrderRedisLock(orderId, gold)
  → 若已鎖定 → 返回 {code:11} ACCOUNT_CONCURRENT
  │
  ▼
[2] DB 重複訂單檢查 isSingleOrderDup(orderId)
  → 若重複 → 返回 {code:9} DUPLICATE_ORDERID
  │
  ▼
[3] 取得匯率 exchangeService.getExchange(currency)
  → 若失敗 → 返回 {code:5} DATA_ERROR
  │
  ▼
[4] 代理帳變（下分）agentService.credit({agent, money, orderId, type:SINGLE_BET})
  → 若失敗 → 記錄失敗原因 → 返回 {code:5}
  │       → insertTrackSingleFailOrder
  │
  ▼
[5] 通知代理下注 thirdParty:10010 POST /playerBet
  │  → thirdParty 呼叫代理 sbUrl GET
  │
  ├── [成功] 代理返回 {d: {code:0, money:X}}
  │     → 記錄 single_orders (status=1)
  │     → 記錄 orders
  │     → 返回 {code:0, account, money:gold}
  │
  └── [失敗] 代理返回失敗或 timeout
        → [6] 回滾代理帳變 agentService.creditRollback
              ├── 成功回滾 → agentOrderStatus=14
              └── 失敗回滾 → agentOrderStatus=13
        → 記錄 single_orders (action=7)
        → 記錄 orders
        → 記錄 tracking_single_fail_order
        → 返回 {code: 失敗碼}
```

### wallet server → thirdParty server 呼叫時的轉換

wallet server 呼叫 thirdParty 時，`money` 已從 gold 轉為 money：
```javascript
const money = utils.goldToMoney(gold);
const callAgentParam = { ...param, money: money };
const callAgentResult = await playerService.singleWalletPlayerBet(callAgentParam);
```

---

## 派獎完整資料流程 (wallet:deposit)

### 完整流程圖

```
game_server → POST wallet:2100/player/deposit
  │
  │ {walletType:2, orderId, agent, account, currency, money(gold),
  │  totalBet, validBet, totalWithdraw, revenue, betCount, ...}
  │
  ▼
[1] Redis 鎖 + DB 重複訂單檢查（同下注流程）
  │
  ▼
[2] 取得匯率 exchangeService.getExchange(currency)
  │
  ▼
[3] 代理帳變（上分）agentService.deposit({agent, money, orderId, type:SINGLE_WIN})
  │
  ▼
[4] 通知代理派獎 thirdParty:10010 POST /playerAward
  │  → 傳入 money, totalBet, validBet, totalWithdraw, revenue（均已轉為 money 單位）
  │
  ├── [成功] {d: {code:0, money:X}}
  │     → 記錄 single_orders (status=1)
  │     → 記錄 orders
  │     → 返回 {code:0, account, money:gold}
  │
  ├── [失敗:code=9 DUPLICATE_ORDERID]
  │     → [4a] 呼叫 getOrderStatus 查詢代理訂單狀態
  │     → 若代理訂單成功 (status=1)
  │           → 查詢餘額 singleWalletQueryBalance
  │           → 視原始訂單狀態決定是否需要回滾
  │           → 返回成功
  │
  └── [其他失敗]
        → [5] 回滾代理帳變 agentService.depositRollback({type:ROLLBACK_SINGLE_WIN})
        → 記錄 tracking_single_fail_order
        → 返回失敗
```

---

## 取消下注完整資料流程 (wallet:cancelBet)

```
game_server → POST wallet:2100/player/cancelBet
  │
  ▼
[1] Redis 鎖
  │
  ▼
[2] 查詢是否已有成功取消記錄 getSuccessOrderByRefOriginOrderId(orderId)
  → 若已取消成功 → 直接返回成功
  │
  ▼
[3] 取得匯率
  │
  ▼
[4] 查詢原始訂單 getOriginSingleOrder(orderId)
  判斷 agentMoneyUpdateFlag = (originOrder.status == 1)
  → 若原始訂單成功 → 需要先退款給代理
  │
  ▼
[5] 生成新訂單 ID = orderId + '_' + 5位隨機字串
  │
  ▼
[6] 若需退款: agentService.deposit({..., type:SINGLE_CANCEL_BET, orderId:newOrderId})
  │
  ▼
[7] 通知代理取消 thirdParty:10010 POST /cancelBet
  │
  ├── [成功]
  │     → 記錄 single_orders (status=1)
  │     → 返回 {code:0, status}
  │
  └── [失敗]
        → 若有退款則回滾 agentService.depositRollback({type:ROLLBACK_SINGLE_CANCEL_BET})
        → 記錄 tracking_single_fail_order
        → 返回 {code:5}
```

---

## 查詢餘額完整資料流程 (wallet:queryBalance)

```
game_server → POST wallet:2100/player/queryBalance
  │
  │ {walletType:2, agent, account, currency}
  │
  ▼
thirdParty:10010 POST /queryBalance
  │
  ▼
代理 sbUrl GET
  │
  ▼
代理返回 {d: {code:0, money:100.00}}
  │
  ▼
轉換: result.money = moneyToGold(100.00) = 10000
  │
  ▼
返回 {code:0, money:10000}
```

> **注意**: queryBalance 不會更新任何本地 DB，純粹轉發查詢

---

## 查詢訂單完整資料流程 (wallet:getOrderStatus)

```
game_server → POST wallet:2100/player/getOrderStatus
  │
  │ {walletType:2, orderId, walletLog: JSON 字串}
  │
  ▼
[1] 檢查 Redis 鎖 getWalletDealOrder(orderId)
  → 若有鎖 → 返回 ACCOUNT_CONCURRENT
  │
  ▼
[2] 查本地 DB single_orders 
  ├── 找到且 status=1 → 直接返回 {code:0, status:1}（不呼叫代理）
  ├── 找到但非成功 → 呼叫代理 getOrderStatus
  └── 找不到 → 返回 {code:0, status:4}（查無訂單）
  │
  ▼
[3] 解析 walletLog 取得 gameNo, gameId
  → walletLog = JSON.parse(param.walletLog).gameInfo.betInfos
  │
  ▼
[4] thirdParty:10010 POST /getOrderStatus
  │
  ▼
[5] 若代理返回 status=1
  → 更新本地 DB: updateGameApiOrderToSuccess(orderId)
  → 更新 orders record DB: updateOrderRecordOrderToSuccess(orderId)
  │
  ▼
返回代理的結果 {code:0, status:1}
```

---

## 錯誤碼對照表

### 單一錢包協議（代理端回傳，來自 singleWalletEnum.js）

| code | 說明 |
|-----|------|
| `0` | 成功 |
| `1` | 余额不足 |
| `2` | 会员帐号不存在 |
| `3` | 维护中 |
| `4` | token验证错误 |
| `5` | 数据格式错误 |
| `6` | 解密错误 |
| `7` | MD5错误 |
| `8` | 未知的操作子类型 |
| `9` | 订单号重复 |
| `10` | 代理不存在 |
| `11` | 帐号正在上下分 |
| `12` | 查无订单号 |
| `13` | 伺服器错误 |

### Wallet Server 回 Game Server（來自 walletResponseMap.js）

| code | 常量名稱 | 說明 |
|-----|--------|------|
| `0` | SUCCESS | 成功 |
| `1` | INSUFFICIENT_BALANCE | 余额不足 |
| `2` | ACCOUNT_NOT_EXIST | 会员帐号不存在 |
| `3` | MAINTAIENANCE | 维护中 |
| `5` | DATA_ERROR | 数据格式错误 |
| `9` | DUPLICATE_ORDERID | 订单号重复 |
| `11` | ACCOUNT_CONCURRENT | 帐号正在上下分 |

---

## 資料庫結構 (single_orders)

### single_orders 表 (game_api DB)

```sql
CREATE TABLE single_orders (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    orderId         VARCHAR(255),    -- 訂單號
    account         VARCHAR(255),    -- 玩家帳號（含代理前綴）
    channelId       INT,             -- 代理 ID（agent）
    gameNo          VARCHAR(255),    -- 局號
    curScore        BIGINT,          -- 帳變前餘額（gold）
    addScore        BIGINT,          -- 帳變金額（gold）
    newScore        BIGINT,          -- 帳變後餘額（gold）
    status          TINYINT,         -- 0=處理中 1=成功 2=失敗
    type            TINYINT,         -- 訂單類型（見下表）
    action          TINYINT,         -- 0=正常 7=失敗 8=補成功
    ref_origin_orderId VARCHAR(255), -- 關聯原始訂單（取消下注時使用）
    retCode         INT,             -- 代理返回 code
    currency        VARCHAR(10)      -- 幣別
);
```

### single_orders.type 對照

| type | 說明 |
|-----|------|
| `0` | 上分（派獎/一般上分）|
| `1` | 下分（下注）|
| `2` | 取消下注 |
| EVENT_AWARD | 活動派獎（PLAYER_WALLET.EVENT_AWARD）|
| FB_TYPE_MAPPING[x] | FB Sport 特殊類型（需參考 single_orders.js）|

### single_orders.action 對照

| action | 說明 |
|-------|------|
| `0` | 正常 |
| `7` | 通知代理失敗 |
| `8` | 補成功（後補更新）|

### tracking_single_fail_order 表

```sql
CREATE TABLE tracking_single_fail_order (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    order_id    VARCHAR(255),   -- 訂單號
    error_note  TEXT,           -- JSON 格式的錯誤詳情
    create_date DATETIME DEFAULT NOW()
);
```

`error_note` JSON 結構（insertTrackSingleFailOrder 寫入）:
```json
{
  "req_data": "s=1002&account=player001&...",
  "req_url": "https://agent.example.com/wallet?agent=70000&...",
  "res_data": "{\"d\":{\"code\":1}}",
  "msg": "單一錢包玩家下注通知返回錯誤余额不足"
}
```

---

## 失敗追蹤機制

### orderService.insertTrackSingleFailOrder

```javascript
// singleWalletDao.js
module.exports.insertTrackSingleFailOrder = async function({ order_id, error_note}) {
    const sql = 'INSERT INTO tracking_single_fail_order (`order_id`, `error_note`, `create_date`) VALUES(?, ?, NOW());';
    return await mysqlHelper.apiSql.queryAsync(sql, [order_id, error_note]);
};
```

### 觸發時機

| 觸發條件 | 呼叫位置 | error_note.msg |
|---------|---------|---------------|
| 呼叫代理 HTTP 超時（60s）| singleWalletService 各方法 | `"...请求失败 http连线timeout"` |
| 代理返回 code ≠ 0（下注）| singleWalletService.playerBet | `"單一錢包玩家下注通知返回錯誤{code說明}"` |
| 代理返回格式錯誤 | singleWalletService 各方法 | `"...代理返回參數錯誤"` |
| encodeURL 失敗 | singleWalletService.callBySbUrl | `"单一钱包通知代理 encodeURL失败"` |
| 代理帳變失敗（wallet controller）| wallet/controller/player.js | `"单一钱包派奖错误 代理上分失败"` |
| 代理帳變餘額不足 | wallet/controller/player.js | `"单一钱包请求下注错误 代理余额不足下分失败"` |
| 贏分補發成功（特別記錄）| singleWalletService.playerAward | `"單一錢包玩家派獎通知代理 赢分补发成功"` |
| 訂單重複補分成功 | wallet/controller/player.js | `"单一钱包派奖订单号重复流程補分成功"` |

---

## 離線通知 (userLogout / notifyBurst)

### userLogout — 玩家下線通知代理

使用代理的 **offlineBackUrl**（而非 sbUrl），加密方式相同（AES + MD5）。

**觸發條件**: 玩家離線

**傳給代理 offlineBackUrl 的 querystring（加密前）**:
```
s=11&account=player001
```

**代理 URL 格式**:
```
{offlineBackUrl}?agent=70000&timestamp=X&param=AES(s%3D11%26account%3Dplayer001)&key=MD5
```

### notifyBurst — 玩家爆獎通知代理

**觸發條件**: 玩家觸發爆獎條件（由 game_server 或其他服務呼叫）

**傳給代理 offlineBackUrl 的 querystring（加密前）**:
```
s=20&gameCode={gameId}&account={account}&betAmount={betGold/100}&winAmount={winGold/100}&settlementAmount={settleGold/100}&burstRatio={ratio}
```

| 欄位 | 說明 |
|-----|------|
| `s` | `20` |
| `gameCode` | 遊戲代碼 |
| `account` | 玩家帳號（無代理前綴）|
| `betAmount` | 投注金額（元）|
| `winAmount` | 贏得金額（元）|
| `settlementAmount` | 結算金額（元）|
| `burstRatio` | 爆獎比例 |

---

## 回滾機制

### 設計原則

單一錢包的回滾採用**「先本地帳變，通知代理失敗則回滾本地」**的模式。

```
代理帳變（本地）→ 通知代理（外部）→ 失敗 → 回滾本地代理帳變
```

### 各操作的回滾類型

| 操作 | 帳變類型 | 回滾類型 |
|-----|--------|--------|
| 下注 (credit) | SINGLE_BET | ROLLBACK_SINGLE_BET |
| 派獎 (deposit) | SINGLE_WIN | ROLLBACK_SINGLE_WIN |
| 取消下注 (cancelBet) | SINGLE_CANCEL_BET | ROLLBACK_SINGLE_CANCEL_BET |

### agentOrderStatus 代碼

| 狀態碼 | 說明 |
|------|------|
| `100` | 成功 |
| `13` | 回滾代理分數失敗（嚴重，需人工介入）|
| `14` | 回滾代理分數成功 |
| `102` | 玩家下分失敗（單一錢包）|

### 特殊情況：重複訂單處理（deposit 流程）

```
代理返回 code=9 (DUPLICATE_ORDERID)
  ↓
呼叫 getOrderStatus 查詢代理訂單
  ↓
代理訂單 status=1 (成功)
  ↓
若原始本地訂單 status=2 (失敗)  ← 代理帳變被回滾過
  → isNeedRollback = false       ← 代理此次帳變不需回滾
  → 直接標記成功
```

---

## 與內轉錢包 (walletType=1) 的差異對照

| 比較項目 | 單一錢包 (walletType=2) | 內轉錢包 (walletType=1/freeTransfer) |
|---------|----------------------|-------------------------------------|
| 餘額存放 | 代理端 | 本系統 DB |
| 通知代理 URL | `sbUrl` | `rechargeUrl` |
| 呼叫時機（下注）| 本地代理帳變後，通知代理 | 先通知代理，再本地帳變（payType=1）|
| 帳號格式 | 去除代理前綴 | 保留完整帳號格式（`toAgentAccountFormat`）|
| 加密方式 | AES + MD5（相同）| AES + MD5（相同）|
| action s 值 | 1001~1005 | 1001~1003（queryBalance, deposit, credit）|
| 回傳格式 | `{d: {code, money}}` | `{d: {code, money}}` |
| 失敗追蹤 | tracking_single_fail_order | 無（直接返回錯誤）|
| 回滾機制 | 有（代理帳變回滾）| 無（通知代理失敗直接返回）|
| payType 概念 | 無 | payType=1（我方先上分）, payType=2（代理自行呼叫）, payType=3（V8版本）|
| 特殊帳號 | XinStars（POST JSON）| specialCheckToken（188bet 驗證）|

### freeTransfer 對代理的 s 值說明

| s 值 | 操作 | 說明 |
|-----|------|------|
| `1000` | specialCheckToken | 188bet Token 驗證 |
| `1001` | queryBalance | 查詢餘額 |
| `1002` | deposit | 上分通知 |
| `1003` | credit | 下分通知 |
| `11` | userLogout | 下線通知（offlineNotify 共用）|
| `12` | queryBalanceCustom | 自定義查餘額（V8）|
| `13` | depositCustom | 自定義上分（V8）|
| `20` | notifyBurst | 爆獎通知（offlineNotify 共用）|

---

## 缺失資訊

1. **`api_config/single_orders.js`** — `SINGLE_ORDERS.FB_TYPE_MAPPING` 的完整映射未讀取，FB Sport 訂單 type 的對應關係不明確
2. **`api_utils/utils.js` 中的 `desEncode`** — AES 加密的確切模式（ECB/CBC/CFB）和 padding 方式未確認，文件名稱為 `desEncode` 但實際可能是 AES（需進一步確認）
3. **`wallet/service/player.js`** — `singleWalletQueryBalance`、`singleWalletPlayerBet`、`singleWalletPlayerAward`、`singleWalletGetOrderStatus`、`singleWalletCancelBet` 等方法的實際實現（是否有額外邏輯）
4. **`wallet/service/agent.js`** — `agentService.credit/deposit/creditRollback/depositRollback` 的具體實現
5. **代理端 sbUrl 的完整 API 文件** — 代理端接收格式、驗證邏輯、所有 s 值的詳細說明
6. **`XINSTARS_AGENT` 環境變數值** — 哪個代理 ID 觸發 XinStars 特殊流程
7. **`exchangeService.getExchange` 的匯率數據** — 多幣種計算的匯率來源和更新機制
8. **`game_server` 如何觸發這些操作** — game_server 呼叫 wallet server 的完整協議（因 game_server 無源碼）
