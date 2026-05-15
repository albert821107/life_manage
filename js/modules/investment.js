'use strict';

const express = require('express');
const https   = require('https');
const http    = require('http');

// ── CSV 工具 ──────────────────────────────────
function fetchCSV(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, (res) => {
      // 跟隨重導向
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchCSV(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, { headers: { 'User-Agent': 'life-manager/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchJSON(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('JSON 解析失敗')); }
      });
    }).on('error', reject);
  });
}

function parseCSVRow(row) {
  const result = [];
  let inQuotes = false, current = '';
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (ch === '"') {
      if (inQuotes && row[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current); current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function parseCSV(csv) {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = parseCSVRow(lines[0]).map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));
  return lines.slice(1)
    .filter(l => l.trim())
    .map(line => {
      const values = parseCSVRow(line);
      const obj = {};
      headers.forEach((h, i) => { obj[h] = (values[i] || '').trim(); });
      return obj;
    });
}

function toCSV(headers, rows) {
  const escape = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  return [headers.join(','), ...rows.map(r => headers.map(h => escape(r[h])).join(','))].join('\n');
}

/**
 * 投資模組 - 持倉與交易管理
 */
module.exports = (io) => {
  const router = express.Router();
  const db = require('../db').get();

  // GET /api/investment/holdings?market=tw|us|crypto
  router.get('/holdings', (req, res) => {
    const { market } = req.query;
    const rows = market
      ? db.prepare(`SELECT * FROM investments WHERE market=? ORDER BY COALESCE(sort_order,0), id`).all(market)
      : db.prepare(`SELECT * FROM investments ORDER BY COALESCE(sort_order,0), id`).all();
    res.json({ success: true, data: rows });
  });

  // GET /api/investment/summary?market=tw|us|crypto
  router.get('/summary', (req, res) => {
    const { market } = req.query;
    const holdings = market
      ? db.prepare(`SELECT * FROM investments WHERE market=?`).all(market)
      : db.prepare(`SELECT * FROM investments`).all();
    let totalCost = 0, totalValue = 0, totalFee = 0;
    const isTw = market === 'tw';
    holdings.forEach(h => {
      const val = h.shares * (h.current_price > 0 ? h.current_price : h.avg_cost);
      totalCost  += h.shares * h.avg_cost;
      totalValue += val;
      if (isTw) totalFee += Math.ceil(val * 0.001425) + Math.ceil(val * 0.003);
    });
    const pnl    = totalValue - totalFee - totalCost;
    const pnlPct = totalCost > 0 ? ((pnl / totalCost) * 100).toFixed(2) : 0;
    res.json({ success: true, data: {
      totalCost:  totalCost.toFixed(2),
      totalValue: totalValue.toFixed(2),
      pnl:        pnl.toFixed(2),
      pnlPct,
      count:      holdings.length
    }});
  });

  // GET /api/investment/txns?market=tw|us|crypto
  router.get('/txns', (req, res) => {
    const { symbol, market } = req.query;
    let rows;
    if (symbol) {
      rows = db.prepare(`SELECT t.* FROM investment_txns t WHERE t.symbol=? ORDER BY t.date DESC, t.id DESC`).all(symbol.toUpperCase());
    } else if (market) {
      rows = db.prepare(`SELECT t.* FROM investment_txns t JOIN investments i ON t.symbol=i.symbol WHERE i.market=? ORDER BY t.date DESC, t.id DESC LIMIT 200`).all(market);
    } else {
      rows = db.prepare(`SELECT t.* FROM investment_txns t ORDER BY t.date DESC, t.id DESC LIMIT 200`).all();
    }
    res.json({ success: true, data: rows });
  });

  // POST /api/investment/txns - 新增交易 (自動更新持倉)
  router.post('/txns', (req, res) => {
    const { symbol, name, type, market, action, shares, price, date, note } = req.body;
    if (!symbol || !action || !shares || !price || !date) {
      return res.status(400).json({ success: false, error: '缺少必要欄位' });
    }
    const sym   = symbol.toUpperCase();
    const mkt   = market || 'tw';
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
          `UPDATE investments SET shares=?, avg_cost=?, market=?, updated_at=datetime('now','localtime') WHERE symbol=?`
        ).run(newShares, +newAvgCost.toFixed(4), mkt, sym);
      } else {
        db.prepare(
          `INSERT INTO investments (symbol, name, type, market, shares, avg_cost, current_price) VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(sym, name || sym, type || 'stock', mkt, qty, prc, prc);
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
    const { name, type, market, shares, avg_cost, current_price, note } = req.body;
    const mkt = market || 'tw';
    const existing = db.prepare(`SELECT id FROM investments WHERE symbol=?`).get(sym);
    if (existing) {
      db.prepare(`UPDATE investments SET name=?, type=?, market=?, shares=?, avg_cost=?, current_price=?, note=?, updated_at=datetime('now','localtime') WHERE symbol=?`)
        .run(name, type || 'stock', mkt, parseFloat(shares)||0, parseFloat(avg_cost)||0, parseFloat(current_price)||0, note||'', sym);
    } else {
      const nextOrd = (db.prepare(`SELECT COALESCE(MAX(sort_order),0) AS m FROM investments`).get().m || 0) + 1;
      db.prepare(`INSERT INTO investments (symbol, name, type, market, shares, avg_cost, current_price, note, sort_order) VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(sym, name||sym, type||'stock', mkt, parseFloat(shares)||0, parseFloat(avg_cost)||0, parseFloat(current_price)||0, note||'', nextOrd);
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

  // PATCH /api/investment/holdings/sort-order — 儲存拖曳排序
  router.patch('/holdings/sort-order', (req, res) => {
    const { symbols } = req.body;
    if (!Array.isArray(symbols)) return res.json({ success: false, error: 'symbols must be array' });
    const stmt = db.prepare(`UPDATE investments SET sort_order=? WHERE symbol=?`);
    symbols.forEach((sym, i) => stmt.run(i, sym.toUpperCase()));
    res.json({ success: true });
  });

  // DELETE /api/investment/holdings/:symbol
  router.delete('/holdings/:symbol', (req, res) => {
    db.prepare(`DELETE FROM investments WHERE symbol=?`).run(req.params.symbol.toUpperCase());
    io.emit('investment:update');
    res.json({ success: true });
  });

  // POST /api/investment/holdings/refresh-prices?market=tw|us|crypto[&symbol=SYM]
  router.post('/holdings/refresh-prices', async (req, res) => {
    try {
      const { market, symbol } = req.query;
      let holdings;
      if (symbol) {
        holdings = db.prepare(`SELECT symbol, market FROM investments WHERE symbol=?`).all(symbol.toUpperCase());
      } else if (market) {
        holdings = db.prepare(`SELECT symbol, market FROM investments WHERE market=?`).all(market);
      } else {
        holdings = db.prepare(`SELECT symbol, market FROM investments`).all();
      }
      if (!holdings.length) return res.json({ success: true, updated: 0 });

      const stmt = db.prepare(`UPDATE investments SET current_price=?, updated_at=datetime('now','localtime') WHERE symbol=?`);
      const updated = [];

      // 依市場分組
      const byMarket = {};
      holdings.forEach(h => { (byMarket[h.market] = byMarket[h.market] || []).push(h.symbol); });

      for (const [mkt, symbols] of Object.entries(byMarket)) {
        if (mkt === 'tw' || mkt === 'us') {
          for (const sym of symbols) {
            try {
              const suffix = mkt === 'tw' ? '.TW' : '';
              const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}${suffix}?interval=1d&range=1d`;
              const data = await fetchJSON(url);
              const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
              if (price && price > 0) { stmt.run(parseFloat(price.toFixed(4)), sym); updated.push(sym); }
            } catch(e) { /* 個股失敗跳過 */ }
          }
        } else if (mkt === 'crypto') {
          // 取 USDT→TWD 匯率（優先用 DB 快取）
          let usdtRate = db.prepare(`SELECT rate FROM assets_rates WHERE currency='USDT'`).get()?.rate;
          if (!usdtRate) {
            try {
              const fiat = await fetchJSON('https://open.er-api.com/v6/latest/TWD');
              usdtRate = parseFloat((1 / fiat.rates.USD).toFixed(4));
            } catch(e) { usdtRate = 30; }
          }
          try {
            const pairs = symbols.map(s => s + 'USDT');
            const param = encodeURIComponent(JSON.stringify(pairs));
            const prices = await fetchJSON(`https://api.binance.com/api/v3/ticker/price?symbols=${param}`);
            if (Array.isArray(prices)) {
              prices.forEach(item => {
                const sym = item.symbol.replace('USDT', '');
                if (symbols.includes(sym)) {
                  const priceUSDT = parseFloat(item.price);
                  const decimals = priceUSDT < 0.01 ? 8 : 2;
                  stmt.run(parseFloat((priceUSDT * usdtRate).toFixed(decimals)), sym);
                  updated.push(sym);
                }
              });
            }
          } catch(e) { /* Binance 失敗跳過 */ }
        }
      }

      if (updated.length) io.emit('investment:update');
      res.json({ success: true, updated: updated.length, symbols: updated });
    } catch(e) {
      res.json({ success: false, error: e.message });
    }
  });

  // ── 台股借券賣出 ────────────────────────────────

  // GET /api/investment/shorts — 查詢開倉中的借券部位
  router.get('/shorts', (req, res) => {
    const rows = db.prepare(`SELECT * FROM tw_shorts WHERE short_shares > 0.00001 ORDER BY COALESCE(sort_order,0), symbol`).all();
    const withPnl = rows.map(s => {
      const curPrice = s.current_price > 0 ? s.current_price : s.avg_sell_price;
      const pnl = (s.avg_sell_price - curPrice) * s.short_shares;
      const cost = s.short_shares * s.avg_sell_price;
      const pnlPct = cost > 0 ? ((pnl / cost) * 100).toFixed(2) : '0';
      return { ...s, pnl: pnl.toFixed(2), pnlPct };
    });
    res.json({ success: true, data: withPnl });
  });

  // POST /api/investment/shorts/txn — 借券賣出 / 回補
  router.post('/shorts/txn', (req, res) => {
    const { symbol, name, action, shares, price, date, note } = req.body;
    if (!symbol || !action || !shares || !price || !date)
      return res.status(400).json({ success: false, error: '缺少必要欄位' });
    const sym   = symbol.toUpperCase();
    const qty   = parseFloat(shares);
    const prc   = parseFloat(price);
    const total = +(qty * prc).toFixed(4);

    // 記錄交易歷史
    db.prepare(`INSERT INTO investment_txns (symbol, action, shares, price, total, date, note) VALUES (?,?,?,?,?,?,?)`)
      .run(sym, action, qty, prc, total, date, note || '');

    if (action === 'short_sell') {
      const ex = db.prepare(`SELECT * FROM tw_shorts WHERE symbol=?`).get(sym);
      if (ex) {
        const newShares   = ex.short_shares + qty;
        const newAvgPrice = ((ex.short_shares * ex.avg_sell_price) + total) / newShares;
        db.prepare(`UPDATE tw_shorts SET short_shares=?, avg_sell_price=?, name=COALESCE(NULLIF(?,name),name), updated_at=datetime('now','localtime') WHERE symbol=?`)
          .run(+newShares.toFixed(4), +newAvgPrice.toFixed(4), name || ex.name, sym);
      } else {
        const nextShortOrd = (db.prepare(`SELECT COALESCE(MAX(sort_order),0) AS m FROM tw_shorts`).get().m || 0) + 1;
        db.prepare(`INSERT INTO tw_shorts (symbol, name, short_shares, avg_sell_price, current_price, sort_order) VALUES (?,?,?,?,?,?)`)
          .run(sym, name || sym, qty, prc, prc, nextShortOrd);
      }
    } else if (action === 'short_cover') {
      const ex = db.prepare(`SELECT * FROM tw_shorts WHERE symbol=?`).get(sym);
      if (ex) {
        const newShares = +(Math.max(0, ex.short_shares - qty)).toFixed(4);
        if (newShares < 0.00001) {
          db.prepare(`DELETE FROM tw_shorts WHERE symbol=?`).run(sym);
        } else {
          db.prepare(`UPDATE tw_shorts SET short_shares=?, updated_at=datetime('now','localtime') WHERE symbol=?`)
            .run(newShares, sym);
        }
      }
    }

    io.emit('investment:update');
    res.json({ success: true });
  });

  // PATCH /api/investment/shorts/sort-order — 拖曳排序
  router.patch('/shorts/sort-order', (req, res) => {
    const { symbols } = req.body;
    if (!Array.isArray(symbols)) return res.json({ success: false, error: 'symbols must be array' });
    const stmt = db.prepare(`UPDATE tw_shorts SET sort_order=? WHERE symbol=?`);
    symbols.forEach((sym, i) => stmt.run(i, sym.toUpperCase()));
    res.json({ success: true });
  });

  // PATCH /api/investment/shorts/:symbol/price — 更新借券部位現價
  router.patch('/shorts/:symbol/price', (req, res) => {
    db.prepare(`UPDATE tw_shorts SET current_price=?, updated_at=datetime('now','localtime') WHERE symbol=?`)
      .run(parseFloat(req.body.current_price) || 0, req.params.symbol.toUpperCase());
    io.emit('investment:update');
    res.json({ success: true });
  });

  // DELETE /api/investment/shorts/:symbol — 強制清除借券部位
  router.delete('/shorts/:symbol', (req, res) => {
    db.prepare(`DELETE FROM tw_shorts WHERE symbol=?`).run(req.params.symbol.toUpperCase());
    io.emit('investment:update');
    res.json({ success: true });
  });

  // ── 資產總覽（本地 CRUD）────────────────────────

  // 計算輔助：取得所有帳戶 + 匯率 + 庫存市值
  function calcAssets() {
    const rates   = db.prepare(`SELECT currency, rate FROM assets_rates`).all();
    const rateMap = { TWD: 1 };
    rates.forEach(r => { rateMap[r.currency] = r.rate; });

    // ── 手動帳戶（現金、定存等）
    const accounts = db.prepare(`SELECT * FROM assets_accounts ORDER BY sort_order, id`).all();
    let accountsTWD = 0;
    const rows = accounts.map(a => {
      const rate   = rateMap[a.currency] ?? null;
      const twdAmt = rate !== null ? +(a.amount * rate).toFixed(0) : null;
      if (twdAmt !== null) accountsTWD += twdAmt;
      return { ...a, rate: rate ?? '未設定', twdAmount: twdAmt };
    });

    // ── 庫存即時市值（台股 TWD，美股/加密 × USD/TWD 匯率）
    const holdings = db.prepare(`SELECT market, shares, avg_cost, current_price FROM investments`).all();
    const usdRate  = rateMap['USD'] || 1;
    let holdingsTWD = 0;
    holdings.forEach(h => {
      const price = h.current_price > 0 ? h.current_price : h.avg_cost;
      const val   = h.shares * price;
      holdingsTWD += h.market === 'tw' ? val : val * usdRate;
    });

    const totalTWD = accountsTWD + holdingsTWD;

    // 佔比（基於總資產）
    rows.forEach(r => {
      r.percentage = (totalTWD > 0 && r.twdAmount !== null)
        ? ((r.twdAmount / totalTWD) * 100).toFixed(2) + '%'
        : '--';
    });

    const invPct = totalTWD > 0 ? +((holdingsTWD / totalTWD) * 100).toFixed(1) : 0;

    return {
      accounts:      rows,
      totalTWD,
      accountsTWD,
      holdingsTWD,
      investmentTWD: holdingsTWD,
      cashTWD:       accountsTWD,
      investmentPct: invPct.toFixed(1),
      cashPct:       (100 - invPct).toFixed(1),
      rates,
      history:       db.prepare(`SELECT * FROM assets_snapshots ORDER BY date ASC`).all(),
    };
  }

  // GET /api/investment/assets
  router.get('/assets', (req, res) => {
    try { res.json({ success: true, data: calcAssets() }); }
    catch(e) { res.json({ success: false, error: e.message }); }
  });

  // POST /api/investment/assets/accounts
  router.post('/assets/accounts', (req, res) => {
    const { unit, currency, amount, category, note } = req.body;
    if (!unit || !currency) return res.json({ success: false, error: '單位和幣種為必填' });
    const maxOrder = db.prepare(`SELECT COALESCE(MAX(sort_order),0) AS m FROM assets_accounts`).get().m;
    db.prepare(`INSERT INTO assets_accounts (unit, currency, amount, category, sort_order, note) VALUES (?,?,?,?,?,?)`)
      .run(unit, currency.toUpperCase(), parseFloat(amount)||0, category||'現金', maxOrder+1, note||'');
    io.emit('investment:update');
    res.json({ success: true });
  });

  // PUT /api/investment/assets/accounts/:id
  router.put('/assets/accounts/:id', (req, res) => {
    const { unit, currency, amount, category, note } = req.body;
    if (!unit || !currency) return res.json({ success: false, error: '單位和幣種為必填' });
    db.prepare(`UPDATE assets_accounts SET unit=?, currency=?, amount=?, category=?, note=?, updated_at=datetime('now','localtime') WHERE id=?`)
      .run(unit, currency.toUpperCase(), parseFloat(amount)||0, category||'現金', note||'', req.params.id);
    io.emit('investment:update');
    res.json({ success: true });
  });

  // DELETE /api/investment/assets/accounts/:id
  router.delete('/assets/accounts/:id', (req, res) => {
    db.prepare(`DELETE FROM assets_accounts WHERE id=?`).run(req.params.id);
    io.emit('investment:update');
    res.json({ success: true });
  });

  // POST /api/investment/assets/rates/fetch — 自動抓取匯率
  router.post('/assets/rates/fetch', async (req, res) => {
    try {
      // 1. 法幣匯率：USD、JPY → TWD
      const fiat = await fetchJSON('https://open.er-api.com/v6/latest/TWD');
      if (fiat.result !== 'success') throw new Error('匯率 API 回應異常');
      const usdTwd  = parseFloat((1 / fiat.rates.USD).toFixed(4));
      const jpyTwd  = parseFloat((1 / fiat.rates.JPY).toFixed(4));
      const usdtTwd = usdTwd; // USDT ≈ USD

      // 2. 加密貨幣：以 USDT 為本位，換算台幣
      const cryptoSymbols = ['BTCUSDT','ETHUSDT','SOLUSDT','DOGEUSDT',
                             'BONKUSDT','WIFUSDT','PEPEUSDT','USDCUSDT'];
      const symbolsParam = encodeURIComponent(JSON.stringify(cryptoSymbols));
      let cryptoList = [];
      try {
        cryptoList = await fetchJSON(
          `https://api.binance.com/api/v3/ticker/price?symbols=${symbolsParam}`
        );
        if (!Array.isArray(cryptoList)) cryptoList = [];
      } catch(e) { /* Binance 失敗不影響法幣匯率存檔 */ }

      // 3. 整理並存入 DB
      const toSave = { USD: usdTwd, JPY: jpyTwd, USDT: usdtTwd };
      for (const item of cryptoList) {
        const sym = item.symbol.replace('USDT', '');
        const priceUSDT = parseFloat(item.price);
        // 小數幣保留 8 位；大幣保留 2 位
        const twdRate = priceUSDT < 0.01
          ? parseFloat((priceUSDT * usdtTwd).toFixed(8))
          : parseFloat((priceUSDT * usdtTwd).toFixed(2));
        toSave[sym] = twdRate;
      }

      const stmt = db.prepare(`INSERT INTO assets_rates (currency, rate) VALUES (?,?)
        ON CONFLICT(currency) DO UPDATE SET rate=excluded.rate, updated_at=datetime('now','localtime')`);
      for (const [currency, rate] of Object.entries(toSave)) {
        stmt.run(currency, rate);
      }
      io.emit('investment:update');
      res.json({ success: true, rates: toSave });
    } catch (e) {
      res.json({ success: false, error: e.message });
    }
  });

  // PUT /api/investment/assets/rates  body: { currency, rate }
  router.put('/assets/rates', (req, res) => {
    const { currency, rate } = req.body;
    if (!currency || !rate) return res.json({ success: false, error: '幣種和匯率為必填' });
    db.prepare(`INSERT INTO assets_rates (currency, rate) VALUES (?,?) ON CONFLICT(currency) DO UPDATE SET rate=excluded.rate, updated_at=datetime('now','localtime')`)
      .run(currency.toUpperCase(), parseFloat(rate));
    io.emit('investment:update');
    res.json({ success: true });
  });

  // DELETE /api/investment/assets/rates/:currency
  router.delete('/assets/rates/:currency', (req, res) => {
    db.prepare(`DELETE FROM assets_rates WHERE currency=?`).run(req.params.currency.toUpperCase());
    io.emit('investment:update');
    res.json({ success: true });
  });

  // POST /api/investment/assets/snapshots — 記錄今日快照
  router.post('/assets/snapshots', (req, res) => {
    const { note } = req.body;
    const { totalTWD } = calcAssets();
    const date = new Date().toISOString().slice(0, 10);
    // 同一天只保留最新一筆
    db.prepare(`DELETE FROM assets_snapshots WHERE date=?`).run(date);
    db.prepare(`INSERT INTO assets_snapshots (date, total_twd, note) VALUES (?,?,?)`)
      .run(date, totalTWD, note||'');
    io.emit('investment:update');
    res.json({ success: true, date, total_twd: totalTWD });
  });

  // DELETE /api/investment/assets/snapshots/:id
  router.delete('/assets/snapshots/:id', (req, res) => {
    db.prepare(`DELETE FROM assets_snapshots WHERE id=?`).run(req.params.id);
    io.emit('investment:update');
    res.json({ success: true });
  });

  // ── 外匯持倉 ─────────────────────────────────────

  // GET /api/investment/forex — 查詢外匯持倉
  router.get('/forex', (req, res) => {
    const rows = db.prepare(`SELECT * FROM forex ORDER BY status, date DESC`).all();
    const withPnl = rows.map(f => {
      const pnl = (f.current_rate - f.entry_rate) * f.amount;
      return { ...f, pnl: +pnl.toFixed(2) };
    });
    res.json({ success: true, data: withPnl });
  });

  // POST /api/investment/forex — 新增外匯持倉
  router.post('/forex', (req, res) => {
    const { pair, base_currency, quote_currency, amount, entry_rate, current_rate, date, note } = req.body;
    if (!pair || !base_currency || !quote_currency || !amount || !entry_rate || !date)
      return res.status(400).json({ success: false, error: '缺少必要欄位' });
    const r = db.prepare(
      `INSERT INTO forex (pair, base_currency, quote_currency, amount, entry_rate, current_rate, date, note) VALUES (?,?,?,?,?,?,?,?)`
    ).run(
      pair.toUpperCase(),
      base_currency.toUpperCase(),
      quote_currency.toUpperCase(),
      parseFloat(amount),
      parseFloat(entry_rate),
      parseFloat(current_rate) || parseFloat(entry_rate),
      date,
      note || ''
    );
    io.emit('investment:update');
    res.json({ success: true, id: r.lastInsertRowid });
  });

  // PUT /api/investment/forex/:id — 更新外匯持倉（現值匯率 / 平倉）
  router.put('/forex/:id', (req, res) => {
    const { current_rate, status, note } = req.body;
    db.prepare(`UPDATE forex SET current_rate=?, status=?, note=?, updated_at=datetime('now','localtime') WHERE id=?`)
      .run(parseFloat(current_rate) || 0, status || 'open', note || '', req.params.id);
    io.emit('investment:update');
    res.json({ success: true });
  });

  // DELETE /api/investment/forex/:id — 刪除外匯持倉
  router.delete('/forex/:id', (req, res) => {
    db.prepare(`DELETE FROM forex WHERE id=?`).run(req.params.id);
    io.emit('investment:update');
    res.json({ success: true });
  });

  return router;
};
