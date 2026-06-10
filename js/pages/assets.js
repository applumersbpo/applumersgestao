const ASSET_TYPE_LABELS = { real_estate:'Imóvel', vehicle:'Veículo', durable_good:'Bem Durável', other:'Outro' };
const ASSET_TYPE_ICONS  = { real_estate:'🏠', vehicle:'🚗', durable_good:'📦', other:'💎' };
const ASSET_TYPE_COLORS = { real_estate:'#3A5A40', vehicle:'#2A7C82', durable_good:'#D4A24C', other:'#8A6418' };

let _assetsCache = [];

async function renderAssets() {
  const content = document.getElementById('content');
  content.innerHTML = `<div class="loading-screen"><div class="spinner"></div></div>`;
  try {
    _assetsCache = await db.assets.toArray();
    _renderAssetsHtml();
  } catch (e) {
    content.innerHTML = `<div class="empty-state"><p>Erro ao carregar bens.</p></div>`;
  }
}

function _renderAssetsHtml() {
  const content = document.getElementById('content');
  const assets  = _assetsCache;

  const netValue      = assets.reduce((s, a) => s + ((a.current_value || 0) - (a.debt_amount || 0)), 0);
  const acqValue      = assets.reduce((s, a) => s + (a.acquisition_value || 0), 0);
  const curValue      = assets.reduce((s, a) => s + (a.current_value || 0), 0);
  const varPct        = acqValue > 0 ? ((curValue - acqValue) / acqValue) * 100 : 0;
  const varColor      = varPct >= 0 ? 'var(--income-text)' : 'var(--expense)';

  content.innerHTML = `
    <div class="summary-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:20px">
      <div class="summary-card income-card">
        <div class="label">Valor Líquido</div>
        <div class="value">${fmt(netValue)}</div>
        <div class="sub">Bens - Dívidas</div>
      </div>
      <div class="summary-card">
        <div class="label">Nº de Bens</div>
        <div class="value">${assets.length}</div>
        <div class="sub">cadastrado${assets.length !== 1 ? 's' : ''}</div>
      </div>
      <div class="summary-card">
        <div class="label" style="color:${varColor}">Variação Total</div>
        <div class="value" style="color:${varColor}">${varPct >= 0 ? '+' : ''}${varPct.toFixed(2)}%</div>
        <div class="sub">${varPct >= 0 ? '+' : ''}${fmt(curValue - acqValue)}</div>
      </div>
    </div>

    <div class="section-header" style="margin-bottom:16px">
      <div class="section-title">Patrimônio Físico (${assets.length})</div>
      <button class="btn btn-primary btn-sm" onclick="openAssetModal()">
        ${icon('plus', 15)} Novo Bem
      </button>
    </div>

    ${assets.length === 0 ? `
      <div class="empty-state">
        ${icon('home', 48)}
        <p>Nenhum bem cadastrado</p>
        <button class="btn btn-primary btn-sm" onclick="openAssetModal()">${icon('plus',14)} Novo Bem</button>
      </div>` : `
      <div class="asset-card-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px">
        ${assets.map(assetCard).join('')}
      </div>`}
  `;

  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function assetCard(a) {
  const typeColor  = ASSET_TYPE_COLORS[a.asset_type] || ASSET_TYPE_COLORS.other;
  const typeLabel  = ASSET_TYPE_LABELS[a.asset_type] || 'Outro';
  const typeIcon   = a.icon || ASSET_TYPE_ICONS[a.asset_type] || ASSET_TYPE_ICONS.other;
  const curVal     = a.current_value || 0;
  const acqVal     = a.acquisition_value || 0;
  const debt       = a.debt_amount || 0;
  const varPct     = acqVal > 0 ? ((curVal - acqVal) / acqVal) * 100 : 0;
  const varColor   = varPct >= 0 ? 'var(--income-text)' : 'var(--expense)';

  return `
    <div class="asset-card card" data-id="${a.id}" style="padding:16px">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:12px">
        <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0">
          <div style="width:44px;height:44px;border-radius:12px;background:${typeColor}22;color:${typeColor};display:flex;align-items:center;justify-content:center;font-size:1.3rem;flex-shrink:0">
            ${typeIcon}
          </div>
          <div style="flex:1;min-width:0">
            <div style="font-weight:700;font-size:.92rem;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_escHtml(a.name || '')}</div>
            <span class="badge" style="background:${typeColor}22;color:${typeColor};font-size:.7rem">${typeLabel}</span>
          </div>
        </div>
        <div style="display:flex;gap:4px;flex-shrink:0">
          <button class="btn btn-sm btn-icon btn-ghost" onclick="openValuationsModal('${a.id}')" title="Histórico">${icon('bar-chart-2', 14)}</button>
          <button class="btn btn-sm btn-icon btn-ghost" onclick="openAssetModal('${a.id}')" title="Editar">${icon('pencil', 14)}</button>
          <button class="btn btn-sm btn-icon btn-danger" onclick="deleteAsset('${a.id}')" title="Excluir">${icon('trash-2', 14)}</button>
        </div>
      </div>

      <div style="display:flex;flex-wrap:wrap;gap:6px 16px">
        <div>
          <div style="font-size:.7rem;color:var(--text-muted)">Aquisição</div>
          <div style="font-size:.85rem;font-weight:600">${fmt(acqVal)}</div>
          ${a.acquisition_date ? `<div style="font-size:.72rem;color:var(--text-muted)">${fmtDate(a.acquisition_date)}</div>` : ''}
        </div>
        <div>
          <div style="font-size:.7rem;color:var(--text-muted)">Valor Atual</div>
          <div style="font-size:.85rem;font-weight:700">${fmt(curVal)}</div>
          ${a.current_value_date ? `<div style="font-size:.72rem;color:var(--text-muted)">${fmtDate(a.current_value_date)}</div>` : ''}
        </div>
        <div>
          <div style="font-size:.7rem;color:var(--text-muted)">Variação</div>
          <div style="font-size:.85rem;font-weight:700;color:${varColor}">${varPct >= 0 ? '+' : ''}${varPct.toFixed(2)}%</div>
        </div>
        ${debt > 0 ? `
        <div>
          <div style="font-size:.7rem;color:var(--expense)">Dívida</div>
          <div style="font-size:.85rem;font-weight:600;color:var(--expense)">${fmt(debt)}</div>
        </div>` : ''}
      </div>
    </div>
  `;
}

async function openAssetModal(id = null) {
  let data = null;
  if (id) {
    data = _assetsCache.find(a => a.id === id) || await db.assets.get(id);
  }
  const isEdit = !!data;
  const typeOpts = Object.entries(ASSET_TYPE_LABELS)
    .map(([v, l]) => `<option value="${v}" ${data?.asset_type === v ? 'selected' : ''}>${l}</option>`)
    .join('');

  showModal(`
    <div class="modal-backdrop">
      <div class="modal">
        <div class="modal-header">
          <div class="modal-title">${isEdit ? 'Editar Bem' : 'Novo Bem'}</div>
          <button class="btn btn-icon btn-ghost" onclick="closeModal()">${icon('x', 16)}</button>
        </div>
        <div class="modal-body">
          <div class="form-row">
            <div class="form-group" style="max-width:80px">
              <label class="form-label">Ícone</label>
              <input type="hidden" id="ast-icon" value="${_escHtml(data?.icon || ASSET_TYPE_ICONS[data?.asset_type || 'other'] || '🏠')}">
              <button type="button" id="ast-icon-btn" onclick="showIconPicker(document.getElementById('ast-icon').value, v => { document.getElementById('ast-icon').value = v; document.getElementById('ast-icon-btn').textContent = v; })"
                style="width:100%;height:40px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface);font-size:1.4rem;cursor:pointer;display:flex;align-items:center;justify-content:center">
                ${data?.icon || ASSET_TYPE_ICONS[data?.asset_type || 'other'] || '🏠'}
              </button>
            </div>
            <div class="form-group" style="flex:1">
              <label class="form-label">Nome *</label>
              <input id="ast-name" class="form-control" placeholder="Ex: Apartamento Centro" value="${_escHtml(data?.name || '')}">
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Tipo</label>
              <select id="ast-type" class="form-control">${typeOpts}</select>
            </div>
            <div class="form-group">
              <label class="form-label">Data de Aquisição</label>
              <input id="ast-acqdate" class="form-control" type="date" value="${data?.acquisition_date ? data.acquisition_date.split('T')[0] : ''}">
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Valor de Aquisição (R$) *</label>
              <input id="ast-acqval" class="form-control" type="text" inputmode="decimal" placeholder="0,00" value="${data?.acquisition_value ?? ''}">
            </div>
            <div class="form-group">
              <label class="form-label">Valor Atual (R$)</label>
              <input id="ast-curval" class="form-control" type="text" inputmode="decimal" placeholder="0,00" value="${data?.current_value ?? ''}">
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Data Avaliação</label>
              <input id="ast-curdate" class="form-control" type="date" value="${data?.current_value_date ? data.current_value_date.split('T')[0] : ''}">
            </div>
            <div class="form-group">
              <label class="form-label">Dívida Vinculada (R$)</label>
              <input id="ast-debt" class="form-control" type="text" inputmode="decimal" placeholder="financiamento, etc." value="${data?.debt_amount ?? ''}">
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Descrição</label>
            <input id="ast-desc" class="form-control" placeholder="Opcional" value="${_escHtml(data?.description || '')}">
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
          <button class="btn btn-primary" onclick="saveAsset('${isEdit ? data.id : ''}')">
            ${isEdit ? 'Salvar' : 'Criar'}
          </button>
        </div>
      </div>
    </div>
  `);
}

async function saveAsset(id) {
  const name  = document.getElementById('ast-name').value.trim();
  const acqVal = parseBRNumber(document.getElementById('ast-acqval').value);
  if (!name)   { toast('Nome obrigatório', 'error'); return; }
  if (!acqVal) { toast('Valor de aquisição obrigatório', 'error'); return; }

  const record = {
    name,
    asset_type:        document.getElementById('ast-type').value,
    icon:              document.getElementById('ast-icon').value.trim(),
    acquisition_value: acqVal,
    acquisition_date:  document.getElementById('ast-acqdate').value || null,
    current_value:     parseBRNumber(document.getElementById('ast-curval').value),
    current_value_date: document.getElementById('ast-curdate').value || null,
    debt_amount:       parseBRNumber(document.getElementById('ast-debt').value),
    description:       document.getElementById('ast-desc').value.trim(),
  };

  try {
    if (id) {
      await db.assets.update(id, record);
      toast('Bem atualizado!', 'success');
    } else {
      await db.assets.add(record);
      toast('Bem cadastrado!', 'success');
    }
    closeModal();
    await renderAssets();
  } catch (e) {
    toast(e.response?.message || 'Erro ao salvar', 'error');
  }
}

async function openValuationsModal(assetId) {
  const asset = _assetsCache.find(a => a.id === assetId);
  let valuations = [];
  try {
    const res = await _api('GET', `/data/asset_valuations?asset_id=${assetId}`);
    valuations = Array.isArray(res) ? res : (res.items || []);
  } catch (e) { valuations = []; }

  valuations.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  const histHtml = valuations.length === 0
    ? `<div style="color:var(--text-muted);font-size:.85rem;text-align:center;padding:12px 0">Nenhuma avaliação registrada</div>`
    : valuations.map(v => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">
          <div>
            <div style="font-weight:600;font-size:.88rem">${fmt(v.value || 0)}</div>
            ${v.notes ? `<div style="font-size:.75rem;color:var(--text-muted)">${_escHtml(v.notes)}</div>` : ''}
          </div>
          <div style="font-size:.78rem;color:var(--text-muted)">${fmtDate(v.date)}</div>
        </div>
      `).join('');

  showModal(`
    <div class="modal-backdrop">
      <div class="modal">
        <div class="modal-header">
          <div class="modal-title">Avaliações — ${_escHtml(asset?.name || '')}</div>
          <button class="btn btn-icon btn-ghost" onclick="closeModal()">${icon('x', 16)}</button>
        </div>
        <div class="modal-body">
          <div style="max-height:200px;overflow-y:auto;margin-bottom:16px">
            ${histHtml}
          </div>
          <div style="border-top:1px solid var(--border);padding-top:16px">
            <div style="font-weight:600;font-size:.88rem;margin-bottom:10px">Registrar Nova Avaliação</div>
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Valor (R$) *</label>
                <input id="val-value" class="form-control" type="text" inputmode="decimal" placeholder="0,00">
              </div>
              <div class="form-group">
                <label class="form-label">Data *</label>
                <input id="val-date" class="form-control" type="date" value="${today()}">
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">Observações</label>
              <input id="val-notes" class="form-control" placeholder="Opcional">
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="closeModal()">Fechar</button>
          <button class="btn btn-primary" onclick="saveValuation('${assetId}')">
            ${icon('check', 14)} Registrar
          </button>
        </div>
      </div>
    </div>
  `);
}

async function saveValuation(assetId) {
  const value = parseBRNumber(document.getElementById('val-value').value);
  const date  = document.getElementById('val-date').value;
  const notes = document.getElementById('val-notes').value.trim();
  if (!value) { toast('Valor obrigatório', 'error'); return; }
  if (!date)  { toast('Data obrigatória', 'error'); return; }

  try {
    await db.assetValuations.add({ asset_id: assetId, value, date, notes });
    await db.assets.update(assetId, { current_value: value, current_value_date: date });

    const idx = _assetsCache.findIndex(a => a.id === assetId);
    if (idx >= 0) {
      _assetsCache[idx].current_value      = value;
      _assetsCache[idx].current_value_date = date;
    }

    toast('Avaliação registrada!', 'success');
    closeModal();
    await renderAssets();
  } catch (e) {
    toast(e.response?.message || 'Erro ao registrar', 'error');
  }
}

async function deleteAsset(id) {
  const a = _assetsCache.find(a => a.id === id);
  if (!confirm(`Excluir o bem "${a?.name}"? Esta ação não pode ser desfeita.`)) return;
  try {
    await db.assets.delete(id);
    toast('Bem excluído', 'success');
    await renderAssets();
  } catch (e) {
    toast(e.response?.message || 'Erro ao excluir', 'error');
  }
}
