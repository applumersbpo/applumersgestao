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
        <div style="flex-shrink:0;color:var(--income)"><i data-lucide="message-circle" style="width:32px;height:32px"></i></div>
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
    if (typeof lucide !== 'undefined') lucide.createIcons();
    setTimeout(() => { if (el.parentNode) el.remove(); }, 12000);
  },

  _showUser() {
    const user = pb.authStore.model || pb.authStore.record;
    const el = document.getElementById('user-name');
    if (el && user) el.textContent = user.name || user.email;

    const isAdmin = user?.email === 'applumergestao@gmail.com' || !!user?.is_admin || user?.role === 'admin' || user?.role === 'super_admin';
    const adminLink = document.getElementById('admin-nav-link');
    if (adminLink) adminLink.style.display = isAdmin ? '' : 'none';
    const banksLink = document.getElementById('banks-admin-link');
    if (banksLink) banksLink.style.display = isAdmin ? '' : 'none';
    const adminUsersLink = document.getElementById('admin-users-link');
    if (adminUsersLink) adminUsersLink.style.display = isAdmin ? '' : 'none';

    const isSuperAdmin2 = user?.role === 'super_admin' || user?.email === 'applumergestao@gmail.com';
    const adminSystemLink = document.getElementById('admin-system-link');
    if (adminSystemLink) adminSystemLink.style.display = isSuperAdmin2 ? '' : 'none';

    // Sidebar profile
    const profileName   = document.getElementById('sidebar-profile-name');
    const profileRole   = document.getElementById('sidebar-profile-role');
    const profileAvatar = document.getElementById('sidebar-profile-avatar');
    if (profileName)   profileName.textContent  = (user?.name || user?.email?.split('@')[0] || 'Usuário');
    if (profileRole)   profileRole.textContent  = user?.role === 'super_admin' ? 'Super Admin' : user?.role === 'admin' ? 'Admin' : 'Usuário';
    if (profileAvatar) {
      if (user?.avatar) {
        profileAvatar.innerHTML = `<img src="${user.avatar}" alt="${user.name || ''}">`;
      } else {
        profileAvatar.textContent = (user?.name || user?.email || 'U').charAt(0).toUpperCase();
      }
    }
  },

  async route() {
    if (typeof destroyBulkMode === 'function' && _Bulk?.active) destroyBulkMode();
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

    try {
      switch (this.currentPage) {
        case 'dashboard':  await renderDashboard(m, y);  break;
  
        case 'income':     await renderIncome(m, y);     break;
        case 'expenses':   await renderExpenses(m, y);   break;
        case 'transactions': await renderTransactions(); break; // kept for backward compatibility
case 'accounts':   await renderAccounts();       break;
        case 'banks':      await renderBanksAdmin();     break;
        case 'categories': await renderCategories();     break;
        case 'goals':      await renderGoals();          break;
        case 'reports':         await renderReports(m, y);         break;
        case 'annual-reports':  await renderAnnualReports(y);     break;
        case 'import':     renderImport();               break;
        case 'settings':   await renderSettings();        break;
        case 'investments':  await renderInvestments();    break;
        case 'assets':       await renderAssets();         break;
        case 'wealth':       await renderWealth();         break;
        case 'admin':      await renderAdmin();           break;
        case 'admin-users':  await renderAdminUsers();  break;
        case 'admin-system': await renderAdminSystem(); break;
        case 'admin-plans':  await renderAdminPlans();  break;
        default:           await renderDashboard(m, y);
      }
      if (typeof lucide !== 'undefined') lucide.createIcons();
    } catch (err) {
      console.error('Render error:', err);
      const content = document.getElementById('content');
      if (content) {
        content.innerHTML = `
          <div class="empty-state">
            <i data-lucide="file-x-2" style="width:40px;height:40px;opacity:.4"></i>
            <p>Erro ao carregar a página: ${err?.message || 'Erro inesperado'}</p>
            <pre style="white-space:pre-wrap;color:var(--text-muted);font-size:.8rem;margin-top:8px">${(err && err.stack) ? String(err.stack).substring(0, 1000) : ''}</pre>
          </div>`;
        if (typeof lucide !== 'undefined') lucide.createIcons();
      }
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
      income:     'Receitas',
      expenses:   'Despesas',
      transactions: 'Transações',
      accounts:   'Contas Bancárias',
      banks:      'Bancos',
      categories: 'Categorias',
      goals:        'Metas Financeiras',
      reports:          'Relatórios',
      'annual-reports': 'Fluxo Anual',
      investments:  'Investimentos',
      assets:       'Patrimônio Físico',
      wealth:       'Meu Patrimônio',
import:     'Importar Dados',
      settings:   'Configurações',
      admin:        'Admin — Dashboard',
      'admin-users':  'Usuários',
      'admin-system': 'Configurações do Sistema',
      'admin-plans':  'Planos de Assinatura',
    };
    document.getElementById('pageTitle').textContent = titles[this.currentPage] || 'Dashboard';
  },

  updateTopbarActions() {
    const el = document.getElementById('topbarActions');
    const showMonth = ['dashboard', 'transactions', 'income', 'expenses', 'reports'].includes(this.currentPage);

    if (showMonth) {
      el.innerHTML = `
        <div class="month-selector">
          <button onclick="app.prevMonth()" title="Mês anterior">
            <i data-lucide="chevron-left" style="width:16px;height:16px"></i>
          </button>
          <span class="month-label">${monthLabel(this.currentMonth, this.currentYear)}</span>
          <button onclick="app.nextMonth()" title="Próximo mês">
            <i data-lucide="chevron-right" style="width:16px;height:16px"></i>
          </button>
        </div>
      `;
      if (typeof lucide !== 'undefined') lucide.createIcons();
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
    document.querySelectorAll('.nav-item, .bottom-nav-item, .sidebar-user-name--link').forEach(link => {
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
