---
name: feedback-git-push
description: git push 必須等使用者明確說「推送」才執行，不自動推
metadata: 
  node_type: memory
  type: feedback
  originSessionId: f9aedee9-fbce-41f1-b0d7-b6bdeb62d9bb
---

不要在完成任務後自動 git push。只有當使用者明確說「推送」或「push」時才執行。

**Why:** 使用者要控制推送時機，避免未確認的程式碼被推到遠端。

**How to apply:** 完成 commit 後停止，不執行 git push，不提示「要推送嗎？」。
