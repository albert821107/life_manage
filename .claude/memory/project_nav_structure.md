---
name: project-nav-structure
description: 前端導航層級結構與新增功能的 SOP，快速定位要在哪裡加東西
metadata: 
  node_type: memory
  type: reference
  originSessionId: f9aedee9-fbce-41f1-b0d7-b6bdeb62d9bb
---

## 導航層級

左側導航兩群組，用 `data-sec` 對應 `#section-xxx` HTML block：

**基本功能** (`#nav-basic`)：dashboard / accounting / tasks / fitness / investment / ai / line / travel / games

**進階功能** (`#nav-advanced`)：work / analysis / investpro / trading

## 有子頁籤的大頁籤

| 大頁籤 | 切換函式 | 子頁籤 ID 前綴 |
|--------|----------|----------------|
| 資產 investment | `switchInvTab(tab)` | `inv-tab-{tab}` / `inv-sub-{tab}` |
| 旅遊 travel | `switchTravelTab(tab)` | `travel-tab-{t}` / `travel-sub-{t}` |
| 工作 work | `switchWorkTab(tab)` | `work-tab-{tab}` / `work-sub-{tab}` |

## 資產子頁籤清單
assets（資產總覽）/ tw（台股）/ us（美股）/ crypto（加密貨幣）/ forex（存款）/ yearlypnl（年度損益）

## 旅遊子頁籤清單
weekly（總覽）/ trips（行程）/ memories（回憶）/ footprint（足跡）

## 工作子頁籤清單
jira（Jira 工單，已完成基本架構）

## 新增功能 SOP

**新大頁籤**：nav-item HTML → #section-xxx HTML → PAGE_META → LOADERS（有 load 邏輯時）

**新子頁籤**：inv-tab HTML → 子內容 HTML → switchXxxTab() case → JS load 函式

**後端 API**：js/modules/xxx.js → js/server.js require+use → js/db.js SCHEMA

詳細導航樹見 [[CLAUDE.md]] 的「前端導航結構」章節。
