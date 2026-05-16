# 安全風險分析報告
## Security Risk Analysis

---

## 目錄 Table of Contents

1. [執行摘要](#執行摘要)
2. [嚴重漏洞（CRITICAL）](#嚴重漏洞-critical)
3. [高風險漏洞（HIGH）](#高風險漏洞-high)
4. [中風險漏洞（MEDIUM）](#中風險漏洞-medium)
5. [低風險漏洞（LOW）](#低風險漏洞-low)
6. [主要風險清單](#主要風險清單)
7. [建議修復優先順序](#建議修復優先順序)
8. [缺失資訊](#缺失資訊)

---

## 執行摘要

本次安全分析在可存取的原始碼範圍內，發現 **6 個嚴重（CRITICAL）、9 個高風險（HIGH）、8 個中風險（MEDIUM）** 安全漏洞。

最高危項目為：
1. **真實生產憑證直接寫入 .env 檔案並提交至代碼庫**（包含 Telegram Bot Token、MySQL 密碼、第三方廠商 API 密鑰）
2. **核心內部 API 端點（錢包、代理更新）缺乏認證機制**
3. **自定義 Token 系統使用弱 SECRET（`lc218.com`）**
4. **CORS 完全開放（`app.use(cors())`）**
5. **MySQL 連線開啟 `multipleStatements: true`**

---

## 嚴重漏洞 CRITICAL

---

### CRIT-001: 真實生產憑證洩露於代碼庫

**漏洞名稱**: 敏感資訊洩露 / Secret Leakage in Repository

**描述**:
多個真實生產環境憑證被直接寫入 `.env` 檔案並提交至版本控制系統：

```
# game_api/.env
MYSQL_PASSWORD='123456'
MYSQL_HOST=52.197.76.238          ← 真實公開 IP
KYS_ADMIN_TOKEN='55d5aAa34B016122d12647a59BbEeE4CdAe318e3485033d0680Fb37F27100912'
KYS_Token_Secret='19bd4ca9711247f39b65b42a88bff4bc'
XPG_Token_Secret='FKHfB2BcnGUUzc6DGd2rggsYBZZMWqmX'
TOKEN_SECRET='lc218.com'          ← 極弱 JWT/自定義 Token Secret
gitLabChdataUrl='https://kay_read:n_6sZtVQCbzG4HXYncNM@git-ewwk.qyrc452.com/...'  ← Git 憑證

# dashboard/.env
DEFAULT_DB_MASTER_PASSWORD="123456"
DEFAULT_DB_MASTER_HOST=52.197.76.238
PROFIT_ALERT_TELEGRAM_BOT_TOKEN='6320115819:AAGlFUAt9GdKcaU7KdQ3_PmviiSPXHCe_xQ'  ← 真實 Telegram Bot Token!
PROFIT_ALERT_TELEGRAM_CHAT_ID='-4280689330'
PLATFORM_SECRET=secret
PLATFORM_DATADIG_AES_KEY=fd295FAGApiuDGLQ

# dashboard/.env 中 manage.config.js 使用
module.exports.loginAesKey = 'fd295FAGApiuDGLQ';   ← 硬編碼 AES Key
module.exports.sessionSecret = 'hello world';       ← 硬編碼 Session Secret
```

**嚴重度**: 🔴 CRITICAL

**攻擊情境**:
1. 攻擊者取得代碼庫存取權（內部人員、代碼庫洩露）→ 立即取得全部資料庫、Redis、第三方廠商管理後台存取權
2. `PROFIT_ALERT_TELEGRAM_BOT_TOKEN` 為真實有效 Token → 可控制 Telegram Bot 發送釣魚訊息、監聽群組
3. MySQL `root` 帳號密碼 `123456` 搭配公開 IP → 可直接連線生產資料庫

**修復建議**:
- 立即輪換所有已洩露的憑證（DB 密碼、API Key、Token）
- 從 git history 中移除敏感資料（`git filter-branch` 或 `BFG Repo Cleaner`）
- 使用 Vault / AWS Secrets Manager / GitHub Secrets 管理憑證
- `.env` 加入 `.gitignore`，只保留 `.env.example`（無真實值）
- 啟用 git pre-commit hook（`gitleaks`、`truffleHog`）防止憑證提交

**是否需要源碼確認**: 否（已在 .env 文件中直接確認）

---

### CRIT-002: 核心內部 API 端點無認證

**漏洞名稱**: Missing API Authentication on Internal Endpoints

**描述**:
`wallet` 服務（Port 2100）、`platform` 服務（Port 3050）、`game` 服務（Port 10000）的路由完全無認證中間件：

```javascript
// wallet/init.js
httpServer.app.use('/player', require('./routes/player'));       // 無認證!
httpServer.app.use('/agent', require('./routes/agent'));         // 無認證!
httpServer.app.use('/exchange', require('./routes/exchange'));   // 無認證!

// wallet/routes/player.js - 高危端點
router.post('/deposit', playerController.deposit);              // 存款!
router.post('/credit', playerController.credit);                // 加分!
router.post('/playerDepositAgentCredit', ...);                  // 存款→代理加分!
router.post('/agentDepositPlayerCredit', ...);                  // 代理→玩家!
router.post('/rollback', playerController.rollback);            // 回滾!

// platform/routes/platformHandle.js
router.post('/updateAgent', platformController.updateAgent);    // 更新代理!
router.post('/updateAccountStatus', ...);                       // 封禁帳號!
router.post('/batchAddKillList', ...);                          // 批量加 Kill!
router.post('/killStrategyConfig', ...);                        // Kill 策略配置!
```

**嚴重度**: 🔴 CRITICAL

**攻擊情境**:
1. 攻擊者若能到達內網（VPN、SSRF、同機其他服務漏洞）→ 直接 POST `/player/deposit` 任意金額到任意帳號
2. POST `/player/credit` → 直接操控玩家積分
3. POST `/platform/updateAgent` → 更改代理設定、注入惡意路由
4. 若 docker-compose 中端口外映射 → 任何人均可直接呼叫

**修復建議**:
- 所有內部 API 加入 shared-secret 驗證（請求頭 `X-Internal-Token`）
- 或使用 mutual TLS（mTLS）做服務間認證
- 錢包端點加入冪等性保護（order ID 唯一鍵）
- 配置防火牆/iptables 確保這些端口僅接受特定 IP 請求

**是否需要源碼確認**: 否（已確認路由無中間件）

---

### CRIT-003: 自定義弱 Token 系統

**漏洞名稱**: Weak Custom Token Implementation

**描述**:
`game_api` 使用自定義 HMAC-SHA256 Token 取代標準 JWT：

```javascript
// token.js
const secret = gameConfig.tokenSecret;  // TOKEN_SECRET='lc218.com' (極弱!)

let token = {
    createToken: function (data, timeout) {
        let payload = {
            data: data,
            created: parseInt(Date.now() / 1000),
            exp: parseInt(timeout) || 150    // 默認只有 150 秒!
        };
        let base64Str = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
        let hash = crypto.createHmac('sha256', secret);
        hash.update(base64Str);
        let signature = hash.digest('base64');
        return base64Str + '.' + signature;
    },
    checkToken: function (token, data) {
        // 只驗證 account 和 machineName
        if (data.account != payload.account) { return false; }
        if (data.machineName != payload.machineName) { return false; }
        // 時間驗證以秒為單位，未使用常數時間比較!
        let expState = (parseInt(Date.now() / 1000) - parseInt(token.payload.created)) > parseInt(token.payload.exp) ? false : true;
        if (token.signature === token.checkSignature && expState) {  // 字串比較可能 timing attack!
```

**嚴重度**: 🔴 CRITICAL

**問題**:
1. `TOKEN_SECRET='lc218.com'` — 弱秘鑰，可被字典攻擊
2. 使用字串等值比較（`===`）驗證簽名 → Timing Attack 可能
3. Payload 僅 Base64 編碼，非加密 → 可解碼查看敏感資料
4. 非標準格式，難以稽核和維護

**修復建議**:
- 使用強隨機 TOKEN_SECRET（至少 256-bit 隨機值）
- 改用標準 JWT（HS256 最低，RS256 更佳）
- 使用 `crypto.timingSafeEqual()` 比較簽名

**是否需要源碼確認**: 否

---

### CRIT-004: CORS 完全開放

**漏洞名稱**: CORS Misconfiguration — Wildcard Origin

**描述**:
```javascript
// dashboard/app/libraries/host.library.js:46
this.app.use(cors());   // 無 origin 限制 = 允許任何來源!

// game_api/server/src/core/base/httpServer.js
// 未見 cors 設定 → 無 CORS 頭（但無限制）
```

**嚴重度**: 🔴 CRITICAL

**攻擊情境**:
任何惡意網站可以在登入用戶的瀏覽器中向 dashboard API（Port 19200）發送跨域請求，並攜帶 Cookie/Header 中的認證資訊 → CSRF 攻擊 → 可呼叫任意後台 API

**修復建議**:
```javascript
app.use(cors({
    origin: ['https://admin.yourdomain.com'],
    credentials: true,
    methods: ['GET', 'POST'],
}));
```

**是否需要源碼確認**: 否

---

### CRIT-005: MySQL multipleStatements 啟用

**漏洞名稱**: SQL Injection Amplification via multipleStatements

**描述**:
```javascript
// dbConfig.js - 多個資料庫連線池
api_mysql_config: {
    multipleStatements: true,    // 允許一次請求執行多條 SQL!
    namedPlaceholders: true,
}
wallet_mysql_config: {
    multipleStatements: true,
}
// ... 幾乎所有連線池均如此設定
```

**嚴重度**: 🔴 CRITICAL

**攻擊情境**:
若任何端點存在 SQL Injection 漏洞，攻擊者可：
1. 執行 `SELECT 1; DROP TABLE game_record; --` 刪除資料表
2. 執行 `INSERT INTO accounts VALUES ('hacker', 'admin')` 創建後門帳號
3. 執行 `UPDATE wallet SET balance=99999999` 修改餘額

**修復建議**:
- **立即關閉 `multipleStatements: true`**（breaking change 但必要）
- 確保所有 SQL 使用 Parameterized Query

**是否需要源碼確認**: 否

---

### CRIT-006: 文件上傳無類型驗證

**漏洞名稱**: Arbitrary File Upload via logoServer

**描述**:
```javascript
// logoServer/routes/index.js
const formidable = require('formidable');
const config = {
    upload: '/home/d3dev/website/',   // 直接寫入 Web 服務目錄!
    url: 'http://127.0.0.1',
};

router.post('/', function(req, res) {
    // 僅透過 Redis key 驗證，無文件類型/大小限制!
    dbHelper.redisHelper.get(key, (error, imgPath) => {
        // 直接寫入文件系統
        getfiles(res, req, root, imgPath);
    });
});
```

**嚴重度**: 🔴 CRITICAL

**攻擊情境**:
1. 取得有效 Redis Key（通過 `/createKey` 端點，無認證）
2. 上傳 `.php` 或 `.js` WebShell 至 `/home/d3dev/website/`
3. 若 Web Server 配置允許執行 → 取得 RCE

**修復建議**:
- 嚴格驗證文件類型（Magic Bytes，非 MIME Type）
- 文件上傳至非 Web 根目錄或 S3/OSS
- 重命名文件（UUID）
- 限制文件大小
- `/createKey` 端點加入認證

**是否需要源碼確認**: 部分（需確認 getfiles 函式實作）

---

## 高風險漏洞 HIGH

---

### HIGH-001: 速率限制使用記憶體（非分散式）

**漏洞名稱**: Rate Limiter In-Memory — Bypass via Multiple Instances

**描述**:
```javascript
// rateLimit.middleware.js
const rateLimiter = new RateLimiterMemory({ points: 20 });
```

只有 20 個請求點數，但使用 `RateLimiterMemory`（記憶體）而非 Redis。
當 PM2 cluster 模式啟動多個 instance 時，每個 instance 各自計算 → 可輕易繞過。

**嚴重度**: 🟠 HIGH

**攻擊情境**: 攻擊者透過多個 Worker 節點繞過速率限制 → 暴力破解登入

**修復建議**: 改用 `RateLimiterRedis`

---

### HIGH-002: 舊版 Node.js v16（EOL）

**漏洞名稱**: End-of-Life Node.js Runtime

**描述**:
```dockerfile
FROM node:16-alpine3.15
```
Node.js 16 已於 2023 年 9 月停止維護，無安全更新。
已知多個安全漏洞（CVE-2023-44487 HTTP/2 Rapid Reset 等）。

**嚴重度**: 🟠 HIGH

**修復建議**: 升級至 Node.js 22 LTS

---

### HIGH-003: Redis 無密碼

**漏洞名稱**: Redis Exposed Without Authentication

**描述**:
```
# game_api/.env
REDIS_PASSWORD=''

# docker-compose.yaml
redis:
    ports:
        - 6379:6379    # 直接映射到主機!
    # 無 requirepass 配置!
```

**嚴重度**: 🟠 HIGH

**攻擊情境**:
1. 若主機 6379 可被存取 → 攻擊者可直接讀取 Redis（包含玩家 Token、黑名單、快取資料）
2. `KEYS *` 列出所有快取鍵
3. 修改 Redis 中的 Agent 資訊、黑名單

**修復建議**:
- Redis 設定強密碼（`requirepass`）
- Redis bind 到內網 IP，禁止 0.0.0.0
- 使用 Redis 6 ACL 最小權限原則

---

### HIGH-004: 遊戲注單竄改風險（game_server 未知）

**漏洞名稱**: Game Result Forgery Risk

**描述**:
`gameRecord server (5000)` 接收並保存遊戲注單，但：
- 游戲結果生成邏輯（game_server）原始碼不可得
- 無法驗證 `/gameRecordHandle` 端點是否有簽名驗證
- `platform/killStrategyConfig` 端點可配置 Kill Rate（莊家優勢調整）

```javascript
// platform routes
router.post('/killStrategyConfig', platformController.killStrategyConfig);
router.post('/batchAddKillList', platformController.batchAddKillList);
```

此類端點若無嚴格認證/稽核，可人為操控遊戲結果分配。

**嚴重度**: 🟠 HIGH（博弈平台核心風險）

**修復建議**:
- killStrategyConfig 變更需要多人審批流程
- 所有 Kill Rate 變更記錄至不可篡改的稽核日誌
- 遊戲結果需包含可驗證的隨機數種子（可由玩家事後驗證）

**是否需要源碼確認**: 需要 game_server 原始碼

---

### HIGH-005: 批量上下分操作無冪等保護

**漏洞名稱**: Race Condition / Replay Attack on Wallet Operations

**描述**:
```javascript
// wallet/routes/player.js
router.post('/deposit', playerController.deposit);
router.post('/credit', playerController.credit);
router.post('/rollback', playerController.rollback);
router.post('/playerDepositAgentCredit', ...);
```

錢包存取操作未確認是否有冪等鍵（Idempotency Key）保護。若重複請求可被重放，攻擊者可重複執行同一存款請求。

**嚴重度**: 🟠 HIGH

**攻擊情境**: 截獲合法存款請求封包 → 重放 → 重複加分

**修復建議**:
- 每筆交易必須有唯一 `orderId`，資料庫加 UNIQUE 約束
- 使用 MySQL transaction + SELECT FOR UPDATE 防止並發問題

**是否需要源碼確認**: 需確認 wallet controller 實作

---

### HIGH-006: 多帳號濫用/同桌套利風險

**漏洞名稱**: Multi-Account Abuse / Same Table Arbitrage

**描述**:
後台有 `sameTableAccount.js` API 及 `reduceScoreBlackList` 功能，顯示系統已知此問題但透過黑名單被動防禦：

```
dashboard-frontend/src/api/riskManagement/sameTableAccount.js
dashboard-frontend/src/api/riskManagement/reduceScoreBlackList.js
```

**嚴重度**: 🟠 HIGH

**修復建議**:
- 主動偵測同 IP/裝置多帳號
- 新帳號有期間性限制（防止即時套利）

---

### HIGH-007: Swagger UI 在非生產環境可公開存取

**漏洞名稱**: API Documentation Exposed in Development

**描述**:
```javascript
// dataService/init.js
if (!process.env.NODE_ENV || process.env.NODE_ENV == 'dev') {
    // Swagger UI with tryItOutEnabled: true ← 可直接呼叫 API!
    httpServer.app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(..., {
        swaggerOptions: { tryItOutEnabled: true },
    }));
}
```

若 dev/sit 環境可被外部存取，Swagger UI 直接暴露所有 API 端點並允許互動測試。

**嚴重度**: 🟠 HIGH（dev/sit 環境）

**修復建議**:
- 確保 dev/sit 環境不可公開存取
- 或加入 Basic Auth 保護 Swagger UI

---

### HIGH-008: AES 金鑰硬編碼在多處

**漏洞名稱**: Hardcoded AES Keys

**描述**:
```javascript
// manage.config.js
module.exports.loginAesKey = 'fd295FAGApiuDGLQ';    // 硬編碼!
module.exports.dataDigAESKEY = config.platform.aesKey;  // fd295FAGApiuDGLQ

// game_api/.env
KEY_AES_DATADIG='fd295FAGApiuDGLQ'
KEY_GAMESERVER_AES='9B1A999D5FF730D8'
KEY_GAMESERVER_MD5='A53D3B55A0C85EB7'
```

同一個 AES Key 在多個系統中使用 → 一旦洩露影響全系統加密。

**嚴重度**: 🟠 HIGH

---

### HIGH-009: Nginx CORS 路由比對使用 case-insensitive 正則

**漏洞名稱**: Nginx Route Bypassing via Case Manipulation

**描述**:
```nginx
# nginx.conf
location ~* ^/(resource|login|winAndLoseReport|...) {
    proxy_pass http://${APIHOST}:19200;
}
location / {
    root /usr/share/nginx/html;
}
```

`~*` 為不分大小寫，但 Express 設定了 `case sensitive routing: true`。
某些路徑可能被 Nginx 直接服務靜態文件（location /），繞過後端認證。

**嚴重度**: 🟠 HIGH

---

## 中風險漏洞 MEDIUM

---

### MED-001: JWT 使用相同 Secret 簽發 Access/Refresh Token

**漏洞名稱**: JWT Secret Reuse for Access and Refresh Tokens

```javascript
class JWTLibrary {
    constructor() {
        this.secret = encrypt.token;  // 同一個 secret
    }
    generateAccessToken(payload) { return jwt.sign(payload, this.secret, { expiresIn: '10m' }); }
    generateRefreshToken(payload) { return jwt.sign(payload, this.secret, { expiresIn: '10h' }); }
}
```

Refresh Token 可被用作 Access Token（同 secret）。

**嚴重度**: 🟡 MEDIUM

---

### MED-002: IP 驗證可被偽造

**漏洞名稱**: IP Spoofing via X-Forwarded-For

```javascript
// authorization.middleware.js
const clientIP = requestExtendLibrary.getIP(request);
if (config.isEnableCheckIP && userInfo.ip !== clientIP) {
    throw new APIErrorResponse(...);
}
```

若 `getIP` 優先讀取 `X-Forwarded-For`，且系統信任所有代理 → 攻擊者可偽造 IP。

**嚴重度**: 🟡 MEDIUM

---

### MED-003: Debug 模式資訊洩露

**漏洞名稱**: Swagger/Debug Mode Leaks in Non-Prod

已在 HIGH-007 詳述，此處補充：
- `swagger-autogen` 可能在 response 中暴露 schema 細節
- Error stack trace 可能在某些端點中洩露

**嚴重度**: 🟡 MEDIUM

---

### MED-004: Session Secret 弱值

```javascript
// manage.config.js
module.exports.sessionSecret = 'hello world';
```

**嚴重度**: 🟡 MEDIUM

---

### MED-005: Redis KEYS 命令使用

```javascript
// redisUtil.js
redisUtil.prototype.getKeys = function (key, callback) {
    this.redisClient.keys(key.toString(), callback);  // O(N) 阻塞操作!
};
```

`KEYS *` 在生產環境中會造成 Redis 阻塞，可能影響所有使用 Redis 的服務。

**嚴重度**: 🟡 MEDIUM（可用性影響）

**修復建議**: 改用 `SCAN` 指令

---

### MED-006: Node.js 依賴舊版套件

- `mysql` (2.x) — deprecated，應使用 `mysql2`
- `redis` (3.x) — 舊版，已有 v4+ 版本
- `request` (2.88.2) — deprecated
- `moment` — deprecated，應使用 `dayjs`/`date-fns`

**嚴重度**: 🟡 MEDIUM

---

### MED-007: 沒有 CSP（Content Security Policy）Header

Dashboard frontend 未配置 CSP，若存在 XSS 漏洞則攻擊者可執行任意 JavaScript。

**嚴重度**: 🟡 MEDIUM

---

### MED-008: 未加密的 HTTP 內部通訊

服務間通訊使用 HTTP（非 HTTPS），如：
```
GAME_API_SERVER=http://127.0.0.1:1029
INTERDEPARTMENTAL_SERVER=http://127.0.0.1
```

若機器間通訊跨越網段且未加密 → 中間人攻擊可截獲/竄改請求。

**嚴重度**: 🟡 MEDIUM（取決於網路架構）

---

## 低風險漏洞 LOW

### LOW-001: 無 HTTP Security Headers（部分）
Helmet 已在 dashboard 使用，但 game_api 的 httpServer.js 未見 Helmet。

### LOW-002: 日誌中可能包含敏感資料
`utils.log()` 記錄完整請求/錯誤，可能包含 Token、密碼等資訊。

### LOW-003: Docker Base Image 使用 Alpine 3.15（舊版）
Alpine 3.15 已 EOL，應升級至 3.20+。

### LOW-004: 部分端點缺乏輸入驗證
`express-validator` 已引入，但需確認所有端點均有使用。

---

## 主要風險清單

| ID | 漏洞名稱 | 嚴重度 | CVSS 估算 | 狀態 |
|----|---------|-------|---------|------|
| CRIT-001 | 憑證洩露於代碼庫 | CRITICAL | 9.8 | 已確認 |
| CRIT-002 | 內部 API 無認證 | CRITICAL | 9.1 | 已確認 |
| CRIT-003 | 弱 Token Secret | CRITICAL | 8.8 | 已確認 |
| CRIT-004 | CORS 完全開放 | CRITICAL | 8.8 | 已確認 |
| CRIT-005 | MySQL multipleStatements | CRITICAL | 8.5 | 已確認 |
| CRIT-006 | 文件上傳無驗證 | CRITICAL | 9.0 | 已確認（需確認細節）|
| HIGH-001 | 速率限制記憶體儲存 | HIGH | 7.5 | 已確認 |
| HIGH-002 | Node.js v16 EOL | HIGH | 7.5 | 已確認 |
| HIGH-003 | Redis 無密碼 | HIGH | 8.1 | 已確認 |
| HIGH-004 | 遊戲結果竄改風險 | HIGH | 7.5 | 需 game_server 確認 |
| HIGH-005 | 錢包操作無冪等保護 | HIGH | 7.5 | 需確認 |
| HIGH-006 | 多帳號套利 | HIGH | 7.0 | 需確認 |
| HIGH-007 | Swagger UI 開放 | HIGH | 7.5 | 已確認 |
| HIGH-008 | AES 金鑰硬編碼 | HIGH | 7.5 | 已確認 |
| HIGH-009 | Nginx 路由繞過 | HIGH | 6.5 | 已確認 |
| MED-001 | JWT Secret 複用 | MEDIUM | 5.5 | 已確認 |
| MED-002 | IP 驗證可偽造 | MEDIUM | 5.0 | 需確認 |
| MED-003 | Debug 模式洩露 | MEDIUM | 5.3 | 已確認 |
| MED-004 | 弱 Session Secret | MEDIUM | 4.5 | 已確認 |
| MED-005 | Redis KEYS 阻塞 | MEDIUM | 4.0 | 已確認 |
| MED-006 | 舊版依賴套件 | MEDIUM | 4.0 | 已確認 |
| MED-007 | 無 CSP Header | MEDIUM | 4.3 | 已確認 |
| MED-008 | HTTP 內部通訊 | MEDIUM | 5.0 | 已確認 |

---

## 建議修復優先順序

### 立即處理（P0 — 24 小時內）

1. **輪換所有已洩露憑證**（DB 密碼、Telegram Bot Token、API Keys）
2. **從 git history 清除憑證**
3. **確認錢包 API 端口是否可公開存取**，若是立即封鎖

### 緊急處理（P1 — 1 週內）

4. 內部 API 加入 shared-secret 或 mTLS 認證
5. 關閉 MySQL `multipleStatements`
6. logoServer 加入文件類型/大小驗證及認證
7. CORS 設定白名單

### 高優先（P2 — 1 個月內）

8. 升級 Node.js 至 v22 LTS
9. Redis 設定強密碼並移除公開端口映射
10. Token Secret 改為強隨機值
11. 速率限制改為 Redis 後端

### 中優先（P3 — 季度內）

12. 錢包操作加入冪等保護
13. JWT 使用不同 Secret 簽發 Access/Refresh Token
14. 升級舊版依賴套件
15. 加入 CSP Header

---

## 缺失資訊

1. **game_server 源碼** — 遊戲結果竄改漏洞無法完整驗證
2. **wallet controller 完整實作** — 冪等性保護確認
3. **網路架構圖** — 確認哪些端口實際可從外部存取
4. **防火牆規則** — iptables / 安全組配置
5. **實際生產 .env** — 確認是否與代碼庫中相同
6. **Nginx 生產配置** — 完整 SSL/HTTPS 設定
