let _instMonth = new Date().getMonth() + 1;
let _instYear  = new Date().getFullYear();

async function renderInstallments(month, year) {
  if (month) _instMonth = month;
  if (year)  _instYear  = year;

  const content = document.getElementById('content');
  const [items, catsMap, instTx] = await Promise.all([
    db.installments.toArray(),
    getCategoriesMap(),
    db.transactions.filter(`transaction_type = 'installment' && month = ${_instMonth} && year = ${_instYear}`).toArray()
  ]);

  const txByInstId = {};
  instTx.forEach(t => { txByInstId[t.template_id] = t; });

  const active = items.filter(i => (i.paid_installments || 0) < (i.installments || 1));
  const instTxTotal   = instTx.reduce((s, t) => s + (t.amount || 0), 0);
  const instTxPaid    = instTx.filter(t => t.status === 'paid').reduce((s, t) => s + (t.amount || 0), 0);
  const instTxPending = instTxTotal - instTxPaid;

  content.innerHTML = `
    <div class="summary-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:20px">
      <div class="summary-card">
        <div class="label">Em aberto</div>
        <div class="value">${active.length}</div>
        <div class="sub">${items.length} total</div>
      </div>
      <div class="summary-card expense-card">
        <div class="label">Parcelas do mês</div>
        <div class="value">${fmt(instTxTotal)}</div>
        <div class="sub">${fmt(instTxPaid)} pago</div>
      </div>
      <div class="summary-card">
        <div class="label">A pagar</div>
        <div class="value" style="color:var(--warning)">${fmt(instTxPending)}</div>
      </div>
    </div>

    <div class="section-header" style="margin-bottom:16px">
      <div class="section-title">Parcelamentos (${items.length})</div>
      <button class="btn btn-primary btn-sm" onclick="openInstallmentModal()">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        Novo
      </button>
    </div>

    ${items.length === 0 ? `
      <div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none"><rect x="8" y="8" width="32" height="32" rx="4" stroke="currentColor" stroke-width="2"/><path d="M16 24h16M24 16v16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        <p>Nenhum parcelamento cadastrado</p>
      </div>` : `
      <div style="display:flex;flex-direction:column;gap:12px">
        ${items.map(i => installmentCard(i, catsMap, txByInstId[i.id])).join('')}
      </div>`
    }
  `;
}

function installmentCard(item, catsMap, tx) {
  const cat     = catsMap[item.category_id];
  const total   = item.installments || 1;
  const paid    = Math.min(item.paid_installments || 0, total);
  const pct     = Math.round((paid / total) * 100);
  const done    = paid >= total;
  const monthly = item.total_amount / total;
  const remaining = (total - paid) * monthly;
  const nextNum = paid + 1;
  const txPaid  = tx?.status === 'paid';

  return `
    <div class="card" style="opacity:${done ? 0.65 : 1}">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:14px">
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:1rem;margin-bottom:4px">${item.name}</div>
          <div style="font-size:.8rem;color:var(--text-muted);display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            ${cat ? catTag(cat) : ''}
            <span>${paid}/${total} parcelas</span>
            <span style="color:var(--expense);font-weight:600">${fmt(monthly)}/mês</span>
            ${item.due_day ? `<span>Vence dia ${item.due_day}</span>` : ''}
            ${done ? '<span class="badge badge-paid">Quitado</span>' : ''}
            ${!done && txPaid ? `<span class="badge badge-paid">Parcela ${nextNum} paga</span>` : ''}
          </div>
        </div>
        <div style="display:flex;gap:4px;flex-shrink:0">
          ${!done && !txPaid ? `
          <button class="btn btn-sm btn-primary" onclick="openPayInstallmentModal('${item.id}')">Pagar ${nextNum}ª</button>` : ''}
          ${!done && txPaid ? `
          <button class="btn btn-sm btn-ghost" style="color:var(--text-muted)" onclick="unpayInstallment('${item.id}')">Desfazer</button>` : ''}
          <button class="btn btn-sm btn-icon btn-ghost" onclick="editInstallment('${item.id}')" title="Editar">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M11.5 2.5a2.121 2.121 0 1 1 3 3L5 15H2v-3L11.5 2.5z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <button class="btn btn-sm btn-icon btn-danger" onclick="deleteInstallment('${item.id}')" title="Excluir">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M5 4V2h6v2M6 7v5M10 7v5M3 4l1 10h8l1-10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          </button>
        </div>
      </div>
      <div style="height:8px;background:var(--border);border-radius:4px;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:${done ? 'var(--income)' : 'var(--primary)'};border-radius:4px;transition:width .4s ease"></div>
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:6px;font-size:.78rem;color:var(--text-muted)">
        <span>${pct}% pago · Total ${fmt(item.total_amount)}</span>
        <span>${done ? 'Quitado!' : 'Restam ' + fmt(remaining)}</span>
      </div>
    </div>
  `;
}

async function editInstallment(id) {
  const data = await db.installments.get(id);
  openInstallmentModal(data);
}

async function openInstallmentModal(data = null) {
  const isEdit  = !!data;
  const catsMap = await getCategoriesMap();
  const expCats = Object.values(catsMap).filter(c => c.type === 'expense');

  showModal(`
    <div class="modal-backdrop">
      <div class="modal">
        <div class="modal-header">
          <div class="modal-title">${isEdit ? 'Editar Parcelamento' : 'Novo Parcelamento'}</div>
          <button class="btn btn-icon btn-ghost" onclick="closeModal()">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M12 4L4 12M4 4l8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          </button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label">Nome da compra</label>
            <input id="inst-name" class="form-control" placeholder="Ex: Sofá, iPhone..." value="${data?.name || ''}">
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Valor Total (R$)</label>
              <input id="inst-total" class="form-control" type="text" inputmode="decimal" placeholder="0,00" value="${data?.total_amount || ''}">
            </div>
            <div class="form-group">
              <label class="form-label">Nº de Parcelas</label>
              <input id="inst-count" class="form-control" type="number" min="1" max="360" placeholder="12" value="${data?.installments || ''}">
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Parcelas Pagas</label>
              <input id="inst-paid" class="form-control" type="number" min="0" placeholder="0" value="${data?.paid_installments ?? 0}">
            </div>
            <div class="form-group">
              <label class="form-label">Dia de Vencimento</label>
              <input id="inst-day" class="form-control" type="number" min="1" max="31" placeholder="1–31 (opcional)" value="${data?.due_day || ''}">
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Categoria</label>
            <select id="inst-cat" class="form-control">
              <option value="">Sem categoria</option>
              ${expCats.map(c => `<option value="${c.id}" ${data?.category_id === c.id ? 'selected' : ''}>${c.icon} ${c.name}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Observações</label>
            <input id="inst-notes" class="form-control" placeholder="Opcional" value="${data?.notes || ''}">
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
          <button class="btn btn-primary" onclick="saveInstallment('${isEdit ? data.id : ''}')">
            ${isEdit ? 'Salvar' : 'Criar'}
          </button>
        </div>
      </div>
    </div>
  `);
}

async function saveInstallment(id) {
  const name  = document.getElementById('inst-name').value.trim();
  const total = parseBRNumber(document.getElementById('inst-total').value);
  const count = parseInt(document.getElementById('inst-count').value)  || 0;
  const paid  = parseInt(document.getElementById('inst-paid').value)   || 0;
  const day   = parseInt(document.getElementById('inst-day').value)    || 0;
  const cat   = document.getElementById('inst-cat').value   || null;
  const notes = document.getElementById('inst-notes').value.trim();

  if (!name)     { toast('Informe o nome', 'error'); return; }
  if (total <= 0){ toast('Informe o valor total', 'error'); return; }
  if (count < 1) { toast('Informe o número de parcelas', 'error'); return; }

  const record = {
    name,
    total_amount:      total,
    installments:      count,
    paid_installments: Math.min(paid, count),
    due_day:           day > 0 ? day : null,
    category_id:       cat,
    notes
  };

  if (id) {
    await db.installments.update(id, record);
    toast('Parcelamento atualizado!', 'success');
  } else {
    record.start_month = _instMonth;
    record.start_year  = _instYear;
    await db.installments.add(record);
    toast('Parcelamento criado!', 'success');
    await generateInstallmentTransactions(_instMonth, _instYear);
  }

  closeModal();
  renderInstallments(_instMonth, _instYear);
}

async function unpayInstallment(id) {
  const item = await db.installments.get(id);
  if (!item) return;

  const oldPaid = item.paid_installments || 0;
  const newPaid = Math.max(oldPaid - 1, 0);

  if (item.start_month && item.start_year) {
    // Index-aware: revert ALL transactions whose parcel idx > newPaid so that
    // paid_installments and the set of paid tx stay in sync (F-01).
    const allTxForInst = await db.transactions.filter(
      `template_id = '${id}' && transaction_type = 'installment'`
    ).toArray();
    for (const tx of allTxForInst) {
      const idx = (tx.year - item.start_year) * 12 + (tx.month - item.start_month) + 1;
      if (idx > newPaid) {
        await db.transactions.update(tx.id, {
          status: 'pending', paid_date: null, cash_date: null, paid_amount: null,
        });
      }
    }
  } else {
    // Legacy (no start_*): only revert current month's transaction.
    const txList = await db.transactions.filter(
      `template_id = '${id}' && transaction_type = 'installment' && month = ${_instMonth} && year = ${_instYear}`
    ).toArray();
    if (txList.length > 0) {
      await db.transactions.update(txList[0].id, {
        status: 'pending', paid_date: null, cash_date: null, paid_amount: null,
      });
    }
  }

  await db.installments.update(id, { paid_installments: newPaid });
  clearUpcomingCache && clearUpcomingCache();
  toast('Pagamento desfeito');
  renderInstallments(_instMonth, _instYear);
}

async function deleteInstallment(id) {
  if (!confirm('Excluir este parcelamento?')) return;
  await db.installments.delete(id);
  toast('Parcelamento excluído');
  renderInstallments(_instMonth, _instYear);
}

// ── Pay installment modal (1 / N / all) ──────────────────────────────────────

async function openPayInstallmentModal(id) {
  const item = await db.installments.get(id);
  if (!item) return;

  const total     = item.installments || 1;
  const paid      = Math.min(item.paid_installments || 0, total);
  const remaining = total - paid;
  const monthly   = item.total_amount / total;

  if (remaining <= 0) { toast('Parcelamento já quitado', 'info'); return; }

  showModal(`
    <div class="modal-backdrop">
      <div class="modal">
        <div class="modal-header">
          <div class="modal-title">Pagar Parcelas</div>
          <button class="btn btn-icon btn-ghost" onclick="closeModal()">${icon('x', 16)}</button>
        </div>
        <div class="modal-body">
          <div style="background:var(--surface-2,#f7f7f5);border-radius:8px;padding:12px;margin-bottom:16px">
            <div style="font-weight:700;margin-bottom:4px">${item.name}</div>
            <div style="font-size:.82rem;color:var(--text-muted)">
              ${paid}/${total} pagas · ${fmt(monthly)}/mês · <strong>${remaining} restante(s)</strong>
            </div>
          </div>

          <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
            <button class="btn btn-sm btn-outline" style="flex:1;min-width:100px" onclick="_instSetN(1)">
              ${icon('check', 13)} Pagar 1ª
            </button>
            <button class="btn btn-sm btn-outline" style="flex:1;min-width:140px;font-size:.78rem" onclick="_instSetN(${remaining})">
              ${icon('zap', 13)} Quitar tudo (${remaining}x — ${fmt(monthly * remaining)})
            </button>
          </div>

          <div class="form-row">
            <div class="form-group" style="flex:1">
              <label class="form-label">Quantas parcelas pagar?</label>
              <input id="inst-pay-n" class="form-control" type="number" min="1" max="${remaining}" value="1"
                data-monthly="${monthly}" oninput="_instUpdatePayHelper()">
            </div>
            <div class="form-group" style="flex:1">
              <label class="form-label">Data do pagamento</label>
              <input id="inst-pay-date" class="form-control" type="date" value="${today()}" max="${today()}">
            </div>
          </div>

          <div id="inst-pay-helper" style="font-size:.88rem;color:var(--primary);font-weight:600;padding:4px 0 4px">
            Total a pagar: ${fmt(monthly)}
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
          <button class="btn btn-primary" style="background:var(--expense)" onclick="_doPayInstallmentN('${id}')">
            ${icon('check', 15)} Confirmar Pagamento
          </button>
        </div>
      </div>
    </div>
  `);
}

function _instSetN(n) {
  const input = document.getElementById('inst-pay-n');
  if (!input) return;
  const max = parseInt(input.max) || n;
  input.value = Math.min(n, max);
  _instUpdatePayHelper();
}

function _instUpdatePayHelper() {
  const input = document.getElementById('inst-pay-n');
  if (!input) return;
  const max     = parseInt(input.max) || 1;
  let n         = parseInt(input.value) || 1;
  n             = Math.max(1, Math.min(n, max));
  input.value   = n;
  const monthly = parseFloat(input.dataset.monthly || 0);
  const helper  = document.getElementById('inst-pay-helper');
  if (helper) helper.textContent = `Total a pagar: ${fmt(monthly * n)}`;
}

async function _doPayInstallmentN(id) {
  const input     = document.getElementById('inst-pay-n');
  const dateInput = document.getElementById('inst-pay-date');
  if (!input || !dateInput) return;

  const max     = parseInt(input.max) || 1;
  const n       = Math.max(1, Math.min(parseInt(input.value) || 1, max));
  const payDate = dateInput.value;

  if (!payDate) { toast('Informe a data do pagamento', 'error'); return; }
  if (payDate > today()) { toast('A data de pagamento não pode ser futura', 'error'); return; }

  await payInstallmentN(id, n, payDate);
}

async function payInstallmentN(id, n, payDate) {
  const item = await db.installments.get(id);
  if (!item) return;

  const total     = item.installments || 1;
  const oldPaid   = item.paid_installments || 0;
  const remaining = total - oldPaid;

  if (remaining <= 0) { toast('Parcelamento já quitado', 'info'); return; }

  n = Math.min(n, remaining);
  const newPaid = oldPaid + n;
  const monthly = item.total_amount / total;

  // 1. Update installment paid count
  await db.installments.update(id, { paid_installments: newPaid });

  // 2. Handle current month's transaction (create or mark paid)
  const currentTxList = await db.transactions.filter(
    `template_id = '${id}' && transaction_type = 'installment' && month = ${_instMonth} && year = ${_instYear}`
  ).toArray();

  if (currentTxList.length > 0) {
    const tx = currentTxList[0];
    if (tx.status !== 'paid') {
      await db.transactions.update(tx.id, {
        status: 'paid', paid_date: payDate, cash_date: payDate, paid_amount: monthly,
      });
    }
  } else {
    const day = Math.min(item.due_day || 1, new Date(_instYear, _instMonth, 0).getDate());
    const due = new Date(_instYear, _instMonth - 1, day);
    // NB-04: include parcel index in name when start_* is known
    const txIdx = (item.start_month && item.start_year)
      ? (_instYear - item.start_year) * 12 + (_instMonth - item.start_month) + 1
      : null;
    await db.transactions.add({
      template_id:      id,
      name:             txIdx !== null ? `${item.name} (${txIdx}/${total})` : item.name,
      category_id:      item.category_id || null,
      account_id:       item.account_id  || '',
      transaction_type: 'installment',
      kind:             'variable',
      amount:           monthly,
      due_date:         due.toISOString().split('T')[0],
      paid_date:        payDate,
      cash_date:        payDate,
      paid_amount:      monthly,
      status:           'paid',
      month:            _instMonth,
      year:             _instYear,
      notes:            item.notes || '',
    });
  }

  // 3. Mark any already-materialized future pending transactions that are now pre-paid.
  //    Only possible when start_month/start_year are set (index-aware installments).
  if (n > 1 && item.start_month && item.start_year) {
    const allTxForInst = await db.transactions.filter(
      `template_id = '${id}' && transaction_type = 'installment'`
    ).toArray();
    for (const tx of allTxForInst) {
      if (tx.month === _instMonth && tx.year === _instYear) continue; // already handled
      if (tx.status === 'paid') continue;
      const idx = (tx.year - item.start_year) * 12 + (tx.month - item.start_month) + 1;
      if (idx >= 1 && idx <= newPaid) {
        await db.transactions.update(tx.id, {
          status: 'paid', paid_date: payDate, cash_date: payDate, paid_amount: monthly,
        });
      }
    }
  }

  const done = newPaid >= total;
  clearUpcomingCache && clearUpcomingCache();
  toast(done ? `"${item.name}" quitado!` : `${n} parcela(s) paga(s)! (${newPaid}/${total})`, 'success');
  closeModal();
  renderInstallments(_instMonth, _instYear);
}
