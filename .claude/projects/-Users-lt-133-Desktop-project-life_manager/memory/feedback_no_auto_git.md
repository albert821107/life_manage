---
name: feedback-no-auto-git
description: 不要自動 git commit / push，只在使用者明確指示時才提交
metadata:
  type: feedback
---

不要主動執行 git commit 或 git push，只在使用者明確說「請推 git」、「幫我 commit」等指令時才操作。

**Why:** 使用者希望自己控制版本節點，不想每次改完就自動有 commit。

**How to apply:** 修改完程式碼後，直接告知使用者改了什麼，等待指示再 commit/push。
