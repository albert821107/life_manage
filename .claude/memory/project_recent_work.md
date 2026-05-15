---
name: project-recent-work
description: life_manage 近期開發重點與投資模組重構細節
metadata:
  type: project
---

近期（2026-05 前後）主力開發投資模組（js/modules/investment.js）：

- 庫存 / 借券總市值分離顯示
- 美股儀表板統一用 TWD 顯示
- 損益公式：標準未實現損益，賣出費用顯示在 tooltip 而非欄位
- 借券拖曳刪除、美股字典 autocomplete
- 外匯 autocomplete
- 存款（assets 模組）重構
- 借券現價改為即時撈取（同庫存 Yahoo Finance 邏輯）

旅遊模組：靜態國旗、GeoJSON 改存 SQLite（travel_geojson 表）、中文地名切換。

**Why:** 個人投資追蹤需求，台股 + 美股 + 外匯 + 借券並存。

**How to apply:** 動投資相關功能時注意 tw_shorts / forex / investments / investment_txns 四個表格分工。見 [[project-overview]]。