async function renderBills(month, year) {
  const content = document.getElementById('content');
  const [transactions, catsMap] = await Promise.all([
    db.transactions.filter(`month = ${month} && year = ${year} && transaction_type = 'expense'`).toArray(),
    getCategoriesMap()
  ]);

  transactions.sort((a, b) => a.due_date > b.due_date ? 1 : -1);

  const total   = transactions.reduce((s, t) => s + (t.amount || 0), 0);
  const paid    = transactions.filter(t => t.status === 'paid').reduce((s, t) => s + (t.amount || 0), 0);
  const pending = total - paid;

  content.innerHTML = `
    <div class="summary-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:20px">
      <div class="summary-card">
        <div class="label">Total</div>
        <div class="value">${fmt(total)}</div>
      </div>
      <div class="summary-card">
        <div class="label" style="color:var(--income)">Pago</div>
        <div class="value" style="color:var(--income)">${fmt(paid)}</div>
      </div>
      <div class="summary-card">
        <div class="label" style="color:var(--warning)">Pendente</div>
        <div class="value" style="color:var(--warning)">${fmt(pending)}</div>
      </div>
    </div>

    <div class="section-header">
      <div class="section-title">Contas (${transactions.length})</div>
      <button class="btn btn-primary btn-sm" onclick="openBillModal(${month}, ${year})">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        Nova Conta
      </button>
    </div>

    ${transactions.length === 0 ? `
      <div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none"><rect x="8" y="8" width="32" height="32" rx="4" stroke="currentColor" stroke-width="2"/><path d="M16 20h16M16 28h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        <p>Nenhuma conta para este mês</p>
      </div>` : `
      <div class="transaction-list" id="bills-list">
        ${transactions.map(t => billRow(t, catsMap)).join('')}
      </div>`
    }
  `;

  bindBillActions();
}

function billRow(t, catsMap) {
  const cat = catsMap[t.category_id];
  const overdue = isOverdue(t.due_date, t.status);

  return `
    <div class="transaction-item" data-id="${t.id}" style="${overdue ? 'border-left:3px solid var(--expense)' : ''}">
      <div class="t-icon" style="background:${cat ? cat.color + '22' : '#f1f5f9'};color:${cat ? cat.color : '#94a3b8'}">
        ${cat ? (cat.icon || cat.name[0]) : '📄'}
      </div>
      <div class="t-info">
        <div class="t-name">${t.name}</div>
        <div class="t-meta">
          ${cat ? catTag(cat) : ''}
          ${kindBadge(t.kind)}
          <span>Vence ${fmtDate(t.due_date)}</span>
          ${statusBadge(t.status, t.due_date)}
        </div>
      </div>
      <div class="t-amount expense">${fmt(t.amount)}</div>
      <div class="t-actions">
        ${t.status !== 'paid' ? `<button class="btn btn-sm btn-icon" style="background:var(--income-light);color:var(--income)" data-action="pay" data-id="${t.id}" title="Marcar como pago"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7l4 4 6-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>` : `<button class="btn btn-sm btn-icon btn-ghost" data-action="unpay" data-id="${t.id}" title="Desfazer pagamento"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 5h7a3 3 0 0 1 0 6H5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M4 3L2 5l2 2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`}
        <button class="btn btn-sm btn-icon btn-ghost" data-action="edit" data-id="${t.id}" title="Editar"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9.5 2.5l2 2L4 12H2v-2L9.5 2.5z" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        <button class="btn btn-sm btn-icon btn-danger" data-action="delete" data-id="${t.id}" title="Excluir"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
      </div>
    </div>
  `;
}

function bindBillActions() {
  document.getElementById('bills-list')?.addEventListener('click', async e => {
    const btn  = e.target.closest('[data-action]');
    const item = e.target.closest('.transaction-item');
    if (!item) return;

    if (btn) {
      const id     = btn.dataset.id;
      const action = btn.dataset.action;
      if (action === 'pay') {
        await db.transactions.update(id, { status: 'paid', paid_date: today() });
        clearUpcomingCache();
        toast('Conta marcada como paga!', 'success');
        app.render();
      } else if (action === 'unpay') {
        await db.transactions.update(id, { status: 'pending', paid_date: null });
        clearUpcomingCache();
        toast('Pagamento desfeito');
        app.render();
      } else if (action === 'edit') {
        const t = await db.transactions.get(id);
        openBillModal(t.month, t.year, t);
      } else if (action === 'delete') {
        if (!confirm('Excluir esta conta?')) return;
        await db.transactions.delete(id);
        toast('Conta excluída');
        app.render();
      }
    } else {
      const t = await db.transactions.get(item.dataset.id);
      if (t) openBillModal(t.month, t.year, t);
    }
  });
}

async function openBillModal(month, year, data = null) {
  const catsMap = await getCategoriesMap();
  const cats = Object.values(catsMap).filter(c => c.type === 'expense');
  const isEdit = !!data;

  showModal(`
    <div class="modal-backdrop">
      <div class="modal">
        <div class="modal-header">
          <div class="modal-title">${isEdit ? 'Editar Conta' : 'Nova Conta'}</div>
          <button class="btn btn-icon btn-ghost" onclick="closeModal()"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M12 4L4 12M4 4l8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label">Nome</label>
            <input id="bill-name" class="form-control" placeholder="Ex: Conta de luz" value="${data?.name || ''}">
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Valor (R$)</label>
              <input id="bill-amount" class="form-control" type="text" inputmode="decimal" placeholder="0,00" value="${data?.amount || ''}">
            </div>
            <div class="form-group">
              <label class="form-label">Vencimento</label>
              <input id="bill-date" class="form-control" type="date" value="${data?.due_date || ''}">
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Categoria</label>
              <select id="bill-cat" class="form-control">
                <option value="">Sem categoria</option>
                ${cats.map(c => `<option value="${c.id}" ${data?.category_id === c.id ? 'selected' : ''}>${c.icon} ${c.name}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Tipo</label>
              <select id="bill-kind" class="form-control">
                <option value="variable" ${data?.kind === 'variable' ? 'selected' : ''}>Variável</option>
                <option value="fixed" ${data?.kind === 'fixed' ? 'selected' : ''}>Fixo</option>
              </select>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Observações</label>
            <textarea id="bill-notes" class="form-control" rows="2" placeholder="Opcional">${data?.notes || ''}</textarea>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
          <button class="btn btn-primary" onclick="saveBill('${isEdit ? data.id : ''}', ${month}, ${year})">
            ${isEdit ? 'Salvar' : 'Adicionar'}
          </button>
        </div>
      </div>
    </div>
  `);
}

async function saveBill(id, month, year) {
  const name   = document.getElementById('bill-name').value.trim();
  const amount = parseBRNumber(document.getElementById('bill-amount').value);
  const date   = document.getElementById('bill-date').value;
  const cat    = document.getElementById('bill-cat').value || null;
  const kind   = document.getElementById('bill-kind').value;
  const notes  = document.getElementById('bill-notes').value.trim();

  if (!name) { toast('Informe o nome da conta', 'error'); return; }
  if (!date) { toast('Informe a data de vencimento', 'error'); return; }

  const record = {
    name, amount, due_date: date,
    category_id: cat, kind, notes,
    transaction_type: 'expense',
    month, year
  };

  if (id && id !== '') {
    await db.transactions.update(id, record);
    toast('Conta atualizada!', 'success');
  } else {
    record.status = 'pending';
    record.paid_date = null;
    record.template_id = null;
    await db.transactions.add(record);
    toast('Conta adicionada!', 'success');
  }

  closeModal();
  app.render();
}
