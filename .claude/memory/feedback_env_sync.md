---
name: feedback-env-sync
description: 新增 .env.example 變數時，同步更新 .env（正在開發中）
metadata: 
  node_type: memory
  type: feedback
  originSessionId: f9aedee9-fbce-41f1-b0d7-b6bdeb62d9bb
---

每次新增環境變數到 .env.example，必須同步更新 .env。

**Why:** 使用者目前處於開發階段，.env 是實際執行用的設定檔，缺少變數會導致功能無法運作。

**How to apply:**
- 新增模組或功能時，.env.example 和 .env 都要更新
- 需要隨機產生的 key（如 ENCRYPT_KEY）在 .env 自動產生真實值，.env.example 放佔位說明
- API key 類（如 BYBIT_API_KEY）在 .env 留空，由使用者自行填入
