# API 與資料流分析報告
## API & Data Flow Analysis

---

## 目錄 Table of Contents

1. [執行摘要](#執行摘要)
2. [API 端點清單](#api-端點清單)
3. [玩家登入資料流](#玩家登入資料流)
4. [遊戲結算資料流](#遊戲結算資料流)
5. [第三方廠商資料流](#第三方廠商資料流)
6. [後台管理員資料流](#後台管理員資料流)
7. [錢包資料流](#錢包資料流)
8. [Jackpot 資料流](#jackpot-資料流)
9. [風控資料流](#風控資料流)
10. [定時任務資料流](#定時任務資料流)
11. [Token 生命週期](#token-生命週期)
12. [缺失資訊](#缺失資訊)

---

## 執行摘要

本報告分析系統所有可識別的 API 端點及其資料流動路徑。

**已識別 API 端點**:
- `game_api` channel: ~5 個
- `game_api` dataService: 20+ 個
- `game_api` wallet: 18 個
- `game_api` platform: 24 個
- `game_api` thirdParty: 17 個
- `dashboard` backend: 200+ 個（路由文件推斷）
- `game_record_parser`: 估計 30+ 個

---

## API 端點清單

### game_api - channel server (2090)

```
POST /channelHandle    → 玩家進入遊戲主入口（推斷）
```

### game_api - game server (10000)

```
POST /checkUserToken          → 驗證玩家 Token
POST /getUserToken            → 取得玩家 Token
POST /getPlayerInfoByAccount  → 透過帳號取玩家資訊
POST /getPlayerInfoByRID      → 透過 RID 取玩家資訊
POST /savePlayerInfo          → 保存玩家資訊
POST /getRedirectServerInfo   → 取得遊戲服務器跳轉資訊
POST /syncAgentDesRoute       → 同步代理目標路由
POST /saveBgDeploymentLog     → 保存藍綠部署日誌
POST /getActiveExRateList     → 取得有效匯率清單
POST /getPlayerStatistic/date → 取得玩家日期統計
POST /getBotAvatarList        → 取得機器人頭像清單
```

### game_api - dataService (1029)

```
# 錢包相關
/walletHandle/*

# 統計相關
/statisticsHandle/*

# 平台管理
/platformHandle/*

# 遊戲資訊
/gameHandle/*
    POST /gameHandle/...     → 遊戲相關操作

# 公司遊戲
/companyGameHandle/*

# FB 體育
/fbHandle/*

# 遊戲紀錄
/gameRecordHandle/*

# 合併紀錄
/mergeRecordHandle/*

# 版本
GET /version

# 通知
/notification/*

# Swagger (dev only)
GET /api/docs
```

### game_api - wallet server (2100)

```
# 玩家錢包
POST /player/create                    → 建立玩家
POST /player/queryBalance              → 查詢餘額
POST /player/getWallets                → 取得所有錢包
POST /player/deposit                   → 存款（代理→玩家）
POST /player/credit                    → 加分（結算）
POST /player/getOrderStatus            → 查詢訂單狀態
POST /player/cancelBet                 → 取消投注
POST /player/playerDepositAgentCredit  → 玩家存款+代理加分
POST /player/agentDepositPlayerCredit  → 代理存款+玩家加分
POST /player/freeTransferBalance       → 免費轉帳餘額查詢
POST /player/freeTransferDeposit       → 免費轉帳存款
POST /player/freeTransferCredit        → 免費轉帳加分
POST /player/playerDepositReqByPlatform→ 平台請求存款
POST /player/playerCreditReqByPlatform → 平台請求加分
POST /player/rollback                  → 回滾

# 代理錢包
POST /agent/*

# 匯率
POST /exchange/*

# 試玩玩家
POST /trialPlayer/*
```

### game_api - thirdParty server (10010)

```
# 單一錢包（第三方標準接口）
POST /queryBalance                → 查詢餘額
POST /playerBet                   → 投注
POST /playerAward                 → 中獎/結算
POST /getOrderStatus              → 查詢訂單狀態
POST /cancelBet                   → 取消投注

# 免費轉帳
POST /freeTranferQueryBalance
POST /freeTranferDeposit
POST /freeTranferCredit
POST /freeTranferQueryBalanceCustom
POST /freeTranferDepositCustom
POST /specialCheckToken           → 特殊 Token 驗證

# 離線通知
POST /userLogout                  → 玩家登出通知
POST /notify/burst                → 爆發通知
```

### game_api - platform server (3050)

```
POST /updateAgent                 → 更新代理設定
POST /updateAgentStatus           → 更新代理狀態
POST /updateAccountStatus         → 更新帳號狀態
POST /updateDisIpList             → 更新 IP 封禁清單
POST /getWinRank                  → 取得排行榜
POST /getLoginStatistic           → 取得登入統計
POST /getRevenueOverTenK          → 取得大額收益
POST /getBridgeOnlineList         → 取得橋接在線清單
POST /getJackpot                  → 取得 Jackpot
POST /addRequestList              → 新增請求清單
POST /getRequestList              → 取得請求清單
POST /updateFestival              → 更新節慶皮膚
POST /delLineCodesLogoInfo        → 刪除線號 Logo
POST /killStrategyConfig          → 配置 Kill 策略
POST /deleteKillStrategyConfig    → 刪除 Kill 策略
POST /batchAddKillList            → 批量新增 Kill 清單
POST /batchDeleteKillList         → 批量刪除 Kill 清單
POST /getHallURL                  → 取得大廳 URL
POST /getWithdrawBlackListStatus  → 取得提款黑名單
POST /setWithdrawBlackListStatus  → 設置提款黑名單
POST /updateBetLimitGroup         → 更新投注限額群組
POST /getPlatformStatis           → 取得平台統計
```

### dashboard - 後台管理 API (19200) 主要端點

```
# 用戶認證
GET  /refreshToken
POST /login
POST /agentLogin
GET  /validateCode
POST /userExit
POST /editPassword

# 帳號管理
/user/*           → 用戶管理
/memberinfo/*     → 會員資訊
/proxyaccount/*   → 代理帳號
/bulkBlackList/*  → 批量黑名單

# 報表
/winAndLoseReport/*     → 盈虧報表
/betDetail/*            → 注單明細
/gameLog/*              → 遊戲日誌
/proxyStatis/*          → 代理統計
/memberStatis/*         → 會員統計
/userMoneyChangeDetail/*→ 用戶資金明細
/deliveryReport/*       → 交收報表（多廠商）
/QueryAllBet/*          → 全部投注查詢

# 財務
/agentLevelManage/*     → 代理層級
/exchangeRate/*         → 匯率
/deliveryReport/*       → 各廠商交收報表

# 遊戲管理
/gameinfo/*             → 遊戲資訊
/gamegroup/*            → 遊戲分組
/banner/*               → 橫幅
/bulletin/*             → 公告
/jackpotManage/*        → Jackpot 管理
/hotupdatecode/*        → 熱更新代碼

# 風控
/killmanagement/*       → Kill 管理
/killRateAdjustment/*   → Kill Rate 調整
/roomMonitoring/*       → 房間監控
/roomRobotMonitoring/*  → 機器人監控
/ipKillmanagement/*     → IP Kill 管理
/dailyProfitMonitoring/*→ 日常盈利監控
/reduceScoreBlackList/* → 減分黑名單

# 活動
/eventSetup/*           → 活動設置
/eventLog/*             → 活動日誌
/multiCurrencyEvent*/*  → 多幣種活動

# 運營
/dataOverview/*         → 資料總覽
/bgDeployment/*         → 藍綠部署
/customOnline/*         → 自定義在線
/gameRoute/*            → 遊戲路由
/company/*              → 公司管理
/checkLogin/*           → 登入檢查

# 系統
/rolemanage/*           → 角色管理
/grant/*                → 權限管理
/sysLog/*               → 系統日誌
/actionLog/*            → 操作日誌
```

---

## 玩家登入資料流

```
玩家客戶端
    │
    │ 1. 攜帶 token + account + agent 資訊
    ▼
channel server (2090)
    │
    │ 2. 驗證 token 格式和簽名（本地）
    │ 3. 查詢 Redis: 黑名單
    │    Key: blacklist:{account}
    │
    │ 4. 查詢 Redis: 代理資訊
    │    Key: agents:{agentId}
    │
    │ 5. 查詢 Redis: 上下分狀態
    │    Key: accActionList:{account}
    │
    │ 6. 查詢 Redis: 貨幣
    │    Key: accountLoginCurrency:{account}
    │
    ▼
MySQL (game_api DB)
    │ 7. 查詢 playerInfo 表
    │ 8. 查詢代理線號（getLinecodeByAccount）
    │
    ▼
channel server
    │ 9. 組裝玩家資料（餘額、幣種、配置）
    │ 10. 記錄登入至 playerInfo 統計
    │
    ▼ 通過 Moleculer RPC
playerInfo login node (7950)
    │ 11. 更新登入統計資料
    │
    ▼
MySQL (statistics DB)

    │ 返回遊戲入場資料
    ▼
玩家客戶端
    │
    │ 12. 使用返回的 token 和地址連線
    ▼
game_server（未知協議）
```

---

## 遊戲結算資料流

### 自有遊戲結算（推斷）

```
game_server（未知）
    │ 1. 遊戲結束，生成結果
    │
    ▼ HTTP POST（推斷）
gameRecord server (5000)
    │ 2. 保存注單至 MySQL (game_record DB)
    │
    ▼ HTTP POST（推斷）
wallet server (2100)
    │ 3. 根據注單進行資金異動
    │    - 贏: 加分至玩家餘額
    │    - 輸: 確認扣款
    │
    ▼
MySQL (wallet DB)
    │ 4. 更新 wallet 表（transaction）
    │
    ▼ 非同步（推斷）
statistics server (4000)
    │ 5. 更新統計資料
    │
    ▼
MySQL (statistics DB)

若有 Jackpot 觸發:
    │
    ▼
platform server (3050)
    │ 6. getJackpot / 觸發 Jackpot 分配
    │
    ▼
MySQL (jackpot DB)
```

### 資金異動流程

```
wallet server 接收結算請求
    │
    ├─ 開啟 MySQL Transaction
    │
    ├─ SELECT balance WHERE account = ? FOR UPDATE
    │  (鎖定行，防止並發)
    │
    ├─ 驗證餘額充足（若為扣款）
    │
    ├─ UPDATE wallet SET balance = balance + amount
    │
    ├─ INSERT INTO transactions (orderId, ...)
    │  (orderId UNIQUE 防重複？需確認)
    │
    └─ COMMIT
```

---

## 第三方廠商資料流

### 廠商 Callback 流程

```
外部廠商服務器
    │ 1. 結算完成 → POST callback 到本系統
    │    包含: playerId, orderId, amount, type(bet/award/cancel)
    ▼
vendor server (e.g., kys:1087)
    │
    │ 2. 驗證簽名（各廠商不同算法）
    │    KYS: HMAC 驗證
    │    CSLay: wallet secret 驗證
    │
    │ 3. 轉換為內部格式
    │
    ▼
thirdParty server (10010)
    │
    │ 4. 識別操作類型
    │
    ├─── playerBet ────► wallet server (2100)
    │                        │
    │                        ▼ /player/deposit
    │                    MySQL (wallet DB) 扣款
    │
    ├─── playerAward ───► wallet server (2100)
    │                        │
    │                        ▼ /player/credit
    │                    MySQL (wallet DB) 加款
    │
    ├─── cancelBet ────► wallet server (2100)
    │                        │
    │                        ▼ /player/rollback
    │                    MySQL (wallet DB) 回滾
    │
    └─── queryBalance ──► wallet server (2100)
                              │
                              ▼ /player/queryBalance
                          MySQL (wallet DB) 讀取
    │
    │ 5. 保存注單至廠商獨立 DB 或 channelRecord
    ▼
MySQL (kys_db / channel_record_db / etc.)
```

### timerTask 資料流

```
定時觸發（每5分鐘）
    │
    ▼
timerTask server (e.g., 8300 for KYS)
    │
    │ 1. 計算需要拉取的時間範圍（上次同步時間至今）
    │
    ▼
外部廠商 API (e.g., KYS Admin API)
    │ 2. GET /records?from=XX&to=XX
    │
    ▼
timerTask server
    │ 3. 解析廠商格式的注單
    │ 4. 去重檢查（已存在的 orderId 跳過）
    │
    ▼
MySQL (廠商獨立 DB 或 game_record DB)
    │ 5. 批量插入缺漏注單
    │
    ▼
channelRecord server (2290/2390)
    │ 6. 更新統計摘要（可選）
```

---

## 後台管理員資料流

### 管理員登入流程

```
管理員瀏覽器
    │ 1. POST /login { username, password, captchaCode }
    ▼
dashboard backend (19200)
    │
    │ 2. 驗證 JWT Access Token（登入前的 captcha 用）
    │
    │ 3. 查詢 Redis: 驗證碼（captcha）
    │    Key: captcha:{accessToken}
    │
    │ 4. 查詢 MySQL: 用戶帳號和密碼雜湊
    │    bcrypt.compare(password, hash)
    │
    │ 5. IP 白名單驗證（若開啟）
    │
    │ 6. 若啟用 2FA: 驗證 TOTP
    │
    │ 7. 生成互動 Token（新的 Access + Refresh JWT）
    │
    │ 8. 保存 Session 至 Redis
    │    Key: userInfo:{accessToken}
    │    值: { name, roleId, ip, isLoginVerified: true }
    │
    │ 9. 記錄登入日誌（actionLog）
    ▼
管理員瀏覽器
    │ 返回 AccessToken + RefreshToken Headers
```

### 管理員 API 請求流程

```
管理員瀏覽器
    │ 1. HTTP Request + AccessToken (Header)
    ▼
dashboard backend
    │
    │ 2. reachMiddleware: 解析請求
    │
    │ 3. contextMiddleware: 建立請求上下文
    │    讀取 AccessToken、IP、語系
    │
    │ 4. rateLimiterMiddleware: 速率限制（20 req/s）
    │
    │ 5. authorizationMiddleware:
    │    a. JWT 驗證
    │    b. 讀取 Redis: userInfo
    │    c. IP 一致性檢查
    │    d. RBAC 權限驗證（roleLibrary）
    │
    │ 6. controller 業務邏輯
    │
    ├─ 需要遊戲資料 ────► game_api dataService (1029)
    │
    ├─ 需要分析資料 ────► game_record_parser (19453)
    │
    ├─ 直接查詢 DB ──────► MySQL (複雜報表)
    │
    └─ 需要快取資料 ─────► Redis
    │
    │ 7. 記錄操作日誌（若為敏感操作）
    ▼
管理員瀏覽器
```

---

## 錢包資料流

### 上分流程（代理→玩家）

```
代理後台請求上分
    │
    ▼
platform server (3050) 或 manage server (3000)
    │
    ▼
wallet server (2100)
    │ POST /agent/*
    │
    ├─ 驗證代理餘額充足
    │
    ├─ BEGIN TRANSACTION
    │
    ├─ UPDATE agents SET balance = balance - amount
    │
    ├─ UPDATE player_wallet SET balance = balance + amount
    │
    ├─ INSERT INTO transactions
    │
    └─ COMMIT
    │
    ▼
Redis（更新玩家餘額快取）
    │
    ▼
通知 game_server 玩家餘額變更（推斷）
```

### 下分流程（玩家→代理）

```
遊戲結束或玩家離線
    │
    ▼
wallet server (2100)
    │
    ├─ BEGIN TRANSACTION
    │
    ├─ 讀取玩家最終餘額
    │
    ├─ UPDATE player_wallet SET balance = 0
    │
    ├─ UPDATE agents SET balance = balance + finalBalance
    │
    └─ COMMIT
```

---

## Jackpot 資料流

```
每局遊戲結算
    │ 按比例從彩金中累積
    ▼
jackpot 積累邏輯（game_server 或 gameRecord）
    │
    ▼
MySQL (jackpot DB)
    │ 更新獎池金額

Jackpot 觸發（條件未知）
    │
    ▼
platform server (3050)
    │ POST /getJackpot
    │
    ▼
Jackpot 分配
    ├─ 更新 jackpot DB（清零或減少）
    ├─ wallet server 加款給中獎玩家
    └─ 記錄 jackpotPayoutRecord
    │
    ▼
通知管理員（Telegram）
```

---

## 風控資料流

```
每筆注單完成後
    │
    ▼
channelRecord server (2290)
    │ 記錄 channel 層注單
    │
    ▼ 非同步
risk analysis（推斷由 statistics 或獨立邏輯）
    │
    ├─ Kill Rate 監控
    │  當前 Kill Rate > 閾值？
    │  └─ 觸發告警
    │
    ├─ 玩家盈利監控
    │  玩家連續大贏？
    │  └─ 標記 → 管理員查看
    │
    ├─ 機器人偵測
    │  投注模式分析
    │  └─ 標記 → roomRobotMonitoring
    │
    └─ IP 分析
       同 IP 多帳號？
       └─ 可能套利 → locationAnalysis

管理員介入
    │ 透過 dashboard
    ├─ 調整 Kill Rate
    ├─ 封停帳號
    ├─ 加入黑名單
    └─ IP Kill
```

---

## 定時任務資料流

```
Cron 定時觸發（各廠商 timerTask）
    │
    ├─ 每 5 分鐘: 拉取廠商注單
    │    └─ timerTask → 廠商 API → MySQL
    │
    ├─ 每日: 統計計算
    │    └─ statistics server → MySQL 彙總
    │
    ├─ 即時: 風控告警
    │    └─ 盈利超過閾值 → Telegram 通知
    │
    └─ 排程: 報表生成
         └─ dashboard cron → 預計算報表 → Redis 快取

dashboard cron server 已知任務:
    ├─ addCheckLoginWorker  → 定期清理過期登入
    ├─ addCheckVVip         → VIP 等級檢查
    └─ addCrontab           → 其他排程任務
```

---

## Token 生命週期

### game_api 自定義 Token

```
生成: game_server 或 channel server
    │ 包含: account, machineName, agent
    │ 有效期: 150秒（預設）
    │ 格式: base64(payload).hmac_sha256

驗證: channel server 每次請求
    │ 1. 分割 base64 和 signature
    │ 2. 重新計算 HMAC
    │ 3. 比較（字串比較，有 timing attack 風險）
    │ 4. 檢查過期時間
    │ 5. 驗證 account 和 machineName

失效:
    │ - 超過 150 秒
    │ - 帳號被封停
    │ - 正在上下分中
```

### dashboard JWT Token

```
Access Token（10 分鐘）:
    ├─ 生成: 登入成功後
    ├─ 存儲: 前端 Header
    ├─ 驗證: 每次 API 請求（authorizationMiddleware）
    ├─ Redis 對應: userInfo:{accessToken} → 用戶資料
    └─ 失效: 10 分鐘後或明確登出

Refresh Token（10 小時）:
    ├─ 生成: 登入成功後
    ├─ 存儲: 前端 Header
    ├─ 驗證: GET /refreshToken 時
    └─ 用途: 換取新 Access Token

登出流程:
    POST /userExit
    → 刪除 Redis: userInfo:{accessToken}
    → 前端清除 Token
```

---

## 缺失資訊

1. **game_server 通訊協議詳細格式** — 玩家客戶端和 game_server 的封包格式
2. **channel server 完整路由** — `channelHandle.js` 未能讀取完整內容
3. **代理後台 manage (3000) 完整路由** — 未詳細分析
4. **wallet agent 路由** — `/agent/*` 端點清單未完整確認
5. **Moleculer RPC 通訊細節** — playerInfo 節點間通訊方式
6. **Redis Key 完整命名規範** — 快取 key 結構未完整梳理
7. **MySQL 交易隔離級別** — 並發保護的確切機制
8. **統計計算的觸發時機** — 實時 vs 定時批次
