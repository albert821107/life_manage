'use strict';

const express = require('express');

module.exports = (io) => {
  const router = express.Router();
  const db = require('../db').get();

  const ITEM_COLS = 'id, batch_id, payment_method, customer_name, phone, address, note, item_name, unit_price, quantity, amount, order_total, facebook_name';

  // GET /api/orders/batches
  router.get('/batches', (req, res) => {
    try {
      const rows = db.prepare(`
        SELECT b.id, b.name, b.note, b.created_at,
               COUNT(i.id) AS item_count,
               COALESCE(SUM(i.amount), 0) AS total_amount
        FROM order_batches b
        LEFT JOIN order_items i ON i.batch_id = b.id
        GROUP BY b.id ORDER BY b.created_at DESC
      `).all();
      res.json({ success: true, data: rows });
    } catch(e) { res.json({ success: false, error: e.message }); }
  });

  // POST /api/orders/batches
  router.post('/batches', (req, res) => {
    try {
      const { name, note = '', items = [] } = req.body;
      if (!name) return res.json({ success: false, error: '請填寫批次名稱' });
      const b = db.prepare(`INSERT INTO order_batches (name, note) VALUES (?,?)`).run(name.trim(), note.trim());
      const batchId = b.lastInsertRowid;
      const stmt = db.prepare(`
        INSERT INTO order_items
          (batch_id, payment_method, customer_name, phone, address, note, item_name, unit_price, quantity, amount, order_total, facebook_name)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
      items.forEach(it => {
        const qty   = parseFloat(it.quantity)   || 0;
        const price = parseFloat(it.unit_price) || 0;
        const amt   = parseFloat(it.amount)     || qty * price;
        stmt.run(
          batchId,
          (it.payment_method || '').trim(),
          (it.customer_name  || '').trim(),
          (it.phone          || '').trim(),
          (it.address        || '').trim(),
          (it.note           || '').trim(),
          (it.item_name      || '').trim(),
          price, qty, amt,
          parseFloat(it.order_total) || 0,
          (it.facebook_name  || '').trim()
        );
      });
      res.json({ success: true, id: batchId });
    } catch(e) { res.json({ success: false, error: e.message }); }
  });

  // DELETE /api/orders/batches/:id
  router.delete('/batches/:id', (req, res) => {
    try {
      db.prepare(`DELETE FROM order_items   WHERE batch_id=?`).run(req.params.id);
      db.prepare(`DELETE FROM order_batches WHERE id=?`).run(req.params.id);
      res.json({ success: true });
    } catch(e) { res.json({ success: false, error: e.message }); }
  });

  // GET /api/orders/items/:batch_id
  router.get('/items/:batch_id', (req, res) => {
    try {
      const rows = db.prepare(`SELECT ${ITEM_COLS} FROM order_items WHERE batch_id=? ORDER BY id`).all(req.params.batch_id);
      res.json({ success: true, data: rows });
    } catch(e) { res.json({ success: false, error: e.message }); }
  });

  // GET /api/orders/summary
  router.get('/summary', (req, res) => {
    try {
      const rows = db.prepare(`
        SELECT item_name,
               AVG(unit_price)   AS avg_price,
               SUM(quantity)     AS total_qty,
               SUM(amount)       AS total_amount,
               COUNT(DISTINCT batch_id)     AS batch_count,
               GROUP_CONCAT(DISTINCT NULLIF(customer_name,'')) AS buyers
        FROM order_items
        WHERE item_name != ''
        GROUP BY item_name
        ORDER BY total_amount DESC
      `).all();
      res.json({ success: true, data: rows });
    } catch(e) { res.json({ success: false, error: e.message }); }
  });

  return router;
};
