const ASSET_CLASS_LABELS = { stock_br:'Ação BR', stock_us:'Ação EUA', fii:'FII', crypto:'Cripto', fixed_income:'Renda Fixa', fund:'Fundo', other:'Outro' };
const ASSET_CLASS_COLORS = { stock_br:'#3A5A40', stock_us:'#2A7C82', fii:'#4D7549', crypto:'#D4A24C', fixed_income:'#165D62', fund:'#8A6418', other:'#ADA897' };
const INV_TX_LABELS = { buy:'Compra', sell:'Venda', dividend:'Dividendo', interest:'Juros/JCP', split:'Desdobramento', bonus:'Bonificação' };

let _invPageCache = { investments: [], summary: {} };
let _invChart = null;

async function renderInvestments() {
  const content = document.getElementById('content');
  content.innerHTML = `<div class="loading-screen"><div class="spinner"></div></div>`;
  try {
    const [investments, summary] = await Promise.all([
      db.investments.toArray(),
      _api('GET', '/data/investments_summary').catch(() => ({}))
    ]);
    _invPageCache = { investments, summary: summary || {} };
    _renderInvestmentsHtml('');
  } catch (e) {
    content.innerHTML = `<div class="empty-state"><p>Erro ao carregar investimentos.</p></div>`;
  }
}

function _renderInvestmentsHtml(search = '') {
  const content = document.getElementById('content');
  const { investments, summary } = _invPageCache;

  const filtered = search
    ? investments.filter(i =>
        (i.ticker || '').toLowerCase().includes(search.toLowerCase()) ||
        (i.name || '').toLowerCase().includes(search.toLowerCase())
      )
    : investments;

  const totalCurrent  = investments.reduce((s, i) => s + ((i.quantity || 0) * (i.current_price || 0)), 0);
  const totalInvested = investments.reduce((s, i) => s + ((i.quantity || 0) * (i.avg_price || 0)), 0);
  const rentPct = totalInvested > 0 ? ((totalCurrent - totalInvested) / totalInvested) * 100 : 0;
  const proventos = summary.proventos || 0;

  const rentColor = rentPct >= 0 ? 'var(--income-text)' : 'var(--expense)';

  content.innerHTML = `
    <div class="summary-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:20px">
      <div class="summary-card income-card">
        <div class="label">Patrimônio Atual</div>
        <div class="value">${fmt(totalCurrent)}</div>
        <div class="sub">${investments.length} ativo${investments.length !== 1 ? 's' : ''}</div>
      </div>
      <div class="summary-card">
        <div class="label" style="color:${rentColor}">Rentabilidade</div>
        <div class="value" style="color:${rentColor}">${rentPct >= 0 ? '+' : ''}${rentPct.toFixed(2)}%</div>
        <div class="sub">${rentPct >= 0 ? '+' : ''}${fmt(totalCurrent - totalInvested)}</div>
      </div>
      <div class="summary-card">
        <div class="label">Total Investido</div>
        <div class="value">${fmt(totalInvested)}</div>
      </div>
      <div class="summary-card">
        <div class="label" style="color:var(--income-text)">Proventos</div>
        <div class="value" style="color:var(--income-text)">${fmt(proventos)}</div>
      </div>
    </div>

    <div class="section-header" style="margin-bottom:16px">
      <div class="section-title">Carteira de Investimentos (${investments.length})</div>
      <div style="display:flex;gap:8px;align-items:center">
        <input class="form-control" type="search" placeholder="Buscar ticker ou nome..."
          oninput="_invSearch(this.value)" value="${_escHtml(search)}"
          style="flex:1;min-width:160px;max-width:240px">
        <button class="btn btn-primary btn-sm" onclick="openInvestmentModal()">
          ${icon('plus', 15)} Novo Ativo
        </button>
      </div>
    </div>

    ${investments.length === 0 ? `
      <div class="empty-state">
        ${icon('trending-up', 48)}
        <p>Nenhum ativo cadastrado</p>
        <button class="btn btn-primary btn-sm" onclick="openInvestmentModal()">${icon('plus',14)} Novo Ativo</button>
      </div>` : `
      <div style="display:flex;gap:20px;flex-wrap:wrap;align-items:flex-start;margin-bottom:24px">
        <div style="min-width:260px;max-width:300px;flex-shrink:0">
          <canvas id="inv-donut-chart" width="260" height="260"></canvas>
          <div id="inv-chart-legend" style="margin-top:12px;display:flex;flex-wrap:wrap;gap:6px 12px"></div>
        </div>
        <div class="inv-list" style="flex:1;min-width:280px;display:flex;flex-direction:column;gap:8px">
          ${filtered.length === 0
            ? `<div class="empty-state"><p>Nenhum resultado para "${_escHtml(search)}"</p></div>`
            : filtered.map(invRow).join('')}
        </div>
      </div>`}
  `;

  if (investments.length > 0) {
    _drawInvChart(investments);
  }

  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function invRow(inv) {
  const total  = (inv.quantity || 0) * (inv.current_price || 0);
  const cost   = (inv.quantity || 0) * (inv.avg_price || 0);
  const diff   = cost > 0 ? ((total - cost) / cost) * 100 : 0;
  const diffColor = diff >= 0 ? 'var(--income-text)' : 'var(--expense)';
  const cls    = ASSET_CLASS_LABELS[inv.asset_class] || inv.asset_class || 'Outro';
  const clrHex = ASSET_CLASS_COLORS[inv.asset_class] || ASSET_CLASS_COLORS.other;

  return `
    <div class="inv-item card" style="padding:12px 14px" data-id="${inv.id}">
      <div class="inv-item-main" style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        <div style="width:36px;height:36px;border-radius:10px;background:${clrHex}22;color:${clrHex};display:flex;align-items:center;justify-content:center;font-size:1.1rem;flex-shrink:0">
          ${inv.icon || '📈'}
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:.9rem">${_escHtml(inv.ticker || '')}</div>
          <div style="font-size:.78rem;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_escHtml(inv.name || '')}</div>
        </div>
        <span class="badge" style="background:${clrHex}22;color:${clrHex};font-size:.72rem">${cls}</span>
      </div>
      <div class="inv-item-data" style="display:flex;flex-wrap:wrap;gap:6px 14px;margin-bottom:8px">
        <div class="inv-data-cell">
          <div class="inv-data-label" style="font-size:.72rem;color:var(--text-muted)">Qtd</div>
          <div class="inv-data-value" style="font-size:.85rem;font-weight:600">${(inv.quantity || 0).toLocaleString('pt-BR', {maximumFractionDigits:6})}</div>
        </div>
        <div class="inv-data-cell">
          <div class="inv-data-label" style="font-size:.72rem;color:var(--text-muted)">PM</div>
          <div class="inv-data-value" style="font-size:.85rem">${fmt(inv.avg_price || 0)}</div>
        </div>
        <div class="inv-data-cell">
          <div class="inv-data-label" style="font-size:.72rem;color:var(--text-muted)">Cotação</div>
          <div class="inv-data-value" style="font-size:.85rem">${fmt(inv.current_price || 0)}</div>
        </div>
        <div class="inv-data-cell">
          <div class="inv-data-label" style="font-size:.72rem;color:var(--text-muted)">Total</div>
          <div class="inv-data-value" style="font-size:.85rem;font-weight:700">${fmt(total)}</div>
        </div>
        <div class="inv-data-cell">
          <div class="inv-data-label" style="font-size:.72rem;color:var(--text-muted)">Rent.</div>
          <div class="inv-data-value" style="font-size:.85rem;font-weight:700;color:${diffColor}">${diff >= 0 ? '+' : ''}${diff.toFixed(2)}%</div>
        </div>
      </div>
      <div class="inv-item-actions" style="display:flex;gap:4px;justify-content:flex-end">
        <button class="btn btn-sm btn-icon btn-ghost" onclick="openUpdatePriceModal('${inv.id}')" title="Atualizar cotação">${icon('refresh-cw', 14)}</button>
        <button class="btn btn-sm btn-icon btn-ghost" onclick="openInvTxModal('${inv.id}')" title="Registrar operação">${icon('plus-circle', 14)}</button>
        <button class="btn btn-sm btn-icon btn-ghost" onclick="openInvestmentModal('${inv.id}')" title="Editar">${icon('pencil', 14)}</button>
        <button class="btn btn-sm btn-icon btn-danger" onclick="deleteInvestment('${inv.id}')" title="Excluir">${icon('trash-2', 14)}</button>
      </div>
    </div>
  `;
}

function _drawInvChart(investments) {
  const canvas = document.getElementById('inv-donut-chart');
  if (!canvas) return;

  if (_invChart) { _invChart.destroy(); _invChart = null; }

  const grouped = {};
  investments.forEach(i => {
    const cls = i.asset_class || 'other';
    const val = (i.quantity || 0) * (i.current_price || 0);
    grouped[cls] = (grouped[cls] || 0) + val;
  });

  const keys    = Object.keys(grouped).filter(k => grouped[k] > 0);
  const labels  = keys.map(k => ASSET_CLASS_LABELS[k] || k);
  const values  = keys.map(k => grouped[k]);
  const colors  = keys.map(k => ASSET_CLASS_COLORS[k] || ASSET_CLASS_COLORS.other);

  _invChart = new Chart(canvas, {
    type: 'doughnut',
    data: { labels, datasets: [{ data: values, backgroundColor: colors, borderWidth: 2, borderColor: 'var(--surface)' }] },
    options: {
      responsive: false,
      cutout: '68%',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ` ${fmt(ctx.raw)} (${((ctx.raw / values.reduce((a,b)=>a+b,0))*100).toFixed(1)}%)`
          }
        }
      }
    }
  });

  const legend = document.getElementById('inv-chart-legend');
  if (legend) {
    const total = values.reduce((a, b) => a + b, 0);
    legend.innerHTML = keys.map((k, i) => `
      <div style="display:flex;align-items:center;gap:5px;font-size:.75rem">
        <span style="width:10px;height:10px;border-radius:3px;background:${colors[i]};flex-shrink:0;display:inline-block"></span>
        <span style="color:var(--text-muted)">${labels[i]}</span>
        <span style="font-weight:600">${total > 0 ? ((values[i]/total)*100).toFixed(1) : 0}%</span>
      </div>
    `).join('');
  }
}

function _invSearch(term) {
  _renderInvestmentsHtml(term);
}

async function openInvestmentModal(id = null) {
  let data = null;
  if (id) {
    data = _invPageCache.investments.find(i => i.id === id) || await db.investments.get(id);
  }
  const isEdit = !!data;
  const clsOptions = Object.entries(ASSET_CLASS_LABELS)
    .map(([v, l]) => `<option value="${v}" ${data?.asset_class === v ? 'selected' : ''}>${l}</option>`)
    .join('');

  showModal(`
    <div class="modal-backdrop">
      <div class="modal">
        <div class="modal-header">
          <div class="modal-title">${isEdit ? 'Editar Ativo' : 'Novo Ativo'}</div>
          <button class="btn btn-icon btn-ghost" onclick="closeModal()">${icon('x', 16)}</button>
        </div>
        <div class="modal-body">
          <div class="form-row">
            <div class="form-group" style="max-width:90px">
              <label class="form-label">Ícone</label>
              <input id="inv-icon" class="form-control" placeholder="📈" maxlength="4" value="${_escHtml(data?.icon || '')}">
            </div>
            <div class="form-group" style="flex:1">
              <label class="form-label">Ticker *</label>
              <input id="inv-ticker" class="form-control" placeholder="Ex: PETR4, BTC" value="${_escHtml(data?.ticker || '')}">
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Nome *</label>
            <input id="inv-name" class="form-control" placeholder="Ex: Petrobras PN" value="${_escHtml(data?.name || '')}">
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Classe</label>
              <select id="inv-class" class="form-control">${clsOptions}</select>
            </div>
            <div class="form-group">
              <label class="form-label">Corretora</label>
              <input id="inv-broker" class="form-control" placeholder="Ex: XP, Rico" value="${_escHtml(data?.broker || '')}">
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Quantidade</label>
              <input id="inv-qty" class="form-control" type="text" inputmode="decimal" placeholder="0" value="${data?.quantity ?? ''}">
            </div>
            <div class="form-group">
              <label class="form-label">Preço Médio (R$)</label>
              <input id="inv-avgprice" class="form-control" type="text" inputmode="decimal" placeholder="0,00" value="${data?.avg_price ?? ''}">
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Cotação Atual (R$)</label>
              <input id="inv-curprice" class="form-control" type="text" inputmode="decimal" placeholder="0,00" value="${data?.current_price ?? ''}">
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Observações</label>
            <input id="inv-notes" class="form-control" placeholder="Opcional" value="${_escHtml(data?.notes || '')}">
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
          <button class="btn btn-primary" onclick="saveInvestment('${isEdit ? data.id : ''}')">
            ${isEdit ? 'Salvar' : 'Criar'}
          </button>
        </div>
      </div>
    </div>
  `);
}

async function saveInvestment(id) {
  const name   = document.getElementById('inv-name').value.trim();
  const ticker = document.getElementById('inv-ticker').value.trim();
  if (!name)   { toast('Nome obrigatório', 'error'); return; }
  if (!ticker) { toast('Ticker obrigatório', 'error'); return; }

  const record = {
    ticker,
    name,
    asset_class:   document.getElementById('inv-class').value,
    broker:        document.getElementById('inv-broker').value.trim(),
    quantity:      parseBRNumber(document.getElementById('inv-qty').value),
    avg_price:     parseBRNumber(document.getElementById('inv-avgprice').value),
    current_price: parseBRNumber(document.getElementById('inv-curprice').value),
    icon:          document.getElementById('inv-icon').value.trim(),
    notes:         document.getElementById('inv-notes').value.trim(),
  };

  try {
    if (id) {
      await db.investments.update(id, record);
      toast('Ativo atualizado!', 'success');
    } else {
      await db.investments.add(record);
      toast('Ativo criado!', 'success');
    }
    closeModal();
    await renderInvestments();
  } catch (e) {
    toast(e.response?.message || 'Erro ao salvar', 'error');
  }
}

function openUpdatePriceModal(id) {
  const inv = _invPageCache.investments.find(i => i.id === id);
  const lastUpdate = inv?.current_price_date ? `<div style="font-size:.78rem;color:var(--text-muted);margin-top:4px">Última atualização: ${fmtDate(inv.current_price_date)}</div>` : '';

  showModal(`
    <div class="modal-backdrop">
      <div class="modal" style="max-width:360px">
        <div class="modal-header">
          <div class="modal-title">Atualizar Cotação</div>
          <button class="btn btn-icon btn-ghost" onclick="closeModal()">${icon('x', 16)}</button>
        </div>
        <div class="modal-body">
          <div style="font-weight:600;margin-bottom:8px">${_escHtml(inv?.ticker || '')} — ${_escHtml(inv?.name || '')}</div>
          <div class="form-group">
            <label class="form-label">Nova Cotação (R$)</label>
            <input id="upd-price-val" class="form-control" type="text" inputmode="decimal" placeholder="0,00" value="${inv?.current_price ?? ''}">
          </div>
          ${lastUpdate}
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
          <button class="btn btn-primary" onclick="saveUpdatePrice('${id}')">Atualizar</button>
        </div>
      </div>
    </div>
  `);
}

async function saveUpdatePrice(id) {
  const price = parseBRNumber(document.getElementById('upd-price-val').value);
  try {
    await db.investments.update(id, { current_price: price, current_price_date: today() });
    const idx = _invPageCache.investments.findIndex(i => i.id === id);
    if (idx >= 0) {
      _invPageCache.investments[idx].current_price = price;
      _invPageCache.investments[idx].current_price_date = today();
    }
    toast('Cotação atualizada!', 'success');
    closeModal();
    _renderInvestmentsHtml('');
  } catch (e) {
    toast(e.response?.message || 'Erro ao atualizar', 'error');
  }
}

function openInvTxModal(investmentId, data = null) {
  const inv    = _invPageCache.investments.find(i => i.id === investmentId);
  const isEdit = !!data;
  const typeOpts = Object.entries(INV_TX_LABELS)
    .map(([v, l]) => `<option value="${v}" ${data?.tx_type === v ? 'selected' : ''}>${l}</option>`)
    .join('');

  const hideQtyPrice = data && ['dividend','interest','bonus'].includes(data.tx_type);

  showModal(`
    <div class="modal-backdrop">
      <div class="modal">
        <div class="modal-header">
          <div class="modal-title">${isEdit ? 'Editar Operação' : 'Registrar Operação'}</div>
          <button class="btn btn-icon btn-ghost" onclick="closeModal()">${icon('x', 16)}</button>
        </div>
        <div class="modal-body">
          <div style="margin-bottom:12px">
            <span class="badge" style="background:${ASSET_CLASS_COLORS[inv?.asset_class] || '#888'}22;color:${ASSET_CLASS_COLORS[inv?.asset_class] || '#888'}">
              ${_escHtml(inv?.ticker || '')} — ${_escHtml(inv?.name || '')}
            </span>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Tipo *</label>
              <select id="invtx-type" class="form-control" onchange="_invTxTypeChange(this.value)">${typeOpts}</select>
            </div>
            <div class="form-group">
              <label class="form-label">Data *</label>
              <input id="invtx-date" class="form-control" type="date" value="${data?.date || today()}">
            </div>
          </div>
          <div id="invtx-qty-row" class="form-row" style="${hideQtyPrice ? 'display:none' : ''}">
            <div class="form-group">
              <label class="form-label">Quantidade</label>
              <input id="invtx-qty" class="form-control" type="text" inputmode="decimal" placeholder="0" value="${data?.quantity ?? ''}">
            </div>
            <div class="form-group">
              <label class="form-label">Preço Unitário (R$)</label>
              <input id="invtx-unit" class="form-control" type="text" inputmode="decimal" placeholder="0,00" value="${data?.unit_price ?? ''}">
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Valor Total (R$) *</label>
            <input id="invtx-amount" class="form-control" type="text" inputmode="decimal" placeholder="0,00" value="${data?.amount ?? ''}">
          </div>
          <div class="form-group">
            <label class="form-label">Observações</label>
            <input id="invtx-notes" class="form-control" placeholder="Opcional" value="${_escHtml(data?.notes || '')}">
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
          <button class="btn btn-primary" onclick="saveInvTx('${isEdit ? data.id : ''}', '${investmentId}')">
            ${isEdit ? 'Salvar' : 'Registrar'}
          </button>
        </div>
      </div>
    </div>
  `);
}

function _invTxTypeChange(type) {
  const hide = ['dividend', 'interest', 'bonus'].includes(type);
  const row  = document.getElementById('invtx-qty-row');
  if (row) row.style.display = hide ? 'none' : '';
}

async function saveInvTx(txId, investmentId) {
  const date   = document.getElementById('invtx-date').value;
  const amount = parseBRNumber(document.getElementById('invtx-amount').value);
  const type   = document.getElementById('invtx-type').value;
  if (!date)   { toast('Data obrigatória', 'error'); return; }
  if (!amount) { toast('Valor total obrigatório', 'error'); return; }

  const qty       = parseBRNumber(document.getElementById('invtx-qty').value);
  const unitPrice = parseBRNumber(document.getElementById('invtx-unit').value);
  const notes     = document.getElementById('invtx-notes').value.trim();

  const txRecord = {
    investment_id: investmentId,
    tx_type: type,
    date,
    quantity: qty,
    unit_price: unitPrice,
    amount,
    notes,
  };

  try {
    if (txId) {
      await db.investmentTransactions.update(txId, txRecord);
    } else {
      await db.investmentTransactions.add(txRecord);
    }

    const inv = _invPageCache.investments.find(i => i.id === investmentId);
    if (inv) {
      if (type === 'buy' && qty > 0) {
        const oldQty = inv.quantity || 0;
        const oldAvg = inv.avg_price || 0;
        const newAvg = (oldQty * oldAvg + qty * unitPrice) / (oldQty + qty);
        await db.investments.update(investmentId, {
          quantity:  oldQty + qty,
          avg_price: newAvg,
        });
      } else if (type === 'sell' && qty > 0) {
        const newQty = Math.max(0, (inv.quantity || 0) - qty);
        await db.investments.update(investmentId, { quantity: newQty });
      }
    }

    toast('Operação registrada!', 'success');
    closeModal();
    await renderInvestments();
  } catch (e) {
    toast(e.response?.message || 'Erro ao registrar', 'error');
  }
}

async function deleteInvestment(id) {
  const inv = _invPageCache.investments.find(i => i.id === id);
  if (!confirm(`Excluir o ativo "${inv?.ticker || inv?.name}"? Esta ação não pode ser desfeita.`)) return;
  try {
    await db.investments.delete(id);
    toast('Ativo excluído', 'success');
    await renderInvestments();
  } catch (e) {
    toast(e.response?.message || 'Erro ao excluir', 'error');
  }
}
