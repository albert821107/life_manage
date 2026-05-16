---
name: project-nav-structure
description: 前端導航層級結構與新增功能的 SOP，快速定位要在哪裡加東西
metadata: 
  node_type: memory
  type: reference
  originSessionId: f9aedee9-fbce-41f1-b0d7-b6bdeb62d9bb
---

## 位置表示法

`{群組}-{頁籤}` 或 `{群組}-{頁籤}-{子頁籤}`，依左側清單顯示順序編號。
群組：`1` = 基本功能，`2` = 進階功能

| 編號 | 名稱 | data-sec |
|------|------|----------|
| 1-1 | 概覽 | dashboard |
| 1-2 | 記帳 | accounting |
| 1-3 | 任務 | tasks |
| 1-4 | 健身 | fitness |
| 1-5 | 資產 | investment |
| 1-5-1 | 資產總覽 | tab=assets |
| 1-5-2 | 台股 | tab=tw |
| 1-5-3 | 美股 | tab=us |
| 1-5-4 | 加密貨幣 | tab=crypto |
| 1-5-5 | 存款 | tab=forex |
| 1-6 | AI助理 | ai |
| 1-7 | 通知 | line |
| 1-8 | 旅遊 | travel |
| 1-8-1 | 總覽 | tab=weekly |
| 1-8-2 | 行程 | tab=trips |
| 1-8-3 | 回憶 | tab=memories |
| 1-8-4 | 足跡 | tab=footprint |
| 1-9 | 遊戲 | games |
| 2-1 | 工作 | work |
| 2-1-1 | Jira工單 | tab=jira |
| 2-2 | 文件閱讀 | analysis |
| 2-3 | 投資(進階) | investpro |
| 2-3-1 | 年度損益 | tab=yearlypnl |
| 2-4 | 操盤 | trading |
| 2-5 | 履歷 | resume |

## 有子頁籤的大頁籤切換函式

| 大頁籤 | 切換函式 | 子頁籤 ID 前綴 |
|--------|----------|----------------|
| 資產 investment | `switchInvTab(tab)` | `inv-tab-{tab}` / `inv-sub-{tab}` |
| 旅遊 travel | `switchTravelTab(tab)` | `travel-tab-{t}` / `travel-sub-{t}` |
| 工作 work | `switchWorkTab(tab)` | `work-tab-{tab}` / `work-sub-{tab}` |
| 投資進階 investpro | `switchInvestproTab(tab)` | `investpro-tab-{tab}` / `investpro-sub-{tab}` |

## 新增功能 SOP

**新大頁籤**：nav-item HTML → #section-xxx HTML → PAGE_META → LOADERS（有 load 邏輯時）

**新子頁籤**：inv-tab HTML → 子內容 HTML → switchXxxTab() case → JS load 函式

**後端 API**：js/modules/xxx.js → js/server.js require+use → js/db.js SCHEMA

詳細導航樹見 [[CLAUDE.md]] 的「前端導航結構」章節。
