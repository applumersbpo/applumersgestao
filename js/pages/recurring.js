async function renderRecurring() {
  const content = document.getElementById('content');
  const [templates, catsMap] = await Promise.all([
    db.templates.toArray(),
    getCategoriesMap()
  ]);

  const expenses = templates.filter(t => t.transaction_type === 'expense');
  const incomes  = templates.filter(t => t.transaction_type === 'income');

  content.innerHTML = `
    <div class="card" style="margin-bottom:16px;background:var(--primary-light);border-color:var(--primary)">
      <p style="font-size:.88rem;color:var(--primary-dark)">
        <strong>Como funciona:</strong> As recorrências geram automaticamente as transações ao abrir um mês novo. Fixas já vêm com o valor definido; variáveis vêm com R$&nbsp;0 para você preencher.
      </p>
    </div>

    <div class="section-header" style="margin-bottom:20px">
      <div class="section-title">Recorrências</div>
      <button class="btn btn-primary btn-sm" onclick="openRecurringModal()">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        Nova Recorrência
      </button>
    </div>

    <div style="display:grid;gap:24px">
      <div class="card">
        <div class="card-title">Despesas Recorrentes (${expenses.length})</div>
        ${expenses.length === 0 ? '<div class="empty-state" style="padding:24px"><p>Nenhuma despesa recorrente</p></div>' : `
        <div style="display:flex;flex-direction:column;gap:1px;background:var(--border);border-radius:8px;overflow:hidden;margin-top:12px">
          ${expenses.map(t => recurringRow(t, catsMap)).join('')}
        </div>`}
      </div>

      <div class="card">
        <div class="card-title">Receitas Recorrentes (${incomes.length})</div>
        ${incomes.length === 0 ? '<div class="empty-state" style="padding:24px"><p>Nenhuma receita recorrente</p></div>' : `
        <div style="display:flex;flex-direction:column;gap:1px;background:var(--border);border-radius:8px;overflow:hidden;margin-top:12px">
          ${incomes.map(t => recurringRow(t, catsMap)).join('')}
        </div>`}
      </div>
    </div>
  `;

  document.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', handleRecurringAction);
  });
}

function recurringRow(t, catsMap) {
  const cat = catsMap[t.category_id];
  const isActive = !!t.active;

  return `
    <div class="transaction-item" style="background:var(--surface);opacity:${isActive ? 1 : 0.5}">
      <div class="t-icon" style="background:${cat ? cat.color + '22' : '#f1f5f9'};color:${cat ? cat.color : '#94a3b8'}">
        ${cat ? (cat.icon || cat.name[0]) : '🔄'}
      </div>
      <div class="t-info">
        <div class="t-name">${t.name}</div>
        <div class="t-meta">
          ${cat ? catTag(cat) : ''}
          ${kindBadge(t.kind)}
          <span>Dia ${t.due_day}</span>
          ${isActive ? '<span class="badge badge-paid">Ativa</span>' : '<span class="badge badge-variable">Inativa</span>'}
        </div>
      </div>
      <div class="t-amount ${t.transaction_type === 'expense' ? 'expense' : 'income'}">
        ${t.kind === 'fixed' ? fmt(t.amount) : 'Variável'}
      </div>
      <div class="t-actions" style="display:flex">
        <button class="btn btn-sm btn-icon btn-ghost" data-action="toggle-tpl" data-id="${t.id}" title="${isActive ? 'Desativar' : 'Ativar'}">
          ${isActive
            ? '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="3" y="2" width="4" height="12" rx="1" fill="currentColor"/><rect x="9" y="2" width="4" height="12" rx="1" fill="currentColor"/></svg>'
            : '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 3l10 5-10 5V3z" fill="currentColor"/></svg>'
          }
        </button>
        <button class="btn btn-sm btn-icon btn-ghost" data-action="edit-tpl" data-id="${t.id}" title="Editar">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M11.5 2.5a2.121 2.121 0 1 1 3 3L5 15H2v-3L11.5 2.5z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <button class="btn btn-sm btn-icon btn-danger" data-action="delete-tpl" data-id="${t.id}" title="Excluir">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M5 4V2h6v2M6 7v5M10 7v5M3 4l1 10h8l1-10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        </button>
      </div>
    </div>
  `;
}

async function handleRecurringAction(e) {
  const btn = e.currentTarget;
  const id = btn.dataset.id;
  const action = btn.dataset.action;

  if (action === 'toggle-tpl') {
    const tpl = await db.templates.get(id);
    await db.templates.update(id, { active: !tpl.active });
    toast(tpl.active ? 'Recorrência desativada' : 'Recorrência ativada', 'success');
    renderRecurring();
  }
  if (action === 'edit-tpl') {
    const tpl = await db.templates.get(id);
    openRecurringModal(tpl);
  }
  if (action === 'delete-tpl') {
    if (!confirm('Excluir esta recorrência? As transações geradas não serão afetadas.')) return;
    await db.templates.delete(id);
    toast('Recorrência excluída');
    renderRecurring();
  }
}

async function openRecurringModal(data = null) {
  const isEdit = !!data;
  const catsMap = await getCategoriesMap();
  const allCats = Object.values(catsMap);
  const expCats = allCats.filter(c => c.type === 'expense');
  const incCats = allCats.filter(c => c.type === 'income');

  const type = data?.transaction_type || 'expense';

  showModal(`
    <div class="modal-backdrop">
      <div class="modal">
        <div class="modal-header">
          <div class="modal-title">${isEdit ? 'Editar Recorrência' : 'Nova Recorrência'}</div>
          <button class="btn btn-icon btn-ghost" onclick="closeModal()">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label">Nome</label>
            <input id="tpl-name" class="form-control" placeholder="Ex: Aluguel" value="${data?.name || ''}">
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Tipo de Transação</label>
              <select id="tpl-type" class="form-control" onchange="updateTplCats()">
                <option value="expense" ${type === 'expense' ? 'selected' : ''}>Despesa</option>
                <option value="income"  ${type === 'income'  ? 'selected' : ''}>Receita</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Fixo ou Variável</label>
              <select id="tpl-kind" class="form-control" onchange="toggleTplAmount()">
                <option value="variable" ${data?.kind === 'variable' ? 'selected' : ''}>Variável</option>
                <option value="fixed"    ${data?.kind === 'fixed'    ? 'selected' : ''}>Fixo</option>
              </select>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group" id="tpl-amount-wrap" style="${data?.kind === 'fixed' ? '' : 'opacity:.4;pointer-events:none'}">
              <label class="form-label">Valor Fixo (R$)</label>
              <input id="tpl-amount" class="form-control" type="number" min="0" step="0.01" placeholder="0,00" value="${data?.amount || ''}">
            </div>
            <div class="form-group">
              <label class="form-label">Dia do Mês</label>
              <input id="tpl-day" class="form-control" type="number" min="1" max="31" placeholder="1–31" value="${data?.due_day || ''}">
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Categoria</label>
            <select id="tpl-cat" class="form-control">
              <option value="">Sem categoria</option>
              ${(type === 'expense' ? expCats : incCats).map(c => `<option value="${c.id}" ${data?.category_id === c.id ? 'selected' : ''}>${c.icon} ${c.name}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
          <button class="btn btn-primary" onclick="saveRecurring('${isEdit ? data.id : ''}')">
            ${isEdit ? 'Salvar' : 'Criar'}
          </button>
        </div>
      </div>
    </div>
  `);

  window._expCats = expCats;
  window._incCats = incCats;
}

function toggleTplAmount() {
  const kind = document.getElementById('tpl-kind').value;
  const wrap = document.getElementById('tpl-amount-wrap');
  wrap.style.opacity = kind === 'fixed' ? '1' : '0.4';
  wrap.style.pointerEvents = kind === 'fixed' ? 'auto' : 'none';
}

async function updateTplCats() {
  const type = document.getElementById('tpl-type').value;
  const cats = type === 'expense' ? window._expCats : window._incCats;
  const sel = document.getElementById('tpl-cat');
  sel.innerHTML = `<option value="">Sem categoria</option>` +
    cats.map(c => `<option value="${c.id}">${c.icon} ${c.name}</option>`).join('');
}

async function saveRecurring(id) {
  const name   = document.getElementById('tpl-name').value.trim();
  const type   = document.getElementById('tpl-type').value;
  const kind   = document.getElementById('tpl-kind').value;
  const amount = parseFloat(document.getElementById('tpl-amount').value) || 0;
  const day    = parseInt(document.getElementById('tpl-day').value);
  const cat    = document.getElementById('tpl-cat').value || null;

  if (!name) { toast('Informe o nome', 'error'); return; }
  if (!day || day < 1 || day > 31) { toast('Informe um dia válido (1–31)', 'error'); return; }

  const record = {
    name,
    transaction_type: type,
    kind,
    amount: kind === 'fixed' ? amount : 0,
    due_day: day,
    category_id: cat,
    active: true
  };

  if (id) {
    await db.templates.update(id, record);
    toast('Recorrência atualizada!', 'success');
  } else {
    await db.templates.add(record);
    toast('Recorrência criada!', 'success');
  }

  closeModal();
  renderRecurring();
}
