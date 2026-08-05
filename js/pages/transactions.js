async function renderTransactions() {
  const content = document.getElementById('content');
  const m = app.currentMonth; const y = app.currentYear;
  const txs = await db.transactions.filter(`month = ${m} && year = ${y}`).toArray();
  const accounts = await db.accounts.toArray();
  const cats = await db.categories.toArray();

  content.innerHTML = `
    <div class="section-header" style="margin-bottom:20px">
      <div class="section-title">Transações</div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-ghost btn-sm" onclick="renderAccounts()">Contas</button>
        <button class="btn btn-primary btn-sm" onclick="openTransactionModal()">Novo Lançamento</button>
      </div>
    </div>

    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div style="font-weight:700">Lançamentos — ${txs.length}</div>
        <div style="font-size:.85rem;color:var(--text-muted)">Mês: ${monthLabel(m,y)}</div>
      </div>
      <div class="transaction-list">
        ${txs.map(t => transactionRowTx(t, accounts, cats)).join('')}
      </div>
    </div>
  `;
}

function transactionRowTx(t, accounts, cats) {
  const acc = accounts.find(a => a.id === t.account_id) || { name: 'Caixa' };
  const cat = cats.find(c => c.id === t.category_id) || null;
  return `
    <div class="transaction-item" style="border-radius:8px;border:1px solid var(--border)">
      <div class="t-icon" style="background:var(--primary-50);color:var(--primary-600);font-size:1.1rem">${t.transaction_type === 'income' ? '💸' : '💳'}</div>
      <div class="t-info">
        <div class="t-name">${t.name} <small style="color:var(--text-soft);font-size:.82rem">${acc.name || ''}</small>${t.source === 'whatsapp' ? waSourceBadge() : ''}</div>
        <div style="font-size:.82rem;color:var(--text-muted);display:flex;flex-wrap:wrap;align-items:center;gap:4px">
          ${cat ? cat.name + ' ·' : ''} Competência: ${t.competence_date || t.due_date || ''} · Caixa: ${t.cash_date || ''}
          ${txTypeBadge(t)}
        </div>
      </div>
      <div class="t-actions" style="display:flex">
        <div style="align-self:center;font-weight:600;color:${t.transaction_type === 'income' ? 'var(--income-text)' : 'var(--expense)'}">${fmt(t.amount)}</div>
        <button class="btn btn-sm btn-icon btn-ghost" data-action="edit-tx" data-id="${t.id}">✎</button>
        <button class="btn btn-sm btn-icon btn-danger" data-action="delete-tx" data-id="${t.id}">✕</button>
      </div>
    </div>
  `;
}

// Actions
document.addEventListener('click', async e => {
  const btn = e.target.closest('[data-action]'); if (!btn) return;
  if (btn.dataset.action === 'edit-tx') {
    const t = await db.transactions.get(btn.dataset.id); openTransactionModal(t);
  }
  if (btn.dataset.action === 'delete-tx') {
    const id = btn.dataset.id; if (!confirm('Excluir lançamento?')) return; await db.transactions.delete(id); toast('Excluído'); renderTransactions();
  }
});

async function openTransactionModal(data = null) {
  const isEdit = !!data;
  const accounts = await db.accounts.toArray();
  const cats = await db.categories.toArray();
  showModal(`
    <div class="modal-backdrop">
      <div class="modal">
        <div class="modal-header">
          <div class="modal-title">${isEdit ? 'Editar Lançamento' : 'Novo Lançamento'}</div>
          <button class="btn btn-icon btn-ghost" onclick="closeModal()">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label">Descrição</label>
            <input id="tx-name" class="form-control" value="${data?.name || ''}">
          </div>
          <div class="form-row">
            <div class="form-group" style="flex:1">
              <label class="form-label">Tipo</label>
              <select id="tx-type" class="form-control"><option value="income" ${data?.transaction_type === 'income' ? 'selected' : ''}>Receita</option><option value="expense" ${data?.transaction_type === 'expense' ? 'selected' : ''}>Despesa</option></select>
            </div>
            <div class="form-group" style="flex:1">
              <label class="form-label">Valor</label>
              <input id="tx-amount" class="form-control" type="number" step="0.01" value="${data?.amount || 0}">
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">Conta (Caixa)</label>
            <select id="tx-account" class="form-control">
              ${accounts.map(a => `<option value="${a.id}" ${data?.account_id === a.id ? 'selected' : ''}>${a.name} - ${a.bank_name || ''}</option>`).join('')}
            </select>
          </div>

          <div class="form-group">
            <label class="form-label">Categoria</label>
            <select id="tx-cat" class="form-control">
              <option value="">— Sem categoria —</option>
              ${cats.map(c => `<option value="${c.id}" ${data?.category_id === c.id ? 'selected' : ''}>${c.name}</option>`).join('')}
            </select>
          </div>

          <div class="form-row">
            <div class="form-group" style="flex:1">
              <label class="form-label">Data de competência <span class="field-info" title="Data de competência: referência contábil para relatórios; não influencia o caixa">ℹ️</span></label>
              <input id="tx-competence" type="date" class="form-control" value="${data?.competence_date || ''}">
            </div>
            <div class="form-group" style="flex:1">
              <label class="form-label">Data de caixa (entrada/saída) <span class="field-info" title="Data de caixa: data em que o dinheiro efetivamente entrou/foi debitado da conta">ℹ️</span></label>
              <input id="tx-cash" type="date" class="form-control" value="${data?.cash_date || ''}">
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">Observações</label>
            <textarea id="tx-notes" class="form-control">${data?.notes || ''}</textarea>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
          <button class="btn btn-primary" onclick="saveTransaction('${data?.id || ''}')">${isEdit ? 'Salvar' : 'Criar'}</button>
        </div>
      </div>
    </div>
  `);
}

async function saveTransaction(id) {
  const name = document.getElementById('tx-name').value.trim();
  const transaction_type = document.getElementById('tx-type').value;
  const amount = parseFloat(document.getElementById('tx-amount').value) || 0;
  const account_id = document.getElementById('tx-account').value || '';
  const category_id = document.getElementById('tx-cat').value || '';
  const competence_date = document.getElementById('tx-competence').value || '';
  const cash_date = document.getElementById('tx-cash').value || '';
  const notes = document.getElementById('tx-notes').value || '';
  if (!name) { toast('Informe a descrição', 'error'); return; }
  const [year, month] = (competence_date || (new Date()).toISOString().split('T')[0]).split('-').map(Number);
  const record = { name, transaction_type, amount, account_id, category_id, competence_date, cash_date, month: month || app.currentMonth, year: year || app.currentYear, notes, status: 'pending' };
  if (id) { await db.transactions.update(id, record); toast('Atualizado'); } else { await db.transactions.add(record); toast('Criado'); }
  closeModal(); renderTransactions();
}
