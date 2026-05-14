'use strict';

const express = require('express');

/**
 * AI 助理模組 - OpenAI 整合
 * 未設定 OPENAI_API_KEY 時自動切換為模擬模式
 */
module.exports = (io) => {
  const router = express.Router();
  const db = require('../db').get();

  let openai = null;
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey && !apiKey.startsWith('sk-your')) {
    try {
      const OpenAI = require('openai');
      openai = new OpenAI({ apiKey });
    } catch (e) {
      console.warn('⚠️  OpenAI 套件載入失敗，切換為模擬模式');
    }
  }

  const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

  /** 從各模組資料庫拉取上下文摘要 */
  function buildContext() {
    const today = new Date().toISOString().slice(0, 10);
    const month = today.slice(0, 7);
    const income  = db.prepare(`SELECT COALESCE(SUM(amount),0) AS t FROM accounting WHERE type='income'  AND date LIKE ?`).get(`${month}%`);
    const expense = db.prepare(`SELECT COALESCE(SUM(amount),0) AS t FROM accounting WHERE type='expense' AND date LIKE ?`).get(`${month}%`);
    const tasks   = db.prepare(`SELECT title, priority, due_date FROM tasks WHERE status!='done' ORDER BY CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END LIMIT 5`).all();
    const fitness = db.prepare(`SELECT COUNT(*) AS c, COALESCE(SUM(calories),0) AS cal FROM fitness WHERE date >= date('now','-6 days')`).get();
    const invest  = db.prepare(`SELECT COUNT(*) AS c FROM investments WHERE shares>0`).get();

    return [
      `今天是 ${today}。`,
      `本月財務：收入 $${income.t}，支出 $${expense.t}，結餘 $${(income.t - expense.t).toFixed(0)}。`,
      `本週運動 ${fitness.c} 次，消耗 ${fitness.cal} 卡。`,
      `投資持倉 ${invest.c} 檔。`,
      tasks.length
        ? `待辦任務：${tasks.map(t => `${t.title}(${t.priority}${t.due_date ? ' 到期:'+t.due_date : ''})`).join('、')}。`
        : '目前無待辦任務。'
    ].join('\n');
  }

  // GET /api/ai/history
  router.get('/history', (req, res) => {
    const rows = db.prepare(`SELECT * FROM ai_chats ORDER BY id ASC`).all();
    res.json({ success: true, data: rows, mockMode: !openai });
  });

  // POST /api/ai/chat
  router.post('/chat', async (req, res) => {
    const { message } = req.body;
    if (!message || !message.trim()) return res.status(400).json({ success: false, error: '請輸入訊息' });

    db.prepare(`INSERT INTO ai_chats (role, content) VALUES ('user', ?)`).run(message.trim());

    if (!openai) {
      const reply = `[模擬模式 - 請在 .env 設定 OPENAI_API_KEY]\n\n您好！您說：「${message}」\n\n目前狀況摘要：\n${buildContext()}`;
      db.prepare(`INSERT INTO ai_chats (role, content) VALUES ('assistant', ?)`).run(reply);
      io.emit('ai:update');
      return res.json({ success: true, data: { role: 'assistant', content: reply } });
    }

    try {
      // 取最近 20 則訊息作為上下文
      const history = db.prepare(`SELECT role, content FROM ai_chats ORDER BY id DESC LIMIT 21`).all().reverse();
      const messages = history.slice(0, -1); // 去掉剛插入的 user message，避免重複

      const completion = await openai.chat.completions.create({
        model: MODEL,
        messages: [
          {
            role: 'system',
            content: `你是一個聰明的個人生活管理助理，使用繁體中文回答。你可以幫助用戶分析財務、規劃任務、建議健身計畫、評估投資。以下是用戶目前的生活狀況：\n\n${buildContext()}`
          },
          ...messages.map(m => ({ role: m.role, content: m.content })),
          { role: 'user', content: message.trim() }
        ],
        max_tokens: 1200,
        temperature: 0.7
      });

      const reply = completion.choices[0].message.content;
      db.prepare(`INSERT INTO ai_chats (role, content) VALUES ('assistant', ?)`).run(reply);
      io.emit('ai:update');
      res.json({ success: true, data: { role: 'assistant', content: reply } });
    } catch (err) {
      const errMsg = `AI 回應錯誤：${err.message}`;
      db.prepare(`INSERT INTO ai_chats (role, content) VALUES ('assistant', ?)`).run(errMsg);
      res.status(500).json({ success: false, error: errMsg });
    }
  });

  // DELETE /api/ai/history - 清除對話紀錄
  router.delete('/history', (req, res) => {
    db.prepare(`DELETE FROM ai_chats`).run();
    io.emit('ai:update');
    res.json({ success: true });
  });

  return router;
};
