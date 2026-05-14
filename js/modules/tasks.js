'use strict';

const express = require('express');

/**
 * 任務模組 - 待辦事項管理
 */
module.exports = (io) => {
  const router = express.Router();
  const db = require('../db').get();

  // GET /api/tasks?status=pending|in_progress|done|all
  router.get('/', (req, res) => {
    const { status } = req.query;
    const rows = (status && status !== 'all')
      ? db.prepare(`
          SELECT * FROM tasks WHERE status=?
          ORDER BY CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, due_date ASC, id DESC
        `).all(status)
      : db.prepare(`
          SELECT * FROM tasks
          ORDER BY CASE status WHEN 'pending' THEN 1 WHEN 'in_progress' THEN 2 ELSE 3 END,
                   CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
                   due_date ASC, id DESC
        `).all();
    res.json({ success: true, data: rows });
  });

  // GET /api/tasks/summary
  router.get('/summary', (req, res) => {
    const pending    = db.prepare(`SELECT COUNT(*) AS c FROM tasks WHERE status='pending'`).get();
    const inProgress = db.prepare(`SELECT COUNT(*) AS c FROM tasks WHERE status='in_progress'`).get();
    const done       = db.prepare(`SELECT COUNT(*) AS c FROM tasks WHERE status='done'`).get();
    const overdue    = db.prepare(
      `SELECT COUNT(*) AS c FROM tasks WHERE status!='done' AND due_date IS NOT NULL AND due_date < date('now')`
    ).get();
    const dueToday   = db.prepare(
      `SELECT title FROM tasks WHERE status!='done' AND due_date=date('now') LIMIT 5`
    ).all();
    res.json({ success: true, data: { pending: pending.c, in_progress: inProgress.c, done: done.c, overdue: overdue.c, dueToday } });
  });

  // POST /api/tasks
  router.post('/', (req, res) => {
    const { title, description, priority, due_date } = req.body;
    if (!title) return res.status(400).json({ success: false, error: '請填寫任務標題' });
    const result = db.prepare(
      `INSERT INTO tasks (title, description, priority, due_date) VALUES (?, ?, ?, ?)`
    ).run(title, description || '', priority || 'medium', due_date || null);
    const task = db.prepare(`SELECT * FROM tasks WHERE id=?`).get(result.lastInsertRowid);
    io.emit('tasks:update');
    res.json({ success: true, data: task });
  });

  // PUT /api/tasks/:id
  router.put('/:id', (req, res) => {
    const { title, description, priority, status, due_date } = req.body;
    db.prepare(
      `UPDATE tasks SET title=?, description=?, priority=?, status=?, due_date=? WHERE id=?`
    ).run(title, description, priority, status, due_date || null, req.params.id);
    const task = db.prepare(`SELECT * FROM tasks WHERE id=?`).get(req.params.id);
    io.emit('tasks:update');
    res.json({ success: true, data: task });
  });

  // PATCH /api/tasks/:id/status
  router.patch('/:id/status', (req, res) => {
    const { status } = req.body;
    const valid = ['pending', 'in_progress', 'done'];
    if (!valid.includes(status)) return res.status(400).json({ success: false, error: '無效的狀態值' });
    db.prepare(`UPDATE tasks SET status=? WHERE id=?`).run(status, req.params.id);
    io.emit('tasks:update');
    res.json({ success: true });
  });

  // DELETE /api/tasks/:id
  router.delete('/:id', (req, res) => {
    db.prepare(`DELETE FROM tasks WHERE id=?`).run(req.params.id);
    io.emit('tasks:update');
    res.json({ success: true });
  });

  return router;
};
