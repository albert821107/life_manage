'use strict';

const express = require('express');

/**
 * 投資模組 - 持倉與交易管理
 */
module.exports = (io) => {
  const router = express.Router();
  const db = require('../db').get();

  // GET /api/investment/holdings
  router.get('/holdings', (req, res) => {
    const rows = db.prepare(`SELECT * FROM investments ORDER BY type, symbol`).all();
    res.json({ success: true, data: rows });
  });

  // GET /api/investment/summary
  router.get('/summary', (req, res) => {
    const holdings = db.prepare(`SELECT * FROM investments`).all();
    let totalCost = 0, totalValue = 0;
    holdings.forEach(h => {
      totalCost  += h.shares * h.avg_cost;
      totalValue += h.shares * (h.current_price > 0 ? h.current_price : h.avg_cost);
    });
    const pnl    = totalValue - totalCost;
    const pnlPct = totalCost > 0 ? ((pnl / totalCost) * 100).toFixed(2) : 0;
    res.json({ success: true, data: {
      totalCost:  totalCost.toFixed(2),
      totalValue: totalValue.toFixed(2),
      pnl:        pnl.toFixed(2),
      pnlPct,
      count:      holdings.length
    }});
  });

  // GET /api/investment/txns?symbol=
  router.get('/txns', (req, res) => {
    const { symbol } = req.query;
    const rows = symbol
      ? db.prepare(`SELECT * FROM investment_txns WHERE symbol=? ORDER BY date DESC, id DESC`).all(symbol.toUpperCase())
      : db.prepare(`SELECT * FROM investment_txns ORDER BY date DESC, id DESC LIMIT 200`).all();
    res.json({ success: true, data: rows });
  });

  // POST /api/investment/txns - 新增交易 (自動更新持倉)
  router.post('/txns', (req, res) => {
    const { symbol, name, type, action, shares, price, date, note } = req.body;
    if (!symbol || !action || !shares || !price || !date) {
      return res.status(400).json({ success: false, error: '缺少必要欄位' });
    }
    const sym   = symbol.toUpperCase();
    const qty   = parseFloat(shares);
    const prc   = parseFloat(price);
    const total = +(qty * prc).toFixed(4);

    db.prepare(
      `INSERT INTO investment_txns (symbol, action, shares, price, total, date, note) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(sym, action, qty, prc, total, date, note || '');

    // 更新持倉
    const existing = db.prepare(`SELECT * FROM investments WHERE symbol=?`).get(sym);
    if (action === 'buy') {
      if (existing) {
        const newShares  = existing.shares + qty;
        const newAvgCost = ((existing.shares * existing.avg_cost) + total) / newShares;
        db.prepare(
          `UPDATE investments SET shares=?, avg_cost=?, updated_at=datetime('now','localtime') WHERE symbol=?`
        ).run(newShares, +newAvgCost.toFixed(4), sym);
      } else {
        db.prepare(
          `INSERT INTO investments (symbol, name, type, shares, avg_cost, current_price) VALUES (?, ?, ?, ?, ?, ?)`
        ).run(sym, name || sym, type || 'stock', qty, prc, prc);
      }
    } else if (action === 'sell' && existing) {
      const newShares = Math.max(0, existing.shares - qty);
      db.prepare(
        `UPDATE investments SET shares=?, updated_at=datetime('now','localtime') WHERE symbol=?`
      ).run(+newShares.toFixed(4), sym);
    }

    io.emit('investment:update');
    res.json({ success: true });
  });

  // PUT /api/investment/holdings/:symbol - 手動編輯持倉
  router.put('/holdings/:symbol', (req, res) => {
    const sym = req.params.symbol.toUpperCase();
    const { name, type, shares, avg_cost, current_price, note } = req.body;
    const existing = db.prepare(`SELECT id FROM investments WHERE symbol=?`).get(sym);
    if (existing) {
      db.prepare(`UPDATE investments SET name=?, type=?, shares=?, avg_cost=?, current_price=?, note=?, updated_at=datetime('now','localtime') WHERE symbol=?`)
        .run(name, type || 'stock', parseFloat(shares)||0, parseFloat(avg_cost)||0, parseFloat(current_price)||0, note||'', sym);
    } else {
      db.prepare(`INSERT INTO investments (symbol, name, type, shares, avg_cost, current_price, note) VALUES (?,?,?,?,?,?,?)`)
        .run(sym, name||sym, type||'stock', parseFloat(shares)||0, parseFloat(avg_cost)||0, parseFloat(current_price)||0, note||'');
    }
    io.emit('investment:update');
    res.json({ success: true });
  });

  // PATCH /api/investment/holdings/:symbol/price - 更新現價
  router.patch('/holdings/:symbol/price', (req, res) => {
    const sym = req.params.symbol.toUpperCase();
    const { current_price } = req.body;
    db.prepare(`UPDATE investments SET current_price=?, updated_at=datetime('now','localtime') WHERE symbol=?`)
      .run(parseFloat(current_price)||0, sym);
    io.emit('investment:update');
    res.json({ success: true });
  });

  // DELETE /api/investment/holdings/:symbol
  router.delete('/holdings/:symbol', (req, res) => {
    db.prepare(`DELETE FROM investments WHERE symbol=?`).run(req.params.symbol.toUpperCase());
    io.emit('investment:update');
    res.json({ success: true });
  });

  return router;
};
