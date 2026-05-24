const CACHE = 'visibill-v23';
const ASSETS = [
  './',
  './index.html',
  './css/app.css',
  './js/db.js',
  './js/utils.js',
  './js/app.js',
  './js/fab.js',
  './js/pages/dashboard.js',
  './js/pages/bills.js',
  './js/pages/daily.js',
  './js/pages/income.js',
  './js/pages/categories.js',
  './js/pages/recurring.js',
  './js/pages/installments.js',
  './js/pages/goals.js',
  './js/pages/reports.js',
  './js/pages/expenses.js',
  './js/pages/import.js',
  './js/pages/settings.js',
  './js/pages/admin.js',
  './js/pages/onboarding.js',
  './js/notifications.js',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.url.includes('/api/')) return;
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});

self.addEventListener('push', e => {
  const data = e.data?.json() || {};
  e.waitUntil(
    self.registration.showNotification(data.title || 'Visibill', {
      body:  data.body  || '',
      icon:  '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data,
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.openWindow('/'));
});
