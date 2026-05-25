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
          <div class="summary-card" style="${d.month === month ? 'border-color:var(--primary-600);box-shadow:0 0 0 2px var(--primary-100)' : ''}">
            <div class="label">${MONTHS[d.month - 1]}</div>
            <div style="font-size:.85rem;color:var(--income-text);font-weight:600">${fmt(d.income)}</div>
            <div style="font-size:.85rem;color:var(--expense);font-weight:600">${fmt(d.expense)}</div>
            <div style="font-size:.75rem;color:${d.income - d.expense >= 0 ? 'var(--income-text)' : 'var(--expense)'};margin-top:2px">
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
            boxWidth: 12,
            boxHeight: 12,
            borderRadius: 3,
            useBorderRadius: true,
          }
        }
      },
      scales: {
        y: {
          ticks: {
            callback: v => 'R$' + (v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v),
            color: '#807B6C',
            font: { family: "'Onest', system-ui, sans-serif", size: 11 }
          },
          grid: { color: '#E8E2D0', drawBorder: false }
        },
        x: {
          grid: { display: false },
          ticks: {
            color: '#807B6C',
            font: { family: "'Onest', system-ui, sans-serif", size: 11 }
          }
        }
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
        backgroundColor: entries.map(e => e.cat?.color || '#ADA897'),
        borderWidth: 2,
        borderColor: '#FFFFFF',
        hoverOffset: 8,
        hoverBorderWidth: 2,
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
            boxWidth: 10,
            boxHeight: 10,
            borderRadius: 3,
            useBorderRadius: true,
            padding: 10,
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
  });
}

function switchReportTab(tab) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.getElementById('tab-overview').style.display    = tab === 'overview'   ? '' : 'none';
  document.getElementById('tab-categories').style.display  = tab === 'categories' ? '' : 'none';

  if (tab === 'categories') setTimeout(() => catChart?.resize(), 10);
}
