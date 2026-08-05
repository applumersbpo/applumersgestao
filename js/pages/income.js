let _incCache = { txs: [], catsMap: {}, month: null, year: null };

async function renderIncome(month, year) {
  const content = document.getElementById('content');
  const [transactions, catsMap] = await Promise.all([
    db.transactions.filter(`month = ${month} && year = ${year} && transaction_type = 'income'`).toArray(),
    getCategoriesMap()
  ]);

  transactions.sort((a, b) => a.due_date > b.due_date ? 1 : -1);
  _incCache = { txs: transactions, catsMap, month, year };

  const total    = transactions.reduce((s, t) => s + (t.amount || 0), 0);
  const received = transactions.filter(t => t.status === 'paid').reduce((s, t) => s + (t.amount || 0), 0);
  const pending  = total - received;
  const incCats  = Object.values(catsMap).filter(c => c.type === 'income');

  content.innerHTML = `
    <div class="summary-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:20px">
      <div class="summary-card">
        <div class="label">Receita Total</div>
        <div class="value">${fmt(total)}</div>
      </div>
      <div class="summary-card income-card">
        <div class="label">Recebido</div>
        <div class="value">${fmt(received)}</div>
      </div>
      <div class="summary-card">
        <div class="label" style="color:var(--warning)">A Receber</div>
        <div class="value" style="color:var(--warning)">${fmt(pending)}</div>
      </div>
    </div>

    <div class="section-header">
      <div class="section-title">Receitas (${transactions.length})</div>
      <div style="display:flex;gap:8px">
        ${transactions.length > 10 ? `<button class="btn btn-sm btn-outline" onclick="toggleIncomeBulk(${month},${year})" id="income-bulk-btn">${icon('check-square',14)} Selecionar</button>` : ''}
        <button class="btn btn-primary btn-sm" style="background:var(--income)" onclick="openIncomeModal(${month}, ${year})">
          ${icon('plus', 15)} Nova Receita
        </button>
      </div>
    </div>

    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:12px 0">
      <input id="inc-search" class="form-control" type="search" placeholder="Buscar descrição..."
        oninput="_incFilterRender()"
        style="flex:1;min-width:140px;max-width:220px">
      <select id="inc-filter-cat" class="form-control" onchange="_incFilterRender()"
        style="flex:1;min-width:130px;max-width:200px">
        <option value="">Todas as categorias</option>
        ${incCats.map(c => `<option value="${c.id}">${c.icon || ''} ${c.name}</option>`).join('')}
      </select>
      <select id="inc-filter-status" class="form-control" onchange="_incFilterRender()"
        style="flex:1;min-width:110px;max-width:160px">
        <option value="">Todos os status</option>
        <option value="paid">Recebido</option>
        <option value="pending">A Receber</option>
      </select>
    </div>

    ${transactions.length === 0 ? `
      <div class="empty-state">
        <i data-lucide="trending-up" style="width:48px;height:48px;opacity:.25"></i>
        <p>Nenhuma receita para este mês</p>
      </div>` : `
      <div class="transaction-list" id="income-list">
        ${transactions.map(t => incomeRow(t, catsMap)).join('')}
      </div>`
    }
  `;

  bindIncomeActions();
}

function _incFilterRender() {
  const text   = (document.getElementById('inc-search')?.value || '').toLowerCase();
  const catId  = document.getElementById('inc-filter-cat')?.value  || '';
  const status = document.getElementById('inc-filter-status')?.value || '';
  const { txs, catsMap } = _incCache;

  const filtered = txs.filter(t => {
    if (text && !t.name.toLowerCase().includes(text)) return false;
    if (catId && t.category_id !== catId) return false;
    if (status === 'paid' && t.status !== 'paid') return false;
    if (status === 'pending' && t.status === 'paid') return false;
    return true;
  });

  const list = document.getElementById('income-list');
  if (!list) return;
  list.innerHTML = filtered.length
    ? filtered.map(t => incomeRow(t, catsMap)).join('')
    : `<div class="empty-state" style="padding:24px"><i data-lucide="search-x" style="width:36px;height:36px;opacity:.3"></i><p>Nenhum resultado</p></div>`;
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function incomeRow(t, catsMap) {
  const cat = catsMap[t.category_id];
  return `
    <div class="transaction-item" data-id="${t.id}">
      <div class="t-icon" style="background:${cat ? cat.color + '22' : '#d1fae5'};color:${cat ? cat.color : 'var(--income)'}">
        ${cat ? (cat.icon || cat.name[0]) : '💰'}
      </div>
      <div class="t-info">
        <div class="t-name">${t.name}</div>
        <div class="t-meta">
          ${cat ? catTag(cat) : ''}
          ${kindBadge(t.kind)}
          <span>${fmtDate(t.due_date)}</span>
          ${statusBadge(t.status, t.due_date)}
        </div>
      </div>
      <div class="t-amount income">+${fmt(t.amount)}</div>
      <div class="t-actions">
        ${t.status !== 'paid'
          ? `<button class="btn btn-sm btn-icon" style="background:var(--income-light);color:var(--income)" data-action="receive" data-id="${t.id}" title="Marcar como recebido">${icon('check', 14)}</button>`
          : `<button class="btn btn-sm btn-icon btn-ghost" data-action="unreceive" data-id="${t.id}" title="Desfazer">${icon('undo-2', 14)}</button>`}
        <button class="btn btn-sm btn-icon btn-ghost" data-action="edit" data-id="${t.id}" title="Editar">${icon('pencil', 14)}</button>
        <button class="btn btn-sm btn-icon btn-danger" data-action="delete" data-id="${t.id}" title="Excluir">${icon('trash-2', 14)}</button>
      </div>
    </div>
  `;
}

function bindIncomeActions() {
  document.getElementById('income-list')?.addEventListener('click', async e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    const action = btn.dataset.action;

    if (action === 'receive') {
      const tx = _incCache.txs.find(t => t.id === id) || await db.transactions.get(id);
      openPayDateModal(tx, 'income', upd => {
        toast('Receita marcada como recebida!', 'success');
        renderIncome(_incCache.month, _incCache.year);
      });
    }
    if (action === 'unreceive') {
      await db.transactions.update(id, { status: 'pending', paid_date: null, cash_date: null, paid_amount: null });
      clearUpcomingCache();
      toast('Alteração desfeita');
      renderIncome(_incCache.month, _incCache.year);
    }
    if (action === 'edit') {
      const t = await db.transactions.get(id);
      openIncomeModal(t.month, t.year, t);
    }
    if (action === 'delete') {
      const t = _incCache.txs.find(x => x.id === id) || await db.transactions.get(id);
      confirmDeleteTx(t, () => {
        _incCache.txs = _incCache.txs.filter(x => x.id !== id);
        _incFilterRender();
      });
    }
  });

  document.getElementById('income-list')?.addEventListener('click', async e => {
    const item = e.target.closest('.transaction-item');
    if (!item || e.target.closest('[data-action]')) return;
    const id = item.dataset.id;
    const t = await db.transactions.get(id);
    if (t) openIncomeModal(t.month, t.year, t);
  });
}

function _incTogglePaid() {
  const cb = document.getElementById('inc-paid-cb');
  const block = document.getElementById('inc-paid-block');
  if (!cb || !block) return;
  block.style.display = cb.checked ? 'block' : 'none';
  if (cb.checked) {
    const amtField = document.getElementById('inc-paid-amount');
    if (amtField && !amtField.value) amtField.value = document.getElementById('inc-amount')?.value || '';
    const dateField = document.getElementById('inc-paid-date');
    if (dateField && !dateField.value) dateField.value = today();
  }
}

async function openIncomeModal(month, year, data = null) {
  const catsMap = await getCategoriesMap();
  const cats = Object.values(catsMap).filter(c => c.type === 'income')
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }));
  const accounts = await db.accounts.toArray();
  const isEdit = !!data;

  showModal(`
    <div class="modal-backdrop">
      <div class="modal">
        <div class="modal-header">
          <div class="modal-title">${isEdit ? 'Editar Receita' : 'Nova Receita'}</div>
          <button class="btn btn-icon btn-ghost" onclick="closeModal()">${icon('x', 16)}</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label">Descrição</label>
            <input id="inc-name" class="form-control" placeholder="Ex: Projeto cliente X" value="${data?.name || ''}">
          </div>
          <div class="form-group">
            <label class="form-label">Valor (R$)</label>
            <input id="inc-amount" class="form-control" type="text" inputmode="decimal" placeholder="0,00" value="${data?.amount || ''}">
          </div>
          <input type="hidden" id="inc-date" value="${data?.due_date || today()}">

          <div class="form-group">
            <label class="form-label">Conta</label>
            <select id="inc-account" class="form-control">
              <option value="">— Selecionar conta —</option>
              ${accounts.map(a => `<option value="${a.id}" ${data?.account_id === a.id ? 'selected' : ''}>${a.name} ${a.bank_name ? '- ' + a.bank_name : ''}</option>`).join('')}
            </select>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Categoria</label>
              <select id="inc-cat" class="form-control">
                <option value="">Sem categoria</option>
                ${cats.map(c => `<option value="${c.id}" ${data?.category_id === c.id ? 'selected' : ''}>${c.icon} ${c.name}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Tipo</label>
              <select id="inc-kind" class="form-control">
                <option value="variable" ${data?.kind === 'variable' ? 'selected' : ''}>Variável</option>
                <option value="fixed" ${data?.kind === 'fixed' ? 'selected' : ''}>Fixo</option>
              </select>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group" style="flex:1">
              <label class="form-label">Data de competência <span class="field-info" title="Data de competência: referência contábil para relatórios; não influencia o caixa">ℹ️</span></label>
              <input id="inc-competence" type="date" class="form-control" value="${data?.competence_date || data?.due_date || today()}">
            </div>
            <div class="form-group" style="flex:1">
              <label class="form-label">Data de vencimento <span class="field-info" title="Data de vencimento: data prevista para o recebimento">ℹ️</span></label>
              <input id="inc-cash" type="date" class="form-control" value="${data?.cash_date || data?.paid_date || today()}">
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">Observações</label>
            <textarea id="inc-notes" class="form-control" rows="2" placeholder="Opcional">${data?.notes || ''}</textarea>
          </div>

          <div class="form-group">
            <label class="form-label" style="display:flex;align-items:center;gap:8px;cursor:pointer">
              <input type="checkbox" id="inc-paid-cb" onchange="_incTogglePaid()" ${data?.status === 'paid' ? 'checked' : ''}>
              Recebido
            </label>
          </div>
          <div id="inc-paid-block" style="display:${data?.status === 'paid' ? 'block' : 'none'}">
            <div class="form-row">
              <div class="form-group" style="flex:1">
                <label class="form-label">Data do recebimento</label>
                <input id="inc-paid-date" type="date" class="form-control" max="${today()}" value="${data?.status === 'paid' ? (data?.cash_date || data?.paid_date || today()) : today()}">
              </div>
              <div class="form-group" style="flex:1">
                <label class="form-label">Valor recebido (R$)</label>
                <input id="inc-paid-amount" class="form-control" type="text" inputmode="decimal" placeholder="0,00" value="${data?.paid_amount != null ? data.paid_amount : ''}">
              </div>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
          <button class="btn btn-primary" style="background:var(--income)" onclick="saveIncome('${isEdit ? data.id : ''}', ${month}, ${year})">
            ${isEdit ? 'Salvar' : 'Adicionar'}
          </button>
        </div>
      </div>
    </div>
  `);
}

function toggleIncomeBulk(month, year) {
  if (_Bulk.active) { destroyBulkMode(); return; }
  initBulkMode('income-list', `
    <button class="btn btn-sm" style="background:var(--income-light);color:var(--income)" onclick="bulkIncomeReceive()">
      ${icon('check',13)} Receber
    </button>
    <button class="btn btn-sm btn-danger-outline" onclick="bulkIncomeDelete(${month},${year})">
      ${icon('trash-2',13)} Excluir
    </button>
  `);
}
async function bulkIncomeReceive() {
  const ids = [..._Bulk.ids];
  if (!ids.length) { toast('Nenhum item selecionado','error'); return; }
  for (const id of ids) {
    const t = _incCache.txs.find(x => x.id === id);
    await db.transactions.update(id, { status:'paid', paid_date: today(), cash_date: today(), paid_amount: t?.amount || 0 });
  }
  clearUpcomingCache();
  destroyBulkMode();
  toast(`${ids.length} receita(s) marcada(s) como recebida(s)`,'success');
  app.render();
}
async function bulkIncomeDelete(month, year) {
  const ids = [..._Bulk.ids];
  if (!ids.length) { toast('Nenhum item selecionado','error'); return; }
  if (!confirm(`Excluir ${ids.length} receita(s)?`)) return;
  for (const id of ids) await db.transactions.delete(id);
  destroyBulkMode();
  toast(`${ids.length} receita(s) excluída(s)`,'success');
  app.render();
}

async function saveIncome(id, month, year) {
  const name   = document.getElementById('inc-name').value.trim();
  const amount = parseBRNumber(document.getElementById('inc-amount').value);
  const date   = document.getElementById('inc-date').value;
  const account_id = document.getElementById('inc-account') ? document.getElementById('inc-account').value : '';
  const cat    = document.getElementById('inc-cat').value || null;
  const kind   = document.getElementById('inc-kind').value;
  const competence_date = document.getElementById('inc-competence') ? document.getElementById('inc-competence').value : '';
  const cash_date = document.getElementById('inc-cash') ? document.getElementById('inc-cash').value : '';
  const notes  = document.getElementById('inc-notes').value.trim();
  const isReceived = document.getElementById('inc-paid-cb') ? document.getElementById('inc-paid-cb').checked : false;
  const paidDateVal = document.getElementById('inc-paid-date') ? document.getElementById('inc-paid-date').value : '';
  // F-210: lê o input CRU para distinguir não-informado (vazio → null, relatório usa
  // amount) de R$0 real digitado explicitamente ("0"/"0,00" → 0). parseBRNumber('')
  // e parseBRNumber('0') retornam ambos 0, por isso checamos a string crua.
  const paidAmountRaw = document.getElementById('inc-paid-amount') ? document.getElementById('inc-paid-amount').value.trim() : '';
  const paidAmountVal = paidAmountRaw === '' ? null : parseBRNumber(paidAmountRaw);

  if (!name) { toast('Informe a descrição', 'error'); return; }
  // amount and category are mandatory
  if (!amount || amount <= 0) { toast('Informe um valor válido', 'error'); return; }
  if (!cat) { toast('Informe a categoria', 'error'); return; }
  // if date not provided, use today (registration date)
  const regDate = date || today();

  // "Data de vencimento" (inc-cash) alimenta due_date, espelhando despesa.
  const due = cash_date || regDate;
  const [yearParsed, monthParsed] = (competence_date || due).split('-').map(Number);
  const record = {
    name, amount,
    due_date: due,
    category_id: cat, kind, notes,
    transaction_type: 'income',
    account_id: account_id || '',
    competence_date: competence_date || due,
    month: monthParsed || month,
    year: yearParsed || year
  };

  // Regime de caixa: checkbox "Recebido" define status e movimento de caixa.
  if (isReceived) {
    if (paidDateVal && paidDateVal > today()) {
      toast('Não é possível registrar um pagamento/recebimento com data superior à data de hoje.', 'error');
      return;
    }
    const pd = paidDateVal || today();
    record.status = 'paid';
    record.cash_date = pd;
    record.paid_date = pd;
    record.paid_amount = paidAmountVal != null ? paidAmountVal : amount;
  } else {
    record.status = 'pending';
    record.cash_date = null;
    record.paid_date = null;
    record.paid_amount = null;
  }

  if (id && id !== '') {
    await db.transactions.update(id, record);
    toast('Receita atualizada!', 'success');
  } else {
    record.template_id = null;
    await db.transactions.add(record);
    toast('Receita adicionada!', 'success');
  }

  closeModal();
  app.render();
}
