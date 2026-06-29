let reportChart = null;
let catChart = null;
let cashChart = null;
let compCaixaChart = null;
let _reportData = null; // cached for export
let _compCaixaData = null; // { year, competencia:[], caixa:[] } for Competência × Caixa tab
let _compCaixaRegime = 'competencia'; // current view of the Competência × Caixa tab

async function renderReports(month, year) {
  const content = document.getElementById('content');

  const [allTransactions, catsMap, accounts] = await Promise.all([
    db.transactions.filter(`year = ${year}`).toArray(),
    getCategoriesMap(),
    db.accounts.toArray()
  ]);

  const EXPENSE_TYPES = ['expense', 'installment', 'general', 'daily'];
  const isIncome  = t => t.transaction_type === 'income';
  const isExpense = t => EXPENSE_TYPES.includes(t.transaction_type);

  // ── Regime helpers ──────────────────────────────────────────────────────────
  const parseYMD = (s) => {
    if (!s || typeof s !== 'string') return null;
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? { year: +m[1], month: +m[2], day: +m[3] } : null;
  };
  // Caixa (regime de caixa): valor efetivamente pago/recebido e data do pagamento
  // F-210: NULL = não-informado → usa amount; 0 = R$0 real pago → conta como 0.
  const cashValue = t => (t.paid_amount != null ? t.paid_amount : (t.amount || 0));
  // Fallback p/ legados pagos sem data de pagamento (cash_date/paid_date vazios):
  // usa competence_date e, por último, due_date — assim não somem do Fluxo de Caixa (F-213).
  // Registros COM cash_date/paid_date mantêm o comportamento original.
  const cashYMD   = t => parseYMD(t.cash_date || t.paid_date || t.competence_date || t.due_date);
  const cashMonth = t => { const p = cashYMD(t); return p ? p.month : null; };
  const cashYear  = t => { const p = cashYMD(t); return p ? p.year : null; };
  // Competência: data de competência (fallback t.month/due_date)
  const compMonth = t => { const p = parseYMD(t.competence_date); return p ? p.month : (t.month || null); };
  const isPaid    = t => t.status === 'paid';

  // ── Regime de COMPETÊNCIA (Visão Geral e Por Categoria) — todos os lançamentos
  const monthlyData = Array.from({ length: 12 }, (_, i) => {
    const m = i + 1;
    const txs = allTransactions.filter(t => compMonth(t) === m);
    const income  = txs.filter(isIncome).reduce((s, t) => s + (t.amount || 0), 0);
    const expense = txs.filter(isExpense).reduce((s, t) => s + (t.amount || 0), 0);
    return { month: m, income, expense, balance: income - expense };
  });

  const currentTxs  = allTransactions.filter(t => compMonth(t) === month);
  const expenseTxs  = currentTxs.filter(isExpense);
  const totalExp    = expenseTxs.reduce((s, t) => s + (t.amount || 0), 0);
  const totalInc    = currentTxs.filter(isIncome).reduce((s, t) => s + (t.amount || 0), 0);

  const catTotals = {};
  expenseTxs.forEach(t => {
    const key = t.category_id || 'none';
    catTotals[key] = (catTotals[key] || 0) + (t.amount || 0);
  });

  const catEntries = Object.entries(catTotals)
    .map(([id, val]) => ({ cat: catsMap[id], val }))
    .sort((a, b) => b.val - a.val);

  // ── Regime de CAIXA (Fluxo de Caixa) — SOMENTE realizado (status==='paid'),
  // alocado por mês/ano do pagamento/recebimento (cash_date||paid_date)
  const cashMonthly = Array.from({ length: 12 }, (_, i) => {
    const m = i + 1;
    const txs = allTransactions.filter(t => isPaid(t) && cashYear(t) === year && cashMonth(t) === m);
    const income  = txs.filter(isIncome).reduce((s, t) => s + cashValue(t), 0);
    const expense = txs.filter(isExpense).reduce((s, t) => s + cashValue(t), 0);
    return { month: m, income, expense, balance: income - expense };
  });

  const cashCurrent = allTransactions.filter(t => isPaid(t) && cashYear(t) === year && cashMonth(t) === month);
  const cashTotalInc = cashCurrent.filter(isIncome).reduce((s, t) => s + cashValue(t), 0);
  const cashTotalExp = cashCurrent.filter(isExpense).reduce((s, t) => s + cashValue(t), 0);

  // Saldo acumulado (regime de caixa)
  let running = 0;
  const cashFlowData = cashMonthly.map(d => {
    running += d.balance;
    return { ...d, cumulative: running };
  });

  // Cache for export (inclui ambos os regimes)
  // cashFlowData traz o saldo acumulado (cumulative) usado pelo gráfico de Fluxo de Caixa.
  _reportData = { month, year, allTransactions, catsMap, accounts, monthlyData, cashMonthly, cashFlowData };
  // Cache for Competência × Caixa tab
  _compCaixaData = { year, competencia: monthlyData, caixa: cashMonthly };
  _compCaixaRegime = 'competencia';

  // Account breakdown for month — regime de CAIXA (somente realizado)
  const accBreakdown = accounts.map(acc => {
    const accTxs = cashCurrent.filter(t => t.account_id === acc.id);
    const inc = accTxs.filter(isIncome).reduce((s, t) => s + cashValue(t), 0);
    const exp = accTxs.filter(isExpense).reduce((s, t) => s + cashValue(t), 0);
    return { ...acc, inc, exp, net: inc - exp };
  }).filter(a => a.inc > 0 || a.exp > 0);

  content.innerHTML = `
    <div class="tabs" style="margin-bottom:20px">
      <div class="tab active" data-tab="overview"   onclick="switchReportTab('overview')">Visão Geral</div>
      <div class="tab"        data-tab="categories" onclick="switchReportTab('categories')">Por Categoria</div>
      <div class="tab"        data-tab="cashflow"   onclick="switchReportTab('cashflow')">Fluxo de Caixa</div>
      <div class="tab"        data-tab="compcaixa"  onclick="switchReportTab('compcaixa')">Competência × Caixa</div>
    </div>

    <!-- ── TAB: Visão Geral ── -->
    <div id="tab-overview">
      <div style="display:flex;justify-content:flex-end;margin-bottom:12px">
        <button class="btn btn-sm btn-outline" onclick="exportReportExcel()">
          ${icon('download', 14)} Exportar Excel
        </button>
      </div>
      <div class="card" style="margin-bottom:24px">
        <div class="section-header">
          <div class="section-title">Receita vs Despesa — ${year} <span style="font-weight:400;color:var(--text-muted);font-size:.8rem">(competência)</span></div>
        </div>
        <div class="chart-container">
          <canvas id="main-chart"></canvas>
        </div>
      </div>

      <div class="summary-grid">
        ${monthlyData.map(d => `
          <div class="summary-card" style="${d.month === month ? 'border-color:var(--primary-600);box-shadow:0 0 0 2px var(--primary-100)' : ''}">
            <div class="label">${MONTHS[d.month - 1]}</div>
            <div style="font-size:.85rem;color:var(--income-text);font-weight:600">${fmt(d.income)}</div>
            <div style="font-size:.85rem;color:var(--expense);font-weight:600">${fmt(d.expense)}</div>
            <div style="font-size:.75rem;color:${d.balance >= 0 ? 'var(--income-text)' : 'var(--expense)'};margin-top:2px">
              ${d.balance >= 0 ? '+' : ''}${fmt(d.balance)}
            </div>
          </div>
        `).join('')}
      </div>
    </div>

    <!-- ── TAB: Por Categoria ── -->
    <div id="tab-categories" style="display:none">
      <div class="card" style="margin-bottom:24px">
        <div class="section-header">
          <div class="section-title">Despesas por Categoria — ${MONTHS[month - 1]} <span style="font-weight:400;color:var(--text-muted);font-size:.8rem">(competência)</span></div>
        </div>
        <div class="chart-container" style="height:240px">
          <canvas id="cat-chart"></canvas>
        </div>
      </div>

      <div class="card">
        <div class="card-title">Detalhamento</div>
        ${catEntries.length === 0 ? '<div class="empty-state" style="padding:24px"><p>Sem dados de despesa para este mês</p></div>' : `
        <div style="display:flex;flex-direction:column;gap:12px;margin-top:12px">
          ${catEntries.map(({ cat, val }) => {
            const pct   = totalExp > 0 ? Math.round((val / totalExp) * 100) : 0;
            const color = cat?.color || '#ADA897';
            return `
              <div>
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                  <span style="font-size:.875rem;font-weight:600;color:var(--text)">${cat ? (cat.icon + ' ' + cat.name) : 'Sem categoria'}</span>
                  <span style="font-size:.875rem;font-weight:600;color:var(--expense)">${fmt(val)} <span style="color:var(--text-soft);font-weight:400;font-size:.8rem">${pct}%</span></span>
                </div>
                <div class="progress-bar" style="margin-top:0">
                  <div class="progress-fill" style="width:${pct}%;background:${color}"></div>
                </div>
              </div>
            `;
          }).join('')}
        </div>`}
      </div>
    </div>

    <!-- ── TAB: Fluxo de Caixa (regime de CAIXA — somente realizado) ── -->
    <div id="tab-cashflow" style="display:none">
      <div style="display:flex;justify-content:flex-end;margin-bottom:12px">
        <button class="btn btn-sm btn-outline" onclick="exportReportExcel('caixa')">
          ${icon('download', 14)} Exportar Excel
        </button>
      </div>
      <div class="summary-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:20px">
        <div class="summary-card income-card">
          <div class="label">Receita recebida no mês</div>
          <div class="value">${fmt(cashTotalInc)}</div>
        </div>
        <div class="summary-card expense-card">
          <div class="label">Despesa paga no mês</div>
          <div class="value">${fmt(cashTotalExp)}</div>
        </div>
        <div class="summary-card ${cashTotalInc - cashTotalExp >= 0 ? 'balance-positive' : 'balance-negative'}">
          <div class="label">Saldo do mês (caixa)</div>
          <div class="value">${fmt(cashTotalInc - cashTotalExp)}</div>
        </div>
      </div>

      <div class="card" style="margin-bottom:20px">
        <div class="section-header" style="margin-bottom:14px">
          <div class="section-title">Saldo Acumulado — ${year} <span style="font-weight:400;color:var(--text-muted);font-size:.8rem">(caixa — realizado)</span></div>
        </div>
        <div class="chart-container">
          <canvas id="cash-chart"></canvas>
        </div>
      </div>

      ${accBreakdown.length > 0 ? `
      <div class="card">
        <div class="card-title" style="margin-bottom:14px">Por Conta — ${MONTHS[month - 1]} <span style="font-weight:400;color:var(--text-muted);font-size:.8rem">(caixa — realizado)</span></div>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${accBreakdown.map(a => {
            const netColor = a.net >= 0 ? 'var(--income-text)' : 'var(--expense)';
            return `
              <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:var(--bg-subtle);border-radius:var(--r-md)">
                <div style="font-weight:600;font-size:.9rem">${a.name}${a.bank_name ? ` <span style="font-weight:400;color:var(--text-muted);font-size:.8rem">· ${a.bank_name}</span>` : ''}</div>
                <div style="display:flex;gap:16px;align-items:center">
                  <span style="font-size:.82rem;color:var(--income-text)">+${fmt(a.inc)}</span>
                  <span style="font-size:.82rem;color:var(--expense)">−${fmt(a.exp)}</span>
                  <span style="font-size:.88rem;font-weight:700;color:${netColor}">${a.net >= 0 ? '+' : ''}${fmt(a.net)}</span>
                </div>
              </div>`;
          }).join('')}
        </div>
      </div>` : ''}
    </div>

    <!-- ── TAB: Competência × Caixa ── -->
    <div id="tab-compcaixa" style="display:none">
      <div class="card" style="margin-bottom:20px">
        <div class="section-header" style="margin-bottom:14px;flex-wrap:wrap;gap:12px">
          <div class="section-title">Competência × Caixa — ${year}</div>
          <div style="display:inline-flex;gap:4px;background:var(--bg-subtle);padding:4px;border-radius:var(--r-md)">
            <button class="btn btn-sm cc-toggle" data-ccview="competencia" onclick="switchCompCaixaView('competencia')" style="border:none">Competência</button>
            <button class="btn btn-sm cc-toggle" data-ccview="caixa" onclick="switchCompCaixaView('caixa')" style="border:none">Caixa (Pagamento/Recebimento)</button>
          </div>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;gap:12px;flex-wrap:wrap">
          <div id="compcaixa-hint" style="font-size:.82rem;color:var(--text-muted)"></div>
          <button class="btn btn-sm btn-outline" onclick="exportCompCaixa()">
            ${icon('download', 14)} Exportar Excel
          </button>
        </div>
        <div class="chart-container" style="margin-bottom:20px">
          <canvas id="compcaixa-chart"></canvas>
        </div>
        <div class="summary-grid" id="compcaixa-summary"></div>
      </div>
    </div>
  `;

  renderMainChart(monthlyData, month);
  renderCatChart(catEntries, totalExp);
  renderCashChart(cashFlowData, month);
  renderCompCaixaView(_compCaixaRegime);
}

// ── Builders de config (reaproveitados pela renderização visível e offscreen) ──
function buildMainChartConfig(data) {
  return {
    type: 'bar',
    data: {
      labels: MONTHS.map(m => m.substring(0, 3)),
      datasets: [
        {
          label: 'Receita',
          data: data.map(d => d.income),
          backgroundColor: 'rgba(58,90,64,.18)',
          borderColor: '#3A5A40',
          borderWidth: 2,
          borderRadius: 6,
          borderSkipped: false,
        },
        {
          label: 'Despesa',
          data: data.map(d => d.expense),
          backgroundColor: 'rgba(201,90,71,.18)',
          borderColor: '#C95A47',
          borderWidth: 2,
          borderRadius: 6,
          borderSkipped: false,
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'top',
          labels: {
            color: '#5D594E',
            font: { family: "'Onest', system-ui, sans-serif", size: 12, weight: '500' },
            boxWidth: 12, boxHeight: 12, borderRadius: 3, useBorderRadius: true,
          }
        }
      },
      scales: {
        y: {
          ticks: {
            callback: v => 'R$' + (v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v),
            color: '#807B6C', font: { family: "'Onest', system-ui, sans-serif", size: 11 }
          },
          grid: { color: '#E8E2D0', drawBorder: false }
        },
        x: {
          grid: { display: false },
          ticks: { color: '#807B6C', font: { family: "'Onest', system-ui, sans-serif", size: 11 } }
        }
      }
    }
  };
}

function buildCatChartConfig(entries, total) {
  return {
    type: 'doughnut',
    data: {
      labels: entries.map(e => e.cat ? e.cat.name : 'Outros'),
      datasets: [{
        data: entries.map(e => e.val),
        backgroundColor: entries.map(e => e.cat?.color || '#ADA897'),
        borderWidth: 2, borderColor: '#FFFFFF', hoverOffset: 8, hoverBorderWidth: 2,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'right',
          labels: {
            color: '#5D594E',
            font: { family: "'Onest', system-ui, sans-serif", size: 12, weight: '500' },
            boxWidth: 10, boxHeight: 10, borderRadius: 3, useBorderRadius: true, padding: 10,
          }
        },
        tooltip: {
          callbacks: {
            label: ctx => ` ${fmt(ctx.parsed)} (${total > 0 ? Math.round(ctx.parsed / total * 100) : 0}%)`
          },
          titleFont: { family: "'Onest', system-ui, sans-serif" },
          bodyFont:  { family: "'Onest', system-ui, sans-serif" },
        }
      },
      cutout: '68%'
    }
  };
}

function buildCashChartConfig(data) {
  const colors = data.map(d => d.cumulative >= 0 ? 'rgba(58,90,64,.7)' : 'rgba(201,90,71,.7)');
  return {
    type: 'bar',
    data: {
      labels: MONTHS.map(m => m.substring(0, 3)),
      datasets: [
        {
          label: 'Saldo acumulado',
          data: data.map(d => d.cumulative),
          backgroundColor: colors,
          borderColor: colors.map(c => c.replace('.7', '1')),
          borderWidth: 1,
          borderRadius: 6,
          borderSkipped: false,
        },
        {
          type: 'line',
          label: 'Resultado mensal',
          data: data.map(d => d.balance),
          borderColor: '#D4A24C',
          backgroundColor: 'rgba(212,162,76,.12)',
          borderWidth: 2,
          pointRadius: 3,
          tension: 0.35,
          fill: false,
          yAxisID: 'y2',
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'top',
          labels: {
            color: '#5D594E',
            font: { family: "'Onest', system-ui, sans-serif", size: 12, weight: '500' },
            boxWidth: 12, boxHeight: 12, borderRadius: 3, useBorderRadius: true,
          }
        },
        tooltip: {
          callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmt(ctx.parsed.y)}` },
          titleFont: { family: "'Onest', system-ui, sans-serif" },
          bodyFont:  { family: "'Onest', system-ui, sans-serif" },
        }
      },
      scales: {
        y: {
          ticks: {
            callback: v => 'R$' + (Math.abs(v) >= 1000 ? (v / 1000).toFixed(1) + 'k' : v),
            color: '#807B6C', font: { family: "'Onest', system-ui, sans-serif", size: 11 }
          },
          grid: { color: '#E8E2D0', drawBorder: false }
        },
        y2: {
          position: 'right',
          ticks: {
            callback: v => 'R$' + (Math.abs(v) >= 1000 ? (v / 1000).toFixed(1) + 'k' : v),
            color: '#D4A24C', font: { family: "'Onest', system-ui, sans-serif", size: 10 }
          },
          grid: { display: false }
        },
        x: {
          grid: { display: false },
          ticks: { color: '#807B6C', font: { family: "'Onest', system-ui, sans-serif", size: 11 } }
        }
      }
    }
  };
}

function renderMainChart(data, currentMonth) {
  if (reportChart) { reportChart.destroy(); reportChart = null; }
  const ctx = document.getElementById('main-chart')?.getContext('2d');
  if (!ctx) return;
  reportChart = new Chart(ctx, buildMainChartConfig(data));
}

function renderCatChart(entries, total) {
  if (catChart) { catChart.destroy(); catChart = null; }
  const ctx = document.getElementById('cat-chart')?.getContext('2d');
  if (!ctx || entries.length === 0) return;
  catChart = new Chart(ctx, buildCatChartConfig(entries, total));
}

function renderCashChart(data, currentMonth) {
  if (cashChart) { cashChart.destroy(); cashChart = null; }
  const ctx = document.getElementById('cash-chart')?.getContext('2d');
  if (!ctx) return;
  cashChart = new Chart(ctx, buildCashChartConfig(data));
}

function switchReportTab(tab) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.getElementById('tab-overview').style.display   = tab === 'overview'   ? '' : 'none';
  document.getElementById('tab-categories').style.display = tab === 'categories' ? '' : 'none';
  document.getElementById('tab-cashflow').style.display   = tab === 'cashflow'   ? '' : 'none';
  document.getElementById('tab-compcaixa').style.display  = tab === 'compcaixa'  ? '' : 'none';

  if (tab === 'categories') setTimeout(() => catChart?.resize(), 10);
  if (tab === 'cashflow')   setTimeout(() => cashChart?.resize(), 10);
  if (tab === 'compcaixa')  setTimeout(() => compCaixaChart?.resize(), 10);
}

// ── Competência × Caixa ───────────────────────────────────────────────────────

function switchCompCaixaView(regime) {
  _compCaixaRegime = regime;
  renderCompCaixaView(regime);
}

function renderCompCaixaView(regime) {
  if (!_compCaixaData) return;
  const data = _compCaixaData[regime] || [];

  // Toggle button states
  document.querySelectorAll('[data-ccview]').forEach(b => {
    const on = b.dataset.ccview === regime;
    b.style.background = on ? 'var(--primary-600)' : 'transparent';
    b.style.color      = on ? '#fff' : 'var(--text)';
    b.style.fontWeight = on ? '600' : '500';
  });

  const hint = document.getElementById('compcaixa-hint');
  if (hint) {
    hint.textContent = regime === 'caixa'
      ? 'Regime de caixa: somente lançamentos realizados (pagos/recebidos), por data de pagamento/recebimento.'
      : 'Regime de competência: todos os lançamentos (pagos e pendentes), por data de competência.';
  }

  const summary = document.getElementById('compcaixa-summary');
  if (summary) {
    summary.innerHTML = data.map(d => `
      <div class="summary-card">
        <div class="label">${MONTHS[d.month - 1]}</div>
        <div style="font-size:.85rem;color:var(--income-text);font-weight:600">${fmt(d.income)}</div>
        <div style="font-size:.85rem;color:var(--expense);font-weight:600">${fmt(d.expense)}</div>
        <div style="font-size:.75rem;color:${d.balance >= 0 ? 'var(--income-text)' : 'var(--expense)'};margin-top:2px">
          ${d.balance >= 0 ? '+' : ''}${fmt(d.balance)}
        </div>
      </div>
    `).join('');
  }

  renderCompCaixaChart(data);
}

function buildCompCaixaChartConfig(data) {
  return {
    type: 'bar',
    data: {
      labels: MONTHS.map(m => m.substring(0, 3)),
      datasets: [
        {
          label: 'Receita',
          data: data.map(d => d.income),
          backgroundColor: 'rgba(58,90,64,.18)',
          borderColor: '#3A5A40',
          borderWidth: 2,
          borderRadius: 6,
          borderSkipped: false,
        },
        {
          label: 'Despesa',
          data: data.map(d => d.expense),
          backgroundColor: 'rgba(201,90,71,.18)',
          borderColor: '#C95A47',
          borderWidth: 2,
          borderRadius: 6,
          borderSkipped: false,
        },
        {
          type: 'line',
          label: 'Saldo',
          data: data.map(d => d.balance),
          borderColor: '#D4A24C',
          backgroundColor: 'rgba(212,162,76,.12)',
          borderWidth: 2,
          pointRadius: 3,
          tension: 0.35,
          fill: false,
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'top',
          labels: {
            color: '#5D594E',
            font: { family: "'Onest', system-ui, sans-serif", size: 12, weight: '500' },
            boxWidth: 12, boxHeight: 12, borderRadius: 3, useBorderRadius: true,
          }
        },
        tooltip: {
          callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmt(ctx.parsed.y)}` },
          titleFont: { family: "'Onest', system-ui, sans-serif" },
          bodyFont:  { family: "'Onest', system-ui, sans-serif" },
        }
      },
      scales: {
        y: {
          ticks: {
            callback: v => 'R$' + (Math.abs(v) >= 1000 ? (v / 1000).toFixed(1) + 'k' : v),
            color: '#807B6C', font: { family: "'Onest', system-ui, sans-serif", size: 11 }
          },
          grid: { color: '#E8E2D0', drawBorder: false }
        },
        x: {
          grid: { display: false },
          ticks: { color: '#807B6C', font: { family: "'Onest', system-ui, sans-serif", size: 11 } }
        }
      }
    }
  };
}

function renderCompCaixaChart(data) {
  if (compCaixaChart) { compCaixaChart.destroy(); compCaixaChart = null; }
  const ctx = document.getElementById('compcaixa-chart')?.getContext('2d');
  if (!ctx) return;
  compCaixaChart = new Chart(ctx, buildCompCaixaChartConfig(data));
}

// ── Excel Export ──────────────────────────────────────────────────────────────

// Renderiza gráficos OFFSCREEN com tamanho de pixel explícito para o export.
// F-214: os Chart.js visíveis das abas inativas ficam 0×0 (display:none) e
// toBase64Image() retorna PNG em branco. Aqui cada gráfico é re-instanciado num
// canvas com dimensões reais (fora da viewport), garantindo PNG correto
// independentemente da aba ativa. specs: [{ config, label }].
function renderChartsOffscreen(specs) {
  const container = document.createElement('div');
  // Fora da tela, mas COM dimensões reais (não display:none) p/ o canvas renderizar.
  container.style.cssText = 'position:absolute;left:-99999px;top:0;width:960px;height:600px;';
  document.body.appendChild(container);
  const results = [];
  try {
    specs.forEach(spec => {
      let chart;
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 960;
        canvas.height = 600;
        container.appendChild(canvas);
        const cfg = spec.config;
        cfg.options = cfg.options || {};
        cfg.options.animation = false;     // sem animação → render síncrono completo
        cfg.options.responsive = false;    // usa o tamanho fixo do canvas
        cfg.options.maintainAspectRatio = false;
        cfg.options.devicePixelRatio = 2;  // nitidez (backing store 1920×1200)
        chart = new Chart(canvas.getContext('2d'), cfg);
        const dataUrl = chart.toBase64Image('image/png', 1.0);
        if (dataUrl) results.push({ dataUrl, label: spec.label });
      } catch (e) {
        // Mantém o comportamento gracioso: pula este gráfico e segue.
        console.warn('Falha ao renderizar gráfico offscreen:', spec.label, e);
      } finally {
        if (chart) chart.destroy();
      }
    });
  } finally {
    container.remove();
  }
  return results;
}

async function exportReportExcel(regime = 'competencia', opts = {}) {
  if (!_reportData) {
    toast('Dados não disponíveis para exportar', 'error');
    return;
  }
  if (typeof ExcelJS === 'undefined') {
    toast('Biblioteca de exportação (ExcelJS) não carregada. Recarregue a página.', 'error');
    return;
  }
  const { month, year, allTransactions, catsMap, accounts } = _reportData;
  const EXPENSE_TYPES = ['expense', 'installment', 'general', 'daily'];
  const isIncome  = t => t.transaction_type === 'income';
  const isExpense = t => EXPENSE_TYPES.includes(t.transaction_type);
  const accMap = Object.fromEntries(accounts.map(a => [a.id, a]));

  const parseYMD = (s) => {
    if (!s || typeof s !== 'string') return null;
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? { year: +m[1], month: +m[2], day: +m[3] } : null;
  };

  const isCaixa = regime === 'caixa';
  let monthTxs, dateOf, valueOf, resumoRows, regimeLabel;

  if (isCaixa) {
    // Regime de CAIXA: somente realizado, por data de pagamento/recebimento
    // Fallback p/ legados pagos sem data: competence_date e, por último, due_date (F-213).
    const cashYMD = t => parseYMD(t.cash_date || t.paid_date || t.competence_date || t.due_date);
    monthTxs = allTransactions.filter(t => {
      const p = cashYMD(t);
      return t.status === 'paid' && p && p.year === year && p.month === month;
    });
    dateOf  = t => t.cash_date || t.paid_date || t.competence_date || t.due_date || '';
    valueOf = t => (t.paid_amount != null ? t.paid_amount : (t.amount || 0));
    resumoRows = (_reportData.cashMonthly || []).map(d => ({
      'Mês':     MONTHS[d.month - 1],
      'Receita': d.income,
      'Despesa': d.expense,
      'Saldo':   d.balance,
    }));
    regimeLabel = 'Caixa';
  } else {
    // Regime de COMPETÊNCIA: todos os lançamentos, por data de competência
    const compMonth = t => { const p = parseYMD(t.competence_date); return p ? p.month : (t.month || null); };
    monthTxs = allTransactions.filter(t => compMonth(t) === month);
    dateOf  = t => t.competence_date || t.due_date || '';
    valueOf = t => (t.amount || 0);
    resumoRows = _reportData.monthlyData.map(d => ({
      'Mês':     MONTHS[d.month - 1],
      'Receita': d.income,
      'Despesa': d.expense,
      'Saldo':   d.balance,
    }));
    regimeLabel = 'Competencia';
  }

  const fmtD = (s) => { const p = parseYMD(s); return p ? `${String(p.day).padStart(2,'0')}/${String(p.month).padStart(2,'0')}/${p.year}` : ''; };

  const incTxs = monthTxs.filter(isIncome);
  const expTxs = monthTxs.filter(isExpense);

  const incRows = incTxs.map(t => ({
    'Data':       fmtD(dateOf(t)),
    'Descrição':  t.name,
    'Categoria':  catsMap[t.category_id]?.name || 'Sem categoria',
    'Conta':      accMap[t.account_id]?.name || '',
    'Valor':      valueOf(t),
    'Status':     t.status === 'paid' ? 'Recebido' : 'Pendente',
    'Observação': t.notes || '',
  }));

  const expRows = expTxs.map(t => ({
    'Data':       fmtD(dateOf(t)),
    'Descrição':  t.name,
    'Categoria':  catsMap[t.category_id]?.name || 'Sem categoria',
    'Conta':      accMap[t.account_id]?.name || '',
    'Valor':      valueOf(t),
    'Status':     t.status === 'paid' ? 'Pago' : 'Pendente',
    'Observação': t.notes || '',
  }));

  const totalInc = incRows.reduce((s, r) => s + (r.Valor || 0), 0);
  const totalExp = expRows.reduce((s, r) => s + (r.Valor || 0), 0);
  const saldoMes = totalInc - totalExp;

  // ── Consolidação por categoria (Receitas e Despesas) ──────────────────────────
  const aggregate = (txs) => {
    const map = {};
    txs.forEach(t => {
      const name = catsMap[t.category_id]?.name || 'Sem categoria';
      if (!map[name]) map[name] = { total: 0, count: 0 };
      map[name].total += valueOf(t);
      map[name].count += 1;
    });
    const grand = Object.values(map).reduce((s, e) => s + e.total, 0);
    return Object.entries(map)
      .map(([name, e]) => ({ name, total: e.total, count: e.count, pct: grand ? e.total / grand : 0 }))
      .sort((a, b) => b.total - a.total);
  };
  const incCats = aggregate(incTxs);
  const expCats = aggregate(expTxs);

  // Entradas (com cor) para o gráfico de Despesas por Categoria — regime-aware,
  // mesma estrutura usada pelo gráfico visível ({ cat, val }).
  const buildCatEntries = (txs) => {
    const totals = {};
    txs.forEach(t => {
      const key = t.category_id || 'none';
      totals[key] = (totals[key] || 0) + valueOf(t);
    });
    return Object.entries(totals)
      .map(([id, val]) => ({ cat: catsMap[id], val }))
      .sort((a, b) => b.val - a.val);
  };
  const exportCatEntries = buildCatEntries(expTxs);

  // ── Estilos / constantes ──────────────────────────────────────────────────────
  const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF243D28' } };
  const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  const ZEBRA_FILL  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDE7D8' } };
  const THIN        = { style: 'thin', color: { argb: 'FFCBD5C4' } };
  const BORDER      = { top: THIN, left: THIN, bottom: THIN, right: THIN };
  const MONEY_FMT   = 'R$ #,##0.00';
  const PCT_FMT     = '0.0%';
  const DARK        = 'FF243D28';
  const PRIMARY     = 'FF3A5A40';
  const RED         = 'FFC95A47';

  // Monta uma tabela estilizada. columns: [{ key, header, money?, pct?, align? }]
  const buildTable = (ws, columns, rows, startRow, freeze = true) => {
    const headerRow = ws.getRow(startRow);
    columns.forEach((c, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = c.header;
      cell.fill = HEADER_FILL;
      cell.font = HEADER_FONT;
      cell.alignment = { vertical: 'middle', horizontal: c.align || (c.money || c.pct ? 'right' : 'left') };
      cell.border = BORDER;
    });
    headerRow.height = 22;
    rows.forEach((r, ri) => {
      const row = ws.getRow(startRow + 1 + ri);
      columns.forEach((c, i) => {
        const cell = row.getCell(i + 1);
        cell.value = r[c.key];
        cell.border = BORDER;
        cell.alignment = { vertical: 'middle', horizontal: c.align || (c.money || c.pct ? 'right' : 'left') };
        if (c.money) cell.numFmt = MONEY_FMT;
        if (c.pct)   cell.numFmt = PCT_FMT;
        if (ri % 2 === 1) cell.fill = ZEBRA_FILL;
      });
    });
    // Auto-largura pela maior célula
    columns.forEach((c, i) => {
      let maxLen = c.header.length;
      rows.forEach(r => {
        let v = r[c.key];
        if (c.money && typeof v === 'number') v = fmt(v);
        else if (c.pct && typeof v === 'number') v = (v * 100).toFixed(1) + '%';
        const len = v == null ? 0 : String(v).length;
        if (len > maxLen) maxLen = len;
      });
      ws.getColumn(i + 1).width = Math.min(Math.max(maxLen + 2, 12), 40);
    });
    if (freeze) ws.views = [{ state: 'frozen', ySplit: startRow }];
    return startRow + 1 + rows.length;
  };

  const sectionTitle = (ws, rowIdx, text, span, color) => {
    ws.mergeCells(rowIdx, 1, rowIdx, span);
    const cell = ws.getCell(rowIdx, 1);
    cell.value = text;
    cell.font = { bold: true, size: 13, color: { argb: color || DARK } };
    cell.alignment = { vertical: 'middle' };
    ws.getRow(rowIdx).height = 24;
    return rowIdx + 1;
  };

  try {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Lumers Flow';
    wb.created = new Date();

    const clientName = (typeof _brand !== 'undefined' && _brand && _brand.appName) ? _brand.appName : 'Lumers Flow';
    const periodLabel = `${MONTHS[month - 1]} ${year}`;

    // ── 1) RESUMO (com gráficos) ─────────────────────────────────────────────────
    const wsResumo = wb.addWorksheet('Resumo', { views: [{ showGridLines: false }] });
    wsResumo.getColumn(1).width = 3;

    wsResumo.mergeCells('B2:K2');
    const titleCell = wsResumo.getCell('B2');
    titleCell.value = `${clientName} — Relatório ${regimeLabel} • ${periodLabel}`;
    titleCell.font = { bold: true, size: 16, color: { argb: DARK } };
    titleCell.alignment = { vertical: 'middle' };
    wsResumo.getRow(2).height = 28;

    wsResumo.mergeCells('B3:K3');
    const subCell = wsResumo.getCell('B3');
    subCell.value = `Gerado em ${new Date().toLocaleString('pt-BR')}`;
    subCell.font = { italic: true, size: 10, color: { argb: 'FF807B6C' } };

    // KPIs (cartões)
    const kpi = (col, label, value, color) => {
      wsResumo.mergeCells(5, col, 5, col + 1);
      const c1 = wsResumo.getCell(5, col);
      c1.value = label;
      c1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
      c1.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
      c1.alignment = { horizontal: 'center', vertical: 'middle' };
      c1.border = BORDER;
      wsResumo.mergeCells(6, col, 6, col + 1);
      const c2 = wsResumo.getCell(6, col);
      c2.value = value;
      c2.numFmt = MONEY_FMT;
      c2.font = { bold: true, size: 14, color: { argb: DARK } };
      c2.alignment = { horizontal: 'center', vertical: 'middle' };
      c2.border = BORDER;
      wsResumo.getColumn(col).width = 16;
      wsResumo.getColumn(col + 1).width = 8;
    };
    kpi(2, 'RECEITAS', totalInc, PRIMARY);
    kpi(5, 'DESPESAS', totalExp, RED);
    kpi(8, 'SALDO DO MÊS', saldoMes, saldoMes >= 0 ? PRIMARY : RED);
    wsResumo.getRow(5).height = 20;
    wsResumo.getRow(6).height = 26;

    // Gráficos embutidos — renderizados OFFSCREEN (F-214) para sairem corretos
    // independentemente da aba ativa. Seleção COERENTE com o regime exportado:
    //  • compcaixa  → Competência × Caixa (regime selecionado) + Despesas por Categoria
    //  • caixa      → Fluxo de Caixa + Despesas por Categoria
    //  • competência → Evolução (Receita × Despesa) + Despesas por Categoria
    const chartSpecs = [];
    if (opts.compCaixa) {
      const ccData = (_compCaixaData && _compCaixaData[regime]) || [];
      if (ccData.length) chartSpecs.push({ config: buildCompCaixaChartConfig(ccData), label: `Competência × Caixa (${regimeLabel})` });
    } else if (isCaixa) {
      const cf = _reportData.cashFlowData || _reportData.cashMonthly || [];
      if (cf.length) chartSpecs.push({ config: buildCashChartConfig(cf), label: 'Fluxo de Caixa (caixa — realizado)' });
    } else {
      const md = _reportData.monthlyData || [];
      if (md.length) chartSpecs.push({ config: buildMainChartConfig(md), label: 'Evolução: Receita × Despesa (competência)' });
    }
    if (exportCatEntries.length) {
      chartSpecs.push({ config: buildCatChartConfig(exportCatEntries, totalExp), label: `Despesas por Categoria — ${periodLabel}` });
    }

    const chartImages = (typeof Chart !== 'undefined') ? renderChartsOffscreen(chartSpecs) : [];

    const IMG_W = 480, IMG_H = 300;
    chartImages.forEach((c, idx) => {
      const imgId = wb.addImage({ base64: c.dataUrl, extension: 'png' });
      const left = (idx % 2) === 0;
      const colIdx0 = left ? 1 : 9;                       // 0-based: B ou J
      const blockRow0 = 8 + Math.floor(idx / 2) * 18;     // 0-based linha do rótulo
      const labelCell = wsResumo.getCell(blockRow0 + 1, colIdx0 + 1);
      labelCell.value = c.label;
      labelCell.font = { bold: true, color: { argb: PRIMARY }, size: 12 };
      wsResumo.addImage(imgId, { tl: { col: colIdx0, row: blockRow0 + 1 }, ext: { width: IMG_W, height: IMG_H } });
    });

    if (!chartImages.length) {
      wsResumo.getCell('B9').value = 'Gráficos indisponíveis para este período.';
      wsResumo.getCell('B9').font = { italic: true, color: { argb: 'FF807B6C' } };
    }

    // ── 2) POR CATEGORIA ─────────────────────────────────────────────────────────
    const wsCat = wb.addWorksheet('Por Categoria');
    const catCols = [
      { key: 'name',  header: 'Categoria' },
      { key: 'total', header: 'Total', money: true },
      { key: 'pct',   header: '% do total', pct: true },
      { key: 'count', header: 'Lançamentos', align: 'right' },
    ];
    let r = sectionTitle(wsCat, 1, `Receitas por Categoria — ${periodLabel}`, catCols.length, PRIMARY);
    r = buildTable(wsCat, catCols, incCats, r, false);
    // Linha de total receitas
    const incTotRow = wsCat.getRow(r);
    incTotRow.getCell(1).value = 'TOTAL RECEITAS';
    incTotRow.getCell(1).font = { bold: true, color: { argb: PRIMARY } };
    incTotRow.getCell(2).value = totalInc;
    incTotRow.getCell(2).numFmt = MONEY_FMT;
    incTotRow.getCell(2).font = { bold: true, color: { argb: PRIMARY } };
    incTotRow.getCell(2).alignment = { horizontal: 'right' };
    r += 2;

    r = sectionTitle(wsCat, r, `Despesas por Categoria — ${periodLabel}`, catCols.length, RED);
    r = buildTable(wsCat, catCols, expCats, r, false);
    const expTotRow = wsCat.getRow(r);
    expTotRow.getCell(1).value = 'TOTAL DESPESAS';
    expTotRow.getCell(1).font = { bold: true, color: { argb: RED } };
    expTotRow.getCell(2).value = totalExp;
    expTotRow.getCell(2).numFmt = MONEY_FMT;
    expTotRow.getCell(2).font = { bold: true, color: { argb: RED } };
    expTotRow.getCell(2).alignment = { horizontal: 'right' };

    // ── 3) RECEITAS (detalhado) ──────────────────────────────────────────────────
    const detailCols = [
      { key: 'Data',       header: 'Data' },
      { key: 'Descrição',  header: 'Descrição' },
      { key: 'Categoria',  header: 'Categoria' },
      { key: 'Conta',      header: 'Conta' },
      { key: 'Valor',      header: 'Valor', money: true },
      { key: 'Status',     header: 'Status' },
      { key: 'Observação', header: 'Observação' },
    ];
    const wsInc = wb.addWorksheet('Receitas');
    buildTable(wsInc, detailCols, incRows, 1);

    // ── 4) DESPESAS (detalhado) ──────────────────────────────────────────────────
    const wsExp = wb.addWorksheet('Despesas');
    buildTable(wsExp, detailCols, expRows, 1);

    // ── 5) RESUMO ANUAL ──────────────────────────────────────────────────────────
    const wsYear = wb.addWorksheet('Resumo Anual');
    const yearCols = [
      { key: 'Mês',     header: 'Mês' },
      { key: 'Receita', header: 'Receita', money: true },
      { key: 'Despesa', header: 'Despesa', money: true },
      { key: 'Saldo',   header: 'Saldo', money: true },
    ];
    buildTable(wsYear, yearCols, resumoRows, 1);

    const filename = `Lumers_${regimeLabel}_${year}_${String(month).padStart(2, '0')}_${MONTHS[month - 1]}.xlsx`;
    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast(`Exportado: ${filename}`, 'success');
  } catch (err) {
    console.error('Falha ao exportar Excel:', err);
    toast('Erro ao gerar a planilha. Tente novamente.', 'error');
  }
}

function exportCompCaixa() {
  exportReportExcel(_compCaixaRegime, { compCaixa: true });
}
