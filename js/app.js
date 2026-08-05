const app = {
  currentMonth: new Date().getMonth() + 1,
  currentYear:  new Date().getFullYear(),
  currentPage:  'dashboard',

  get isImpersonating() { return _store.isImpersonating; },

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
    this._showImpersonationNotice();
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

  _showImpersonationNotice() {
    const notice = sessionStorage.getItem('_lg_imp_notice');
    if (!notice) return;
    sessionStorage.removeItem('_lg_imp_notice');
    setTimeout(() => { if (typeof toast === 'function') toast(notice, 'error'); }, 400);
  },

  // Banner fixo "Vendo como <usuário> — somente leitura" + classe global no body.
  _updateImpersonationBanner(user) {
    const on = _store.isImpersonating;
    document.body.classList.toggle('impersonating', on);
    if (on) {
      const nameEl = document.getElementById('imp-banner-name');
      if (nameEl) nameEl.textContent = (user?.name || user?.email || 'usuário');
    }
  },

  // Lista explícita das funções de MUTAÇÃO acionadas via onclick nas páginas do
  // usuário (criar/editar/excluir/pagar/seleção em massa/importar). Mirar nomes
  // conhecidos — em vez de um regex genérico de verbos — evita ocultar modais de
  // VISUALIZAÇÃO que compartilham verbos (ex.: openChangelogModal, openValuationsModal,
  // openMsgHistoryModal) e preserva navegação/exportação no modo somente-leitura.
  // O backend continua sendo a fonte de verdade (já rejeita o token de impersonação);
  // isto é apenas UX coerente: não oferecer a ação.
  _IMP_MUTATION_HANDLERS: [
    // Abrir modais de criação/edição ("Novo/Editar X")
    'openExpenseModal', 'openIncomeModal', 'openAccountModal', 'openBankModal',
    'openCategoryModal', 'openGoalModal', 'openRevenueGoalModal', 'openInvestmentModal',
    'openInvTxModal', 'openAssetModal', 'openInstallmentModal', 'openRecurringModal',
    'openBillModal', 'openDailyModal', 'openTransactionModal',
    // Atualizar (modal dedicado de mutação → save)
    'openUpdateGoalModal', 'openUpdatePriceModal', 'updateGoalAmount',
    'editGoal', 'editInstallment',
    // Excluir
    'deleteAccount', 'deleteAsset', 'deleteGoal', 'deleteInstallment', 'deleteInvestment',
    'confirmDeleteAccount',
    // Pagar / desfazer pagamento
    'openPayInstallmentModal', 'unpayInstallment',
    // Ações em massa (e entrar no modo de seleção em massa, precursor da mutação)
    'bulkAccDelete', 'bulkBanksDelete', 'bulkBanksPublish', 'bulkCatDelete',
    'bulkExpenseDelete', 'bulkExpensePay', 'bulkGoalsDelete', 'bulkIncomeDelete',
    'bulkIncomeReceive', 'toggleAccBulk', 'toggleBanksBulk', 'toggleCatBulk',
    'toggleExpenseBulk', 'toggleGoalsBulk', 'toggleIncomeBulk',
    // Adição rápida / importação
    'quickAddCategory', 'addAllSuggestions', 'confirmImport', 'confirmJsonImport',
    // Salvar (botões inline em #content — ex.: Configurações: perfil/telefone/senha)
    'saveAccount', 'saveAsset', 'saveBank', 'saveBill', 'saveCategory', 'saveDaily',
    'saveExpense', 'saveGoal', 'saveIncome', 'saveInstallment', 'saveInvTx',
    'saveInvestment', 'saveTransaction', 'saveRecurring', 'saveValuation',
    'saveUpdatePrice', 'saveProfileName', 'savePhone', 'savePassword', 'saveQuickAdd',
  ],

  // Read-only UX: enquanto impersonando, oculta SOMENTE os gatilhos de mutação
  // conhecidos (whitelist acima). Visualizar/navegar/exportar continuam disponíveis.
  _applyImpersonationReadOnly() {
    if (!_store.isImpersonating) return;
    const content = document.getElementById('content');
    if (!content) return;
    // Casa "handler(" para qualquer função de mutação conhecida, mesmo quando o
    // onclick encadeia/embrulha a chamada (ex.: "if(confirm(...)) deleteGoal(id)").
    const MUT = new RegExp('\\b(' + this._IMP_MUTATION_HANDLERS.join('|') + ')\\s*\\(');
    content.querySelectorAll('[onclick]').forEach(el => {
      if (MUT.test(el.getAttribute('onclick') || '')) el.style.display = 'none';
    });
  },

  _showUser() {
    const user = pb.authStore.model || pb.authStore.record;
    this._updateImpersonationBanner(user);
    const el = document.getElementById('user-name');
    if (el && user) el.textContent = user.name || user.email;

    const isAdmin = user?.email === 'applumergestao@gmail.com' || !!user?.is_admin || user?.role === 'admin' || user?.role === 'super_admin';
    // Sidebar: entrada única "Painel Admin" (as demais áreas ficam nas abas internas do painel)
    const adminLink = document.getElementById('admin-nav-link');
    if (adminLink) adminLink.style.display = isAdmin ? '' : 'none';
    const adminSectionLabel = document.getElementById('admin-section-label');
    if (adminSectionLabel) adminSectionLabel.style.display = isAdmin ? '' : 'none';

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

    const versionEl = document.querySelector('.sidebar-version');
    if (versionEl) {
      if (isAdmin) {
        versionEl.classList.add('clickable');
        versionEl.title = 'Ver histórico de versões';
        versionEl.onclick = () => openChangelogModal();
      } else {
        versionEl.classList.remove('clickable');
        versionEl.onclick = null;
        versionEl.removeAttribute('title');
      }
    }
  },

  async route() {
    if (typeof destroyBulkMode === 'function' && _Bulk?.active) destroyBulkMode();
    // Defensivo: se o usuário deixou o editor de e-mail em tela cheia aberto e
    // navegou por hashchange (sidebar), o _adminEmailBuilderDestroy não roda —
    // garante que o scroll-lock do body nunca fique preso entre páginas.
    document.body.classList.remove('em-fullscreen-open');
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
        case 'admin-email':  await renderAdminEmail();  break;
        case 'admin-theme':  await renderAdminTheme();  break;
        case 'admin-plans':  await renderAdminPlans();  break;
        case 'admin-logs':   await renderAdminLogs();   break;
        default:           await renderDashboard(m, y);
      }
      if (typeof lucide !== 'undefined') lucide.createIcons();
      this._applyImpersonationReadOnly();
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
    // Subpáginas do painel admin mantêm o item único "Painel Admin" destacado
    const adminPages = ['admin', 'admin-users', 'admin-system', 'admin-email', 'admin-theme', 'admin-plans', 'admin-logs', 'banks'];
    const inAdmin = adminPages.includes(this.currentPage);
    document.querySelectorAll('[data-page]').forEach(el => {
      const isActive = el.dataset.page === this.currentPage
        || (inAdmin && el.dataset.page === 'admin');
      el.classList.toggle('active', isActive);
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
      admin:        'Painel Admin — Visão Geral',
      'admin-users':  'Usuários',
      'admin-system': 'Configurações do Sistema',
      'admin-email':  'Comunicação',
      'admin-theme':  'Tema & Identidade Visual',
      'admin-plans':  'Planos de Assinatura',
      'admin-logs':   'Logs do Sistema',
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
          <button class="month-label" onclick="app.openMonthPicker()" title="Escolher mês/ano" style="background:none;border:none;font:inherit;color:inherit;cursor:pointer;display:inline-flex;align-items:center;gap:5px">
            ${monthLabel(this.currentMonth, this.currentYear)}
            <i data-lucide="chevron-down" style="width:14px;height:14px;opacity:.6"></i>
          </button>
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

  openMonthPicker() {
    const y = this._pickerYear || this.currentYear;
    const months = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
    const grid = months.map((mn, i) => {
      const m = i + 1;
      const isCur = m === this.currentMonth && y === this.currentYear;
      return `<button class="btn ${isCur ? 'btn-primary' : 'btn-ghost'}" style="padding:12px 0" onclick="app.goToMonth(${m}, ${y})">${mn}</button>`;
    }).join('');
    showModal(`
      <div class="modal-backdrop">
        <div class="modal" style="max-width:360px">
          <div class="modal-header">
            <div class="modal-title">Escolher mês</div>
            <button class="btn btn-icon btn-ghost" onclick="closeModal()">✕</button>
          </div>
          <div class="modal-body">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
              <button class="btn btn-icon btn-ghost" onclick="app.pickerYear(${y - 1})">${icon('chevron-left', 16)}</button>
              <strong style="font-size:1.1rem">${y}</strong>
              <button class="btn btn-icon btn-ghost" onclick="app.pickerYear(${y + 1})">${icon('chevron-right', 16)}</button>
            </div>
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">${grid}</div>
            <button class="btn btn-outline" style="width:100%;margin-top:14px" onclick="app.goToMonth(${new Date().getMonth() + 1}, ${new Date().getFullYear()})">Ir para o mês atual</button>
          </div>
        </div>
      </div>
    `);
  },

  pickerYear(y) {
    this._pickerYear = y;
    this.openMonthPicker();
  },

  async goToMonth(month, year) {
    this._pickerYear = null;
    this.currentMonth = month;
    this.currentYear = year;
    closeModal();
    this.updateTopbarActions();
    await getOrGenerateMonth(this.currentMonth, this.currentYear);
    await this.render();
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
