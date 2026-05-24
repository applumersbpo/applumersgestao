function initFAB() {
  document.getElementById('fab').addEventListener('click', openQuickAdd);
}

async function openQuickAdd(type = 'expense') {
  const catsMap = await getCategoriesMap();
  const cats = Object.values(catsMap);
  const today = new Date().toISOString().split('T')[0];

  const catOptions = (t) => cats
    .filter(c => c.type === t)
    .map(c => `<option value="${c.id}">${c.icon || ''} ${c.name}</option>`)
    .join('');

  showModal(`
    <div class="modal-backdrop">
      <div class="modal">
        <div class="modal-header">
          <div class="modal-title">Lançamento rápido</div>
          <button class="btn btn-icon btn-ghost" onclick="closeModal()"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M12 4L4 12M4 4l8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>
        </div>
        <div class="modal-body">

          <div style="display:flex;background:var(--surface);border-radius:var(--radius-sm);padding:4px;margin-bottom:16px">
            <button id="fab-type-expense" onclick="fabSetType('expense')"
              style="flex:1;padding:8px;border-radius:6px;font-size:.85rem;font-weight:600;transition:all .15s;
                background:${type === 'expense' ? 'var(--expense)' : 'transparent'};
                color:${type === 'expense' ? '#fff' : 'var(--text-muted)'}">
              Despesa
            </button>
            <button id="fab-type-income" onclick="fabSetType('income')"
              style="flex:1;padding:8px;border-radius:6px;font-size:.85rem;font-weight:600;transition:all .15s;
                background:${type === 'income' ? 'var(--income)' : 'transparent'};
                color:${type === 'income' ? '#fff' : 'var(--text-muted)'}">
              Receita
            </button>
          </div>

          <input type="hidden" id="fab-type" value="${type}">

          <div class="form-group">
            <label class="form-label">Descrição</label>
            <input id="fab-name" class="form-control" placeholder="Ex: Almoço, Salário...">
          </div>
          <div class="form-group">
            <label class="form-label">Valor (R$)</label>
            <input id="fab-amount" class="form-control" type="text" inputmode="decimal" placeholder="0,00">
          </div>
          <div class="form-group">
            <label class="form-label">Categoria</label>
            <select id="fab-cat" class="form-control">
              <option value="">Sem categoria</option>
              ${catOptions(type)}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Data</label>
            <input id="fab-date" class="form-control" type="date" value="${today}">
          </div>

        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
          <button class="btn btn-primary" onclick="saveQuickAdd()">Salvar</button>
        </div>
      </div>
    </div>
  `);

  document.getElementById('fab-name').focus();
}

async function fabSetType(type) {
  const catsMap = await getCategoriesMap();
  const cats = Object.values(catsMap).filter(c => c.type === type);

  document.getElementById('fab-type').value = type;

  const expBtn = document.getElementById('fab-type-expense');
  const incBtn = document.getElementById('fab-type-income');
  expBtn.style.background = type === 'expense' ? 'var(--expense)' : 'transparent';
  expBtn.style.color      = type === 'expense' ? '#fff' : 'var(--text-muted)';
  incBtn.style.background = type === 'income'  ? 'var(--income)'  : 'transparent';
  incBtn.style.color      = type === 'income'  ? '#fff' : 'var(--text-muted)';

  const sel = document.getElementById('fab-cat');
  sel.innerHTML = '<option value="">Sem categoria</option>' +
    cats.map(c => `<option value="${c.id}">${c.icon || ''} ${c.name}</option>`).join('');
}

async function saveQuickAdd() {
  const name   = document.getElementById('fab-name').value.trim();
  const amount = parseBRNumber(document.getElementById('fab-amount').value);
  const type   = document.getElementById('fab-type').value;
  const catId  = document.getElementById('fab-cat').value || null;
  const date   = document.getElementById('fab-date').value;

  if (!name)   { toast('Informe a descrição', 'error'); return; }
  if (!amount) { toast('Informe o valor', 'error'); return; }
  if (!date)   { toast('Informe a data', 'error'); return; }

  const d = new Date(date + 'T12:00:00');
  const month = d.getMonth() + 1;
  const year  = d.getFullYear();

  await db.transactions.add({
    template_id:      null,
    name,
    category_id:      catId,
    transaction_type: type,
    kind:             'fixed',
    amount,
    due_date:         date,
    paid_date:        date,
    status:           'paid',
    month,
    year,
    notes:            '',
  });

  closeModal();
  toast('Lançamento salvo!', 'success');
  await app.render();
}
