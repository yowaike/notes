const contentDiv = document.getElementById('app-content');
const homeBtn = document.getElementById('home-btn');
const aboutBtn = document.getElementById('about-btn');
const enableBtn = document.getElementById('enable-push');
const disableBtn = document.getElementById('disable-push');
const socket = io('http://localhost:3001');

let mainDatetimeValue = '';
let modalDatetimeValue = '';
let notesCache = [];

// --- Навигация ---
function setActiveButton(activeId) {
    [homeBtn, aboutBtn].forEach(btn => btn.classList.remove('active'));
    document.getElementById(activeId).classList.add('active');
}

async function loadContent(page) {
  try {
    const response = await fetch(`/content/${page}.html`);
    const html = await response.text();
    contentDiv.innerHTML = html;
    if (page === 'home') {
      initNotes();
      // Показываем кнопки уведомлений только на главной
      if (enableBtn) enableBtn.style.display = '';
      if (disableBtn) disableBtn.style.display = '';
      updatePushUI();
    } else if (page === 'about') {
      // Скрываем кнопки на странице "О приложении"
      if (enableBtn) enableBtn.style.display = 'none';
      if (disableBtn) disableBtn.style.display = 'none';
    }
  } catch (err) {
    contentDiv.innerHTML = `<p style="color:#ff6b6b; text-align:center; padding: 2rem;">Ошибка загрузки страницы</p>`;
  }
}

homeBtn.addEventListener('click', () => { setActiveButton('home-btn'); loadContent('home'); });
aboutBtn.addEventListener('click', () => { setActiveButton('about-btn'); loadContent('about'); });
loadContent('home');

// --- Утилиты: Модальные окна ---
function createModal(title, bodyHTML, onConfirm, onCancel, confirmText = 'Сохранить', cancelText = 'Отмена', confirmClass = 'modal-btn-confirm') {
    const old = document.querySelector('.modal-overlay');
    if (old) old.remove();
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header"><h3>${title}</h3>
        <button class="modal-close" aria-label="Закрыть"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>
      </div>
      <div class="modal-body">${bodyHTML}</div>
      <div class="modal-footer">
        <button class="modal-btn modal-btn-cancel">${cancelText}</button>
        <button class="modal-btn ${confirmClass}">${confirmText}</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);

    const close = () => { overlay.remove(); if (onCancel) onCancel(); };
    overlay.querySelector('.modal-close').addEventListener('click', close);
    overlay.querySelector('.modal-btn-cancel').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    overlay.querySelector(`.${confirmClass}`).addEventListener('click', () => {
        const textInput = overlay.querySelector('.modal-text-input');
        const textVal = textInput ? textInput.value : '';
        const display = overlay.querySelector('.datetime-display');
        const dtVal = display ? display.dataset.value : '';
        overlay.remove();
        if (onConfirm) onConfirm(textVal, dtVal);
    });
    return overlay;
}

function showDeleteConfirmation(id) {
    const note = notesCache.find(n => n.id === id);
    const noteText = note ? note.text : 'эту заметку';
    createModal('Удаление заметки', `<p class="modal-message">Вы уверены, что хотите удалить «${noteText}»?</p>`,
        () => {
            notesCache = notesCache.filter(n => n.id !== id);
            localStorage.setItem('notes', JSON.stringify(notesCache));
            loadNotes();
            showToast('Заметка удалена');
        }, null, 'Удалить', 'Отмена', 'modal-btn-danger'
    );
}

function showEditModal(note) {
    modalDatetimeValue = note.reminder ? new Date(note.reminder).toISOString().slice(0, 16) : '';
    const safeText = note.text.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const bodyHTML = `
    <div class="modal-field">
      <label>Текст заметки</label>
      <input type="text" class="modal-text-input" value="${safeText}" placeholder="Введите текст" style="width: 100%; box-sizing: border-box;">
    </div>
    <div class="modal-field modal-datetime-field">
      <label>Напоминание</label>
      <div class="datetime-picker-wrapper">
        <div class="datetime-display" id="modal-datetime-display" data-value="${modalDatetimeValue}">${modalDatetimeValue ? formatDateDisplay(modalDatetimeValue) : 'Не установлено'}</div>
        <button type="button" class="datetime-toggle" id="modal-datetime-toggle">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
            <line x1="16" y1="2" x2="16" y2="6"></line>
            <line x1="8" y1="2" x2="8" y2="6"></line>
            <line x1="3" y1="10" x2="21" y2="10"></line>
          </svg>
        </button>
        <div class="datetime-dropdown" id="modal-datetime-dropdown" style="display:none;">
          <div class="datetime-calendar" id="modal-calendar-container"></div>
          <button type="button" class="calendar-apply-btn">Готово</button>
        </div>
      </div>
    </div>`;

    createModal('Редактировать заметку', bodyHTML, (newText, newDtVal) => {
        if (!newText.trim()) return;
        let reminder = null;
        if (newDtVal && newDtVal.trim() !== '') {
            const ts = new Date(newDtVal).getTime();
            if (ts > Date.now()) reminder = ts;
        }
        note.text = newText.trim();
        note.reminder = reminder;
        notesCache = notesCache.map(n => n.id === note.id ? note : n);
        localStorage.setItem('notes', JSON.stringify(notesCache));
        loadNotes();
        if (reminder) {
            socket.emit('newReminder', { id: note.id, text: note.text, reminderTime: reminder });
        }
        showToast('Заметка обновлена');
    }, null, 'Сохранить', 'Отмена');

    setTimeout(() => {
        initCalendar('modal-datetime-display', 'modal-datetime-toggle', 'modal-datetime-dropdown', 'modal-calendar-container',
            (val) => { modalDatetimeValue = val; }, modalDatetimeValue);
    }, 50);
}

// --- Календарь ---
function initCalendar(displayId, toggleId, dropdownId, containerId, onValueChange, initialValue) {
    const display = document.getElementById(displayId);
    const toggle = document.getElementById(toggleId);
    const dropdown = document.getElementById(dropdownId);
    const container = document.getElementById(containerId);
    const applyBtn = dropdown ? dropdown.querySelector('.calendar-apply-btn') : null;
    if (!container || !dropdown) return;

    const now = new Date();
    let currentMonth = now.getMonth(), currentYear = now.getFullYear(), selectedDay = null, selectedHour = 12, selectedMinute = 0;
    if (initialValue) {
        const d = new Date(initialValue);
        currentYear = d.getFullYear(); currentMonth = d.getMonth();
        selectedDay = d.getDate(); selectedHour = d.getHours(); selectedMinute = d.getMinutes();
    }

    const monthNames = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

    function render() {
        container.innerHTML = `<div class="cal-grid-wrapper"><div class="cal-nav"><button type="button" class="cal-nav-btn prev">‹</button><span class="cal-month-year">${monthNames[currentMonth]} ${currentYear}</span><button type="button" class="cal-nav-btn next">›</button></div><div class="cal-grid-content"><div class="cal-side-left"><div class="cal-weekdays"><span>Пн</span><span>Вт</span><span>Ср</span><span>Чт</span><span>Пт</span><span>Сб</span><span>Вс</span></div><div class="cal-days"></div></div><div class="cal-side-right"><div class="time-section"><label>Часы</label><div class="time-scroll time-h"></div></div><div class="time-section"><label>Мин</label><div class="time-scroll time-m"></div></div></div></div></div>`;

        const daysContainer = container.querySelector('.cal-days');
        const firstDay = new Date(currentYear, currentMonth, 1).getDay();
        const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
        const startDay = firstDay === 0 ? 6 : firstDay - 1;
        for (let i = 0; i < startDay; i++) daysContainer.innerHTML += '<div class="cal-day empty"></div>';
        for (let day = 1; day <= daysInMonth; day++) {
            const isToday = day === now.getDate() && currentMonth === now.getMonth() && currentYear === now.getFullYear();
            const isSelected = day === selectedDay;
            const isPast = new Date(currentYear, currentMonth, day) < new Date(new Date().setHours(0, 0, 0, 0));
            let cls = 'cal-day';
            if (isSelected) cls += ' selected';
            if (isToday) cls += ' today';
            if (isPast) cls += ' past';
            daysContainer.innerHTML += `<div class="${cls}" data-day="${day}">${day}</div>`;
        }

        daysContainer.querySelectorAll('.cal-day:not(.empty):not(.past)').forEach(d => {
            d.addEventListener('click', () => { selectedDay = parseInt(d.dataset.day); render(); updateDisplay(); });
        });

        const hScroll = container.querySelector('.time-h');
        const mScroll = container.querySelector('.time-m');
        for (let h = 0; h < 24; h++) hScroll.innerHTML += `<div class="time-option${h === selectedHour ? ' active' : ''}" data-v="${h}">${String(h).padStart(2, '0')}</div>`;
        for (let m = 0; m < 60; m++) mScroll.innerHTML += `<div class="time-option${m === selectedMinute ? ' active' : ''}" data-v="${m}">${String(m).padStart(2, '0')}</div>`;
        hScroll.querySelectorAll('.time-option').forEach(o => o.onclick = () => { selectedHour = parseInt(o.dataset.v); render(); updateDisplay(); });
        mScroll.querySelectorAll('.time-option').forEach(o => o.onclick = () => { selectedMinute = parseInt(o.dataset.v); render(); updateDisplay(); });
        container.querySelector('.prev').onclick = () => { currentMonth--; if (currentMonth < 0) { currentMonth = 11; currentYear--; } render(); };
        container.querySelector('.next').onclick = () => { currentMonth++; if (currentMonth > 11) { currentMonth = 0; currentYear++; } render(); };
    }

    function updateDisplay() {
        if (selectedDay) {
            const val = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(selectedDay).padStart(2, '0')}T${String(selectedHour).padStart(2, '0')}:${String(selectedMinute).padStart(2, '0')}`;
            display.dataset.value = val;
            display.textContent = formatDateDisplay(val);
            if (onValueChange) onValueChange(val);
        } else { display.dataset.value = ''; display.textContent = 'Не выбрано'; if (onValueChange) onValueChange(''); }
    }

    toggle.onclick = (e) => { e.stopPropagation(); dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none'; if (dropdown.style.display === 'block') render(); };
    if (applyBtn) applyBtn.onclick = () => { dropdown.style.display = 'none'; };
    render(); updateDisplay();
}

function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; toast.style.transform = 'translateX(400px)'; setTimeout(() => toast.remove(), 300); }, 3000);
}

function formatDateDisplay(value) {
    if (!value) return 'Не выбрано';
    const date = new Date(value);
    return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) + ' • ' + date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(text) {
    const div = document.createElement('div'); div.textContent = text; return div.innerHTML;
}

// --- Логика заметок ---
function initNotes() {
    const form = document.getElementById('note-form');
    const input = document.getElementById('note-input');
    const reminderForm = document.getElementById('reminder-form');
    const reminderText = document.getElementById('reminder-text');
    const list = document.getElementById('notes-list');

    initCalendar('main-datetime-display', 'main-datetime-toggle', 'main-datetime-dropdown', 'main-calendar-container', (val) => { mainDatetimeValue = val; }, '');

    window.loadNotes = function () {
        notesCache = JSON.parse(localStorage.getItem('notes') || '[]');
        notesCache.sort((a, b) => b.id - a.id);
        if (notesCache.length === 0) { list.innerHTML = '<li class="empty-state">Нет заметок. Создайте первую!</li>'; return; }

        list.innerHTML = notesCache.map(note => {
            let reminderHtml = '';
            let noteClass = '';
            if (note.reminder) {
                const date = new Date(note.reminder);
                const isOverdue = date < new Date();
                noteClass = ' has-reminder';
                reminderHtml = `<div class="note-reminder ${isOverdue ? 'overdue' : ''}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline>
          </svg>
          <span>${date.toLocaleString('ru-RU')}</span>
          ${isOverdue ? '<span class="overdue-badge">Просрочено</span>' : '<span class="pending-badge">Ожидает</span>'}
        </div>`;
            }
            return `<li class="note-item${noteClass}" data-id="${note.id}">
        <div class="note-content">
          <div class="note-text">${escapeHtml(note.text)}</div>
          ${reminderHtml}
        </div>
        <div class="note-actions">
          <button class="action-btn edit-btn" title="Редактировать">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
          </button>
          <button class="action-btn delete-btn" title="Удалить">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              <line x1="10" y1="11" x2="10" y2="17"></line>
              <line x1="14" y1="11" x2="14" y2="17"></line>
            </svg>
          </button>
        </div>
      </li>`;
        }).join('');

        document.querySelectorAll('.edit-btn').forEach(btn => btn.addEventListener('click', e => {
            const id = parseInt(e.target.closest('.note-item').dataset.id);
            const note = notesCache.find(n => n.id === id);
            if (note) showEditModal(note);
        }));
        document.querySelectorAll('.delete-btn').forEach(btn => btn.addEventListener('click', e => {
            const id = parseInt(e.target.closest('.note-item').dataset.id);
            showDeleteConfirmation(id);
        }));
    };

    function addNote(text, reminderTimestamp = null) {
        notesCache = JSON.parse(localStorage.getItem('notes') || '[]');
        const newNote = { id: Date.now(), text, reminder: reminderTimestamp };
        notesCache.push(newNote);
        localStorage.setItem('notes', JSON.stringify(notesCache));
        loadNotes();
        if (reminderTimestamp) {
            const delayMinutes = Math.round((reminderTimestamp - Date.now()) / 60000);
            showToast(`Напоминание придёт через ${delayMinutes} мин.`);
            socket.emit('newReminder', { id: newNote.id, text, reminderTime: reminderTimestamp });
        } else {
            showToast('Заметка создана');
        }
    }

    form.addEventListener('submit', e => {
        e.preventDefault();
        const t = input.value.trim();
        if (t) {
            addNote(t);
            input.value = '';
            input.focus();
        }
    });

    reminderForm.addEventListener('submit', e => {
        e.preventDefault();
        const t = reminderText.value.trim();
        const dt = mainDatetimeValue;
        if (t && dt) {
            const ts = new Date(dt).getTime();
            if (ts > Date.now()) {
                addNote(t, ts);
                reminderText.value = '';
                mainDatetimeValue = '';
                const disp = document.getElementById('main-datetime-display');
                if (disp) {
                    disp.dataset.value = '';
                    disp.textContent = 'Не выбрано';
                }
            } else {
                showToast('Дата должна быть в будущем', 'error');
            }
        } else if (t && !dt) {
            showToast('Выберите дату и время', 'error');
        } else {
            showToast('Введите текст напоминания', 'error');
        }
    });

    loadNotes();
}

// --- WebSocket & Push ---
socket.on('taskAdded', task => {
    showToast(`Новая задача: ${task.text}`);
    loadNotes();
});

socket.on('reminderTriggered', reminder => {
    showToast(`Напоминание: ${reminder.text}`);
    loadNotes();
});

function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
    return outputArray;
}

// Обновленная функция переключения кнопок
// Замените функцию updatePushUI на эту:
async function updatePushUI() {
  if (!enableBtn || !disableBtn) return;
  
  try {
    // Проверяем доступность Service Worker
    if (!navigator.serviceWorker.controller) {
      console.log('Service Worker не контролирует страницу');
      enableBtn.style.display = 'inline-flex';
      disableBtn.style.display = 'none';
      return;
    }
    
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    
    if (subscription && Notification.permission === 'granted') {
      // Уведомления включены
      enableBtn.style.display = 'none';
      disableBtn.style.display = 'inline-flex';
      console.log('UI: Уведомления включены');
    } else {
      // Уведомления выключены
      enableBtn.style.display = 'inline-flex';
      disableBtn.style.display = 'none';
      console.log('UI: Уведомления выключены');
    }
  } catch (err) {
    console.error('Ошибка проверки подписки:', err);
    enableBtn.style.display = 'inline-flex';
    disableBtn.style.display = 'none';
  }
}

// Исправленная функция подписки
async function subscribeToPush() {
  if (!('PushManager' in window)) {
    showToast('Push-уведомления не поддерживаются браузером', 'error');
    return false;
  }
  
  try {
    // Проверяем разрешение
    if (Notification.permission === 'denied') {
      showToast('Разрешите уведомления в настройках браузера', 'error');
      return false;
    }
    
    if (Notification.permission === 'default') {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        showToast('Требуется разрешение на уведомления', 'error');
        return false;
      }
    }
    
    const reg = await navigator.serviceWorker.ready;
    
    // Проверяем, нет ли уже подписки
    let subscription = await reg.pushManager.getSubscription();
    if (subscription) {
      console.log('Подписка уже существует');
      await updatePushUI();
      showToast('Уведомления уже включены');
      return true;
    }
    
    // Создаем новую подписку
    subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array('BLvBdNy4s9Su2Q4NbGohK8rm8yYDSUf3dDyTVphMZh001wkrieihqI7BkgzVToYr5RHbpMVXaSp1ol4hoHcofvc')
    });
    
    console.log('Подписка создана:', subscription);
    
    // Отправляем подписку на сервер
    const response = await fetch('http://localhost:3001/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(subscription)
    });
    
    if (response.ok) {
      await updatePushUI();
      showToast('Уведомления включены');
      return true;
    } else {
      throw new Error('Ошибка сервера');
    }
  } catch (err) {
    console.error('Ошибка подписки:', err);
    showToast('Не удалось включить уведомления', 'error');
    return false;
  }
}

// Исправленная функция отписки
async function unsubscribeFromPush() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const subscription = await reg.pushManager.getSubscription();
    
    if (subscription) {
      console.log('Отписываемся...');
      
      // Сообщаем серверу
      await fetch('http://localhost:3001/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: subscription.endpoint })
      });
      
      // Отписываемся локально
      const result = await subscription.unsubscribe();
      console.log('Отписка выполнена:', result);
      
      await updatePushUI();
      showToast('Уведомления отключены');
    } else {
      console.log('Нет активной подписки');
      await updatePushUI();
    }
  } catch (err) {
    console.error('Ошибка отписки:', err);
    showToast('Ошибка при отключении уведомлений', 'error');
  }
}

// Инициализация Service Worker и кнопок
// Замените весь блок инициализации Service Worker в конце файла app.js на этот:

// Инициализация Service Worker и кнопок
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      // Удаляем старый Service Worker если есть
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (let registration of registrations) {
        if (registration.active && registration.active.scriptURL.includes('sw.js')) {
          console.log('Service Worker уже зарегистрирован');
        }
      }
      
      const registration = await navigator.serviceWorker.register('/sw.js');
      console.log('Service Worker зарегистрирован:', registration.scope);
      
      // Ждем активации
      await navigator.serviceWorker.ready;
      
      // Обновляем UI кнопок
      await updatePushUI();
      
      // Привязываем обработчики к кнопкам (с защитой от дублирования)
      if (enableBtn && !enableBtn.hasListener) {
        enableBtn.hasListener = true;
        enableBtn.addEventListener('click', async (e) => {
          e.preventDefault();
          console.log('Нажата кнопка "Включить уведомления"');
          await subscribeToPush();
        });
      }
      
      if (disableBtn && !disableBtn.hasListener) {
        disableBtn.hasListener = true;
        disableBtn.addEventListener('click', async (e) => {
          e.preventDefault();
          console.log('Нажата кнопка "Отключить уведомления"');
          await unsubscribeFromPush();
        });
      }
      
    } catch (err) {
      console.error('Ошибка регистрации Service Worker:', err);
    }
  });
} else {
  console.log('Service Worker не поддерживается');
  if (enableBtn) enableBtn.style.display = 'none';
  if (disableBtn) disableBtn.style.display = 'none';
}
