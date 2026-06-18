function initFAB() {
  document.getElementById('fab').addEventListener('click', () => openQuickAdd());
}

async function openQuickAdd(type = 'expense') {
  const catsMap = await getCategoriesMap();
  const cats = Object.values(catsMap);
  const today = new Date().toISOString().split('T')[0];

  const catOptions = (t) => cats
    .filter(c => c.type === t)
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }))
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
            <label id="fab-amount-label" class="form-label">Valor (R$)</label>
            <input id="fab-amount" class="form-control" type="text" inputmode="decimal" placeholder="0,00" oninput="_fabUpdateParcelHelper()">
          </div>

          <div id="fab-parcel-wrap" style="display:${type === 'income' ? 'none' : 'block'}">
            <div class="form-group">
              <label class="form-label" style="display:flex;align-items:center;gap:8px;cursor:pointer">
                <input type="checkbox" id="fab-parcel-cb" onchange="_fabToggleParcel()">
                Parcelar esta despesa
              </label>
            </div>
            <div id="fab-parcel-block" style="display:none;border:1px solid var(--border);border-radius:8px;padding:12px 12px 4px;margin-bottom:4px;background:var(--surface-2,#f7f7f5)">
              <div class="form-row">
                <div class="form-group" style="flex:1">
                  <label class="form-label">Nº de parcelas</label>
                  <input id="fab-parcel-count" class="form-control" type="number" min="2" max="360" placeholder="Ex: 10" oninput="_fabUpdateParcelHelper()">
                </div>
                <div class="form-group" style="flex:1">
                  <label class="form-label">Dia de vencimento</label>
                  <input id="fab-parcel-day" class="form-control" type="number" min="1" max="31" placeholder="1–31">
                </div>
              </div>
              <div id="fab-parcel-helper" style="font-size:.82rem;min-height:20px;padding-bottom:8px"></div>
            </div>
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
              <label class="form-label">Data de vencimento <span class="field-info" title="Data de vencimento: data em que o valor deve ser pago ou recebido">ℹ️</span></label>
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
  const cats = Object.values(catsMap).filter(c => c.type === type)
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }));

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

  // Toggle parcelamento block: only available in expense mode
  const parcelWrap = document.getElementById('fab-parcel-wrap');
  const parcelCb   = document.getElementById('fab-parcel-cb');
  if (parcelWrap) parcelWrap.style.display = type === 'income' ? 'none' : 'block';
  if (type === 'income' && parcelCb && parcelCb.checked) {
    parcelCb.checked = false;
    _fabToggleParcel();
  }
}

function _fabToggleParcel() {
  const cb       = document.getElementById('fab-parcel-cb');
  const block    = document.getElementById('fab-parcel-block');
  const amtLabel = document.getElementById('fab-amount-label');
  if (!cb || !block) return;
  block.style.display = cb.checked ? 'block' : 'none';
  if (amtLabel) amtLabel.textContent = cb.checked ? 'Valor da parcela (R$)' : 'Valor (R$)';
  if (cb.checked) {
    // Pre-populate due_day from vencimento date field if available
    const cashDate = document.getElementById('fab-cash')?.value || '';
    const dayInput = document.getElementById('fab-parcel-day');
    if (dayInput && cashDate && !dayInput.value) {
      const day = parseInt(cashDate.split('-')[2]);
      if (day) dayInput.value = day;
    }
    _fabUpdateParcelHelper();
  }
}

function _fabUpdateParcelHelper() {
  if (!document.getElementById('fab-parcel-cb')?.checked) return;
  const amt    = parseBRNumber(document.getElementById('fab-amount')?.value || '0');
  const count  = parseInt(document.getElementById('fab-parcel-count')?.value) || 0;
  const helper = document.getElementById('fab-parcel-helper');
  if (!helper) return;
  if (count >= 2 && amt > 0) {
    helper.innerHTML = `<strong style="color:var(--primary)">${count}x de ${fmt(amt)} = ${fmt(amt * count)} total</strong>`;
  } else if (count === 1) {
    helper.innerHTML = `<span style="color:var(--expense)">Mínimo 2 parcelas</span>`;
  } else if (count >= 2 && amt <= 0) {
    helper.innerHTML = `<span style="color:var(--text-muted)">Informe o valor da parcela acima</span>`;
  } else {
    helper.innerHTML = '';
  }
}

async function saveQuickAdd() {
  const name   = document.getElementById('fab-name').value.trim();
  const amount = parseBRNumber(document.getElementById('fab-amount').value);
  const type   = document.getElementById('fab-type').value;
  const catId  = document.getElementById('fab-cat').value || null;
  const date = (document.getElementById('fab-competence') ? document.getElementById('fab-competence').value : '') || today();

  if (!name)   { toast('Informe a descrição', 'error'); return; }
  if (!amount || amount <= 0) { toast('Informe o valor', 'error'); return; }
  if (!catId)  { toast('Informe a categoria', 'error'); return; }
  const competence = date;
  const cashDate = (document.getElementById('fab-cash') ? document.getElementById('fab-cash').value : '') || null;

  const d = new Date(date + 'T12:00:00');
  const month = d.getMonth() + 1;
  const year  = d.getFullYear();

  // ── Parcel mode: only for expenses ──
  const isParcelMode = type === 'expense' && document.getElementById('fab-parcel-cb')?.checked;
  if (isParcelMode) {
    const parcelCount = parseInt(document.getElementById('fab-parcel-count')?.value) || 0;
    const parcelDay   = parseInt(document.getElementById('fab-parcel-day')?.value)   || 0;
    if (parcelCount < 2) { toast('Informe pelo menos 2 parcelas', 'error'); return; }

    // Determine due_day: explicit field → day from vencimento date → day from competence → 1
    const cashDay     = parseInt((cashDate || competence || '').split('-')[2]) || 1;
    const instDueDay  = parcelDay || cashDay;

    const instRecord = {
      name,
      total_amount:      amount * parcelCount,
      installments:      parcelCount,
      paid_installments: cashDate ? 1 : 0,
      due_day:           instDueDay,
      category_id:       catId,
      notes:             '',
      account_id:        '',
      start_month:       month,
      start_year:        year,
    };
    const instId = await db.installments.add(instRecord);
    await generateAllInstallmentTransactions(instId);

    // If cashDate is set, mark the 1st installment of this month as paid
    if (cashDate) {
      const txList = await db.transactions.filter(
        `template_id = '${instId}' && transaction_type = 'installment' && month = ${month} && year = ${year}`
      ).toArray();
      if (txList.length > 0) {
        await db.transactions.update(txList[0].id, {
          status: 'paid', paid_date: cashDate, cash_date: cashDate, paid_amount: amount,
        });
      }
    }

    toast('Parcelamento criado!', 'success');
    closeModal();
    await app.render();
    return;
  }

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
