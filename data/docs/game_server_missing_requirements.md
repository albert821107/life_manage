# game_server 缺失資訊需求報告
## Game Server Missing Requirements

---

## 目錄 Table of Contents

1. [執行摘要](#執行摘要)
2. [無法分析的範圍](#無法分析的範圍)
3. [所需原始碼清單](#所需原始碼清單)
4. [所需二進位/執行檔清單](#所需二進位執行檔清單)
5. [所需協議/通訊規範](#所需協議通訊規範)
6. [所需日誌範本](#所需日誌範本)
7. [所需配置文件](#所需配置文件)
8. [無法驗證的安全風險](#無法驗證的安全風險)
9. [架構分析的缺口](#架構分析的缺口)
10. [業務邏輯無法確認的部分](#業務邏輯無法確認的部分)
11. [下一步行動](#下一步行動)

---

## 執行摘要

**Further analysis requires game_server source code.**

`game_server` 是整個博弈平台的**最核心組件**，負責遊戲邏輯執行、亂數生成（RNG）、賠率計算和遊戲結果判定。然而目前 `game_server` 目錄下**無任何可分析的原始碼**。

在缺乏 `game_server` 原始碼的情況下，以下關鍵安全和業務問題**完全無法評估**：

1. 遊戲結果是否可被操控（最高優先）
2. 亂數生成機制是否安全（RNG 驗證）
3. 玩家與 game_server 的通訊協議是否可被模擬/偽造
4. WebSocket/TCP 連線是否有加密和認證
5. 賠率配置是否可被即時竄改
6. 防作弊機制的強度

---

## 無法分析的範圍

### 1. 遊戲結果生成邏輯

目前已知 `game_api` 的 `game server (port 10000)` 與 game_server 通訊，但：
- game_server 的地址從 `bgDeployment` 資料庫讀取（動態配置）
- 通訊協議未知
- 結果生成/驗證邏輯未知

```javascript
// game_api 已知部分
// bgDeployment.repository.js
async query() {
    const sql = `SELECT * FROM KYDB_NEW.bgDeployment WHERE type <> "0"`;
    // 返回 gameServer, outGameServer, manageGameServer 等地址
}
```

**無法分析**:
- game_server 如何生成遊戲結果
- 是否使用可驗證的 Provably Fair 機制
- 結果是否在生成後可被後端修改

### 2. 客戶端-伺服器通訊協議

已知 `channel server (port 2090)` 是玩家入口，但：
- 玩家客戶端是透過 HTTP、WebSocket 還是 TCP 連線？
- 封包格式未知（二進位/JSON/Protobuf/自定義格式？）
- 加密方式未知

### 3. 防作弊機制

- 是否有客戶端完整性驗證？
- 是否有封包重放保護？
- 是否有 Bot/自動化偵測？
- 是否有封包篡改偵測？

### 4. Jackpot 觸發機制

後台有完整的 Jackpot 管理功能（`jackpotManage`、`jackpotPoolManagement`、`jackpotPayoutRecord`），但：
- Jackpot 觸發條件邏輯未知
- 是否可被後端人員手動觸發？
- 觸發機率配置在哪裡？

### 5. Kill Rate 實際應用

後台有 `killRateAdjustment`、`killManagement` 功能，且有：
```javascript
// manage.config.js
module.exports.killRate = 0.028;
```

但 Kill Rate 如何影響遊戲結果的具體算法完全未知。

---

## 所需原始碼清單

以下為完整分析 game_server 所需的所有原始碼文件：

### 核心業務邏輯
```
game_server/
├── src/
│   ├── game/               # 各遊戲類型邏輯
│   │   ├── slots/          # 老虎機邏輯
│   │   ├── poker/          # 撲克遊戲邏輯
│   │   ├── baccarat/       # 百家樂邏輯
│   │   └── ...
│   ├── rng/                # 亂數生成器
│   │   ├── rng.js/ts       # ← 最高優先
│   │   └── seed.js/ts      # 種子管理
│   ├── payout/             # 賠率計算
│   │   ├── paytable.js/ts  # 賠率表
│   │   └── calc.js/ts      # 計算邏輯
│   ├── jackpot/            # Jackpot 觸發邏輯
│   ├── auth/               # 認證/Token 驗證
│   ├── protocol/           # 通訊協議定義
│   └── server.js/ts        # 主伺服器入口
├── config/
│   ├── games.json/js       # 遊戲配置
│   ├── paytables/          # 賠率表文件
│   └── rtp.json            # Return to Player 配置
└── package.json
```

### 協議定義文件
```
game_server/
├── proto/                  # Protobuf 定義文件（若使用）
│   ├── game.proto
│   ├── wallet.proto
│   └── player.proto
└── protocol/
    ├── handler.js          # 封包處理器
    └── encoder.js          # 封包編碼器
```

---

## 所需二進位/執行檔清單

若 game_server 以編譯形式發布：

```
game_server/
├── *.exe              # Windows 可執行檔
├── *.so               # Linux 共享庫
├── *.dll              # Windows DLL
├── *.node             # Node.js Native Addon
├── pkg/               # 打包後的 Node.js 執行檔
├── nexe/              # nexe 打包執行檔
└── *.bin              # 其他二進位文件
```

**分析工具需求**（若為編譯二進位）:
- `strings` — 提取可讀字串
- `objdump` / `nm` — 符號表分析
- `ltrace` / `strace` — 系統呼叫追蹤
- `Ghidra` / `IDA Pro` — 反組譯
- `Frida` — 動態插樁分析

---

## 所需協議/通訊規範

### 1. 客戶端通訊協議文件

```
需求文件類型:
├── 協議版本定義
├── 封包格式規範（Header + Body）
├── 指令碼（Command Code）清單
├── 加密/壓縮方式說明
├── 心跳機制說明
└── 錯誤碼清單
```

### 2. 內部服務間通訊規範

```
game_api ←→ game_server 通訊:
├── 通訊方式（HTTP/WebSocket/TCP/gRPC）
├── 認證機制（Token/Signature）
├── API 端點清單
└── 資料格式（JSON/Protobuf/MessagePack）
```

### 3. 已知相關端口/地址

```javascript
// game_api/server/src/config/gameConfig.js 已知
KEY_GAMESERVER_MD5='A53D3B55A0C85EB7'      // 簽名 Key
KEY_GAMESERVER_AES='9B1A999D5FF730D8'      // 加密 Key

// bgDeployment 表欄位（推斷）
gameServer           // 主要遊戲服務器地址
outGameServer        // 外部遊戲服務器
manageGameServer     // 熱更新管理服務
machineName          // 機器名稱
type                 // 1=主服, 2=次服
```

---

## 所需日誌範本

以下日誌對補全架構分析至關重要：

### game_server 日誌範本
```
所需日誌類型:
├── 遊戲結果日誌（每局包含: 種子、結果、賠率）
├── 玩家連線/斷線日誌
├── 投注/結算日誌
├── 錯誤/異常日誌
└── 性能日誌（延遲、QPS）
```

### 通訊日誌範本
```
所需範本:
├── 封包 Dump 範本（加密前/後）
├── WebSocket 幀範本
├── TCP 連線日誌
└── 認證流程日誌
```

---

## 所需配置文件

```
game_server/config/ 或等效路徑:
├── game_config.json        # 遊戲基本配置
├── rtp_config.json         # 各遊戲 RTP 設定
├── jackpot_config.json     # Jackpot 觸發配置
├── kill_rate_config.json   # Kill Rate 配置
├── room_config.json        # 房間配置
├── bet_limit_config.json   # 投注限額
├── currency_config.json    # 幣種配置
└── .env 或 等效環境變數文件
```

---

## 無法驗證的安全風險

以下安全風險在缺少 game_server 源碼時**無法確認**：

| 風險 ID | 風險描述 | 風險等級 | 需要文件 |
|--------|---------|---------|---------|
| GS-001 | 遊戲結果可被後端人員手動竄改 | 🔴 CRITICAL | RNG 源碼、賠率計算邏輯 |
| GS-002 | Jackpot 觸發可被手動觸發 | 🔴 CRITICAL | Jackpot 觸發代碼 |
| GS-003 | Kill Rate 配置可繞過遊戲保護 | 🔴 CRITICAL | Kill Rate 應用邏輯 |
| GS-004 | 通訊協議可被模擬/偽造 | 🟠 HIGH | 協議定義文件 |
| GS-005 | 封包重放攻擊 | 🟠 HIGH | 協議 + 序列號機制 |
| GS-006 | RNG 可預測性 | 🟠 HIGH | RNG 實作源碼 |
| GS-007 | 客戶端反作弊強度 | 🟠 HIGH | 反作弊代碼 |
| GS-008 | WebSocket 認證強度 | 🟠 HIGH | 認證中間件代碼 |
| GS-009 | 遊戲狀態不一致（斷線重連）| 🟡 MEDIUM | 狀態管理代碼 |
| GS-010 | 壓縮/加密協議強度 | 🟡 MEDIUM | 協議層代碼 |

---

## 架構分析的缺口

### 已知但未確認的架構組件

1. **藍綠部署切換機制**
   - `bgDeployment` 表包含 `gameServer`/`outGameServer` 地址
   - 切換邏輯在 game_server 端如何實現？

2. **熱更新機制**
   - `gitLabChdataUrl` 顯示 game_server 有熱更新機制（從 GitLab 拉取 chdata）
   - 熱更新如何影響執行中的遊戲局？

3. **pomelo-rpc 使用**
   - `game_api/package.json` 包含 `pomelo-rpc`
   - 是否用於 game_server ↔ game_api 通訊？

4. **Moleculer 與 game_server 的關係**
   - playerInfo Moleculer 節點收集遊戲數據
   - 數據從 game_server 推送還是拉取？

---

## 業務邏輯無法確認的部分

| 業務流程 | 缺失資訊 | 影響 |
|--------|---------|-----|
| 玩家登入遊戲 | 最終進入 game_server 的流程 | 無法評估認證安全性 |
| 遊戲結果生成 | RNG + 賠率計算完整流程 | 無法評估公平性 |
| 斷線重連處理 | 未完成局的處理邏輯 | 無法評估資金安全 |
| Jackpot 分配 | 觸發條件和分配算法 | 無法評估操控風險 |
| Kill Rate 應用 | 何時/如何影響結果分配 | 無法評估合規性 |
| 試玩模式隔離 | 試玩與正式模式的資金隔離 | 無法評估資金安全 |
| 機器人識別 | Bot 偵測算法 | 無法評估反作弊強度 |
| 多幣種換算 | 遊戲內幣種與平台幣種換算 | 無法評估精度問題 |

---

## 下一步行動

### 立即行動（取得源碼後優先分析）

```
優先順序 1（安全關鍵）:
□ RNG 實作 → 驗證熵源質量
□ 遊戲結果生成 → 確認無後門竄改介面
□ Jackpot 觸發 → 確認無手動觸發介面
□ 通訊認證 → 確認無法偽造

優先順序 2（業務完整性）:
□ Kill Rate 應用算法
□ 賠率計算精度（浮點問題）
□ 並發處理（多人同桌）

優先順序 3（DevOps）:
□ 熱更新機制安全性
□ 藍綠切換影響範圍
□ 性能瓶頸識別
```

### 替代分析方案（若無法取得源碼）

若 game_server 為黑盒或第三方提供：

1. **網路封包分析**（需授權環境）
   - Wireshark 抓包分析通訊協議
   - 確認加密方式

2. **行為測試**
   - 設計測試用例驗證 Kill Rate 行為
   - 壓力測試並發場景

3. **日誌分析**
   - 分析現有遊戲結果日誌的分布統計
   - 驗證 RNG 輸出的隨機性（Chi-square test）

4. **API Fuzzing**
   - 對 game server 端點進行 Fuzz 測試
   - 發現未文件化的功能或漏洞
