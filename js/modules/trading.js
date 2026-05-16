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

function bybitSign(payload, secret, timestamp, recvWindow) {
  const raw = `${timestamp}${process.env.BYBIT_API_KEY}${recvWindow}${payload}`;
  return require('crypto').createHmac('sha256', secret).update(raw).digest('hex');
}

async function bybitGet(endpoint, params = {}) {
  const apiKey    = process.env.BYBIT_API_KEY;
  const apiSecret = process.env.BYBIT_API_SECRET;
  if (!apiKey || !apiSecret) throw new Error('BYBIT_API_KEY / BYBIT_API_SECRET 未設定');

  const timestamp  = Date.now().toString();
  const recvWindow = '5000';
  const query      = new URLSearchParams(params).toString();
  const sign       = bybitSign(query, apiSecret, timestamp, recvWindow);

  const resp = await axios.get(`${bybitBaseUrl()}${endpoint}`, {
    params,
    headers: {
      'X-BAPI-API-KEY':     apiKey,
      'X-BAPI-SIGN':        sign,
      'X-BAPI-TIMESTAMP':   timestamp,
      'X-BAPI-RECV-WINDOW': recvWindow,
    },
    timeout: 10000,
  });

  if (resp.data.retCode !== 0) throw new Error(`Bybit: ${resp.data.retMsg} (code=${resp.data.retCode})`);
  return resp.data.result;
}

async function bybitPost(endpoint, body = {}) {
  const apiKey    = process.env.BYBIT_API_KEY;
  const apiSecret = process.env.BYBIT_API_SECRET;
  if (!apiKey || !apiSecret) throw new Error('BYBIT_API_KEY / BYBIT_API_SECRET 未設定');

  const timestamp  = Date.now().toString();
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

module.exports = (io) => {
  const router = express.Router();

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

  // GET /api/trading/bybit/balance — 帳戶餘額
  router.get('/bybit/balance', async (req, res) => {
    try {
      const result = await bybitGet('/v5/account/wallet-balance', { accountType: 'UNIFIED' });
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
