let _dailyDate = today();

async function renderDaily() {
  const content = document.getElementById('content');
  const [transactions, catsMap] = await Promise.all([
    db.transactions.filter(`(transaction_type = 'daily' || transaction_type = 'general') && due_date = '${_dailyDate}'`).toArray(),
    getCategoriesMap()
  ]);

  transactions.sort((a, b) => a.created > b.created ? -1 : 1);

  const total = transactions.reduce((s, t) => s + (t.amount || 0), 0);
  const isToday = _dailyDate === today();

  content.innerHTML = `
    <div class="day-nav">
      <button class="btn btn-ghost btn-icon" onclick="dailyPrevDay()">
        <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><path d="M10 12L6 8l4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <div class="day-nav-center">
        <span class="day-label">${formatDayLabel(_dailyDate)}</span>
        <span class="day-sub">${fmtDate(_dailyDate)}</span>
        <input type="date" id="daily-date-input" class="day-date-overlay" value="${_dailyDate}" onchange="dailyGoDate(this.value)">
      </div>
      <button class="btn btn-ghost btn-icon" onclick="dailyNextDay()" ${isToday ? 'disabled style="opacity:.35;cursor:default"' : ''}>
        <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    </div>

    <div class="summary-grid" style="grid-template-columns:1fr 1fr;margin-bottom:20px">
      <div class="summary-card expense-card">
        <div class="label">Total do dia</div>
        <div class="value">${fmt(total)}</div>
      </div>
      <div class="summary-card">
        <div class="label">Lançamentos</div>
        <div class="value" style="color:var(--text)">${transactions.length}</div>
      </div>
    </div>

    <div class="section-header">
      <div class="section-title">Gastos do Dia (${transactions.length})</div>
      <button class="btn btn-primary btn-sm" style="background:var(--expense)" onclick="openDailyModal()">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        Novo Gasto
      </button>
    </div>

    ${transactions.length === 0 ? `
      <div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="18" stroke="currentColor" stroke-width="2"/><path d="M24 16v8l5 3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        <p>Nenhum gasto registrado${isToday ? ' hoje' : ' neste dia'}</p>
      </div>` : `
      <div class="transaction-list" id="daily-list">
        ${transactions.map(t => dailyRow(t, catsMap)).join('')}
      </div>`
    }
  `;

  bindDailyActions();
}

function formatDayLabel(iso) {
  const t = today();
  if (iso === t) return 'Hoje';
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yStr = yesterday.toISOString().split('T')[0];
  if (iso === yStr) return 'Ontem';
  const [y, m, d] = iso.split('-');
  const days = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const dow = new Date(Number(y), Number(m) - 1, Number(d)).getDay();
  return `${days[dow]}, ${d}/${m}`;
}

function dailyRow(t, catsMap) {
  const cat = catsMap[t.category_id];
  return `
    <div class="transaction-item" data-id="${t.id}">
      <div class="t-icon" style="background:${cat ? cat.color + '22' : '#FAEDE7'};color:${cat ? cat.color : '#C95A47'}">
        ${cat ? (cat.icon || cat.name[0]) : '💸'}
      </div>
      <div class="t-info">
        <div class="t-name">${t.name}</div>
        <div class="t-meta">
          ${cat ? catTag(cat) : ''}
          ${t.notes ? `<span title="${t.notes}">📝 ${t.notes.substring(0, 30)}${t.notes.length > 30 ? '…' : ''}</span>` : ''}
        </div>
      </div>
      <div class="t-amount expense">${fmt(t.amount)}</div>
      <div class="t-actions">
        <button class="btn btn-sm btn-icon btn-ghost" data-action="edit" data-id="${t.id}" title="Editar"><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M11.5 2.5a2.121 2.121 0 1 1 3 3L5 15H2v-3L11.5 2.5z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        <button class="btn btn-sm btn-icon btn-danger" data-action="delete" data-id="${t.id}" title="Excluir"><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M5 4V2h6v2M6 7v5M10 7v5M3 4l1 10h8l1-10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>
      </div>
    </div>
  `;
}

function bindDailyActions() {
  document.getElementById('daily-list')?.addEventListener('click', async e => {
    const btn  = e.target.closest('[data-action]');
    const item = e.target.closest('.transaction-item');
    if (!item) return;

    if (btn) {
      const id     = btn.dataset.id;
      const action = btn.dataset.action;
      if (action === 'edit') {
        const t = await db.transactions.get(id);
        if (t) openDailyModal(t);
      } else if (action === 'delete') {
        if (!confirm('Excluir este gasto?')) return;
        await db.transactions.delete(id);
        toast('Gasto excluído');
        renderDaily();
      }
    } else {
      const t = await db.transactions.get(item.dataset.id);
      if (t) openDailyModal(t);
    }
  });
}

async function openDailyModal(data = null) {
  const catsMap = await getCategoriesMap();
  const cats = Object.values(catsMap).filter(c => c.type === 'expense')
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }));
  const isEdit = !!data;

  showModal(`
    <div class="modal-backdrop">
      <div class="modal">
        <div class="modal-header">
          <div class="modal-title">${isEdit ? 'Editar Gasto' : 'Novo Gasto do Dia'}</div>
          <button class="btn btn-icon btn-ghost" onclick="closeModal()"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M12 4L4 12M4 4l8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label">Descrição</label>
            <input id="daily-name" class="form-control" placeholder="Ex: Café, Uber, Almoço…" value="${data?.name || ''}">
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Valor (R$)</label>
              <input id="daily-amount" class="form-control" type="text" inputmode="decimal" placeholder="0,00" value="${data?.amount || ''}">
            </div>
            <div class="form-group">
              <label class="form-label">Data</label>
              <input id="daily-date" class="form-control" type="date" value="${data?.due_date || _dailyDate}">
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Categoria</label>
            <select id="daily-cat" class="form-control">
              <option value="">Sem categoria</option>
              ${cats.map(c => `<option value="${c.id}" ${data?.category_id === c.id ? 'selected' : ''}>${c.icon} ${c.name}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Observação</label>
            <input id="daily-notes" class="form-control" placeholder="Opcional" value="${data?.notes || ''}">
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
          <button class="btn btn-primary" style="background:var(--expense)" onclick="saveDaily('${isEdit ? data.id : ''}')">
            ${isEdit ? 'Salvar' : 'Adicionar'}
          </button>
        </div>
      </div>
    </div>
  `);
}

async function saveDaily(id) {
  const name   = document.getElementById('daily-name').value.trim();
  const amount = parseBRNumber(document.getElementById('daily-amount').value);
  const date   = document.getElementById('daily-date').value;
  const cat    = document.getElementById('daily-cat').value || null;
  const notes  = document.getElementById('daily-notes').value.trim();

  if (!name)   { toast('Informe a descrição', 'error'); return; }
  if (!amount) { toast('Informe o valor', 'error'); return; }
  if (!date)   { toast('Informe a data', 'error'); return; }

  const [y, m] = date.split('-');
  const record = {
    name, amount,
    due_date: date,
    category_id: cat,
    notes,
    transaction_type: 'general',
    status: 'paid',
    month: parseInt(m),
    year: parseInt(y),
    kind: 'variable',
    paid_date: date,
    template_id: null,
  };

  if (id && id !== '') {
    await db.transactions.update(id, record);
    toast('Gasto atualizado!', 'success');
  } else {
    await db.transactions.add(record);
    toast('Gasto registrado!', 'success');
  }

  _dailyDate = date;
  closeModal();
  renderDaily();
}

function dailyPrevDay() {
  const d = new Date(_dailyDate);
  d.setDate(d.getDate() - 1);
  _dailyDate = d.toISOString().split('T')[0];
  renderDaily();
}

function dailyNextDay() {
  const d = new Date(_dailyDate);
  d.setDate(d.getDate() + 1);
  const next = d.toISOString().split('T')[0];
  if (next > today()) return;
  _dailyDate = next;
  renderDaily();
}

function dailyGoDate(value) {
  if (!value || value > today()) return;
  _dailyDate = value;
  renderDaily();
}
