async function renderExpenses(month, year) {
  const content = document.getElementById('content');
  const [transactions, catsMap, accounts] = await Promise.all([
    db.transactions.filter(`month = ${month} && year = ${year} && (transaction_type = 'general' || transaction_type = 'daily' || transaction_type = 'expense' || transaction_type = 'installment')`).toArray(),
    getCategoriesMap(),
    db.accounts.toArray()
  ]);

  transactions.sort((a, b) => a.due_date > b.due_date ? -1 : 1);

  const total = transactions.reduce((s, t) => s + (t.amount || 0), 0);

  content.innerHTML = `
    <div class="summary-grid" style="grid-template-columns:1fr 1fr;margin-bottom:20px">
      <div class="summary-card expense-card">
        <div class="label">Total Gasto</div>
        <div class="value">${fmt(total)}</div>
      </div>
      <div class="summary-card">
        <div class="label">Lançamentos</div>
        <div class="value" style="color:var(--text)">${transactions.length}</div>
      </div>
    </div>

    <div class="section-header">
      <div class="section-title">Gastos Gerais (${transactions.length})</div>
      <button class="btn btn-primary btn-sm" style="background:var(--expense)" onclick="openExpenseModal(${month}, ${year})">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        Novo Gasto
      </button>
    </div>

    ${transactions.length === 0 ? `
      <div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none"><path d="M12 8h24a2 2 0 0 1 2 2v28a2 2 0 0 1-2 2H12a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z" stroke="currentColor" stroke-width="2"/><path d="M16 20h16M16 28h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        <p>Nenhum gasto registrado neste mês</p>
      </div>` : `
      <div class="transaction-list" id="expenses-list">
    ${transactions.map(t => expenseRow(t, catsMap, accounts)).join('')}
      </div>`
    }
  `;

  bindExpenseActions(month, year);
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
          ${t.notes ? `<span title="${t.notes}">📝 ${t.notes.substring(0, 30)}${t.notes.length > 30 ? '…' : ''}</span>` : ''}
        </div>
      </div>
      <div class="t-amount expense">${fmt(t.amount)}</div>
      <div class="t-actions">
        <button class="btn btn-sm btn-icon btn-ghost" data-action="edit" data-id="${t.id}" title="Editar">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M11.5 2.5a2.121 2.121 0 1 1 3 3L5 15H2v-3L11.5 2.5z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <button class="btn btn-sm btn-icon btn-danger" data-action="delete" data-id="${t.id}" title="Excluir">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M5 4V2h6v2M6 7v5M10 7v5M3 4l1 10h8l1-10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        </button>
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
      if (action === 'edit') {
        const t = await db.transactions.get(id);
        if (t) openExpenseModal(t.month, t.year, t);
      } else if (action === 'delete') {
        if (!confirm('Excluir este gasto?')) return;
        await db.transactions.delete(id);
        toast('Gasto excluído');
        renderExpenses(month, year);
      }
    } else {
      const t = await db.transactions.get(item.dataset.id);
      if (t) openExpenseModal(t.month, t.year, t);
    }
  });
}

async function openExpenseModal(month, year, data = null) {
  const catsMap = await getCategoriesMap();
  const cats    = Object.values(catsMap).filter(c => c.type === 'expense');
  const accounts = await db.accounts.toArray();
  const isEdit  = !!data;

  showModal(`
    <div class="modal-backdrop">
      <div class="modal">
        <div class="modal-header">
          <div class="modal-title">${isEdit ? 'Editar Gasto' : 'Novo Gasto Geral'}</div>
          <button class="btn btn-icon btn-ghost" onclick="closeModal()">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M12 4L4 12M4 4l8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          </button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label">Descrição</label>
            <input id="exp-name" class="form-control" placeholder="Ex: Pagamento funcionário, Material..." value="${data?.name || ''}">
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Valor (R$)</label>
              <input id="exp-amount" class="form-control" type="text" inputmode="decimal" placeholder="0,00" value="${data?.amount || ''}">
            </div>
            <div class="form-group">
              <label class="form-label">Data</label>
              <input id="exp-date" class="form-control" type="date" value="${data?.due_date || today()}">
            </div>
          </div>

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
              <label class="form-label">Data de caixa (saída) <span class="field-info" title="Data de caixa: data em que o dinheiro efetivamente entrou/foi debitado da conta">ℹ️</span></label>
              <input id="exp-cash" type="date" class="form-control" value="${data?.cash_date || data?.paid_date || today()}">
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Observação</label>
            <input id="exp-notes" class="form-control" placeholder="Opcional" value="${data?.notes || ''}">
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

  if (!name)   { toast('Informe a descrição', 'error'); return; }
  if (!amount || amount <= 0) { toast('Informe um valor válido', 'error'); return; }
  if (!cat) { toast('Informe a categoria', 'error'); return; }
  if (!date)   { toast('Informe a data', 'error'); return; }

  const [yearParsed, monthParsed] = (competence_date || date).split('-').map(Number);
  const record = {
    name, amount,
    due_date:         date,
    paid_date:        cash_date || null,
    category_id:      cat,
    notes,
    transaction_type: 'expense',
    account_id:       account_id || '',
    competence_date:  competence_date || date,
    cash_date:        cash_date || date,
    status:           'paid',
    month:            monthParsed || month,
    year:             yearParsed || year,
    kind:             'variable',
    template_id:      null,
  };

  if (id && id !== '') {
    await db.transactions.update(id, record);
    toast('Gasto atualizado!', 'success');
  } else {
    await db.transactions.add(record);
    toast('Gasto registrado!', 'success');
  }

  closeModal();
  renderExpenses(parseInt(record.month), parseInt(record.year));
}
