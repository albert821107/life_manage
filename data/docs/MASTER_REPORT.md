# 主報告：完整分析總覽
## Master Report — Full Platform Analysis

> 生成日期: 2026-05-16
> 分析範圍: dashboard / dashboard-frontend / game_api / game_record_parser / kysport / env / start_all.sh
> 排除範圍: game_server（原始碼不存在）

---

## 目錄 Table of Contents

1. [分析目錄樹](#分析目錄樹)
2. [系統快照摘要](#系統快照摘要)
3. [主要風險總表](#主要風險總表)
4. [缺失資訊檢查清單](#缺失資訊檢查清單)
5. [建議下一步路線圖](#建議下一步路線圖)
6. [各報告索引](#各報告索引)

---

## 分析目錄樹

```
/Users/lt-133/Desktop/game/
│
├── analysis_reports/                    ← 本次分析產出
│   ├── MASTER_REPORT.md                 ← 本文件（總覽）
│   ├── system_architecture_analysis.md  ← 架構分析
│   ├── security_risk_analysis.md        ← 安全風險
│   ├── deployment_and_devops_analysis.md← DevOps 分析
│   ├── game_server_missing_requirements.md ← 缺失需求
│   ├── reverse_engineering_analysis.md  ← 逆向工程
│   ├── refactor_suggestion.md           ← 重構建議
│   ├── service_dependency_graph.md      ← 服務依賴圖
│   └── api_dataflow_analysis.md         ← API 資料流
│
├── dashboard/                           ← 後台管理系統（Node.js + Express）
│   ├── app/                             ← 主業務邏輯
│   │   ├── configs/                     ← 系統配置（DB、JWT、manage）
│   │   ├── constants/                   ← 業務常數（70+）
│   │   ├── controllers/                 ← HTTP 控制器（80+）
│   │   ├── core/                        ← DI 容器
│   │   ├── enums/                       ← 列舉（100+）
│   │   ├── libraries/                   ← 公用庫（JWT、i18n、RBAC）
│   │   ├── middlewares/                 ← 中間件（auth、rateLimit、CORS）
│   │   ├── providers/                   ← 外部服務提供者
│   │   ├── repositories/                ← 資料存取層
│   │   ├── routes/                      ← 路由定義（80+）
│   │   ├── services/                    ← 業務服務層
│   │   ├── server.js                    ← 服務啟動
│   │   └── [大量功能模組...]
│   ├── app_cron/                        ← 定時任務（排程服務）
│   ├── startups/                        ← 啟動腳本
│   ├── tools/                           ← 工具腳本（i18n、依賴分析）
│   ├── Jenkinsfile                      ← CI/CD（存在但未詳細）
│   ├── .env                             ← 🔴 含真實憑證！
│   └── package.json                     ← 依賴清單
│
├── dashboard-frontend/                  ← Vue.js 前端
│   ├── src/
│   │   ├── api/                         ← 前端 API 呼叫（200+ 文件）
│   │   │   ├── accountManagement/
│   │   │   ├── eventManagement/
│   │   │   ├── financeManagement/       ← 多廠商交收報表
│   │   │   ├── gameManagement/
│   │   │   ├── operationManagement/
│   │   │   ├── reportManagement/
│   │   │   ├── riskManagement/          ← Kill Rate、機器人、風控
│   │   │   ├── sportsRelated/
│   │   │   └── systemSetting/
│   │   ├── components/
│   │   ├── composables/
│   │   └── directive/
│   ├── scripts/
│   │   └── nginx.conf                   ← Nginx 配置
│   ├── web_server/                      ← 前端 Web 伺服器
│   ├── cypress/                         ← E2E 測試
│   └── package.json
│
├── game_api/                            ← 核心遊戲 API（40+ 服務）
│   ├── server/
│   │   └── src/
│   │       ├── app.js                   ← 統一入口（通過 serverId 分發）
│   │       ├── config/
│   │       │   ├── servers.js           ← 48 個服務配置
│   │       │   ├── dbConfig.js          ← 多資料庫配置
│   │       │   └── gameConfig.js        ← 廠商 API 金鑰
│   │       ├── core/
│   │       │   ├── auth/walletAuth.js
│   │       │   ├── base/httpServer.js   ← Express 基礎
│   │       │   ├── dao/                 ← 45+ DAO 文件
│   │       │   ├── db/
│   │       │   │   ├── dbHelper.js      ← 🔴 全連線池初始化
│   │       │   │   └── redisUtil.js     ← Redis 工具
│   │       │   └── middleware/
│   │       └── servers/
│   │           ├── channel/             ← 玩家入口
│   │           ├── game/                ← 遊戲核心
│   │           ├── wallet/              ← 錢包服務
│   │           ├── dataService/         ← 資料匯聚
│   │           ├── platform/            ← 後台接入
│   │           ├── statistics/          ← 統計
│   │           ├── gameRecord/          ← 注單保存
│   │           ├── manage/              ← 代理管理
│   │           ├── notification/        ← 通知
│   │           ├── logoServer/          ← 🔴 文件上傳（無驗證）
│   │           ├── vendor/              ← 20 個廠商適配器
│   │           └── timerTask/           ← 20 個廠商定時任務
│   ├── .env                             ← 🔴 含真實憑證！公開 IP！
│   ├── server_a.json                    ← PM2: 24 個廠商/核心服務
│   ├── server_b.json                    ← PM2: manage
│   ├── server_c.json                    ← PM2: 核心資料服務
│   ├── server_d.json                    ← PM2: 定時任務
│   ├── docker-compose.yaml              ← 🔴 Redis 無密碼、端口全映射
│   └── Dockerfile                       ← 🔴 Node.js v16（EOL）
│
├── game_record_parser/                  ← TypeScript 注單解析器
│   ├── src/
│   │   ├── controllers/
│   │   ├── services/
│   │   ├── repositories/
│   │   ├── models/
│   │   └── utils/
│   ├── env/                             ← 多品牌環境配置（含密碼）
│   └── package.json                     ← TypeScript + TSOA + Vue SSR
│
├── kysport/                             ← Next.js 15 體育賽事
│   ├── app/
│   │   ├── actions/
│   │   ├── api/
│   │   ├── components/
│   │   └── lib/
│   └── package.json                     ← Next.js 15.5
│
├── env/                                 ← 多品牌 env 目錄
│   ├── YL/ LY/ KX/ NW/ V8/ BW/ GKX/   ← 各品牌設定
│   └── WC1/ WC3/ ...                   ← 其他環境
│
├── dashboard_frontend_build/            ← 前端建構產物（略過）
├── game_record_parser_build/            ← Parser 建構產物（略過）
│
└── start_all.sh                         ← PM2 一鍵啟動腳本
```

---

## 系統快照摘要

| 項目 | 值 |
|-----|---|
| 系統類型 | 多品牌博弈/遊戲平台（B2B）|
| 支援品牌 | YL、LY、KX、NW、V8、BW、GKX、CU、VP 等 9+ |
| 服務數量 | 48 個 PM2 進程 + dashboard + kysport |
| 第三方廠商 | 20 家遊戲廠商整合 |
| 技術棧 | Node.js v16 + Express.js + MySQL + Redis + Moleculer |
| 前端框架 | Vue.js 3 (dashboard) + Next.js 15 (kysport) |
| 程序管理 | PM2 (cluster/fork mode) |
| 容器化 | Docker（僅 game_api 完整）|
| CI/CD | Jenkins（僅 dashboard，未完整）|
| 認證機制 | JWT (dashboard) + 自定義 HMAC Token (game_api) |
| 資料庫 | MySQL 主從（25+ 個資料庫）+ Redis 快取 |
| 遊戲 game_server | ❌ 原始碼不存在，無法分析 |

---

## 主要風險總表

| ID | 類型 | 嚴重度 | 說明 | 修復工作量 | 狀態 |
|----|-----|-------|------|----------|------|
| CRIT-001 | 安全 | 🔴 CRITICAL | 真實憑證提交至代碼庫（DB 密碼、Telegram Token、API Keys）| 中 | 立即處理 |
| CRIT-002 | 安全 | 🔴 CRITICAL | 錢包/平台 API 完全無認證（/player/deposit 無保護）| 中 | 立即處理 |
| CRIT-003 | 安全 | 🔴 CRITICAL | 自定義 Token 使用弱密鑰 `lc218.com` + 算法可逆 | 低 | 立即處理 |
| CRIT-004 | 安全 | 🔴 CRITICAL | CORS 完全開放（`app.use(cors())`）| 低 | 立即處理 |
| CRIT-005 | 安全 | 🔴 CRITICAL | MySQL multipleStatements=true（SQL Injection 放大）| 低 | 立即處理 |
| CRIT-006 | 安全 | 🔴 CRITICAL | 文件上傳（logoServer）無類型驗證，寫入 Web 目錄 | 低 | 立即處理 |
| HIGH-001 | 安全 | 🟠 HIGH | 速率限制使用記憶體（PM2 多 Worker 可繞過）| 低 | 1週內 |
| HIGH-002 | 安全 | 🟠 HIGH | Node.js v16 EOL，已停止安全更新 | 中 | 1月內 |
| HIGH-003 | 安全 | 🟠 HIGH | Redis 無密碼，端口直接映射主機 | 低 | 1週內 |
| HIGH-004 | 業務 | 🟠 HIGH | Kill Rate 配置無審計流程（遊戲結果可操控）| 高 | 1月內 |
| HIGH-005 | 安全 | 🟠 HIGH | 錢包操作缺乏冪等保護（重放攻擊風險）| 中 | 1月內 |
| HIGH-006 | 業務 | 🟠 HIGH | 多帳號套利防護為被動黑名單 | 中 | 季度內 |
| HIGH-007 | 安全 | 🟠 HIGH | Swagger UI 開放（dev 環境 tryItOutEnabled）| 低 | 立即 |
| HIGH-008 | 安全 | 🟠 HIGH | AES 金鑰硬編碼在代碼和配置文件中 | 中 | 1月內 |
| HIGH-009 | 安全 | 🟠 HIGH | Nginx 路由規則可能有繞過風險 | 低 | 1月內 |
| ARCH-001 | 架構 | 🟠 HIGH | 所有 40+ 服務共用同一代碼庫（偽微服務）| 極高 | 長期 |
| ARCH-002 | 架構 | 🟠 HIGH | dbHelper 全連線池初始化（資源浪費）| 中 | 1月內 |
| ARCH-003 | 架構 | 🟠 HIGH | 無 API Gateway（40+ 端口直接暴露）| 高 | 季度內 |
| ARCH-004 | 架構 | 🟡 MEDIUM | 無統一廠商接口（每廠商重複實作）| 高 | 季度內 |
| ARCH-005 | 架構 | 🟡 MEDIUM | Redis 單點（全平台依賴）| 中 | 1月內 |
| OPS-001 | 運維 | 🟠 HIGH | PM2 日誌設定為 NULL（錯誤日誌丟棄）| 低 | 立即 |
| OPS-002 | 運維 | 🟠 HIGH | 無應用程式監控（APM/Prometheus）| 高 | 季度內 |
| OPS-003 | 運維 | 🟡 MEDIUM | 無集中式日誌收集（ELK）| 高 | 季度內 |
| OPS-004 | 運維 | 🟡 MEDIUM | 無 CI/CD 標準化流程 | 高 | 季度內 |
| OPS-005 | 運維 | 🟡 MEDIUM | 無自動化災難復原機制 | 高 | 半年內 |
| DEBT-001 | 技術債 | 🟡 MEDIUM | Node.js mysql/redis 舊版套件 | 低 | 1月內 |
| DEBT-002 | 技術債 | 🟡 MEDIUM | moment.js / request deprecated | 低 | 1月內 |
| DEBT-003 | 技術債 | 🟡 MEDIUM | 缺乏單元測試（dashboard 後端）| 高 | 長期 |
| GS-001 | 業務 | 🔴 CRITICAL | 遊戲結果竄改風險（game_server 未知）| 未知 | 需源碼 |
| GS-002 | 業務 | 🔴 CRITICAL | Jackpot 觸發機制未知（可操控風險）| 未知 | 需源碼 |
| GS-003 | 安全 | 🟠 HIGH | 通訊協議可被模擬（Token 算法已知）| 中 | 需源碼 |

---

## 缺失資訊檢查清單

### 必需（影響架構/安全判斷）

```
□ game_server 原始碼
  → 阻擋: 遊戲公平性分析、RNG 驗證、通訊協議分析、防作弊評估

□ game_server 通訊協議文件
  → 阻擋: 協議模擬風險評估

□ 完整 Nginx 生產配置
  → 阻擋: SSL/HTTPS 驗證、路由安全性確認

□ MySQL Schema（資料表結構）
  → 阻擋: SQL Injection 影響範圍、資料模型設計評估

□ 實際生產 .env（是否與代碼庫中相同）
  → 阻擋: 確認憑證洩露嚴重程度
```

### 建議提供

```
□ 網路架構圖（防火牆、VPC、機器部署）
□ 各服務實際 QPS/TPS 資料
□ MySQL Replication 配置
□ Redis 持久化配置（AOF/RDB）
□ SLA 要求（可用性目標）
□ 防火牆/安全組規則
□ 最近 30 天異常告警記錄
□ 廠商接入技術文件（Whitepaper）
```

---

## 建議下一步路線圖

### Phase 0 — 立即行動（24 小時）

```
優先級 P0-CRITICAL:
□ 1. 輪換所有已洩露憑證
     ├── MySQL 密碼（root/123456）
     ├── Telegram Bot Token（6320115819:AAGl...）
     ├── KYS Admin Token
     ├── KYS/XPG Token Secrets
     └── TOKEN_SECRET / AES Keys

□ 2. 確認錢包 API（port 2100）是否可從外部存取
     └── 若是，立即封鎖防火牆規則

□ 3. 修正 PM2 日誌配置（移除 NULL）
     └── 確保錯誤日誌有記錄

□ 4. Swagger UI 關閉或加認證（若 dev 環境可外部存取）
```

### Phase 1 — 緊急修復（1 週）

```
□ 5. 內部 API 加入 shared-secret 認證
     ├── wallet server (2100)
     ├── platform server (3050)
     └── game server (10000)

□ 6. CORS 設定白名單（非 * ）

□ 7. Redis 設定密碼 + bind 內網 IP

□ 8. 速率限制改用 Redis 後端
```

### Phase 2 — 高優先修復（1 個月）

```
□ 9.  關閉 MySQL multipleStatements
□ 10. logoServer 文件上傳加入類型驗證、認證
□ 11. TOKEN_SECRET 改為強隨機值（256-bit）
□ 12. 升級 Node.js v16 → v22 LTS
□ 13. 修正 dbHelper 連線池（按需初始化）
□ 14. 部署基本監控（至少 PM2 狀態 + 健康檢查端點）
□ 15. 憑證遷移至 AWS Secrets Manager / Vault
□ 16. .env 加入 .gitignore，從 git history 清除
```

### Phase 3 — 架構改善（3 個月）

```
□ 17. 引入 API Gateway（Kong 或 Nginx Plus）
□ 18. 廠商接口標準化（IVendorAdapter）
□ 19. timerTask 整合（Bull Queue 替換 20 個定時任務）
□ 20. 部署 ELK Stack（集中日誌）
□ 21. 部署 Prometheus + Grafana（監控）
□ 22. 建立 CI/CD Pipeline（全模組）
□ 23. Redis 高可用（Sentinel 或 Cluster）
```

### Phase 4 — 長期改善（6-12 個月）

```
□ 24. 真正微服務拆分（wallet-service 獨立）
□ 25. Kubernetes 遷移（Phase 1: 容器標準化）
□ 26. 錢包服務冪等保護（Idempotency Key）
□ 27. game_server 通訊改用 mTLS
□ 28. 引入 Provably Fair 機制（RNG 可驗證）
□ 29. 補充單元測試（從 dashboard 後端開始）
□ 30. 每季滲透測試
```

---

## 各報告索引

| 報告文件 | 內容 |
|---------|------|
| [system_architecture_analysis.md](./system_architecture_analysis.md) | 整體架構、服務職責、業務流程推斷 |
| [security_risk_analysis.md](./security_risk_analysis.md) | 安全漏洞詳細分析（6 CRITICAL / 9 HIGH）|
| [deployment_and_devops_analysis.md](./deployment_and_devops_analysis.md) | CI/CD、容器化、監控、K8s 遷移 |
| [game_server_missing_requirements.md](./game_server_missing_requirements.md) | game_server 所有缺失分析需求 |
| [reverse_engineering_analysis.md](./reverse_engineering_analysis.md) | Token 逆向、加密分析、Bot 風險 |
| [refactor_suggestion.md](./refactor_suggestion.md) | 高耦合問題、重構順序、技術債 |
| [service_dependency_graph.md](./service_dependency_graph.md) | 服務依賴圖、單點故障分析 |
| [api_dataflow_analysis.md](./api_dataflow_analysis.md) | API 端點清單、資料流圖 |

---

> ⚠️ **重要聲明**: 本報告中發現的安全漏洞（特別是 CRIT-001 的憑證洩露）屬高度敏感資訊。
> 建議僅在授權範圍內分享，並立即採取修復行動。
> 如需進一步深入分析 game_server，請提供相關原始碼或二進位文件。
