let _expCache = { txs: [], catsMap: {}, accounts: [], month: null, year: null };

async function renderExpenses(month, year) {
  const content = document.getElementById('content');
  const [transactions, catsMap, accounts] = await Promise.all([
    db.transactions.filter(`month = ${month} && year = ${year} && (transaction_type = 'general' || transaction_type = 'daily' || transaction_type = 'expense' || transaction_type = 'installment')`).toArray(),
    getCategoriesMap(),
    db.accounts.toArray()
  ]);

  transactions.sort((a, b) => a.due_date > b.due_date ? -1 : 1);
  _expCache = { txs: transactions, catsMap, accounts, month, year };

  const total = transactions.reduce((s, t) => s + (t.amount || 0), 0);
  const paid  = transactions.filter(t => t.status === 'paid').reduce((s, t) => s + (t.amount || 0), 0);
  const expCats = Object.values(catsMap).filter(c => c.type === 'expense');

  content.innerHTML = `
    <div class="summary-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:20px">
      <div class="summary-card expense-card">
        <div class="label">Total Gasto</div>
        <div class="value">${fmt(total)}</div>
      </div>
      <div class="summary-card">
        <div class="label" style="color:var(--income-text)">Pago</div>
        <div class="value" style="color:var(--income-text)">${fmt(paid)}</div>
      </div>
      <div class="summary-card">
        <div class="label" style="color:var(--warning)">A Pagar</div>
        <div class="value" style="color:var(--warning)">${fmt(total - paid)}</div>
      </div>
    </div>

    <div class="section-header">
      <div class="section-title">Gastos (${transactions.length})</div>
      <div style="display:flex;gap:8px">
        ${transactions.length > 10 ? `<button class="btn btn-sm btn-outline" onclick="toggleExpenseBulk(${month},${year})" id="expense-bulk-btn">${icon('check-square',14)} Selecionar</button>` : ''}
        <button class="btn btn-primary btn-sm" style="background:var(--expense)" onclick="openExpenseModal(${month}, ${year})">
          ${icon('plus', 15)} Novo Gasto
        </button>
      </div>
    </div>

    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:12px 0">
      <input id="exp-search" class="form-control" type="search" placeholder="Buscar descrição..."
        oninput="_expFilterRender()"
        style="flex:1;min-width:140px;max-width:220px">
      <select id="exp-filter-cat" class="form-control" onchange="_expFilterRender()"
        style="flex:1;min-width:130px;max-width:200px">
        <option value="">Todas as categorias</option>
        ${expCats.map(c => `<option value="${c.id}">${c.icon || ''} ${c.name}</option>`).join('')}
      </select>
      <select id="exp-filter-status" class="form-control" onchange="_expFilterRender()"
        style="flex:1;min-width:110px;max-width:160px">
        <option value="">Todos os status</option>
        <option value="paid">Pago</option>
        <option value="pending">Pendente/Vencido</option>
      </select>
    </div>

    ${transactions.length === 0 ? `
      <div class="empty-state">
        <i data-lucide="trending-down" style="width:48px;height:48px;opacity:.25"></i>
        <p>Nenhum gasto registrado neste mês</p>
      </div>` : `
      <div class="transaction-list" id="expenses-list">
        ${transactions.map(t => expenseRow(t, catsMap, accounts)).join('')}
      </div>`
    }
  `;

  bindExpenseActions(month, year);
}

function _expFilterRender() {
  const text   = (document.getElementById('exp-search')?.value || '').toLowerCase();
  const catId  = document.getElementById('exp-filter-cat')?.value  || '';
  const status = document.getElementById('exp-filter-status')?.value || '';
  const { txs, catsMap, accounts } = _expCache;

  const filtered = txs.filter(t => {
    if (text && !t.name.toLowerCase().includes(text)) return false;
    if (catId && t.category_id !== catId) return false;
    if (status === 'paid' && t.status !== 'paid') return false;
    if (status === 'pending' && t.status === 'paid') return false;
    return true;
  });

  const list = document.getElementById('expenses-list');
  if (!list) return;
  list.innerHTML = filtered.length
    ? filtered.map(t => expenseRow(t, catsMap, accounts)).join('')
    : `<div class="empty-state" style="padding:24px"><i data-lucide="search-x" style="width:36px;height:36px;opacity:.3"></i><p>Nenhum resultado</p></div>`;
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function expenseRow(t, catsMap, accounts) {
  const cat = catsMap[t.category_id];
  const acc = accounts?.find(a => a.id === t.account_id) || null;
  return `
    <div class="transaction-item" data-id="${t.id}">
      <div class="t-icon" style="background:${cat ? cat.color + '22' : '#FAEDE7'};color:${cat ? cat.color : '#C95A47'}">
        ${cat ? (cat.icon || cat.name[0]) : '💸'}
      </div>
      <div class="t-info">
        <div class="t-name">${t.name}</div>
        <div class="t-meta">
          ${cat ? catTag(cat) : ''}
          ${acc ? `<span title="Conta">🏦 ${acc.name}</span>` : ''}
          <span>${fmtDate(t.due_date)}</span>
          ${statusBadge(t.status, t.due_date)}
          ${t.notes ? `<span title="${t.notes}">📝 ${t.notes.substring(0, 30)}${t.notes.length > 30 ? '…' : ''}</span>` : ''}
        </div>
      </div>
      <div class="t-amount expense">${fmt(t.amount)}</div>
      <div class="t-actions">
        ${t.status !== 'paid'
          ? `<button class="btn btn-sm btn-icon" style="background:var(--income-light);color:var(--income)" data-action="pay" data-id="${t.id}" title="Marcar como pago">${icon('check', 14)}</button>`
          : `<button class="btn btn-sm btn-icon btn-ghost" data-action="unpay" data-id="${t.id}" title="Desfazer">${icon('undo-2', 14)}</button>`}
        <button class="btn btn-sm btn-icon btn-ghost" data-action="edit" data-id="${t.id}" title="Editar">${icon('pencil', 14)}</button>
        <button class="btn btn-sm btn-icon btn-danger" data-action="delete" data-id="${t.id}" title="Excluir">${icon('trash-2', 14)}</button>
      </div>
    </div>
  `;
}

function bindExpenseActions(month, year) {
  document.getElementById('expenses-list')?.addEventListener('click', async e => {
    const btn  = e.target.closest('[data-action]');
    const item = e.target.closest('.transaction-item');
    if (!item) return;

    if (btn) {
      const id     = btn.dataset.id;
      const action = btn.dataset.action;
      if (action === 'pay') {
        const tx = _expCache.txs.find(t => t.id === id) || await db.transactions.get(id);
        openPayDateModal(tx, 'expense', upd => {
          _expCache.txs = _expCache.txs.map(t => t.id === id ? { ...t, ...upd } : t);
          toast('Marcado como pago!', 'success');
          _expFilterRender();
        });
      } else if (action === 'unpay') {
        await db.transactions.update(id, { status: 'pending', paid_date: null, cash_date: null, paid_amount: 0 });
        _expCache.txs = _expCache.txs.map(t => t.id === id ? { ...t, status: 'pending', paid_date: null, cash_date: null, paid_amount: 0 } : t);
        clearUpcomingCache();
        toast('Alteração desfeita');
        _expFilterRender();
      } else if (action === 'edit') {
        const t = await db.transactions.get(id);
        if (t) openExpenseModal(t.month, t.year, t);
      } else if (action === 'delete') {
        if (!confirm('Excluir este gasto?')) return;
        await db.transactions.delete(id);
        _expCache.txs = _expCache.txs.filter(t => t.id !== id);
        toast('Gasto excluído');
        _expFilterRender();
      }
    } else {
      const t = await db.transactions.get(item.dataset.id);
      if (t) openExpenseModal(t.month, t.year, t);
    }
  });
}

function toggleExpenseBulk(month, year) {
  if (_Bulk.active) { destroyBulkMode(); return; }
  initBulkMode('expenses-list', `
    <button class="btn btn-sm" style="background:var(--income-light);color:var(--income)" onclick="bulkExpensePay()">
      ${icon('check',13)} Pagar
    </button>
    <button class="btn btn-sm btn-danger-outline" onclick="bulkExpenseDelete(${month},${year})">
      ${icon('trash-2',13)} Excluir
    </button>
  `);
}
async function bulkExpensePay() {
  const ids = [..._Bulk.ids];
  if (!ids.length) { toast('Nenhum item selecionado','error'); return; }
  for (const id of ids) {
    const t = _expCache.txs.find(x => x.id === id);
    await db.transactions.update(id, { status:'paid', paid_date: today(), cash_date: today(), paid_amount: t?.amount || 0 });
  }
  _expCache.txs = _expCache.txs.map(t => ids.includes(t.id) ? { ...t, status: 'paid', paid_date: today(), cash_date: today(), paid_amount: t.amount || 0 } : t);
  clearUpcomingCache();
  destroyBulkMode();
  toast(`${ids.length} gasto(s) marcado(s) como pago(s)`,'success');
  app.render();
}
async function bulkExpenseDelete(month, year) {
  const ids = [..._Bulk.ids];
  if (!ids.length) { toast('Nenhum item selecionado','error'); return; }
  if (!confirm(`Excluir ${ids.length} gasto(s)?`)) return;
  for (const id of ids) await db.transactions.delete(id);
  destroyBulkMode();
  toast(`${ids.length} gasto(s) excluído(s)`,'success');
  app.render();
}

function _expTogglePaid() {
  const cb = document.getElementById('exp-paid-cb');
  const block = document.getElementById('exp-paid-block');
  if (!cb || !block) return;
  block.style.display = cb.checked ? 'block' : 'none';
  if (cb.checked) {
    const amtField = document.getElementById('exp-paid-amount');
    if (amtField && !amtField.value) amtField.value = document.getElementById('exp-amount')?.value || '';
    const dateField = document.getElementById('exp-paid-date');
    if (dateField && !dateField.value) dateField.value = today();
  }
}

// Modal compartilhado (despesa e receita) para confirmar data e valor ao marcar pago/recebido.
function openPayDateModal(tx, type, onDone) {
  const isExpense = type === 'expense';
  const t = today();
  showModal(`
    <div class="modal-backdrop">
      <div class="modal" style="max-width:380px">
        <div class="modal-header">
          <div class="modal-title">${isExpense ? 'Confirmar pagamento' : 'Confirmar recebimento'}</div>
          <button class="btn btn-icon btn-ghost" onclick="closeModal()">${icon('x', 16)}</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label">${isExpense ? 'Data do pagamento' : 'Data do recebimento'}</label>
            <input id="paydate-date" type="date" class="form-control" max="${t}" value="${t}">
          </div>
          <div class="form-group">
            <label class="form-label">${isExpense ? 'Valor pago' : 'Valor recebido'} (R$)</label>
            <input id="paydate-amount" class="form-control" type="text" inputmode="decimal" placeholder="0,00" value="${tx?.amount != null ? tx.amount : ''}">
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
          <button class="btn btn-primary" id="paydate-confirm">Confirmar</button>
        </div>
      </div>
    </div>
  `);
  document.getElementById('paydate-confirm').addEventListener('click', async () => {
    const dateVal = document.getElementById('paydate-date').value;
    const amountVal = parseBRNumber(document.getElementById('paydate-amount').value);
    if (!dateVal) { toast('Informe a data', 'error'); return; }
    if (dateVal > today()) { toast('Não é possível registrar um pagamento/recebimento com data superior à data de hoje.', 'error'); return; }
    const paid_amount = amountVal > 0 ? amountVal : (tx?.amount || 0);
    const upd = { status: 'paid', cash_date: dateVal, paid_date: dateVal, paid_amount };
    await db.transactions.update(tx.id, upd);
    clearUpcomingCache();
    closeModal();
    if (onDone) onDone(upd);
  });
}

async function openExpenseModal(month, year, data = null) {
  const catsMap = await getCategoriesMap();
  const cats    = Object.values(catsMap).filter(c => c.type === 'expense')
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }));
  const accounts = await db.accounts.toArray();
  const isEdit  = !!data;

  showModal(`
    <div class="modal-backdrop">
      <div class="modal">
        <div class="modal-header">
          <div class="modal-title">${isEdit ? 'Editar Gasto' : 'Novo Gasto Geral'}</div>
          <button class="btn btn-icon btn-ghost" onclick="closeModal()">${icon('x', 16)}</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label">Descrição</label>
            <input id="exp-name" class="form-control" placeholder="Ex: Pagamento funcionário, Material..." value="${data?.name || ''}">
          </div>
          <div class="form-group">
            <label class="form-label">Valor (R$)</label>
            <input id="exp-amount" class="form-control" type="text" inputmode="decimal" placeholder="0,00" value="${data?.amount || ''}">
          </div>
          <input type="hidden" id="exp-date" value="${data?.due_date || today()}">

          <div class="form-group">
            <label class="form-label">Conta</label>
            <select id="exp-account" class="form-control">
              <option value="">— Selecionar conta —</option>
              ${accounts.map(a => `<option value="${a.id}" ${data?.account_id === a.id ? 'selected' : ''}>${a.name} ${a.bank_name ? '- ' + a.bank_name : ''}</option>`).join('')}
            </select>
          </div>

          <div class="form-group">
            <label class="form-label">Categoria</label>
            <select id="exp-cat" class="form-control">
              <option value="">Sem categoria</option>
              ${cats.map(c => `<option value="${c.id}" ${data?.category_id === c.id ? 'selected' : ''}>${c.icon} ${c.name}</option>`).join('')}
            </select>
          </div>
          <div class="form-row">
            <div class="form-group" style="flex:1">
              <label class="form-label">Data de competência <span class="field-info" title="Data de competência: referência contábil para relatórios; não influencia o caixa">ℹ️</span></label>
              <input id="exp-competence" type="date" class="form-control" value="${data?.competence_date || data?.due_date || today()}">
            </div>
            <div class="form-group" style="flex:1">
              <label class="form-label">Data de vencimento <span class="field-info" title="Data de vencimento: data prevista para o pagamento">ℹ️</span></label>
              <input id="exp-cash" type="date" class="form-control" value="${data?.cash_date || data?.paid_date || today()}">
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Observação</label>
            <input id="exp-notes" class="form-control" placeholder="Opcional" value="${data?.notes || ''}">
          </div>

          <div class="form-group">
            <label class="form-label" style="display:flex;align-items:center;gap:8px;cursor:pointer">
              <input type="checkbox" id="exp-paid-cb" onchange="_expTogglePaid()" ${data?.status === 'paid' ? 'checked' : ''}>
              Pago
            </label>
          </div>
          <div id="exp-paid-block" style="display:${data?.status === 'paid' ? 'block' : 'none'}">
            <div class="form-row">
              <div class="form-group" style="flex:1">
                <label class="form-label">Data do pagamento</label>
                <input id="exp-paid-date" type="date" class="form-control" max="${today()}" value="${data?.status === 'paid' ? (data?.cash_date || data?.paid_date || today()) : today()}">
              </div>
              <div class="form-group" style="flex:1">
                <label class="form-label">Valor pago (R$)</label>
                <input id="exp-paid-amount" class="form-control" type="text" inputmode="decimal" placeholder="0,00" value="${data?.paid_amount != null ? data.paid_amount : ''}">
              </div>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
          <button class="btn btn-primary" style="background:var(--expense)" onclick="saveExpense('${isEdit ? data.id : ''}', ${month}, ${year})">
            ${isEdit ? 'Salvar' : 'Adicionar'}
          </button>
        </div>
      </div>
    </div>
  `);
}

async function saveExpense(id, month, year) {
  const name   = document.getElementById('exp-name').value.trim();
  const amount = parseBRNumber(document.getElementById('exp-amount').value);
  const date   = document.getElementById('exp-date').value;
  const account_id = document.getElementById('exp-account') ? document.getElementById('exp-account').value : '';
  const cat    = document.getElementById('exp-cat').value || null;
  const competence_date = document.getElementById('exp-competence') ? document.getElementById('exp-competence').value : '';
  const cash_date = document.getElementById('exp-cash') ? document.getElementById('exp-cash').value : '';
  const notes  = document.getElementById('exp-notes').value.trim();
  const isPaid = document.getElementById('exp-paid-cb') ? document.getElementById('exp-paid-cb').checked : false;
  const paidDateVal = document.getElementById('exp-paid-date') ? document.getElementById('exp-paid-date').value : '';
  const paidAmountVal = parseBRNumber(document.getElementById('exp-paid-amount') ? document.getElementById('exp-paid-amount').value : '');

  if (!name)   { toast('Informe a descrição', 'error'); return; }
  if (!amount || amount <= 0) { toast('Informe um valor válido', 'error'); return; }
  if (!cat) { toast('Informe a categoria', 'error'); return; }
  if (!date)   { toast('Informe a data', 'error'); return; }

  // "Data de vencimento" (campo exp-cash) é o que alimenta due_date (cálculo de "Vencido").
  const due = cash_date || date;
  const [yearParsed, monthParsed] = (competence_date || due).split('-').map(Number);
  const record = {
    name, amount,
    due_date:         due,
    category_id:      cat,
    notes,
    transaction_type: 'expense',
    account_id:       account_id || '',
    competence_date:  competence_date || due,
    month:            monthParsed || month,
    year:             yearParsed || year,
    kind:             'variable',
  };

  // Regime de caixa: checkbox "Pago" define status e movimento de caixa.
  if (isPaid) {
    if (paidDateVal && paidDateVal > today()) {
      toast('Não é possível registrar um pagamento/recebimento com data superior à data de hoje.', 'error');
      return;
    }
    const pd = paidDateVal || today();
    record.status = 'paid';
    record.cash_date = pd;
    record.paid_date = pd;
    record.paid_amount = paidAmountVal > 0 ? paidAmountVal : amount;
  } else {
    record.status = 'pending';
    record.paid_date = null;
    record.cash_date = null;
    record.paid_amount = 0;
  }

  if (id && id !== '') {
    await db.transactions.update(id, record);
    toast('Gasto atualizado!', 'success');
  } else {
    record.template_id = null;
    await db.transactions.add(record);
    toast('Gasto registrado!', 'success');
  }

  closeModal();
  renderExpenses(parseInt(record.month), parseInt(record.year));
}
