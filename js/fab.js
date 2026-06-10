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
          <button class="btn btn-icon btn-ghost" onclick="closeModal()">${icon('x', 16)}</button>
        </div>
        <div class="modal-body">

          <div style="display:flex;background:var(--surface);border-radius:var(--radius-sm);padding:4px;margin-bottom:16px;gap:4px">
            <button id="fab-type-expense" onclick="fabSetType('expense')"
              style="flex:1;padding:8px;border-radius:6px;font-size:.85rem;font-weight:600;transition:all .15s;display:flex;align-items:center;justify-content:center;gap:6px;
                background:${type === 'expense' ? 'var(--expense)' : 'var(--expense-light)'};
                color:${type === 'expense' ? '#fff' : 'var(--expense-text)'}">
              ${icon('trending-down', 15)} Despesa
            </button>
            <button id="fab-type-income" onclick="fabSetType('income')"
              style="flex:1;padding:8px;border-radius:6px;font-size:.85rem;font-weight:600;transition:all .15s;display:flex;align-items:center;justify-content:center;gap:6px;
                background:${type === 'income' ? 'var(--income)' : 'var(--income-light)'};
                color:${type === 'income' ? '#fff' : 'var(--income-text)'}">
              ${icon('trending-up', 15)} Receita
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
          <div class="form-row">
            <div class="form-group" style="flex:1">
              <label class="form-label">Data de competência <span class="field-info" title="Data de competência: referência contábil para relatórios; não influencia o caixa">ℹ️</span></label>
              <input id="fab-competence" class="form-control" type="date" value="${today}">
            </div>
            <div class="form-group" style="flex:1">
              <label class="form-label">Data de caixa <span class="field-info" title="Data de caixa: data em que o dinheiro entrou/saiu">ℹ️</span></label>
              <input id="fab-cash" class="form-control" type="date" value="">
            </div>
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
  expBtn.style.background = type === 'expense' ? 'var(--expense)' : 'var(--expense-light)';
  expBtn.style.color      = type === 'expense' ? '#fff' : 'var(--expense-text)';
  incBtn.style.background = type === 'income'  ? 'var(--income)'  : 'var(--income-light)';
  incBtn.style.color      = type === 'income'  ? '#fff' : 'var(--income-text)';

  const sel = document.getElementById('fab-cat');
  sel.innerHTML = '<option value="">Sem categoria</option>' +
    cats.map(c => `<option value="${c.id}">${c.icon || ''} ${c.name}</option>`).join('');
}

async function saveQuickAdd() {
  const name   = document.getElementById('fab-name').value.trim();
  const amount = parseBRNumber(document.getElementById('fab-amount').value);
  const type   = document.getElementById('fab-type').value;
  const catId  = document.getElementById('fab-cat').value || null;
  const date = (document.getElementById('fab-competence') ? document.getElementById('fab-competence').value : '') || today;

  if (!name)   { toast('Informe a descrição', 'error'); return; }
  if (!amount || amount <= 0) { toast('Informe o valor', 'error'); return; }
  if (!catId)  { toast('Informe a categoria', 'error'); return; }
  // competence date is required for reporting; default to provided date or today
  const competence = (document.getElementById('fab-competence') ? document.getElementById('fab-competence').value : '') || date;
  const cashDate = (document.getElementById('fab-cash') ? document.getElementById('fab-cash').value : '') || null;

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
    due_date:         competence,
    competence_date:  competence,
    cash_date:        cashDate,
    paid_date:        cashDate || null,
    status:           cashDate ? 'paid' : 'pending',
    month,
    year,
    notes:            '',
  });

  closeModal();
  toast('Lançamento salvo!', 'success');
  await app.render();
}
