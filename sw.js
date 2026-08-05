const CACHE_STATIC = 'lumers-v71';

const SHELL_ASSETS = [
  './',
  './index.html',
  './css/app.css',
  './js/db.js',
  './js/utils.js',
  './js/app.js',
  './js/fab.js',
  './js/brand.js',
  './js/banks-logos.js',
  './js/pages/dashboard.js',
  './js/pages/bills.js',
  './js/pages/daily.js',
  './js/pages/income.js',
  './js/pages/categories.js',
  './js/pages/recurring.js',
  './js/pages/installments.js',
  './js/pages/goals.js',
  './js/pages/reports.js',
  './js/pages/annual-reports.js',
  './js/pages/expenses.js',
  './js/pages/import.js',
  './js/pages/settings.js',
  './js/pages/admin.js',
  './js/pages/onboarding.js',
  './js/pages/accounts.js',
  './js/pages/banks-admin.js',
  './js/pages/transactions.js',
  './js/notifications.js',
  './lumers-flow-logotipo.png',
  './lumers-atualizacao.png',
  './favicon-lumers-flow.png',
  './logos/banks/banco-do-brasil.svg',
  './logos/banks/bradesco.svg',
  './logos/banks/itau.svg',
  './logos/banks/caixa.svg',
  './logos/banks/santander.svg',
  './logos/banks/safra.svg',
  './logos/banks/btg.svg',
  './logos/banks/bv.svg',
  './logos/banks/banrisul.svg',
  './logos/banks/bmg.svg',
  './logos/banks/daycoval.svg',
  './logos/banks/sofisa.svg',
  './logos/banks/brb.svg',
  './logos/banks/banestes.svg',
  './logos/banks/bnb.svg',
  './logos/banks/basa.svg',
  './logos/banks/bs2.svg',
  './logos/banks/abc.svg',
  './logos/banks/pine.svg',
  './logos/banks/arbi.svg',
  './logos/banks/original.svg',
  './logos/banks/bnp.svg',
  './logos/banks/nubank.svg',
  './logos/banks/inter.svg',
  './logos/banks/c6.svg',
  './logos/banks/neon.svg',
  './logos/banks/xp.svg',
  './logos/banks/infinitepay.svg',
  './logos/banks/conta-simples.svg',
  './logos/banks/cora.svg',
  './logos/banks/asaas.svg',
  './logos/banks/efi.svg',
  './logos/banks/transfeera.svg',
  './logos/banks/mercadopago.svg',
  './logos/banks/pagseguro.svg',
  './logos/banks/pagbank.svg',
  './logos/banks/stone.svg',
  './logos/banks/picpay.svg',
  './logos/banks/recargapay.svg',
  './logos/banks/sicoob.svg',
  './logos/banks/sicredi.svg',
  './logos/banks/cresol.svg',
  './logos/banks/unicred.svg',
  './logos/banks/credisis.svg',
  './logos/banks/uniprime.svg',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_STATIC).then(c => c.addAll(SHELL_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_STATIC).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const { request } = e;
  const url = new URL(request.url);

  // API: nunca cacheia
  if (url.pathname.includes('/api/')) return;

  // HTML: Network First → fallback cache (sempre recebe versão mais nova quando online)
  if (request.destination === 'document' || url.pathname === '/' || url.pathname.endsWith('.html')) {
    e.respondWith(
      fetch(request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE_STATIC).then(c => c.put(request, clone));
          return res;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Imagens e ícones: Cache First (raramente mudam)
  if (request.destination === 'image' || /\.(png|svg|ico|webp|jpg|jpeg)$/.test(url.pathname)) {
    e.respondWith(
      caches.match(request).then(cached => cached || fetch(request).then(res => {
        const clone = res.clone();
        caches.open(CACHE_STATIC).then(c => c.put(request, clone));
        return res;
      }))
    );
    return;
  }

  // JS e CSS: Stale-While-Revalidate (serve cache, atualiza em background)
  e.respondWith(
    caches.open(CACHE_STATIC).then(cache =>
      cache.match(request).then(cached => {
        const networkFetch = fetch(request).then(res => {
          cache.put(request, res.clone());
          return res;
        });
        return cached || networkFetch;
      })
    )
  );
});

self.addEventListener('push', e => {
  const data = e.data?.json() || {};
  e.waitUntil(
    self.registration.showNotification(data.title || 'Lumers Gestão Financeira', {
      body:  data.body  || '',
      icon:  '/favicon-lumers-flow.png',
      badge: '/favicon-lumers-flow.png',
      data,
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.openWindow('/'));
});
