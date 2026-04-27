// sw.js
const CACHE_NAME = 'reminder-app-v1';

self.addEventListener('install', (event) => {
  console.log('Service Worker установлен');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('Service Worker активирован');
  event.waitUntil(clients.claim());
});

self.addEventListener('push', (event) => {
  console.log('Push получен:', event);
  
  let data = {
    title: '🔔 Напоминание',
    body: 'У вас новое напоминание!',
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    timestamp: Date.now()
  };
  
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data.body = event.data.text();
    }
  }
  
  const options = {
    body: data.body,
    icon: data.icon || '/favicon.ico',
    badge: data.badge || '/favicon.ico',
    vibrate: [200, 100, 200],
    data: {
      url: '/',
      reminderId: data.reminderId,
      timestamp: data.timestamp
    },
    actions: [
      {
        action: 'snooze',
        title: 'Отложить на 5 минут'
      },
      {
        action: 'close',
        title: 'Закрыть'
      }
    ]
  };
  
  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

self.addEventListener('notificationclick', (event) => {
  console.log('Notification клик:', event.action);
  
  event.notification.close();
  
  if (event.action === 'snooze') {
    const reminderId = event.notification.data?.reminderId;
    if (reminderId) {
      fetch(`http://localhost:3001/snooze?reminderId=${reminderId}`, {
        method: 'POST'
      }).catch(err => console.error('Snooze error:', err));
    }
  }
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(windowClients => {
        if (windowClients.length > 0) {
          windowClients[0].focus();
        } else {
          clients.openWindow('/');
        }
      })
  );
});