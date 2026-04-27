const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const webpush = require('web-push');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const vapidKeys = { 
  publicKey: 'BLvBdNy4s9Su2Q4NbGohK8rm8yYDSUf3dDyTVphMZh001wkrieihqI7BkgzVToYr5RHbpMVXaSp1ol4hoHcofvc', 
  privateKey: 'YBAJfy6iWfbPFVqJCTEvTakzvQN59AohX5oo36-ug38' 
};
webpush.setVapidDetails('mailto:your-email@example.com', vapidKeys.publicKey, vapidKeys.privateKey);

const app = express();
app.use(cors()); 
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, './')));

let subscriptions = [];
const reminders = new Map();

// Загружаем сохраненные напоминания
const REMINDERS_FILE = path.join(__dirname, 'reminders.json');
if (fs.existsSync(REMINDERS_FILE)) {
  try {
    const saved = JSON.parse(fs.readFileSync(REMINDERS_FILE, 'utf8'));
    saved.forEach(r => {
      const delay = r.reminderTime - Date.now();
      if (delay > 0) {
        const timeoutId = setTimeout(() => triggerReminder(r.id, r.text), delay);
        reminders.set(r.id, { timeoutId, text: r.text, reminderTime: r.reminderTime });
        console.log(`Восстановлено напоминание: "${r.text}" на ${new Date(r.reminderTime).toLocaleString()}`);
      }
    });
  } catch (e) {
    console.error('Ошибка загрузки напоминаний:', e);
  }
}

function saveReminders() {
  const data = Array.from(reminders.entries()).map(([id, r]) => ({
    id,
    text: r.text,
    reminderTime: r.reminderTime
  }));
  fs.writeFileSync(REMINDERS_FILE, JSON.stringify(data, null, 2));
}

function triggerReminder(id, text) {
  console.log(`СРАБОТАЛО НАПОМИНАНИЕ: "${text}" в ${new Date().toLocaleString()}`);
  
  const payload = JSON.stringify({ 
    title: 'Напоминание', 
    body: text, 
    reminderId: id,
    timestamp: Date.now()
  });
  
  // Отправляем push всем подписчикам
  subscriptions.forEach((sub, index) => {
    webpush.sendNotification(sub, payload).catch(err => {
      console.error(`Ошибка отправки уведомления подписчику ${index}:`, err.statusCode);
      // Удаляем невалидные подписки
      if (err.statusCode === 410 || err.statusCode === 404) {
        subscriptions = subscriptions.filter(s => s.endpoint !== sub.endpoint);
      }
    });
  });
  
  // Отправляем через WebSocket
  io.emit('reminderTriggered', { id, text, reminderTime: Date.now() });
  reminders.delete(id);
  saveReminders();
}

const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

io.on('connection', socket => {
  console.log('Клиент подключён:', socket.id);
  
  socket.on('newTask', task => {
    console.log('Новая задача:', task.text);
    io.emit('taskAdded', task);
  });
  
  socket.on('newReminder', reminder => {
    const { id, text, reminderTime } = reminder;
    const delay = reminderTime - Date.now();
    
    if (delay <= 0) {
      console.log(`Напоминание "${text}" уже просрочено`);
      return;
    }
    
    console.log(`Установлено напоминание: "${text}" на ${new Date(reminderTime).toLocaleString()} (через ${Math.round(delay/60000)} мин.)`);
    
    // Очищаем старый таймер если есть
    if (reminders.has(id)) {
      clearTimeout(reminders.get(id).timeoutId);
    }
    
    const timeoutId = setTimeout(() => triggerReminder(id, text), delay);
    reminders.set(id, { timeoutId, text, reminderTime });
    saveReminders();
  });
  
  socket.on('disconnect', () => console.log('Клиент отключён:', socket.id));
});

app.post('/subscribe', (req, res) => {
  const sub = req.body;
  if (!subscriptions.find(s => s.endpoint === sub.endpoint)) {
    subscriptions.push(sub);
    console.log('Новая подписка. Всего:', subscriptions.length);
    // Сохраняем подписки
    fs.writeFileSync(path.join(__dirname, 'subscriptions.json'), JSON.stringify(subscriptions, null, 2));
  }
  res.status(201).json({ message: 'Подписка сохранена' });
});

// Найдите и замените обработчик POST /unsubscribe на этот:
app.post('/unsubscribe', (req, res) => {
  const endpoint = req.body.endpoint;
  const before = subscriptions.length;
  subscriptions = subscriptions.filter(sub => sub.endpoint !== endpoint);
  console.log(`Удалена подписка. Было: ${before}, стало: ${subscriptions.length}`);
  
  // Сохраняем обновленный список
  fs.writeFileSync(path.join(__dirname, 'subscriptions.json'), JSON.stringify(subscriptions, null, 2));
  res.status(200).json({ message: 'Подписка удалена' });
});

app.post('/snooze', (req, res) => {
  const id = parseInt(req.query.reminderId, 10);
  if (!id || !reminders.has(id)) {
    return res.status(404).json({ error: 'Reminder not found' });
  }
  
  const r = reminders.get(id);
  clearTimeout(r.timeoutId);
  
  const newDelay = 5 * 60 * 1000; // 5 минут
  const newTime = Date.now() + newDelay;
  const newTimeoutId = setTimeout(() => triggerReminder(id, r.text), newDelay);
  
  reminders.set(id, { timeoutId: newTimeoutId, text: r.text, reminderTime: newTime });
  saveReminders();
  
  console.log(`Напоминание "${r.text}" отложено на 5 минут (до ${new Date(newTime).toLocaleString()})`);
  res.status(200).json({ message: 'Snoozed 5 min' });
});

// Загружаем сохраненные подписки
const SUBS_FILE = path.join(__dirname, 'subscriptions.json');
if (fs.existsSync(SUBS_FILE)) {
  try {
    subscriptions = JSON.parse(fs.readFileSync(SUBS_FILE, 'utf8'));
    console.log(`Загружено ${subscriptions.length} подписок`);
  } catch (e) {
    console.error('Ошибка загрузки подписок:', e);
  }
}

server.listen(3001, () => {
  console.log('Сервер запущен на http://localhost:3001');
  console.log('Активных напоминаний:', reminders.size);
});