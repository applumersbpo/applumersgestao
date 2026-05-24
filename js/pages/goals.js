async function renderGoals() {
  const content = document.getElementById('content');
  const goals   = await db.goals.toArray();

  const totalTarget  = goals.reduce((s, g) => s + (g.target_amount  || 0), 0);
  const totalCurrent = goals.reduce((s, g) => s + (g.current_amount || 0), 0);
  const completed    = goals.filter(g => (g.current_amount || 0) >= (g.target_amount || 0) && g.target_amount > 0).length;

  content.innerHTML = `
    <div class="summary-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:20px">
      <div class="summary-card">
        <div class="label">Metas</div>
        <div class="value">${goals.length}</div>
        <div class="sub">${completed} concluída${completed !== 1 ? 's' : ''}</div>
      </div>
      <div class="summary-card income-card">
        <div class="label">Acumulado</div>
        <div class="value">${fmt(totalCurrent)}</div>
      </div>
      <div class="summary-card">
        <div class="label">Objetivo Total</div>
        <div class="value">${fmt(totalTarget)}</div>
      </div>
    </div>

    <div class="section-header" style="margin-bottom:16px">
      <div class="section-title">Metas Financeiras (${goals.length})</div>
      <button class="btn btn-primary btn-sm" onclick="openGoalModal()">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        Nova Meta
      </button>
    </div>

    ${goals.length === 0 ? `
      <div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="16" stroke="currentColor" stroke-width="2"/><circle cx="24" cy="24" r="6" stroke="currentColor" stroke-width="2"/><path d="M24 8v4M24 36v4M8 24h4M36 24h4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        <p>Nenhuma meta cadastrada</p>
      </div>` : `
      <div style="display:grid;gap:16px">
        ${goals.map(goalCard).join('')}
      </div>`
    }
  `;
}

function goalCard(g) {
  const target  = g.target_amount  || 0;
  const current = g.current_amount || 0;
  const pct     = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
  const done    = current >= target && target > 0;
  const remaining = Math.max(0, target - current);
  const color   = g.color || '#6366f1';

  return `
    <div class="card">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
        <div style="display:flex;align-items:center;gap:12px;flex:1;min-width:0">
          <div style="width:48px;height:48px;border-radius:14px;background:${color}22;color:${color};display:flex;align-items:center;justify-content:center;font-size:1.4rem;flex-shrink:0">
            ${g.icon || '🎯'}
          </div>
          <div style="flex:1;min-width:0">
            <div style="font-weight:700;font-size:.95rem;margin-bottom:2px">${g.name}</div>
            ${g.description ? `<div style="font-size:.8rem;color:var(--text-muted)">${g.description}</div>` : ''}
            ${g.deadline ? `<div style="font-size:.78rem;color:var(--text-muted);margin-top:2px">Prazo: ${fmtDate(g.deadline)}</div>` : ''}
          </div>
        </div>
        <div style="display:flex;gap:4px;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end">
          ${!done ? `<button class="btn btn-sm" style="background:${color}22;color:${color};font-weight:600;border-radius:var(--radius-sm)" onclick="openUpdateGoalModal('${g.id}')">Atualizar</button>` : ''}
          <button class="btn btn-sm btn-icon btn-ghost" onclick="editGoal('${g.id}')" title="Editar">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M11.5 2.5a2.121 2.121 0 1 1 3 3L5 15H2v-3L11.5 2.5z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <button class="btn btn-sm btn-icon btn-danger" onclick="deleteGoal('${g.id}')" title="Excluir">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M5 4V2h6v2M6 7v5M10 7v5M3 4l1 10h8l1-10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          </button>
        </div>
      </div>

      <div style="margin-top:16px">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px">
          <span style="font-weight:700;font-size:1.1rem;color:${color}">${fmt(current)}</span>
          <span style="font-size:.82rem;color:var(--text-muted)">de ${fmt(target)}</span>
        </div>
        <div style="height:10px;background:var(--border);border-radius:5px;overflow:hidden">
          <div style="height:100%;width:${pct}%;background:${color};border-radius:5px;transition:width .4s ease"></div>
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:6px;font-size:.78rem;color:var(--text-muted)">
          <span>${pct}% atingido</span>
          ${done ? '<span class="badge badge-paid">Concluída!</span>' : `<span>Faltam ${fmt(remaining)}</span>`}
        </div>
      </div>
    </div>
  `;
}

async function editGoal(id) {
  const data = await db.goals.get(id);
  openGoalModal(data);
}

async function openGoalModal(data = null) {
  const isEdit       = !!data;
  const defaultColor = data?.color || '#6366f1';

  showModal(`
    <div class="modal-backdrop">
      <div class="modal">
        <div class="modal-header">
          <div class="modal-title">${isEdit ? 'Editar Meta' : 'Nova Meta'}</div>
          <button class="btn btn-icon btn-ghost" onclick="closeModal()">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M12 4L4 12M4 4l8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          </button>
        </div>
        <div class="modal-body">
          <div class="form-row">
            <div class="form-group" style="max-width:80px">
              <label class="form-label">Ícone</label>
              <input id="goal-icon" class="form-control" placeholder="🎯" maxlength="2" value="${data?.icon || ''}">
            </div>
            <div class="form-group" style="flex:1">
              <label class="form-label">Nome da Meta</label>
              <input id="goal-name" class="form-control" placeholder="Ex: Viagem, Carro..." value="${data?.name || ''}">
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Descrição (opcional)</label>
            <input id="goal-desc" class="form-control" placeholder="Ex: Férias na Europa em 2027" value="${data?.description || ''}">
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Valor Objetivo (R$)</label>
              <input id="goal-target" class="form-control" type="text" inputmode="decimal" placeholder="0,00" value="${data?.target_amount || ''}">
            </div>
            <div class="form-group">
              <label class="form-label">Valor Atual (R$)</label>
              <input id="goal-current" class="form-control" type="text" inputmode="decimal" placeholder="0,00" value="${data?.current_amount || 0}">
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Prazo (opcional)</label>
            <input id="goal-deadline" class="form-control" type="date" value="${data?.deadline ? data.deadline.split('T')[0] : ''}">
          </div>
          <div class="form-group">
            <label class="form-label">Cor</label>
            <input type="hidden" id="goal-color" value="${defaultColor}">
            ${colorPicker(defaultColor, 'goal-color')}
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
          <button class="btn btn-primary" onclick="saveGoal('${isEdit ? data.id : ''}')">
            ${isEdit ? 'Salvar' : 'Criar'}
          </button>
        </div>
      </div>
    </div>
  `);

  bindColorPicker(document.getElementById('modal-container'), 'goal-color');
}

async function saveGoal(id) {
  const name    = document.getElementById('goal-name').value.trim();
  const icon    = document.getElementById('goal-icon').value.trim();
  const desc    = document.getElementById('goal-desc').value.trim();
  const target  = parseBRNumber(document.getElementById('goal-target').value);
  const current = parseBRNumber(document.getElementById('goal-current').value);
  const deadline= document.getElementById('goal-deadline').value || null;
  const color   = document.getElementById('goal-color').value   || '#6366f1';

  if (!name)     { toast('Informe o nome da meta', 'error'); return; }
  if (target <= 0){ toast('Informe o valor objetivo', 'error'); return; }

  const record = {
    name,
    icon,
    description:    desc,
    target_amount:  target,
    current_amount: Math.min(current, target),
    deadline,
    color
  };

  if (id) {
    await db.goals.update(id, record);
    toast('Meta atualizada!', 'success');
  } else {
    await db.goals.add(record);
    toast('Meta criada!', 'success');
  }

  closeModal();
  renderGoals();
}

async function openUpdateGoalModal(id) {
  const goal = await db.goals.get(id);
  if (!goal) return;
  const color = goal.color || '#6366f1';

  showModal(`
    <div class="modal-backdrop">
      <div class="modal">
        <div class="modal-header">
          <div class="modal-title">Atualizar "${goal.name}"</div>
          <button class="btn btn-icon btn-ghost" onclick="closeModal()">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M12 4L4 12M4 4l8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          </button>
        </div>
        <div class="modal-body">
          <div style="margin-bottom:20px">
            <div style="font-size:.83rem;color:var(--text-muted);margin-bottom:4px">Progresso atual</div>
            <div style="font-weight:700;font-size:1.15rem;color:${color}">${fmt(goal.current_amount || 0)}
              <span style="font-size:.85rem;font-weight:400;color:var(--text-muted)"> de ${fmt(goal.target_amount)}</span>
            </div>
            <div style="height:8px;background:var(--border);border-radius:4px;overflow:hidden;margin-top:10px">
              <div style="height:100%;width:${Math.min(100,Math.round(((goal.current_amount||0)/goal.target_amount)*100))}%;background:${color};border-radius:4px"></div>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Novo valor acumulado (R$)</label>
            <input id="goal-update-val" class="form-control" type="text" inputmode="decimal" placeholder="0,00" value="${goal.current_amount || 0}">
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
          <button class="btn btn-primary" onclick="updateGoalAmount('${id}')">Salvar</button>
        </div>
      </div>
    </div>
  `);
}

async function updateGoalAmount(id) {
  const current = parseBRNumber(document.getElementById('goal-update-val').value);
  const goal    = await db.goals.get(id);
  if (!goal) return;

  await db.goals.update(id, { current_amount: Math.min(current, goal.target_amount) });
  const done = current >= goal.target_amount;
  toast(done ? `Meta "${goal.name}" atingida! 🎉` : 'Meta atualizada!', 'success');
  closeModal();
  renderGoals();
}

async function deleteGoal(id) {
  if (!confirm('Excluir esta meta?')) return;
  await db.goals.delete(id);
  toast('Meta excluída');
  renderGoals();
}
