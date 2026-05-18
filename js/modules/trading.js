'use strict';

const express = require('express');
const crypto  = require('axios') ? require('crypto') : require('crypto');
const axios   = require('axios');
const path    = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

function bybitBaseUrl() {
  return process.env.BYBIT_TESTNET === 'true'
    ? 'https://api-testnet.bybit.com'
    : 'https://api.bybit.com';
}

let _serverTimeOffset = 0;
let _serverTimeLastSync = 0;

async function syncServerTime() {
  if (Date.now() - _serverTimeLastSync < 30000) return; // 30 秒內不重複同步
  try {
    const resp = await axios.get(`${bybitBaseUrl()}/v5/market/time`, { timeout: 5000 });
    const serverMs = parseInt(resp.data?.result?.timeNano?.slice(0, 13) || resp.data?.result?.timeSecond * 1000 || resp.data?.time);
    if (serverMs) {
      _serverTimeOffset = serverMs - Date.now();
      _serverTimeLastSync = Date.now();
    }
  } catch(e) { /* 同步失敗則沿用上次偏移 */ }
}

function bybitNow() {
  return (Date.now() + _serverTimeOffset).toString();
}

function bybitSign(payload, secret, timestamp, recvWindow) {
  const raw = `${timestamp}${process.env.BYBIT_API_KEY}${recvWindow}${payload}`;
  return require('crypto').createHmac('sha256', secret).update(raw).digest('hex');
}

async function bybitGet(endpoint, params = {}) {
  const apiKey    = process.env.BYBIT_API_KEY;
  const apiSecret = process.env.BYBIT_API_SECRET;
  if (!apiKey || !apiSecret) throw new Error('BYBIT_API_KEY / BYBIT_API_SECRET 未設定');

  await syncServerTime();
  const timestamp  = bybitNow();
  const recvWindow = '5000';
  const query      = new URLSearchParams(params).toString();
  const sign       = bybitSign(query, apiSecret, timestamp, recvWindow);

  let resp;
  try {
    resp = await axios.get(`${bybitBaseUrl()}${endpoint}`, {
      params,
      headers: {
        'X-BAPI-API-KEY':     apiKey,
        'X-BAPI-SIGN':        sign,
        'X-BAPI-TIMESTAMP':   timestamp,
        'X-BAPI-RECV-WINDOW': recvWindow,
      },
      timeout: 10000,
    });
  } catch(e) {
    const status = e.response?.status;
    if (status === 401) throw new Error('API Key 無效或測試網/正式網不符（HTTP 401）');
    throw e;
  }

  if (resp.data.retCode !== 0) throw new Error(`Bybit: ${resp.data.retMsg} (code=${resp.data.retCode})`);
  return resp.data.result;
}

async function bybitPost(endpoint, body = {}) {
  const apiKey    = process.env.BYBIT_API_KEY;
  const apiSecret = process.env.BYBIT_API_SECRET;
  if (!apiKey || !apiSecret) throw new Error('BYBIT_API_KEY / BYBIT_API_SECRET 未設定');

  await syncServerTime();
  const timestamp  = bybitNow();
  const recvWindow = '5000';
  const payload    = JSON.stringify(body);
  const sign       = bybitSign(payload, apiSecret, timestamp, recvWindow);

  const resp = await axios.post(`${bybitBaseUrl()}${endpoint}`, body, {
    headers: {
      'X-BAPI-API-KEY':     apiKey,
      'X-BAPI-SIGN':        sign,
      'X-BAPI-TIMESTAMP':   timestamp,
      'X-BAPI-RECV-WINDOW': recvWindow,
      'Content-Type':       'application/json',
    },
    timeout: 10000,
  });

  if (resp.data.retCode !== 0) throw new Error(`Bybit: ${resp.data.retMsg} (code=${resp.data.retCode})`);
  return resp.data.result;
}

const fs = require('fs');
const ENV_PATH = path.resolve(__dirname, '../../.env');

function readEnvFile() {
  return fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
}

function writeEnvKey(key, value) {
  let content = readEnvFile();
  const regex = new RegExp(`^${key}=.*$`, 'm');
  if (regex.test(content)) {
    content = content.replace(regex, `${key}=${value}`);
  } else {
    content = content.trimEnd() + `\n${key}=${value}`;
  }
  fs.writeFileSync(ENV_PATH, content, 'utf8');
  process.env[key] = value;
}

module.exports = (io) => {
  const router = express.Router();
  const db = require('../db').get();

  const mask = v => v ? v.slice(0, 4) + '••••••' + v.slice(-4) : '';

  // ── 交易所金鑰管理 ──────────────────────────────────────────
  // 啟用金鑰時同步 process.env（Bybit 相關函式繼續讀 process.env）
  function activateKeyToEnv(row) {
    const extra = JSON.parse(row.extra || '{}');
    if (row.exchange === 'bybit') {
      writeEnvKey('BYBIT_API_KEY',    row.api_key);
      writeEnvKey('BYBIT_API_SECRET', row.api_secret);
      writeEnvKey('BYBIT_TESTNET',    extra.testnet ? 'true' : 'false');
    }
  }

  // 啟動時：若 .env 有 BYBIT_API_KEY 但 DB 無紀錄，自動匯入
  (function migrateEnvKeys() {
    try {
      const existing = db.prepare(`SELECT id FROM exchange_keys WHERE exchange='bybit'`).get();
      if (!existing && process.env.BYBIT_API_KEY && process.env.BYBIT_API_SECRET) {
        const extra = JSON.stringify({ testnet: process.env.BYBIT_TESTNET === 'true' });
        db.prepare(`INSERT INTO exchange_keys (exchange, label, api_key, api_secret, extra, is_active) VALUES ('bybit','主帳號',?,?,?,1)`)
          .run(process.env.BYBIT_API_KEY, process.env.BYBIT_API_SECRET, extra);
      }
    } catch(e) { /* ignore */ }
  })();

  // GET /api/trading/exchanges/keys?exchange=bybit
  router.get('/exchanges/keys', (req, res) => {
    try {
      const { exchange } = req.query;
      const rows = exchange
        ? db.prepare(`SELECT * FROM exchange_keys WHERE exchange=? ORDER BY is_active DESC, id ASC`).all(exchange)
        : db.prepare(`SELECT * FROM exchange_keys ORDER BY exchange, is_active DESC, id ASC`).all();
      const masked = rows.map(r => ({
        ...r,
        api_key_masked:    mask(r.api_key),
        api_secret_masked: mask(r.api_secret),
        api_key: undefined, api_secret: undefined,
        extra: JSON.parse(r.extra || '{}'),
      }));
      res.json({ success: true, data: masked });
    } catch(e) { res.json({ success: false, error: e.message }); }
  });

  // POST /api/trading/exchanges/keys — 新增金鑰
  router.post('/exchanges/keys', (req, res) => {
    try {
      const { exchange, label, api_key, api_secret, extra = {}, set_active = false } = req.body;
      if (!exchange || !api_key || !api_secret) return res.json({ success: false, error: '請填寫完整資訊' });
      const extraStr = JSON.stringify(extra);
      if (set_active) db.prepare(`UPDATE exchange_keys SET is_active=0 WHERE exchange=?`).run(exchange);
      const r = db.prepare(`INSERT INTO exchange_keys (exchange,label,api_key,api_secret,extra,is_active) VALUES (?,?,?,?,?,?)`)
        .run(exchange, (label||'').trim()||'主帳號', api_key.trim(), api_secret.trim(), extraStr, set_active ? 1 : 0);
      if (set_active) activateKeyToEnv({ exchange, api_key: api_key.trim(), api_secret: api_secret.trim(), extra: extraStr });
      res.json({ success: true, id: r.lastInsertRowid });
    } catch(e) { res.json({ success: false, error: e.message }); }
  });

  // PUT /api/trading/exchanges/keys/:id/activate — 切換使用中金鑰
  router.put('/exchanges/keys/:id/activate', (req, res) => {
    try {
      const row = db.prepare(`SELECT * FROM exchange_keys WHERE id=?`).get(req.params.id);
      if (!row) return res.json({ success: false, error: '找不到此金鑰' });
      db.prepare(`UPDATE exchange_keys SET is_active=0 WHERE exchange=?`).run(row.exchange);
      db.prepare(`UPDATE exchange_keys SET is_active=1 WHERE id=?`).run(row.id);
      activateKeyToEnv(row);
      res.json({ success: true });
    } catch(e) { res.json({ success: false, error: e.message }); }
  });

  // DELETE /api/trading/exchanges/keys/:id
  router.delete('/exchanges/keys/:id', (req, res) => {
    try {
      const row = db.prepare(`SELECT * FROM exchange_keys WHERE id=?`).get(req.params.id);
      if (!row) return res.json({ success: false, error: '找不到此金鑰' });
      db.prepare(`DELETE FROM exchange_keys WHERE id=?`).run(row.id);
      res.json({ success: true });
    } catch(e) { res.json({ success: false, error: e.message }); }
  });

  // GET /api/trading/bybit/config — 取得目前設定（Key 遮罩）
  router.get('/bybit/config', (req, res) => {
    const key    = process.env.BYBIT_API_KEY    || '';
    const secret = process.env.BYBIT_API_SECRET || '';
    const testnet = process.env.BYBIT_TESTNET === 'true';
    res.json({
      success: true,
      data: {
        api_key_masked: key ? key.slice(0, 6) + '••••••' + key.slice(-4) : '',
        has_key:    !!key,
        has_secret: !!secret,
        testnet,
      }
    });
  });

  // POST /api/trading/bybit/config — 儲存 API Key 到 .env
  router.post('/bybit/config', (req, res) => {
    try {
      const { api_key, api_secret, testnet } = req.body;
      if (api_key !== undefined && api_key !== '')    writeEnvKey('BYBIT_API_KEY',    api_key.trim());
      if (api_secret !== undefined && api_secret !== '') writeEnvKey('BYBIT_API_SECRET', api_secret.trim());
      if (testnet !== undefined) writeEnvKey('BYBIT_TESTNET', testnet ? 'true' : 'false');
      res.json({ success: true });
    } catch(e) { res.json({ success: false, error: e.message }); }
  });

  // GET /api/trading/bybit/status — 連線狀態
  router.get('/bybit/status', async (req, res) => {
    const configured = !!(process.env.BYBIT_API_KEY && process.env.BYBIT_API_SECRET);
    if (!configured) return res.json({ success: true, configured: false });
    try {
      await bybitGet('/v5/account/wallet-balance', { accountType: 'UNIFIED' });
      res.json({ success: true, configured: true, connected: true, testnet: process.env.BYBIT_TESTNET === 'true' });
    } catch(e) {
      res.json({ success: true, configured: true, connected: false, error: e.message });
    }
  });

  // GET /api/trading/bybit/balance — 統一交易帳戶餘額
  router.get('/bybit/balance', async (req, res) => {
    try {
      const result = await bybitGet('/v5/account/wallet-balance', { accountType: 'UNIFIED' });
      res.json({ success: true, data: result });
    } catch(e) { res.json({ success: false, error: e.message }); }
  });

  // GET /api/trading/bybit/fund-balance — 資金帳戶餘額
  router.get('/bybit/fund-balance', async (req, res) => {
    try {
      const result = await bybitGet('/v5/asset/transfer/query-account-coins-balance', { accountType: 'FUND' });
      res.json({ success: true, data: result });
    } catch(e) { res.json({ success: false, error: e.message }); }
  });

  // GET /api/trading/bybit/positions — 持倉
  router.get('/bybit/positions', async (req, res) => {
    try {
      const result = await bybitGet('/v5/position/list', { category: 'linear', settleCoin: 'USDT' });
      res.json({ success: true, data: result });
    } catch(e) { res.json({ success: false, error: e.message }); }
  });

  // GET /api/trading/bybit/ticker?symbol=BTCUSDT
  router.get('/bybit/ticker', async (req, res) => {
    try {
      const { symbol = 'BTCUSDT', category = 'linear' } = req.query;
      const result = await bybitGet('/v5/market/tickers', { category, symbol });
      res.json({ success: true, data: result });
    } catch(e) { res.json({ success: false, error: e.message }); }
  });

  return router;
};
