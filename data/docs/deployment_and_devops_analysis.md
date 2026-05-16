# 部署與 DevOps 分析報告
## Deployment & DevOps Analysis

---

## 目錄 Table of Contents

1. [執行摘要](#執行摘要)
2. [現有部署架構分析](#現有部署架構分析)
3. [容器化現狀評估](#容器化現狀評估)
4. [CI/CD 現狀](#cicd-現狀)
5. [日誌架構](#日誌架構)
6. [監控架構](#監控架構)
7. [高可用與水平擴展分析](#高可用與水平擴展分析)
8. [Docker 優化建議](#docker-優化建議)
9. [Kubernetes 遷移可行性](#kubernetes-遷移可行性)
10. [ELK/Prometheus/Grafana 建議](#elkprometheus-grafana-建議)
11. [WAF/API Gateway 建議](#wafapi-gateway-建議)
12. [雲端架構建議](#雲端架構建議)
13. [災難復原策略](#災難復原策略)
14. [風險評估](#風險評估)
15. [建議實施路徑](#建議實施路徑)
16. [缺失資訊](#缺失資訊)

---

## 執行摘要

系統目前使用 **PM2 程序管理**運行 40+ Node.js 服務，僅 `game_api` 有 Docker/docker-compose 設定，其餘模組（dashboard、game_record_parser、kysport）在裸機或不一致的環境中運行。

整體部署成熟度評估：**初級（Level 1/5）**

主要問題：
- 無統一的 CI/CD Pipeline（僅 dashboard 有 Jenkinsfile）
- 無集中式日誌收集
- 無應用程式監控（APM）
- Docker 設定存在安全問題
- 無 Kubernetes 就緒設計（40+ 端口硬編碼、無健康檢查端點）

---

## 現有部署架構分析

### PM2 配置分析

```json
// server_a.json - 核心廠商服務
{
    "name": "channel",
    "script": "./server/src/app.js",
    "args": "2090",
    "instances": 1,        // 僅單一實例!
    "exec_mode": "cluster",
    "shutdown_with_message": true,
    "kill_timeout": 60000,
    "wait_ready": true,
    "listen_timeout": 10000
}
```

**問題**:
- `instances: 1` — 所有服務均為單實例，無水平擴展
- `error_file: "NULL"` — 錯誤日誌輸出被丟棄（NULL）!
- `out_file: "NULL"` — 輸出日誌也被丟棄!
- 無 `max_memory_restart` 設定 — 記憶體洩漏時不會重啟

```bash
# start_all.sh 問題
for cmd in "${pm2_commands[@]}"
do
    eval "${cmd}"  # eval 使用有注入風險
done
```

### 品牌多環境部署

系統支援多品牌（YL/LY/KX/NW/V8/CU/VP），透過 `.env` 檔案切換：
```
env/
├── YL/    (YL 品牌)
├── LY/    (LY 品牌)
├── KX/    (KX 品牌)
├── NW/    (NW 品牌)
├── V8/    (V8 品牌)
├── BW/    (BW 品牌)
├── GKX/   (GKX 品牌)
└── ...
```

這種設計導致 `.env` 文件數量龐大，難以管理且容易混淆。

---

## 容器化現狀評估

### game_api Docker 配置

```dockerfile
# Dockerfile 問題清單
FROM node:16-alpine3.15   # ❌ EOL 版本
WORKDIR /workspace
RUN apk add tzdata        # 安裝時區
RUN cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime  # ❌ 硬編碼上海時區
RUN echo "Asia/Shanghai" >/etc/timezone
RUN npm install pm2 -g    # ❌ 全局安裝 PM2 在 container 中

ENTRYPOINT ["sh", "./docker-entrypoint.sh"]  # 以 root 運行
```

```yaml
# docker-compose.yaml 問題清單
services:
    api:
        ports:
            - '89:89'     # ❌ 40+ 個端口直接映射到主機
            - '90:90'
            # ... 40+ more ports
        volumes:
            - ./:/workspace/   # ❌ 整個代碼庫掛載為 volume（含 .env 文件）
        # ❌ 無 resource limits（CPU/Memory）
        # ❌ 以 root 運行
        # ❌ 無 healthcheck
        networks:
            mynet:
                ipv4_address: 172.21.0.3
    redis:
        image: redis          # ❌ 無 password 配置
        ports:
            - 6379:6379       # ❌ Redis 直接暴露到主機
        healthcheck:          # ✅ 有 healthcheck
            test: ['CMD', 'redis-cli', 'ping']
```

### 容器化覆蓋率

| 模組 | Docker | docker-compose |
|-----|--------|---------------|
| game_api | ✅ | ✅ |
| dashboard | ✅ | ✅（Jenkins 流程中） |
| dashboard-frontend | ✅（dev.dockerfile）| ❌ |
| game_record_parser | ✅ | ✅ |
| kysport | ❌ | ❌ |

---

## CI/CD 現狀

### dashboard Jenkinsfile 分析

```groovy
// Jenkinsfile 存在但為空（或未完整提供）
```

根據 `deployment.sh`（dashboard-frontend）、`ecosystem.config.js`（PM2 設定）等文件推斷：

**現有 CI/CD 成熟度**: 初級
- 可能有手動觸發 Jenkins job
- 無自動化測試閘門（test gate）
- 無藍綠部署自動化（雖後台有 `bgDeployment` 功能，但為手動切換）
- 無 Rollback 自動化策略

### 現有測試覆蓋

```
dashboard-frontend:
  ✅ Cypress E2E (login, winAndLoseReport)
  ✅ Vitest (unit tests)
  ✅ ESLint / Biome linting
  ✅ Husky pre-commit/pre-push hooks

dashboard:
  ✅ Biome linting
  ✅ Husky hooks
  ❌ No unit tests found
  ❌ No integration tests
```

---

## 日誌架構

### 現有日誌設定

```javascript
// game_api + dashboard 均使用 Winston
const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
```

**問題**:
1. **日誌分散在各服務的本地文件中** — 無集中收集
2. **PM2 錯誤日誌設定為 NULL** — 大量日誌被丟棄
3. **無結構化日誌格式（JSON）** — 難以解析和搜索
4. **無日誌等級統一管理** — 各服務獨立配置
5. **無日誌輪轉清理策略** — 磁碟可能被填滿

```
# PM2 配置問題
"error_file": "NULL"   // 錯誤日誌不輸出!
"out_file": "NULL"     // 標準輸出不記錄!
```

---

## 監控架構

### 現有監控

- ❌ 無 APM（Application Performance Monitoring）
- ❌ 無 Metrics 收集（Prometheus）
- ❌ 無 Dashboard（Grafana）
- ❌ 無 Health Check 端點（標準 `/health`）
- ✅ Telegram 告警（盈利監控）
- ✅ 後台有房間監控、在線人數監控（但為業務層級）

---

## 高可用與水平擴展分析

### 當前水平擴展能力

| 服務 | 可水平擴展 | 阻礙 |
|-----|---------|------|
| channel | 部分 | PM2 instances:1，Session 需 Redis 共享 |
| game | ❌ | 有狀態（loadAgents/loadBlacklist 內存快取）|
| wallet | ❌ | 無冪等保護，並發風險高 |
| dataService | 部分 | 多數查詢無狀態 |
| timerTask | ❌ | 多實例會導致重複任務執行 |
| dashboard | 部分 | Rate Limiter 使用記憶體 |
| Moleculer nodes | ✅ | 設計為分散式 |

### 單點故障

1. **Redis** — 所有服務依賴，無 Redis Sentinel/Cluster
2. **MySQL** — 主庫故障影響所有寫入操作
3. **timerTask** — 若任一廠商 timerTask 失敗，注單同步中斷
4. **channel** — 玩家入口，單點

---

## Docker 優化建議

```dockerfile
# 建議的 Dockerfile
FROM node:22-alpine3.20 AS builder

# 非 root 用戶
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# 只複製必要文件
COPY package*.json ./
RUN npm ci --only=production

COPY . .

# 不使用 PM2 in Docker，改用 docker 原生功能
USER appuser

# 健康檢查
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT}/health || exit 1

CMD ["node", "server/src/app.js"]
```

```yaml
# 建議的 docker-compose 改進
services:
    channel:
        build:
            context: .
            target: production
        environment:
            - PORT=2090
            - SERVER_ID=2090
        ports:
            - '2090:2090'    # 只映射需要對外的端口
        deploy:
            resources:
                limits:
                    cpus: '1.0'
                    memory: 512M
        healthcheck:
            test: ["CMD", "wget", "-qO-", "http://localhost:2090/health"]
            interval: 30s
            timeout: 10s
            retries: 3
        security_opt:
            - no-new-privileges:true
        read_only: true
        tmpfs:
            - /tmp
```

---

## Kubernetes 遷移可行性

### 遷移難度評估

**難度**: ⭐⭐⭐⭐ 困難

**主要阻礙**:

1. **40+ 端口硬編碼** — K8s 需改用 Service 名稱通訊
2. **有狀態快取（記憶體）** — game server 使用記憶體快取 Agent/黑名單
3. **timerTask 多實例防護** — 需 Leader Election 機制
4. **PM2 管理方式** — 需重構為每容器單一服務
5. **共享 .env 文件** — 需改用 K8s ConfigMap/Secret

### 建議遷移路徑

```
Phase 1（3個月）: 容器化標準化
├── 每個服務獨立 Dockerfile
├── 移除 PM2（或使用 pm2-runtime）
├── 加入健康檢查端點 /health
└── 統一環境變量管理

Phase 2（3個月）: 有狀態遷移
├── 記憶體快取遷移至 Redis
├── timerTask 加入分散式鎖
└── Session/Token 統一 Redis 管理

Phase 3（6個月）: K8s 部署
├── Helm Charts 設計
├── 服務網格（Istio/Linkerd）
├── HPA（水平 Pod 自動伸縮）
└── Monitoring Stack 部署
```

---

## ELK/Prometheus/Grafana 建議

### 日誌架構（ELK Stack）

```
┌─────────────────┐    ┌───────────────┐    ┌──────────────┐    ┌──────────┐
│  game_api       │    │  Filebeat /   │    │  Logstash    │    │  Kibana  │
│  dashboard      │───►│  Fluentd      │───►│  (解析/過濾)  │───►│  (可視化) │
│  game_record_   │    │  (Log 收集)   │    │              │    │          │
│  parser         │    └───────────────┘    └──────────────┘    └──────────┘
└─────────────────┘                                │
                                                   ▼
                                          ┌──────────────┐
                                          │ Elasticsearch │
                                          │  (存儲/搜索)  │
                                          └──────────────┘
```

**建議 Winston 配置改為 JSON 輸出**:
```javascript
const winston = require('winston');
const logger = winston.createLogger({
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json(),  // 結構化 JSON
    ),
    transports: [
        new winston.transports.Console(),
        new DailyRotateFile({
            filename: 'logs/%DATE%.log',
            datePattern: 'YYYY-MM-DD',
            maxFiles: '14d',
        }),
    ],
});
```

### 監控架構（Prometheus + Grafana）

```
┌────────────────┐    ┌────────────────┐    ┌────────────────┐
│ Node.js Apps   │    │  Prometheus    │    │    Grafana     │
│ (prom-client)  │───►│  (指標收集)    │───►│  (儀表板可視化) │
└────────────────┘    └────────────────┘    └────────────────┘
                              │
                    ┌─────────┼─────────┐
                    │         │         │
                ┌───▼──┐  ┌──▼──┐  ┌──▼──────┐
                │Redis │  │MySQL│  │ Node.js │
                │Exporter  │Exporter  │Exporter │
                └──────┘  └─────┘  └─────────┘
```

**建議監控指標**:
```javascript
// 加入 prom-client
const { Counter, Histogram, Gauge } = require('prom-client');

const httpRequestDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration',
    labelNames: ['method', 'route', 'status'],
});

const walletTransactionCounter = new Counter({
    name: 'wallet_transactions_total',
    help: 'Total wallet transactions',
    labelNames: ['type', 'status'],
});

const onlinePlayersGauge = new Gauge({
    name: 'online_players_current',
    help: 'Current online players count',
    labelNames: ['brand'],
});
```

**Grafana Dashboard 建議**:
- 各廠商注單量/失敗率
- 錢包交易 TPS
- 在線玩家數量趨勢
- Redis 命中率
- MySQL 慢查詢
- PM2 進程狀態

---

## WAF/API Gateway 建議

### API Gateway 方案

**推薦**: Kong Gateway（開源版）

```
外部流量
    │
    ▼
Cloudflare (DDoS 防護)
    │
    ▼
Nginx (SSL Termination)
    │
    ▼
Kong API Gateway
├── JWT 驗證插件
├── Rate Limiting 插件（Redis 後端）
├── IP 黑白名單插件
├── 請求日誌插件
├── CORS 插件（統一管理）
└── 轉發至後端服務
```

**WAF 規則建議（Nginx ModSecurity/Cloudflare WAF）**:
- SQL Injection 防護（OWASP Core Rule Set）
- XSS 防護
- 文件上傳類型限制
- 速率限制（按 IP/帳號）
- Bot 偵測

---

## 雲端架構建議

### AWS 架構建議

```
                        Route 53 (DNS)
                              │
                        CloudFront (CDN)
                              │
                    ┌─────────┴─────────┐
                    │                   │
              WAF (AWS WAF)      API Gateway / ALB
                    │                   │
              Nginx (EC2)         ECS/EKS Cluster
                    │                   │
              Static Assets      ┌──────┴──────┐
              (S3)                │             │
                             game_api      dashboard
                                  │             │
                        ┌─────────┴──────┐     │
                        │                │     │
                     RDS MySQL       ElastiCache Redis
                   (Multi-AZ)           │
                   ├── Primary          │
                   └── Read Replicas    │
                                 Secrets Manager
                                 (憑證管理)
```

### OCI/GCP 替代方案亦可，核心原則相同

---

## 災難復原策略

### RTO/RPO 目標（建議）

| 服務 | RTO | RPO |
|-----|-----|-----|
| 遊戲核心（channel/game） | 5 分鐘 | 0（零數據損失）|
| 錢包服務 | 2 分鐘 | 0（ACID）|
| 後台管理 | 30 分鐘 | 1 小時 |
| 統計報表 | 4 小時 | 24 小時 |

### 建議策略

1. **MySQL 主從複製** — 已有配置，需加入監控
2. **Redis 持久化（AOF）** — 確保 Redis 開啟 AOF
3. **定期備份** — RDS 自動快照 + 跨區域備份
4. **藍綠部署** — 系統已有 `bgDeployment` 機制，需自動化
5. **Runbook** — 各服務恢復手冊文件化

---

## 風險評估

| 問題 | 嚴重度 | 影響 |
|-----|-------|------|
| PM2 日誌丟棄（NULL） | 高 | 無法追蹤問題 |
| 無監控 | 高 | 故障無法及時發現 |
| 無 CI/CD 標準化 | 高 | 部署風險高 |
| 單點 Redis | 高 | Redis 故障全平台癱瘓 |
| Node.js v16 EOL | 高 | 安全漏洞無修補 |
| 無 DR 演練 | 中 | 災難恢復時間不可預期 |

---

## 建議實施路徑

### 短期（1 個月）
1. 修正 PM2 log 配置（移除 NULL）
2. 加入 `/health` 健康檢查端點
3. 統一 Winston JSON 日誌格式
4. Redis 加入密碼和持久化

### 中期（3 個月）
5. 部署 ELK Stack（日誌集中化）
6. 部署 Prometheus + Grafana
7. 建立 CI/CD Pipeline（GitHub Actions / Jenkins）
8. 升級 Node.js 至 v22

### 長期（6-12 個月）
9. API Gateway（Kong）部署
10. Kubernetes 遷移（Phase 1: 容器標準化）
11. AWS/GCP 雲端架構遷移
12. 自動化災難恢復演練

---

## 缺失資訊

1. **伺服器硬體規格** — CPU/Memory/Disk 配置未知
2. **網路架構** — 防火牆規則、VPC 設計未知
3. **資料庫備份策略** — 現有備份頻率/保留期未知
4. **實際生產流量** — QPS/TPS 無法評估擴展需求
5. **SLA 要求** — 可用性目標未定義
6. **監控覆蓋** — 是否有其他監控工具（外部）
