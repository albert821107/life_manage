---
name: project-overview
description: life_manage 專案基本資訊、tech stack、模組結構
metadata:
  type: project
---

個人人生管理系統（life_manage），Node.js + Express + sql.js (SQLite WebAssembly) + Socket.io，單頁 SPA（public/index.html 單一大檔）。

**Why:** 單人本機使用，無認證系統，sql.js 避免 native 編譯問題。

**How to apply:** 修改前端在 public/index.html 找對應 section，後端功能在 js/modules/ 對應模組。

模組清單：accounting, tasks, fitness, investment（近期主力）, ai, line_notify, telegram, travel

Port: 3100，開發指令 `npm run dev`。詳見 [[project-recent-work]] 和 CLAUDE.md。