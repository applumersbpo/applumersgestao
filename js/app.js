const app = {
  currentMonth: new Date().getMonth() + 1,
  currentYear:  new Date().getFullYear(),
  currentPage:  'dashboard',

  async init() {
    loadBrand();
    if (_checkResetToken()) return;
    if (!pb.authStore.isValid) {
      showAuthScreen();
      return;
    }
    await this._start();
  },

  async _start() {
    hideAuthScreen();
    this._showUser();
    await seedDefaultCategories();
    this.bindNav();
    this.bindMonthSelector();
    this.bindSidebar();

    const done = await checkOnboardingDone();
    if (!done) { showOnboarding(); return; }

    await this._resume();
  },

  async _resume() {
    initFAB();
    requestAndNotify();
    await this.route();
    if (!this._hashBound) {
      window.addEventListener('hashchange', () => this.route());
      this._hashBound = true;
    }
    if (!this._visibilityBound) {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        const now = new Date();
        const m = now.getMonth() + 1;
        const y = now.getFullYear();
        if (m !== this.currentMonth || y !== this.currentYear) {
          this.currentMonth = m;
          this.currentYear  = y;
          this.route();
        }
      });
      this._visibilityBound = true;
    }
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
    this._maybeShowWhatsAppPopup();
  },

  _maybeShowWhatsAppPopup() {
    const user = pb.authStore.model || pb.authStore.record;
    if (!user || user.phone) return;
    const key = `wa_popup_shown_${user.id}`;
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, '1');

    const el = document.createElement('div');
    el.id = 'wa-popup';
    el.style.cssText = `
      position:fixed;bottom:80px;left:50%;transform:translateX(-50%);
      width:calc(100% - 32px);max-width:400px;
      background:#fff;border-radius:16px;
      box-shadow:0 8px 32px rgba(0,0,0,.15);
      padding:20px;z-index:4000;
      animation:slideUp .3s ease
    `;
    el.innerHTML = `
      <div style="display:flex;align-items:flex-start;gap:14px">
        <div style="font-size:2rem;line-height:1;flex-shrink:0">💬</div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:.95rem;color:var(--text);margin-bottom:4px">
            Registre gastos pelo WhatsApp!
          </div>
          <p style="font-size:.82rem;color:var(--text-muted);margin:0 0 14px;line-height:1.5">
            Mande uma mensagem como <em>"gastei 35 no almoço"</em> e o lançamento entra automático no app.
            Basta cadastrar seu número com DDI e DDD nas Configurações.
          </p>
          <div style="display:flex;gap:8px">
            <button class="btn btn-primary btn-sm" style="flex:1" onclick="location.hash='#/settings';document.getElementById('wa-popup').remove()">
              Ir para Configurações
            </button>
            <button class="btn btn-ghost btn-sm" onclick="document.getElementById('wa-popup').remove()">
              Agora não
            </button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(el);
    setTimeout(() => { if (el.parentNode) el.remove(); }, 12000);
  },

  _showUser() {
    const user = pb.authStore.model || pb.authStore.record;
    const el = document.getElementById('user-name');
    if (el && user) el.textContent = user.name || user.email;

    const adminLink = document.getElementById('admin-nav-link');
    if (adminLink) {
      adminLink.style.display = user?.email === 'applumergestao@gmail.com' ? '' : 'none';
    }
    const banksLink = document.getElementById('banks-admin-link');
    if (banksLink) {
      banksLink.style.display = user?.email === 'applumergestao@gmail.com' ? '' : 'none';
    }
  },

  async route() {
    const hash = location.hash || '#/';
    const page = hash.replace('#/', '') || 'dashboard';
    this.currentPage = page || 'dashboard';
    this.updateNav();
    this.updateTitle();
    this.updateTopbarActions();
    await getOrGenerateMonth(this.currentMonth, this.currentYear);
    await this.render();
    await injectUpcomingAlert();
  },

  async render() {
    const m = this.currentMonth;
    const y = this.currentYear;

    switch (this.currentPage) {
      case 'dashboard':  await renderDashboard(m, y);  break;
      case 'bills':      await renderBills(m, y);      break;
      case 'income':     await renderIncome(m, y);     break;
      case 'expenses':   await renderExpenses(m, y);   break;
      case 'transactions': await renderTransactions(); break; // kept for backward compatibility
      case 'accounts':   await renderAccounts();       break;
      case 'banks':      await renderBanksAdmin();     break;
      case 'categories': await renderCategories();     break;
      case 'goals':      await renderGoals();          break;
      case 'reports':    await renderReports(m, y);    break;
      case 'import':     renderImport();               break;
      case 'settings':   await renderSettings();        break;
      case 'admin':      await renderAdmin();           break;
      default:           await renderDashboard(m, y);
    }
  },

  updateNav() {
    document.querySelectorAll('[data-page]').forEach(el => {
      el.classList.toggle('active', el.dataset.page === this.currentPage);
    });
  },

  updateTitle() {
    const titles = {
      dashboard:  'Dashboard',
      bills:      'Contas a Pagar',
      income:     'Receitas',
      expenses:   'Despesas',
      transactions: 'Transações',
      accounts:   'Contas Bancárias',
      banks:      'Bancos',
      categories: 'Categorias',
      goals:        'Metas Financeiras',
      reports:      'Relatórios',
      import:     'Importar Dados',
      settings:   'Configurações',
      admin:      'Usuários',
    };
    document.getElementById('pageTitle').textContent = titles[this.currentPage] || 'Dashboard';
  },

  updateTopbarActions() {
    const el = document.getElementById('topbarActions');
    const showMonth = ['dashboard', 'bills', 'transactions', 'income', 'expenses', 'reports'].includes(this.currentPage);

    if (showMonth) {
      el.innerHTML = `
        <div class="month-selector">
          <button onclick="app.prevMonth()" title="Mês anterior">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 12L6 8l4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <span class="month-label">${monthLabel(this.currentMonth, this.currentYear)}</span>
          <button onclick="app.nextMonth()" title="Próximo mês">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
      `;
    } else {
      el.innerHTML = '';
    }
  },

  async prevMonth() {
    if (this.currentMonth === 1) {
      this.currentMonth = 12;
      this.currentYear--;
    } else {
      this.currentMonth--;
    }
    this.updateTopbarActions();
    await getOrGenerateMonth(this.currentMonth, this.currentYear);
    await this.render();
  },

  async nextMonth() {
    if (this.currentMonth === 12) {
      this.currentMonth = 1;
      this.currentYear++;
    } else {
      this.currentMonth++;
    }
    this.updateTopbarActions();
    await getOrGenerateMonth(this.currentMonth, this.currentYear);
    await this.render();
  },

  bindNav() {
    document.querySelectorAll('.nav-item, .bottom-nav-item').forEach(link => {
      link.addEventListener('click', () => {
        document.getElementById('sidebar').classList.remove('open');
        document.getElementById('overlay').classList.remove('visible');
      });
    });
  },

  bindSidebar() {
    const sidebar  = document.getElementById('sidebar');
    const overlay  = document.getElementById('overlay');
    const menuBtn  = document.getElementById('menuBtn');
    const closeBtn = document.getElementById('sidebarClose');

    menuBtn.addEventListener('click', () => {
      sidebar.classList.add('open');
      overlay.classList.add('visible');
    });
    closeBtn.addEventListener('click', () => {
      sidebar.classList.remove('open');
      overlay.classList.remove('visible');
    });
    overlay.addEventListener('click', () => {
      sidebar.classList.remove('open');
      overlay.classList.remove('visible');
    });
  },

  bindMonthSelector() {}
};

document.addEventListener('DOMContentLoaded', () => app.init());
