'use strict';

/**
 * 個人人生管理系統 v1 - 主伺服器
 *
 * 啟動方式:
 *   node js/server.js          一般啟動
 *   npm run dev                 nodemon 開發模式
 *   pm2 start ecosystem.pm2.config.js  PM2 部署
 */

const path = require('path');
const fs   = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const express      = require('express');
const { createServer } = require('http');
const { Server }   = require('socket.io');
const cron         = require('node-cron');

const app        = express();
const httpServer = createServer(app);
const io         = new Server(httpServer);
const PORT       = process.env.PORT || 3100;

// ==========================================
// 日誌目錄初始化
// ==========================================
['logs/server/error', 'logs/server/out'].forEach(d => {
  const p = path.join(__dirname, '..', d);
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
});

// ==========================================
// Middleware
// ==========================================
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, '../public')));

// ==========================================
// 非同步啟動（等待 DB 初始化完成後掛載路由）
// ==========================================
(async () => {
  await require('./db').init();

  const accountingRouter = require('./modules/accounting')(io);
  const tasksRouter      = require('./modules/tasks')(io);
  const fitnessRouter    = require('./modules/fitness')(io);
  const investmentRouter = require('./modules/investment')(io);
  const aiRouter         = require('./modules/ai')(io);
  const lineModule       = require('./modules/line_notify')(io);
  const telegramModule   = require('./modules/telegram')(io);
  const travelRouter     = require('./modules/travel')(io);

  app.use('/api/accounting', accountingRouter);
  app.use('/api/tasks',      tasksRouter);
  app.use('/api/fitness',    fitnessRouter);
  app.use('/api/investment', investmentRouter);
  app.use('/api/ai',         aiRouter);
  app.use('/api/line',       lineModule.router);
  app.use('/api/telegram',   telegramModule.router);
  app.use('/api/travel',     travelRouter);

  app.get('/api/health', (req, res) => {
    res.json({ success: true, version: '1.0.0', uptime: Math.floor(process.uptime()) });
  });

  // ==========================================
  // Nav Order Settings
  // ==========================================
  app.get('/api/settings/nav-order', (req, res) => {
    const db = require('./db').get();
    const rows = db.prepare('SELECT sec, position FROM nav_order ORDER BY position').all();
    res.json({ success: true, order: rows.map(r => r.sec) });
  });

  app.post('/api/settings/nav-order', (req, res) => {
    const db = require('./db').get();
    const { order } = req.body;
    if (!Array.isArray(order)) return res.json({ success: false, error: 'order must be array' });
    db.prepare('DELETE FROM nav_order').run();
    order.forEach((sec, i) => {
      db.prepare('INSERT INTO nav_order (sec, position) VALUES (?, ?)').run(sec, i);
    });
    res.json({ success: true });
  });

  // ==========================================
  // Socket.io
  // ==========================================
  io.on('connection', (socket) => {
    console.log(`✓ 客戶端連線: ${socket.id}`);
    socket.on('disconnect', () => console.log(`✗ 客戶端離線: ${socket.id}`));
  });

  // ==========================================
  // 排程 - 每日摘要通知
  // ==========================================
  const CRON_TIME = process.env.DAILY_NOTIFY_CRON || '0 8 * * *';
  const NOTIFY_ENABLED = process.env.DAILY_NOTIFY_ENABLED === 'true';

  if (NOTIFY_ENABLED) {
    cron.schedule(CRON_TIME, async () => {
      console.log('⏰ 發送每日摘要...');
      try {
        const db      = require('./db').get();
        const today   = new Date().toISOString().slice(0, 10);
        const month   = today.slice(0, 7);
        const expense = db.prepare(`SELECT COALESCE(SUM(amount),0) AS t FROM accounting WHERE type='expense' AND date LIKE ?`).get(`${month}%`);
        const pending = db.prepare(`SELECT COUNT(*) AS c FROM tasks WHERE status='pending'`).get();
        const msg = `\n📊 每日摘要 ${today}\n💰 本月支出 $${expense.t}\n✅ 待辦任務 ${pending.c} 件`;
        await lineModule.sendLineNotification(msg);
        console.log('✓ 摘要通知已發送');
      } catch (err) {
        console.log(`✗ 摘要通知失敗: ${err.message}`);
      }
    }, { timezone: 'Asia/Taipei' });
    console.log(`✓ 每日通知排程已啟用 (${CRON_TIME})`);
  }

  // ==========================================
  // 啟動
  // ==========================================
  httpServer.listen(PORT, () => {
  console.log('\n╔══════════════════════════════════════╗');
  console.log('║   🧠  個人人生管理系統 v1             ║');
  console.log('╚══════════════════════════════════════╝');
  console.log(`\n   🌐 http://localhost:${PORT}\n`);
  console.log('   模組列表:');
  console.log('   💰 記帳      /api/accounting');
  console.log('   ✅ 任務      /api/tasks');
  console.log('   💪 健身      /api/fitness');
  console.log('   📈 投資      /api/investment');
  console.log('   🤖 AI助理    /api/ai');
  console.log('   🔔 LINE通知  /api/line');
  console.log('\n   按 Ctrl+C 停止服務\n');
  });

})().catch(err => { console.error('啟動失敗:', err); process.exit(1); });

process.on('SIGTERM', () => { httpServer.close(() => process.exit(0)); });
