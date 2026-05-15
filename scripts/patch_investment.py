import re, sys

with open('c:/Project/life_manage/public/index.html', 'r', encoding='utf-8') as f:
    content = f.read()

results = {}

# ─────────────────────────────────────────────
# 1. 移除 header 的「新增帳戶」按鈕
# ─────────────────────────────────────────────
old = (
    '        <div class="sec-header-right" id="inv-header-assets" style="display:flex;">\n'
    '          <button class="btn btn-outline btn-sm" onclick="showAssetRates()">💱 匯率設定</button>\n'
    '          <button class="btn btn-outline btn-sm" onclick="saveAssetSnapshot()">📷 記錄快照</button>\n'
    '          <button class="btn btn-primary" onclick="showAddAccount()">＋ 新增帳戶</button>\n'
    '        </div>'
)
new = (
    '        <div class="sec-header-right" id="inv-header-assets" style="display:flex;">\n'
    '          <button class="btn btn-outline btn-sm" onclick="showAssetRates()">💱 匯率設定</button>\n'
    '          <button class="btn btn-outline btn-sm" onclick="saveAssetSnapshot()">📷 記錄快照</button>\n'
    '        </div>'
)
results['1_header'] = old in content
content = content.replace(old, new)

# ─────────────────────────────────────────────
# 2. 重設 inv-sub-assets HTML（移除帳戶明細表，改為圖表+快照 grid-2）
# ─────────────────────────────────────────────
# Find the block between <!-- ── 資產總覽 ── --> and <!-- ── 市場持倉（台股/美股/加密貨幣共用） ── -->
old_marker_start = '      <!-- ── 資產總覽 ── -->'
old_marker_end   = '\n\n      <!-- ── 市場持倉（台股/美股/加密貨幣共用） ── -->'
idx_start = content.find(old_marker_start)
idx_end   = content.find(old_marker_end)
if idx_start != -1 and idx_end != -1:
    old_block = content[idx_start:idx_end]
    new_block = (
        '      <!-- ── 資產總覽 ── -->\n'
        '      <div class="inv-sub active" id="inv-sub-assets">\n'
        '        <div class="stats-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:16px;">\n'
        '          <div class="stat-card"><div class="lbl">總資產(TWD)</div><div class="val" id="ast-total">--</div></div>\n'
        '          <div class="stat-card"><div class="lbl">📈 庫存市值</div><div class="val" id="ast-inv" style="color:var(--primary);">--</div><div class="sub" id="ast-inv-pct">佔 --%</div></div>\n'
        '          <div class="stat-card"><div class="lbl">💵 存款總額</div><div class="val" id="ast-cash" style="color:var(--success);">--</div><div class="sub" id="ast-cash-pct">佔 --%</div></div>\n'
        '        </div>\n'
        '        <div id="ast-market-cards" style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:16px;"></div>\n'
        '        <div class="grid-2">\n'
        '          <div class="card">\n'
        '            <div class="card-title" style="display:flex;justify-content:space-between;align-items:center;">\n'
        '              <span>總資產歷史走勢</span>\n'
        '              <small style="font-weight:400;color:var(--muted);font-size:12px;">點擊「📷 記錄快照」新增</small>\n'
        '            </div>\n'
        '            <canvas id="assets-chart" height="155"></canvas>\n'
        '            <div id="assets-chart-empty" style="display:none;text-align:center;color:var(--muted);padding:28px;font-size:14px;">尚無快照記錄</div>\n'
        '          </div>\n'
        '          <div class="card">\n'
        '            <div class="card-title">快照紀錄</div>\n'
        '            <div id="ast-snapshots"><div style="color:var(--muted);font-size:14px;">載入中...</div></div>\n'
        '          </div>\n'
        '        </div>\n'
        '      </div>'
    )
    content = content.replace(old_block, new_block, 1)
    results['2_assets_html'] = True
else:
    results['2_assets_html'] = f'FAIL idx_start={idx_start} idx_end={idx_end}'

# ─────────────────────────────────────────────
# 3. 重設 inv-sub-forex HTML（像台股一樣）
# ─────────────────────────────────────────────
old_marker_start = '      <!-- ── 存款 ── -->'
old_marker_end   = '\n    </div>\n\n    <!-- ════ INVEST'
idx_start = content.find(old_marker_start)
idx_end   = content.find(old_marker_end)
if idx_start != -1 and idx_end != -1:
    old_block = content[idx_start:idx_end]
    new_block = (
        '      <!-- ── 存款 ── -->\n'
        '      <div class="inv-sub" id="inv-sub-forex">\n'
        '        <div class="stats-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:16px;">\n'
        '          <div class="stat-card"><div class="lbl">存款總額(TWD)</div><div class="val" id="dep-total">--</div></div>\n'
        '          <div class="stat-card"><div class="lbl">帳戶數</div><div class="val" id="dep-count">--</div></div>\n'
        '          <div class="stat-card"><div class="lbl">佔總資產</div><div class="val" id="dep-pct">--%</div></div>\n'
        '        </div>\n'
        '        <div class="card">\n'
        '          <div class="card-title" style="display:flex;justify-content:space-between;align-items:center;">\n'
        '            <span>帳戶列表</span>\n'
        '            <div style="display:flex;gap:8px;">\n'
        '              <button class="btn btn-sm btn-danger" id="btn-acc-bulk-delete" disabled onclick="deleteSelectedAccounts()">🗑 刪除</button>\n'
        '              <button class="btn btn-sm btn-primary" onclick="showAddAccount()">＋ 新增存款</button>\n'
        '            </div>\n'
        '          </div>\n'
        '          <div class="tbl-wrap">\n'
        '            <table id="ast-table">\n'
        '              <thead>\n'
        '                <tr>\n'
        '                  <th class="th-check"><input type="checkbox" id="acc-chk-all" onchange="toggleAccSelectAll(this)"></th>\n'
        '                  <th>帳戶</th><th>幣種</th>\n'
        '                  <th style="text-align:right;">金額</th>\n'
        '                  <th style="text-align:right;">匯率</th>\n'
        '                  <th style="text-align:right;">換算台幣</th>\n'
        '                  <th style="text-align:right;">佔比</th>\n'
        '                  <th>類別</th>\n'
        '                  <th style="width:80px;"></th>\n'
        '                </tr>\n'
        '              </thead>\n'
        '              <tbody id="ast-tbody">\n'
        '                <tr><td colspan="9" style="text-align:center;color:var(--muted);padding:32px;">尚無存款記錄，點擊「＋ 新增存款」開始建立</td></tr>\n'
        '              </tbody>\n'
        '              <tfoot id="ast-tfoot"></tfoot>\n'
        '            </table>\n'
        '          </div>\n'
        '        </div>\n'
        '      </div>'
    )
    content = content.replace(old_block, new_block, 1)
    results['3_forex_html'] = True
else:
    results['3_forex_html'] = f'FAIL idx_start={idx_start} idx_end={idx_end}'

# ─────────────────────────────────────────────
# 4. loadAssets() — 更新統計卡 JS（移除 ast-ratio 等）
# ─────────────────────────────────────────────
old = (
    "  // ── 統計卡 ──\n"
    "  $('ast-total').textContent    = fmtMoney(d.totalTWD);\n"
    "  $('ast-inv').textContent      = fmtMoney(d.investmentTWD);\n"
    "  $('ast-inv-pct').textContent  = `佔 ${d.investmentPct}%`;\n"
    "  $('ast-cash').textContent     = fmtMoney(d.cashTWD);\n"
    "  $('ast-cash-pct').textContent = `佔 ${d.cashPct}%`;\n"
    "  $('ast-ratio').textContent    = `${d.investmentPct}% / ${d.cashPct}%`;\n"
    "  $('ast-bar-inv').style.width  = d.investmentPct + '%';\n"
    "  $('ast-bar-cash').style.flex  = '1';"
)
new = (
    "  // ── 統計卡 ──\n"
    "  $('ast-total').textContent    = fmtMoney(d.totalTWD);\n"
    "  $('ast-inv').textContent      = fmtMoney(d.investmentTWD);\n"
    "  $('ast-inv-pct').textContent  = `佔 ${d.investmentPct}%`;\n"
    "  $('ast-cash').textContent     = fmtMoney(d.cashTWD);\n"
    "  $('ast-cash-pct').textContent = `佔 ${d.cashPct}%`;"
)
results['4_stats_js'] = old in content
content = content.replace(old, new)

# ─────────────────────────────────────────────
# 5. loadAssets() — 市場卡改為 4 欄（台股含借券放第一、加存款卡）
# ─────────────────────────────────────────────
old_cards_start = "  const [twSum, usSum, cryptoSum] = await Promise.all(["
old_cards_end   = "  // ── 帳戶明細表 ──"
idx_s = content.find(old_cards_start)
idx_e = content.find(old_cards_end)
if idx_s != -1 and idx_e != -1:
    old_block = content[idx_s:idx_e]
    new_block = (
        "  const [twSum, usSum, cryptoSum, shortsData] = await Promise.all([\n"
        "    api('/api/investment/summary?market=tw'),\n"
        "    api('/api/investment/summary?market=us'),\n"
        "    api('/api/investment/summary?market=crypto'),\n"
        "    api('/api/investment/shorts'),\n"
        "  ]);\n"
        "  const shortsTWD = (shortsData.data||[]).reduce((s,x)=>s+(x.short_shares*(x.current_price||x.avg_sell_price||0)),0);\n"
        "  $('ast-market-cards').innerHTML = [\n"
        "    { label:'<img class=\"tab-flag\" src=\"/flags/tw.svg\" alt=\"TW\"> 台股', tab:'tw', sum:twSum.data, rate:1, extra:shortsTWD, extraLabel:'借券' },\n"
        "    { label:'<img class=\"tab-flag\" src=\"/flags/us.svg\" alt=\"US\"> 美股', tab:'us', sum:usSum.data, rate:usdRate },\n"
        "    { label:'💎 加密貨幣', tab:'crypto', sum:cryptoSum.data, rate:usdRate },\n"
        "    { label:'💰 存款', tab:'forex', deposit:true, totalTWD:d.cashTWD||0, pct:d.cashPct||0 },\n"
        "  ].map(({label,tab,sum,rate,extra,extraLabel,deposit,totalTWD,pct})=>{\n"
        "    if(deposit){\n"
        "      const hasData = totalTWD > 0;\n"
        "      return `<div class=\"stat-card\" style=\"cursor:pointer;transition:box-shadow .15s;\" onclick=\"switchInvTab('${tab}')\"\n"
        "          onmouseover=\"this.style.boxShadow='0 4px 16px rgba(99,102,241,.18)'\" onmouseout=\"this.style.boxShadow=''\">\n"
        "        <div class=\"lbl\">${label}</div>\n"
        "        <div style=\"font-size:15px;font-weight:700;margin:6px 0;\">${hasData ? fmtMoney(totalTWD) : '<span style=\"color:var(--muted);font-size:13px;\">尚無存款</span>'}</div>\n"
        "        ${hasData ? `<div style=\"font-size:12px;color:var(--muted);\">${pct}% 佔比</div>` : ''}\n"
        "        <div style=\"font-size:11px;color:var(--muted);margin-top:4px;\">點擊進入 →</div>\n"
        "      </div>`;\n"
        "    }\n"
        "    const pnl=parseFloat(sum?.pnl||0)*rate;\n"
        "    const holdVal=parseFloat(sum?.totalValue||0)*rate;\n"
        "    const extraVal=extra||0;\n"
        "    const totalVal=holdVal+extraVal;\n"
        "    const hasData=parseFloat(sum?.count||0)>0||extraVal>0;\n"
        "    const curr=rate===1?'':' (TWD)';\n"
        "    return `<div class=\"stat-card\" style=\"cursor:pointer;transition:box-shadow .15s;\" onclick=\"switchInvTab('${tab}')\"\n"
        "        onmouseover=\"this.style.boxShadow='0 4px 16px rgba(99,102,241,.18)'\" onmouseout=\"this.style.boxShadow=''\">\n"
        "      <div class=\"lbl\">${label}</div>\n"
        "      <div style=\"font-size:15px;font-weight:700;margin:6px 0;\">${hasData ? fmtMoney(totalVal)+curr : '<span style=\"color:var(--muted);font-size:13px;\">尚無庫存</span>'}</div>\n"
        "      ${parseFloat(sum?.count||0)>0?`<div style=\"font-size:12px;\" class=\"${pnl>=0?'pnl-pos':'pnl-neg'}\">損益 ${pnl>=0?'+':''}${fmtMoney(pnl)} (${sum?.pnlPct||0}%)</div>`:''}\n"
        "      ${extraVal>0?`<div style=\"font-size:11px;color:var(--muted);\">含${extraLabel} ${fmtMoney(extraVal)}</div>`:''}\n"
        "      <div style=\"font-size:11px;color:var(--muted);margin-top:4px;\">點擊進入 →</div>\n"
        "    </div>`;\n"
        "  }).join('');\n\n"
    )
    content = content.replace(old_block, new_block, 1)
    results['5_market_cards'] = True
else:
    results['5_market_cards'] = f'FAIL idx_s={idx_s} idx_e={idx_e}'

# ─────────────────────────────────────────────
# 6. loadAssets() — 移除帳戶明細表 + tfoot 渲染（到「歷史走勢圖」之前）
# ─────────────────────────────────────────────
old_acc_start = "  // ── 帳戶明細表 ──"
old_acc_end   = "\n\n  // ── 歷史走勢圖 ──"
idx_s = content.find(old_acc_start)
idx_e = content.find(old_acc_end)
if idx_s != -1 and idx_e != -1:
    old_block = content[idx_s:idx_e]
    content = content.replace(old_block, '', 1)
    results['6_remove_accounts'] = True
else:
    results['6_remove_accounts'] = f'FAIL idx_s={idx_s} idx_e={idx_e}'

# ─────────────────────────────────────────────
# 7. 重寫 loadForex() — 改為載入帳戶資料
# ─────────────────────────────────────────────
old_forex_start = "async function loadForex(){"
old_forex_end   = "\nfunction showAddDeposit(){"
idx_s = content.find(old_forex_start)
idx_e = content.find(old_forex_end)
if idx_s != -1 and idx_e != -1:
    old_block = content[idx_s:idx_e]
    new_block = (
        "async function loadForex(){\n"
        "  const r = await api('/api/investment/assets');\n"
        "  if(!r.success){ toast('存款載入失敗：'+r.error,'err'); return; }\n"
        "  const d = r.data;\n"
        "  const depEl = $('dep-total'), cntEl = $('dep-count'), pctEl = $('dep-pct');\n"
        "  if(depEl) depEl.textContent = fmtMoney(d.cashTWD||0);\n"
        "  if(cntEl) cntEl.textContent = (d.accounts||[]).length;\n"
        "  if(pctEl) pctEl.textContent = (d.cashPct||0)+'%';\n"
        "  const catBadge = c => c==='投資'\n"
        "    ? `<span class=\"badge b-stock\">📈 投資</span>`\n"
        "    : `<span class=\"badge b-pending\">💵 現金</span>`;\n"
        "  const accChkAll = $('acc-chk-all');\n"
        "  if(accChkAll){ accChkAll.checked=false; accChkAll.indeterminate=false; }\n"
        "  _updateAccBulkDeleteBtn();\n"
        "  $('ast-tbody').innerHTML = (d.accounts||[]).length ? (d.accounts).map(a => `\n"
        "    <tr data-id=\"${a.id}\">\n"
        "      <td class=\"td-check\"><input type=\"checkbox\" class=\"acc-row-chk\" data-id=\"${a.id}\" onchange=\"onAccRowCheck()\"></td>\n"
        "      <td><strong>${a.unit}</strong></td>\n"
        "      <td><span class=\"badge b-pending\">${a.currency}</span></td>\n"
        "      <td style=\"text-align:right;\">${Number(a.amount).toLocaleString('zh-TW',{minimumFractionDigits:0,maximumFractionDigits:4})}</td>\n"
        "      <td style=\"text-align:right;color:var(--muted);font-size:13px;\">${a.rate}</td>\n"
        "      <td style=\"text-align:right;font-weight:600;\">${a.twdAmount!==null?fmtMoney(a.twdAmount):'<span style=\"color:var(--warning);\">未設匯率</span>'}</td>\n"
        "      <td style=\"text-align:right;color:var(--primary);font-size:13px;\">${a.percentage}</td>\n"
        "      <td>${catBadge(a.category)}</td>\n"
        "      <td style=\"white-space:nowrap;\">\n"
        "        <span class=\"acc-drag-handle\" title=\"拖曳排序\" style=\"cursor:grab;padding:0 6px;color:var(--muted);\">⠿</span>\n"
        "        <button class=\"btn btn-xs btn-outline\" onclick=\"showEditAccount(${a.id})\">✏️</button>\n"
        "      </td>\n"
        "    </tr>\n"
        "  `).join('') : `<tr><td colspan=\"9\" style=\"text-align:center;color:var(--muted);padding:32px;\">尚無存款記錄，點擊「＋ 新增存款」開始建立</td></tr>`;\n"
        "  $('ast-tfoot').innerHTML = (d.accounts||[]).length ? `\n"
        "    <tr class=\"assets-tbl-row-total\">\n"
        "      <td></td><td colspan=\"4\"><strong>合計</strong></td>\n"
        "      <td style=\"text-align:right;\"><strong>${fmtMoney(d.cashTWD||0)}</strong></td>\n"
        "      <td style=\"text-align:right;font-weight:700;\">100%</td>\n"
        "      <td colspan=\"2\"></td>\n"
        "    </tr>` : '';\n"
        "  initAssetsSortable();\n"
        "}\n"
    )
    content = content.replace(old_block, new_block, 1)
    results['7_loadforex'] = True
else:
    results['7_loadforex'] = f'FAIL idx_s={idx_s} idx_e={idx_e}'

# ─────────────────────────────────────────────
# 8. 帳戶操作後改呼叫 loadForex（而非 loadAssets）
# ─────────────────────────────────────────────
# showAddAccount callback
old = "if(r.success){ toast('\\u5e33\\u6236\\u5df2\\u65b0\\u589e','ok'); closeModalForce(); loadAssets(); }"
new = "if(r.success){ toast('存款已新增','ok'); closeModalForce(); loadForex(); }"
results['8a_add'] = old in content
content = content.replace(old, new)
if not results['8a_add']:
    # try finding it differently - search for the loadAssets call in showAddAccount context
    idx = content.find("closeModalForce(); loadAssets(); }\n      else toast(r.error")
    if idx != -1:
        content = content[:idx] + "closeModalForce(); loadForex(); }\n      else toast(r.error" + content[idx+len("closeModalForce(); loadAssets(); }\n      else toast(r.error"):]
        results['8a_add'] = 'fixed_alt'

# showEditAccount callback
old8b = "closeModalForce(); loadAssets();\n      } else toast(r.error,'err');\n    }\n  });\n}\n\n// ── 編輯帳戶"
# This is complex - let me search for it more broadly
idx = content.find("if(r.success){\n        toast(")
while idx != -1:
    chunk = content[idx:idx+200]
    if 'loadAssets' in chunk:
        end_idx = content.find('loadAssets();', idx)
        if end_idx != -1:
            content = content[:end_idx] + 'loadForex();' + content[end_idx+len('loadAssets();'):]
            results['8_callbacks'] = True
            break
    idx = content.find("if(r.success){\n        toast(", idx+1)

# Also replace any remaining loadAssets() in account-related callbacks
import re
def replace_in_account_callbacks(c):
    # Replace loadAssets() calls inside showEditAccount and deleteSelectedAccounts functions
    # Find showEditAccount function
    for fn_name in ['showEditAccount', 'deleteSelectedAccounts']:
        fn_idx = c.find(f'async function {fn_name}')
        if fn_idx == -1:
            fn_idx = c.find(f'function {fn_name}')
        if fn_idx == -1:
            continue
        # Find next function boundary (look for 'function ' or 'async function ')
        next_fn = re.search(r'\n(async )?function ', c[fn_idx+10:])
        if next_fn:
            fn_end = fn_idx + 10 + next_fn.start()
        else:
            fn_end = fn_idx + 2000
        fn_body = c[fn_idx:fn_end]
        if 'loadAssets()' in fn_body:
            new_fn_body = fn_body.replace('loadAssets()', 'loadForex()')
            c = c[:fn_idx] + new_fn_body + c[fn_end:]
    return c

content = replace_in_account_callbacks(content)
results['8_loadassets_in_callbacks'] = True

print('All changes:')
for k,v in results.items():
    print(f'  {k}: {v}')

with open('c:/Project/life_manage/public/index.html', 'w', encoding='utf-8') as f:
    f.write(content)
print('Done. File written.')
