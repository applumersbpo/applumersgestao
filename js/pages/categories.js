async function renderCategories() {
  const content = document.getElementById('content');
  const categories = await db.categories.toArray();

  const expenses = categories.filter(c => c.type === 'expense');
  const incomes  = categories.filter(c => c.type === 'income');

  const existingNames = new Set(categories.map(c => c.name.toLowerCase().trim()));
  const missingSuggestions = SUGGESTED_CATEGORIES.filter(s => !existingNames.has(s.name.toLowerCase().trim()));
  const missingExpenses = missingSuggestions.filter(s => s.type === 'expense');
  const missingIncomes  = missingSuggestions.filter(s => s.type === 'income');

  content.innerHTML = `
    <div class="section-header" style="margin-bottom:20px">
      <div class="section-title">Categorias</div>
      <button class="btn btn-primary btn-sm" onclick="openCategoryModal()">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        Nova Categoria
      </button>
    </div>

    ${missingSuggestions.length > 0 ? `
    <div class="card" style="margin-bottom:24px;border-color:var(--primary)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px">
        <div>
          <div class="card-title" style="margin-bottom:2px">Sugestões para adicionar</div>
          <p style="font-size:.83rem;color:var(--text-muted)">${missingSuggestions.length} categoria(s) que você ainda não tem. Clique para adicionar.</p>
        </div>
        <button class="btn btn-primary btn-sm" onclick="addAllSuggestions()">Adicionar todas</button>
      </div>
      ${missingExpenses.length > 0 ? `
      <div class="card-title" style="margin-bottom:8px;margin-top:4px">Despesas</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px">
        ${missingExpenses.map(s => `
          <button class="btn btn-sm" style="background:${s.color}22;color:${s.color};border:1px solid ${s.color}44" onclick="quickAddCategory('${s.name}','${s.type}','${s.color}','${s.icon}')">
            ${s.icon} ${s.name}
          </button>
        `).join('')}
      </div>` : ''}
      ${missingIncomes.length > 0 ? `
      <div class="card-title" style="margin-bottom:8px">Receitas</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px">
        ${missingIncomes.map(s => `
          <button class="btn btn-sm" style="background:${s.color}22;color:${s.color};border:1px solid ${s.color}44" onclick="quickAddCategory('${s.name}','${s.type}','${s.color}','${s.icon}')">
            ${s.icon} ${s.name}
          </button>
        `).join('')}
      </div>` : ''}
    </div>` : ''}

    <div style="display:grid;gap:24px">
      <div class="card">
        <div class="card-title">Despesas (${expenses.length})</div>
        ${expenses.length === 0 ? '<p style="color:var(--text-muted);font-size:.9rem;margin-top:8px">Nenhuma categoria de despesa</p>' : `
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:12px" id="cat-list">
          ${expenses.map(c => catRow(c)).join('')}
        </div>`}
      </div>

      <div class="card">
        <div class="card-title">Receitas (${incomes.length})</div>
        ${incomes.length === 0 ? '<p style="color:var(--text-muted);font-size:.9rem;margin-top:8px">Nenhuma categoria de receita</p>' : `
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:12px" id="cat-list-income">
          ${incomes.map(c => catRow(c)).join('')}
        </div>`}
      </div>
    </div>
  `;

  bindCategoryActions();
}

function catRow(c) {
  return `
    <div class="transaction-item" style="border-radius:8px;border:1px solid var(--border)">
      <div class="t-icon" style="background:${c.color}22;color:${c.color};font-size:1.1rem">
        ${c.icon || c.name[0]}
      </div>
      <div class="t-info">
        <div class="t-name">${c.name}</div>
      </div>
      <div class="t-actions" style="display:flex">
        <button class="btn btn-sm btn-icon btn-ghost" data-action="edit-cat" data-id="${c.id}">✎</button>
        <button class="btn btn-sm btn-icon btn-danger" data-action="delete-cat" data-id="${c.id}">✕</button>
      </div>
    </div>
  `;
}

function bindCategoryActions() {
  document.addEventListener('click', async e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;

    if (btn.dataset.action === 'edit-cat') {
      const cat = await db.categories.get(btn.dataset.id);
      openCategoryModal(cat);
    }
    if (btn.dataset.action === 'delete-cat') {
      const id = btn.dataset.id;
      const used = await db.transactions.filter(`category_id = '${id}'`).count();
      if (used > 0) {
        toast(`Esta categoria está em uso em ${used} transação(ões)`, 'error');
        return;
      }
      if (!confirm('Excluir esta categoria?')) return;
      await db.categories.delete(id);
      clearCatsCache();
      toast('Categoria excluída');
      renderCategories();
    }
  }, { once: false });
}

async function openCategoryModal(data = null) {
  const isEdit = !!data;
  const selectedColor = data?.color || COLORS[0];

  showModal(`
    <div class="modal-backdrop">
      <div class="modal">
        <div class="modal-header">
          <div class="modal-title">${isEdit ? 'Editar Categoria' : 'Nova Categoria'}</div>
          <button class="btn btn-icon btn-ghost" onclick="closeModal()">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label">Nome</label>
            <input id="cat-name" class="form-control" placeholder="Ex: Moradia" value="${data?.name || ''}">
          </div>
          <div class="form-group">
            <label class="form-label">Emoji / Ícone</label>
            <input id="cat-icon" class="form-control" placeholder="Ex: 🏠" value="${data?.icon || ''}">
          </div>
          <div class="form-group">
            <label class="form-label">Tipo</label>
            <select id="cat-type" class="form-control">
              <option value="expense" ${data?.type === 'expense' ? 'selected' : ''}>Despesa</option>
              <option value="income" ${data?.type === 'income' ? 'selected' : ''}>Receita</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Cor</label>
            ${colorPicker(selectedColor, 'cat-color')}
            <input type="hidden" id="cat-color" value="${selectedColor}">
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
          <button class="btn btn-primary" onclick="saveCategory(${isEdit ? data.id : 'null'})">
            ${isEdit ? 'Salvar' : 'Criar'}
          </button>
        </div>
      </div>
    </div>
  `);

  const modal = document.querySelector('.modal');
  bindColorPicker(modal, 'cat-color');
}

async function quickAddCategory(name, type, color, icon) {
  await db.categories.add({ name, type, color, icon });
  clearCatsCache();
  toast(`"${name}" adicionada!`, 'success');
  renderCategories();
}

async function addAllSuggestions() {
  const existing = await db.categories.toArray();
  const existingNames = new Set(existing.map(c => c.name.toLowerCase().trim()));
  const toAdd = SUGGESTED_CATEGORIES.filter(s => !existingNames.has(s.name.toLowerCase().trim()));
  if (toAdd.length === 0) { toast('Nenhuma sugestão nova para adicionar'); return; }
  await db.categories.bulkAdd(toAdd);
  clearCatsCache();
  toast(`${toAdd.length} categorias adicionadas!`, 'success');
  renderCategories();
}

async function saveCategory(id) {
  const name  = document.getElementById('cat-name').value.trim();
  const icon  = document.getElementById('cat-icon').value.trim();
  const type  = document.getElementById('cat-type').value;
  const color = document.getElementById('cat-color').value;

  if (!name) { toast('Informe o nome da categoria', 'error'); return; }

  const record = { name, icon, type, color };

  if (id) {
    await db.categories.update(id, record);
    toast('Categoria atualizada!', 'success');
  } else {
    await db.categories.add(record);
    toast('Categoria criada!', 'success');
  }

  clearCatsCache();
  closeModal();
  renderCategories();
}
