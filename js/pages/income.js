async function renderIncome(month, year) {
  const content = document.getElementById('content');
  const [transactions, catsMap] = await Promise.all([
    db.transactions.filter(`month = ${month} && year = ${year} && transaction_type = 'income'`).toArray(),
    getCategoriesMap()
  ]);

  transactions.sort((a, b) => a.due_date > b.due_date ? 1 : -1);

  const total    = transactions.reduce((s, t) => s + (t.amount || 0), 0);
  const received = transactions.filter(t => t.status === 'paid').reduce((s, t) => s + (t.amount || 0), 0);
  const pending  = total - received;

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
      <button class="btn btn-primary btn-sm" style="background:var(--income)" onclick="openIncomeModal(${month}, ${year})">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        Nova Receita
      </button>
    </div>

    ${transactions.length === 0 ? `
      <div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none"><path d="M24 8v32M12 20l12-12 12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <p>Nenhuma receita para este mês</p>
      </div>` : `
      <div class="transaction-list" id="income-list">
        ${transactions.map(t => incomeRow(t, catsMap)).join('')}
      </div>`
    }
  `;

  bindIncomeActions();
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
        ${t.status !== 'paid' ? `<button class="btn btn-sm btn-icon" style="background:var(--income-light);color:var(--income)" data-action="receive" data-id="${t.id}" title="Marcar como recebido"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7l4 4 6-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>` : `<button class="btn btn-sm btn-icon btn-ghost" data-action="unreceive" data-id="${t.id}" title="Desfazer"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 5h7a3 3 0 0 1 0 6H5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M4 3L2 5l2 2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`}
        <button class="btn btn-sm btn-icon btn-ghost" data-action="edit" data-id="${t.id}" title="Editar"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9.5 2.5l2 2L4 12H2v-2L9.5 2.5z" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        <button class="btn btn-sm btn-icon btn-danger" data-action="delete" data-id="${t.id}" title="Excluir"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
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
      await db.transactions.update(id, { status: 'paid', paid_date: today() });
      clearUpcomingCache();
      toast('Receita marcada como recebida!', 'success');
      app.render();
    }
    if (action === 'unreceive') {
      await db.transactions.update(id, { status: 'pending', paid_date: null });
      clearUpcomingCache();
      toast('Alteração desfeita');
      app.render();
    }
    if (action === 'edit') {
      const t = await db.transactions.get(id);
      openIncomeModal(t.month, t.year, t);
    }
    if (action === 'delete') {
      if (!confirm('Excluir esta receita?')) return;
      await db.transactions.delete(id);
      toast('Receita excluída');
      app.render();
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

async function openIncomeModal(month, year, data = null) {
  const catsMap = await getCategoriesMap();
  const cats = Object.values(catsMap).filter(c => c.type === 'income');
  const isEdit = !!data;

  showModal(`
    <div class="modal-backdrop">
      <div class="modal">
        <div class="modal-header">
          <div class="modal-title">${isEdit ? 'Editar Receita' : 'Nova Receita'}</div>
          <button class="btn btn-icon btn-ghost" onclick="closeModal()"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M12 4L4 12M4 4l8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label">Descrição</label>
            <input id="inc-name" class="form-control" placeholder="Ex: Projeto cliente X" value="${data?.name || ''}">
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Valor (R$)</label>
              <input id="inc-amount" class="form-control" type="text" inputmode="decimal" placeholder="0,00" value="${data?.amount || ''}">
            </div>
            <div class="form-group">
              <label class="form-label">Data</label>
              <input id="inc-date" class="form-control" type="date" value="${data?.due_date || ''}">
            </div>
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
          <div class="form-group">
            <label class="form-label">Observações</label>
            <textarea id="inc-notes" class="form-control" rows="2" placeholder="Opcional">${data?.notes || ''}</textarea>
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

async function saveIncome(id, month, year) {
  const name   = document.getElementById('inc-name').value.trim();
  const amount = parseBRNumber(document.getElementById('inc-amount').value);
  const date   = document.getElementById('inc-date').value;
  const cat    = document.getElementById('inc-cat').value || null;
  const kind   = document.getElementById('inc-kind').value;
  const notes  = document.getElementById('inc-notes').value.trim();

  if (!name) { toast('Informe a descrição', 'error'); return; }
  if (!date) { toast('Informe a data', 'error'); return; }

  const record = {
    name, amount, due_date: date,
    category_id: cat, kind, notes,
    transaction_type: 'income',
    month, year
  };

  if (id && id !== '') {
    await db.transactions.update(id, record);
    toast('Receita atualizada!', 'success');
  } else {
    record.status = 'pending';
    record.paid_date = null;
    record.template_id = null;
    await db.transactions.add(record);
    toast('Receita adicionada!', 'success');
  }

  closeModal();
  app.render();
}
