async function renderAccounts() {
  const content = document.getElementById('content');
  const accounts = await db.accounts.toArray();
  const banks = await db.banks.toArray();

  async function calcBalance(acc) {
    const txs = await db.transactions.filter(`account_id = '${acc.id}'`).toArray();
    const sum = txs.filter(t => t.cash_date && t.cash_date <= new Date().toISOString().split('T')[0])
      .reduce((s, t) => s + (t.transaction_type === 'income' ? (t.amount || 0) : -(t.amount || 0)), 0);
    return (acc.initial_balance || 0) + sum;
  }

  const rows = await Promise.all(accounts.map(async a => {
    const bal = await calcBalance(a);
    return accountRow(a, bal);
  }));

  content.innerHTML = `
    <div class="section-header" style="margin-bottom:20px">
      <div class="section-title">Contas Bancárias</div>
      <button class="btn btn-primary btn-sm" onclick="openAccountModal()">Nova Conta</button>
    </div>

    <div style="display:grid;gap:12px">
      ${rows.join('\n') || '<p style="color:var(--text-muted)">Nenhuma conta cadastrada</p>'}
    </div>
  `;
}

function accountRow(a, balance) {
  return `
    <div class="transaction-item" style="border-radius:8px;border:1px solid var(--border)">
      <div class="t-icon" style="background:var(--primary-50);color:var(--primary-600);font-size:1.1rem">
        ${a.bank_name ? a.bank_name[0] : '🏦'}
      </div>
      <div class="t-info">
        <div class="t-name">${a.name} <small style="color:var(--text-soft);font-size:.82rem">${a.bank_name || ''}</small></div>
        <div style="font-size:.82rem;color:var(--text-muted)">Saldo: ${fmt(balance)}</div>
      </div>
      <div class="t-actions" style="display:flex">
        <button class="btn btn-sm btn-icon btn-ghost" data-action="edit-acc" data-id="${a.id}">✎</button>
        <button class="btn btn-sm btn-icon btn-danger" data-action="delete-acc" data-id="${a.id}">✕</button>
      </div>
    </div>
  `;
}

// Actions
document.addEventListener('click', async e => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  if (action === 'edit-acc') {
    const acc = await db.accounts.get(btn.dataset.id);
    openAccountModal(acc);
  }
  if (action === 'delete-acc') {
    const id = btn.dataset.id;
    const used = await db.transactions.filter(`account_id = '${id}'`).count();
    if (used > 0) { toast('Esta conta possui transações. Remova-as antes.', 'error'); return; }
    if (!confirm('Excluir esta conta?')) return;
    await db.accounts.delete(id);
    toast('Conta excluída');
    renderAccounts();
  }
});

async function openAccountModal(data = null) {
  const isEdit = !!data;
  const banks = await db.banks.toArray();
  showModal(`
    <div class="modal-backdrop">
      <div class="modal">
        <div class="modal-header">
          <div class="modal-title">${isEdit ? 'Editar Conta' : 'Nova Conta'}</div>
          <button class="btn btn-icon btn-ghost" onclick="closeModal()">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label">Nome da conta</label>
            <input id="acc-name" class="form-control" value="${data?.name || ''}">
          </div>
          <div class="form-group">
            <label class="form-label">Banco</label>
            <select id="acc-bank" class="form-control">
              <option value="">— Sem banco —</option>
              ${banks.map(b => `<option value="${b.id}" ${data?.bank_id === b.id ? 'selected' : ''}>${b.name}</option>`).join('')}
            </select>
          </div>
          <div class="form-row">
            <div class="form-group" style="flex:1">
              <label class="form-label">Tipo</label>
              <select id="acc-type" class="form-control"><option value="checking">Conta Corrente</option><option value="savings">Poupança</option></select>
            </div>
            <div class="form-group" style="flex:1">
              <label class="form-label">Moeda</label>
              <input id="acc-currency" class="form-control" value="${data?.currency || 'BRL'}">
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Saldo inicial</label>
            <input id="acc-initial" class="form-control" type="number" step="0.01" value="${data?.initial_balance || 0}">
          </div>
          <div class="form-group">
            <label class="form-label">Data do saldo inicial</label>
            <input id="acc-initial-date" class="form-control" type="date" value="${data?.initial_balance_date || ''}">
          </div>
          <div class="form-group">
            <label class="form-label">Observações</label>
            <textarea id="acc-notes" class="form-control">${data?.notes || ''}</textarea>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
          <button class="btn btn-primary" onclick="saveAccount('${data?.id || ''}')">${isEdit ? 'Salvar' : 'Criar'}</button>
        </div>
      </div>
    </div>
  `);
}

async function saveAccount(id) {
  const name = document.getElementById('acc-name').value.trim();
  const bank_id = document.getElementById('acc-bank').value || '';
  const type = document.getElementById('acc-type').value;
  const currency = document.getElementById('acc-currency').value.trim() || 'BRL';
  const initial_balance = parseFloat(document.getElementById('acc-initial').value) || 0;
  const initial_balance_date = document.getElementById('acc-initial-date').value || '';
  const notes = document.getElementById('acc-notes').value || '';
  if (!name) { toast('Informe o nome da conta', 'error'); return; }
  const record = { name, bank_id, bank_name: '', type, currency, initial_balance, initial_balance_date, notes };
  if (bank_id) {
    const b = await db.banks.get(bank_id); if (b) record.bank_name = b.name;
  }
  if (id) {
    await db.accounts.update(id, record);
    toast('Conta atualizada', 'success');
  } else {
    await db.accounts.add(record);
    toast('Conta criada', 'success');
  }
  closeModal();
  renderAccounts();
}
