let reportChart = null;
let catChart = null;

async function renderReports(month, year) {
  const content = document.getElementById('content');

  const [allTransactions, catsMap] = await Promise.all([
    db.transactions.filter(`year = ${year}`).toArray(),
    getCategoriesMap()
  ]);

  const EXPENSE_TYPES = ['expense', 'installment', 'general', 'daily'];

  const monthlyData = Array.from({ length: 12 }, (_, i) => {
    const m = i + 1;
    const txs = allTransactions.filter(t => t.month === m);
    return {
      month: m,
      income:  txs.filter(t => t.transaction_type === 'income').reduce((s, t) => s + (t.amount || 0), 0),
      expense: txs.filter(t => EXPENSE_TYPES.includes(t.transaction_type)).reduce((s, t) => s + (t.amount || 0), 0),
    };
  });

  const currentTxs  = allTransactions.filter(t => t.month === month);
  const expenseTxs  = currentTxs.filter(t => EXPENSE_TYPES.includes(t.transaction_type));
  const totalExp    = expenseTxs.reduce((s, t) => s + (t.amount || 0), 0);

  const catTotals = {};
  expenseTxs.forEach(t => {
    const key = t.category_id || 'none';
    catTotals[key] = (catTotals[key] || 0) + (t.amount || 0);
  });

  const catEntries = Object.entries(catTotals)
    .map(([id, val]) => ({ cat: catsMap[id], val }))
    .sort((a, b) => b.val - a.val);

  content.innerHTML = `
    <div class="tabs">
      <div class="tab active" data-tab="overview"    onclick="switchReportTab('overview')">Visão Geral</div>
      <div class="tab"        data-tab="categories"  onclick="switchReportTab('categories')">Por Categoria</div>
    </div>

    <div id="tab-overview">
      <div class="card" style="margin-bottom:24px">
        <div class="section-header">
          <div class="section-title">Receita vs Despesa — ${year}</div>
        </div>
        <div class="chart-container">
          <canvas id="main-chart"></canvas>
        </div>
      </div>

      <div class="summary-grid">
        ${monthlyData.map(d => `
          <div class="summary-card" style="${d.month === month ? 'border-color:var(--primary);box-shadow:0 0 0 2px var(--primary-light)' : ''}">
            <div class="label">${MONTHS[d.month - 1]}</div>
            <div style="font-size:.85rem;color:var(--income);font-weight:600">${fmt(d.income)}</div>
            <div style="font-size:.85rem;color:var(--expense);font-weight:600">${fmt(d.expense)}</div>
            <div style="font-size:.75rem;color:${d.income - d.expense >= 0 ? 'var(--income)' : 'var(--expense)'};margin-top:2px">
              ${fmt(d.income - d.expense)}
            </div>
          </div>
        `).join('')}
      </div>
    </div>

    <div id="tab-categories" style="display:none">
      <div class="card" style="margin-bottom:24px">
        <div class="section-header">
          <div class="section-title">Despesas por Categoria — ${MONTHS[month - 1]}</div>
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
            const color = cat?.color || '#94a3b8';
            return `
              <div>
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
                  <span style="font-size:.85rem;font-weight:600">${cat ? (cat.icon + ' ' + cat.name) : 'Sem categoria'}</span>
                  <span style="font-size:.85rem;font-weight:700;color:var(--expense)">${fmt(val)} <span style="color:var(--text-muted);font-weight:400">(${pct}%)</span></span>
                </div>
                <div class="progress-bar">
                  <div class="progress-fill" style="width:${pct}%;background:${color}"></div>
                </div>
              </div>
            `;
          }).join('')}
        </div>`}
      </div>
    </div>
  `;

  renderMainChart(monthlyData, month);
  renderCatChart(catEntries, totalExp);
}

function renderMainChart(data, currentMonth) {
  if (reportChart) { reportChart.destroy(); reportChart = null; }
  const ctx = document.getElementById('main-chart')?.getContext('2d');
  if (!ctx) return;

  reportChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: MONTHS.map(m => m.substring(0, 3)),
      datasets: [
        {
          label: 'Receita',
          data: data.map(d => d.income),
          backgroundColor: '#10b98133',
          borderColor: '#10b981',
          borderWidth: 2,
          borderRadius: 6,
        },
        {
          label: 'Despesa',
          data: data.map(d => d.expense),
          backgroundColor: '#ef444433',
          borderColor: '#ef4444',
          borderWidth: 2,
          borderRadius: 6,
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'top' } },
      scales: {
        y: {
          ticks: { callback: v => 'R$' + (v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v) },
          grid: { color: '#f1f5f9' }
        },
        x: { grid: { display: false } }
      }
    }
  });
}

function renderCatChart(entries, total) {
  if (catChart) { catChart.destroy(); catChart = null; }
  const ctx = document.getElementById('cat-chart')?.getContext('2d');
  if (!ctx || entries.length === 0) return;

  catChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: entries.map(e => e.cat ? e.cat.name : 'Outros'),
      datasets: [{
        data: entries.map(e => e.val),
        backgroundColor: entries.map(e => e.cat?.color || '#94a3b8'),
        borderWidth: 0,
        hoverOffset: 8
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right' },
        tooltip: {
          callbacks: {
            label: ctx => ` ${fmt(ctx.parsed)} (${total > 0 ? Math.round(ctx.parsed / total * 100) : 0}%)`
          }
        }
      },
      cutout: '65%'
    }
  });
}

function switchReportTab(tab) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.getElementById('tab-overview').style.display    = tab === 'overview'   ? '' : 'none';
  document.getElementById('tab-categories').style.display  = tab === 'categories' ? '' : 'none';

  if (tab === 'categories') setTimeout(() => catChart?.resize(), 10);
}
