---
name: feedback-git-push
description: git push 必須等使用者明確說「推送」才執行，不自動推
metadata: 
  node_type: memory
  type: feedback
  originSessionId: f9aedee9-fbce-41f1-b0d7-b6bdeb62d9bb
---

只有 commit 和 push 這兩個操作需要等使用者明確指示才執行。其他 git 查詢操作（status、log、diff、show、branch 等）可自由執行。

**Why:** 使用者要控制程式碼實際寫入 / 推出的時機，但查詢操作不影響狀態，不需要確認。

**How to apply:**
- `git commit`、`git push` — 必須等使用者說「commit」「推送」「push」等才執行
- `git status`、`git log`、`git diff`、`git show` 等 — 可直接執行，無需確認
- commit 時 `data/life_manager.db` 一律納入，不可省略
