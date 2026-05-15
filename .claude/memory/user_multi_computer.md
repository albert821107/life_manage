---
name: user-multi-computer
description: 使用者在多台電腦間開發，memory 存於 project 內 .claude/memory/ 透過 git 同步
metadata:
  type: user
---

使用者在多台電腦（Windows + Mac）輪流開發。

Memory 檔案存於 `c:\Project\life_manage\.claude\memory\`（git tracked），透過 git push/pull 跨機同步。

每台電腦需在 `~/.claude/settings.json` 設定：
- Windows: `"autoMemoryDirectory": "c:\\Project\\life_manage\\.claude\\memory"`
- Mac: `"autoMemoryDirectory": "/Users/<username>/Project/life_manage/.claude/memory"`
- 同時設定 `"model": "claude-sonnet-4-6"`

**How to apply:** 新電腦 clone 後，先執行 git pull，再建立/更新 ~/.claude/settings.json，確認 autoMemoryDirectory 指向正確絕對路徑。