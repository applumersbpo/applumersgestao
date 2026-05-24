async function renderDashboard(month, year) {
  window._currentPeriod = { month, year };
  const content = document.getElementById('content');

  const [transactions, catsMap] = await Promise.all([
    db.transactions.filter(`month = ${month} && year = ${year}`).toArray(),
    getCategoriesMap()
  ]);

  const expenses   = transactions.filter(t => t.transaction_type === 'expense');
  const generalExp = transactions.filter(t => t.transaction_type === 'general' || t.transaction_type === 'daily');
  const incomes    = transactions.filter(t => t.transaction_type === 'income');
  const instTx     = transactions.filter(t => t.transaction_type === 'installment');

  const totalIncome   = incomes.reduce((s, t) => s + (t.amount || 0), 0);
  const totalExpense  = expenses.reduce((s, t) => s + (t.amount || 0), 0);
  const totalGeneral  = generalExp.reduce((s, t) => s + (t.amount || 0), 0);
  const instTotal     = instTx.reduce((s, t) => s + (t.amount || 0), 0);
  const instPaid      = instTx.filter(t => t.status === 'paid').reduce((s, t) => s + (t.amount || 0), 0);

  const received  = incomes.filter(t => t.status === 'paid').reduce((s, t) => s + (t.amount || 0), 0);
  const expPaid   = expenses.filter(t => t.status === 'paid').reduce((s, t) => s + (t.amount || 0), 0);
  const expPending = totalExpense - expPaid;

  const recvPct = totalIncome > 0 ? Math.round((received / totalIncome) * 100) : 0;
  const expPct  = totalExpense > 0 ? Math.round((expPaid / totalExpense) * 100) : 0;

  const saldoProjetado = totalIncome - totalExpense - instTotal - totalGeneral;
  const saldoReal      = received - expPaid - instPaid - totalGeneral;

  const projClass = saldoProjetado >= 0 ? 'balance-positive' : 'balance-negative';
  const realClass  = saldoReal >= 0 ? 'balance-positive' : 'balance-negative';

  const overdue   = expenses.filter(t => isOverdue(t.due_date, t.status));
  const upcoming  = expenses.filter(t => {
    if (t.status === 'paid') return false;
    const diff = (new Date(t.due_date) - new Date()) / 86400000;
    return diff >= 0 && diff <= 7;
  });

  const _uid = (pb.authStore.model || pb.authStore.record)?.id || 'local';
  const revenueGoal = parseFloat(localStorage.getItem(`revenue_goal_${_uid}_${year}_${month}`) || '0');
  const rawGoalPct  = revenueGoal > 0 ? (totalIncome / revenueGoal) * 100 : 0;
  const goalPct     = Math.min(Math.round(rawGoalPct), 100);
  const goalReached = revenueGoal > 0 && totalIncome >= revenueGoal;

  const PHRASES = [
    "Cada real faturado é um passo rumo à liberdade financeira.",
    "Foco, consistência e disciplina constroem impérios.",
    "O sucesso é a soma de pequenas ações repetidas todos os dias.",
    "Você está construindo algo grande. Continue.",
    "Dinheiro é resultado. Valor entregue é a causa.",
    "Grandes resultados exigem grandes comprometimentos.",
    "Hoje é uma nova chance de superar o seu próprio recorde.",
    "A meta de hoje é o mínimo de amanhã.",
    "Trabalhe enquanto eles dormem. Aprenda enquanto eles relaxam.",
    "Seu esforço de hoje é o seu legado de amanhã.",
    "Consistência bate talento quando o talento não é consistente.",
    "Cada venda é uma prova de que você está no caminho certo.",
    "Pequenos progressos diários levam a grandes resultados.",
    "A disciplina de hoje é a conquista de amanhã.",
    "Sucesso não é sorte — é comprometimento diário.",
    "Quem controla o financeiro, controla o futuro.",
    "O caminho para a riqueza começa no controle dos números.",
    "Não espere a motivação — construa o hábito.",
    "Metas sem prazo são apenas sonhos. Execute.",
    "A riqueza é construída um dia, uma decisão de cada vez.",
    "Fature mais. Gaste menos. Invista sempre.",
    "O que você mede, você gerencia. Continue monitorando.",
    "Cada obstáculo financeiro tem uma solução — encontre-a.",
    "Seu melhor mês está sempre à frente, nunca atrás.",
    "A prosperidade não vem por acaso. Ela é planejada.",
    "Cada reais guardado hoje é uma opção de escolha amanhã.",
    "Transforme pressão em combustível. Você consegue.",
    "Os números não mentem — e os seus estão melhorando.",
    "Foque no que gera resultado. Elimine o que drena energia.",
    "O sucesso financeiro é um jogo de paciência e ação.",
    "Você já chegou até aqui. Não pare agora.",
  ];
  const dayOfYear = Math.floor((new Date() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  const phrase = PHRASES[dayOfYear % PHRASES.length];

  let goalColor, goalStatus, goalBorderColor;
  if (!revenueGoal) {
    goalColor = 'var(--text-muted)';
    goalBorderColor = 'var(--border)';
    goalStatus = 'Defina sua meta de faturamento mensal';
  } else if (goalReached) {
    goalColor = 'var(--income)';
    goalBorderColor = 'var(--income)';
    goalStatus = `🎉 Meta atingida! Superou em ${fmt(totalIncome - revenueGoal)}`;
  } else if (rawGoalPct >= 50) {
    goalColor = 'var(--warning)';
    goalBorderColor = 'var(--warning)';
    goalStatus = `Faltam ${fmt(revenueGoal - totalIncome)} para bater a meta`;
  } else {
    goalColor = 'var(--expense)';
    goalBorderColor = 'var(--expense)';
    goalStatus = `Faltam ${fmt(revenueGoal - totalIncome)} para bater a meta`;
  }

  const totalCommitted = totalExpense + instTotal + totalGeneral;
  const coveragePct    = totalCommitted > 0 ? Math.min(Math.round((totalIncome / totalCommitted) * 100), 100) : 100;
  const gap            = totalCommitted - totalIncome;
  const coverOk        = gap <= 0;

  content.innerHTML = `
    <div class="summary-grid">
      <div class="summary-card income-card">
        <div class="icon-wrap">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 3v14M6 7l4-4 4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
        <div class="label">Faturamento</div>
        <div class="value">${fmt(totalIncome)}</div>
        <div class="sub">${fmt(received)} recebido (${recvPct}%)</div>
        <div class="progress-bar"><div class="progress-fill" style="width:${recvPct}%;background:var(--income)"></div></div>
      </div>

      <div class="summary-card expense-card">
        <div class="icon-wrap">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 17V3M14 13l-4 4-4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
        <div class="label">Contas a Pagar</div>
        <div class="value">${fmt(totalExpense)}</div>
        <div class="sub">${fmt(expPaid)} pago (${expPct}%)</div>
        <div class="progress-bar"><div class="progress-fill" style="width:${expPct}%;background:var(--expense)"></div></div>
      </div>

      <div class="summary-card ${projClass}">
        <div class="icon-wrap">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M3 10h14M10 3l7 7-7 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
        <div class="label">Saldo Projetado</div>
        <div class="value">${fmt(saldoProjetado)}</div>
        <div class="sub">Receita − todas as saídas</div>
      </div>

      <div class="summary-card ${realClass}">
        <div class="icon-wrap">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="1.5"/><path d="M10 7v4l2 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        </div>
        <div class="label">Saldo Real</div>
        <div class="value">${fmt(saldoReal)}</div>
        <div class="sub">Recebido − o que saiu</div>
      </div>
    </div>

    ${totalGeneral > 0 ? `
    <div class="card" style="margin-bottom:24px;border-left:3px solid var(--expense);padding:14px 16px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
        <div style="min-width:0">
          <div class="card-title" style="margin-bottom:4px">Gastos Gerais</div>
          <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap">
            <span style="font-size:1.1rem;font-weight:700;color:var(--expense)">${fmt(totalGeneral)}</span>
            <span style="font-size:.8rem;color:var(--text-muted)">${generalExp.length} lançamento${generalExp.length !== 1 ? 's' : ''} · já incluído no Saldo</span>
          </div>
        </div>
        <a href="#/expenses" class="btn btn-sm btn-ghost" style="flex-shrink:0">Ver todos</a>
      </div>
    </div>` : ''}

    ${instTotal > 0 ? `
    <div class="card" style="margin-bottom:24px;border-left:3px solid var(--primary);padding:14px 16px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
        <div style="min-width:0">
          <div class="card-title" style="margin-bottom:4px">Parcelas do Mês</div>
          <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap">
            <span style="font-size:1.1rem;font-weight:700;color:var(--primary)">${fmt(instTotal)}<span style="font-size:.78rem;font-weight:400;color:var(--text-muted)">/mês</span></span>
            <span style="font-size:.8rem;color:var(--text-muted)">${fmt(instPaid)} pago · ${fmt(instTotal - instPaid)} pendente</span>
          </div>
        </div>
        <a href="#/installments" class="btn btn-sm btn-ghost" style="flex-shrink:0">Ver todos</a>
      </div>
    </div>` : ''}

    ${expPending > 0 ? `
    <div class="card" style="margin-bottom:24px;border-left:3px solid var(--warning);padding:14px 16px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
        <div style="min-width:0">
          <div class="card-title" style="margin-bottom:4px">Contas Pendentes</div>
          <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap">
            <span style="font-size:1.1rem;font-weight:700;color:var(--warning)">${fmt(expPending)}</span>
            <span style="font-size:.8rem;color:var(--text-muted)">${expenses.filter(t => t.status !== 'paid').length} conta${expenses.filter(t => t.status !== 'paid').length !== 1 ? 's' : ''} em aberto</span>
          </div>
        </div>
        <a href="#/bills" class="btn btn-sm btn-ghost" style="flex-shrink:0">Ver todas</a>
      </div>
    </div>` : ''}

    <div class="card goal-revenue-card ${goalReached ? 'goal-reached' : ''}" style="margin-bottom:24px;border-color:${goalBorderColor}">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:8px">
        <div style="flex:1;min-width:0">
          <div class="card-title" style="margin-bottom:2px">Meta de Faturamento</div>
          <div style="font-size:1.05rem;font-weight:700;color:${goalColor}">${goalStatus}</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
          <div style="text-align:right">
            <div style="font-size:1.6rem;font-weight:800;color:${goalColor}">${revenueGoal > 0 ? goalPct + '%' : '—'}</div>
            <div style="font-size:.75rem;color:var(--text-muted)">da meta</div>
          </div>
          <button onclick="openRevenueGoalModal()" class="btn btn-sm btn-ghost" style="padding:6px 10px;flex-shrink:0" title="Editar meta">
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none"><path d="M13.586 3.586a2 2 0 112.828 2.828L7.414 15.414 4 16l.586-3.414 9-9z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
      </div>
      <div class="progress-bar" style="height:10px;margin-bottom:8px">
        <div class="progress-fill ${goalReached ? 'goal-bar-celebrate' : ''}" style="width:${revenueGoal > 0 ? goalPct : 0}%;background:${goalColor}"></div>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:10px;font-size:.78rem;color:var(--text-muted)">
        <span>Faturado: <strong style="color:var(--income)">${fmt(totalIncome)}</strong></span>
        <span>Meta: <strong style="color:${goalColor}">${revenueGoal > 0 ? fmt(revenueGoal) : 'Não definida'}</strong></span>
      </div>
      <div style="font-size:.8rem;color:var(--text-muted);font-style:italic;border-top:1px solid var(--border);padding-top:8px;line-height:1.5">
        "${phrase}"
      </div>
      ${goalReached ? '<div class="goal-sparkles" aria-hidden="true"></div>' : ''}
    </div>

    <div class="card" style="margin-bottom:24px;border-color:${coverOk ? 'var(--income)' : 'var(--warning)'}">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px">
        <div>
          <div class="card-title" style="margin-bottom:2px">Cobertura de Despesas</div>
          <div style="font-size:1.1rem;font-weight:700;color:${coverOk ? 'var(--income)' : 'var(--expense)'}">
            ${coverOk
              ? `✓ Sobra ${fmt(Math.abs(gap))} após cobrir as despesas`
              : `Faltam ${fmt(gap)} para cobrir todas as despesas`
            }
          </div>
        </div>
        <div style="text-align:right">
          <div style="font-size:1.6rem;font-weight:800;color:${coverOk ? 'var(--income)' : 'var(--expense)'}">${coveragePct}%</div>
          <div style="font-size:.75rem;color:var(--text-muted)">do total coberto</div>
        </div>
      </div>
      <div class="progress-bar" style="height:10px">
        <div class="progress-fill" style="width:${coveragePct}%;background:${coverOk ? 'var(--income)' : 'var(--warning)'}"></div>
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:6px;font-size:.78rem;color:var(--text-muted);flex-wrap:wrap;gap:4px">
        <span>Faturamento: <strong style="color:var(--income)">${fmt(totalIncome)}</strong></span>
        <span>Compromissos: <strong style="color:var(--expense)">${fmt(totalCommitted)}</strong></span>
      </div>
    </div>

    ${overdue.length > 0 ? `
    <div class="card" style="border-color:var(--expense);margin-bottom:24px">
      <div class="section-header">
        <div class="section-title" style="color:var(--expense)">⚠ Contas Vencidas (${overdue.length})</div>
        <a href="#/bills" class="btn btn-sm btn-ghost">Ver todas</a>
      </div>
      <div class="transaction-list">
        ${overdue.slice(0, 3).map(t => transactionRow(t, catsMap, false)).join('')}
      </div>
    </div>` : ''}

    ${upcoming.length > 0 ? `
    <div class="card" style="margin-bottom:24px">
      <div class="section-header">
        <div class="section-title">📅 Vencem nos próximos 7 dias</div>
        <a href="#/bills" class="btn btn-sm btn-ghost">Ver todas</a>
      </div>
      <div class="transaction-list">
        ${upcoming.slice(0, 5).map(t => transactionRow(t, catsMap, false)).join('')}
      </div>
    </div>` : ''}

    <div class="card">
      <div class="section-header">
        <div class="section-title">Últimas Movimentações</div>
        <a href="#/bills" class="btn btn-sm btn-ghost">Ver tudo</a>
      </div>
      ${transactions.length === 0 ? `
        <div class="empty-state">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none"><path d="M8 12h32M8 24h20M8 36h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          <p>Nenhuma movimentação neste mês</p>
        </div>` : `
        <div class="transaction-list">
          ${transactions.slice(0, 8).map(t => transactionRow(t, catsMap, false)).join('')}
        </div>`
      }
    </div>
  `;
}

function openRevenueGoalModal() {
  const { month, year } = window._currentPeriod || {};
  const uid = (pb.authStore.model || pb.authStore.record)?.id || 'local';
  const goalKey = `revenue_goal_${uid}_${year}_${month}`;
  const current = parseFloat(localStorage.getItem(goalKey) || '0');
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modal-header">
        <span class="modal-title">Meta de Faturamento</span>
        <button class="btn btn-icon btn-ghost" id="goal-modal-close" aria-label="Fechar">
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        </button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">Valor da meta mensal (R$)</label>
          <input id="goal-input" type="number" min="0" step="100" class="form-control" placeholder="Ex: 15000" value="${current > 0 ? current : ''}">
        </div>
        <p style="font-size:.8rem;color:var(--text-muted);margin:0">A barra fica vermelha até 50%, amarela de 50–99% e verde ao bater a meta.</p>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" id="goal-modal-cancel">Cancelar</button>
        <button class="btn btn-primary" id="goal-modal-save">Salvar</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);

  const input = backdrop.querySelector('#goal-input');
  input.focus();

  backdrop.querySelector('#goal-modal-close').onclick =
  backdrop.querySelector('#goal-modal-cancel').onclick = () => backdrop.remove();
  backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove(); });

  backdrop.querySelector('#goal-modal-save').onclick = () => {
    const val = parseFloat(input.value);
    if (!isNaN(val) && val >= 0) {
      if (val === 0) localStorage.removeItem(goalKey);
      else localStorage.setItem(goalKey, val);
      backdrop.remove();
      if (month && year) renderDashboard(month, year);
    } else {
      input.style.borderColor = 'var(--expense)';
    }
  };

  input.addEventListener('keydown', e => { if (e.key === 'Enter') backdrop.querySelector('#goal-modal-save').click(); });
}

function transactionRow(t, catsMap, showActions = true) {
  const cat = catsMap[t.category_id];
  const isExp = ['expense', 'installment', 'general', 'daily'].includes(t.transaction_type);
  const overdue = isOverdue(t.due_date, t.status);

  return `
    <div class="transaction-item" data-id="${t.id}">
      <div class="t-icon" style="background:${cat ? cat.color + '22' : '#f1f5f9'};color:${cat ? cat.color : '#94a3b8'}">
        ${cat ? (cat.icon || cat.name[0]) : '?'}
      </div>
      <div class="t-info">
        <div class="t-name">${t.name}</div>
        <div class="t-meta">
          ${cat ? catTag(cat) : ''}
          <span>${fmtDate(t.due_date)}</span>
          ${statusBadge(t.status, t.due_date)}
        </div>
      </div>
      <div class="t-amount ${isExp ? 'expense' : 'income'}">
        ${isExp ? '−' : '+'}${fmt(t.amount)}
      </div>
    </div>
  `;
}
