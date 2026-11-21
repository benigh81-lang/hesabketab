/**
 * حساب‌یار - Personal Finance PWA
 * Fully offline • IndexedDB • Persian • RTL
 */

const App = (() => {
  // ==================== State ====================
  let db = null;
  let transactions = [];
  let categories = [];
  let settings = {
    currency: 'toman',      // toman | rial
    theme: 'light',
    monthlyBudget: 0,
    pin: null,              // 4-digit string or null
    locked: false
  };
  let currentType = 'expense';
  let editingId = null;
  let currentFilter = 'all';
  let reportPeriod = 'month';
  let charts = { compare: null, pie: null };
  let pinBuffer = '';

  // Default categories
  const DEFAULT_CATEGORIES = [
    { id: 'exp_food', name: 'خوراک و رستوران', type: 'expense', icon: '🍽️' },
    { id: 'exp_personal', name: 'خرید شخصی', type: 'expense', icon: '🛍️' },
    { id: 'exp_clothes', name: 'پوشاک', type: 'expense', icon: '👕' },
    { id: 'exp_transport', name: 'رفت‌وآمد و بنزین', type: 'expense', icon: '🚗' },
    { id: 'exp_bills', name: 'قبض و اینترنت', type: 'expense', icon: '💡' },
    { id: 'exp_fun', name: 'تفریح', type: 'expense', icon: '🎬' },
    { id: 'exp_sport', name: 'ورزش و مکمل', type: 'expense', icon: '💪' },
    { id: 'exp_health', name: 'درمان و سلامت', type: 'expense', icon: '🏥' },
    { id: 'exp_other', name: 'سایر هزینه‌ها', type: 'expense', icon: '📦' },
    { id: 'inc_salary', name: 'حقوق', type: 'income', icon: '💼' },
    { id: 'inc_business', name: 'درآمد کسب‌وکار', type: 'income', icon: '🏢' },
    { id: 'inc_sale', name: 'فروش', type: 'income', icon: '💰' },
    { id: 'inc_receive', name: 'دریافت وجه', type: 'income', icon: '🤝' },
    { id: 'inc_other', name: 'سایر درآمدها', type: 'income', icon: '📥' }
  ];

  // ==================== Persian Date Utilities ====================
  function toJalali(gy, gm, gd) {
    const g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
    let jy = (gy <= 1600) ? 0 : 979;
    gy -= (gy <= 1600) ? 621 : 1600;
    let gy2 = (gm > 2) ? (gy + 1) : gy;
    let days = (365 * gy) + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100) +
               Math.floor((gy2 + 399) / 400) - 80 + gd + g_d_m[gm - 1];
    jy += 33 * Math.floor(days / 12053);
    days %= 12053;
    jy += 4 * Math.floor(days / 1461);
    days %= 1461;
    if (days > 365) {
      jy += Math.floor((days - 1) / 365);
      days = (days - 1) % 365;
    }
    let jm = (days < 186) ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
    let jd = 1 + ((days < 186) ? (days % 31) : ((days - 186) % 30));
    return { jy, jm, jd };
  }

  function toGregorian(jy, jm, jd) {
    let gy = (jy <= 979) ? 621 : 1600;
    jy -= (jy <= 979) ? 0 : 979;
    let days = (365 * jy) + Math.floor(jy / 33) * 8 + Math.floor(((jy % 33) + 3) / 4) + 78 + jd +
               ((jm < 7) ? (jm - 1) * 31 : ((jm - 7) * 30 + 186));
    gy += 400 * Math.floor(days / 146097);
    days %= 146097;
    if (days > 36524) {
      gy += 100 * Math.floor(--days / 36524);
      days %= 36524;
      if (days >= 365) days++;
    }
    gy += 4 * Math.floor(days / 1461);
    days %= 1461;
    if (days > 365) {
      gy += Math.floor((days - 1) / 365);
      days = (days - 1) % 365;
    }
    let gd = days + 1;
    const sal_a = [0, 31, ((gy % 4 === 0 && gy % 100 !== 0) || (gy % 400 === 0)) ? 29 : 28,
                   31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let gm;
    for (gm = 0; gm < 13 && gd > sal_a[gm]; gm++) gd -= sal_a[gm];
    return { gy, gm, gd };
  }

  function formatShamsi(dateStr) {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-').map(Number);
    const { jy, jm, jd } = toJalali(y, m, d);
    const months = ['فروردین','اردیبهشت','خرداد','تیر','مرداد','شهریور','مهر','آبان','آذر','دی','بهمن','اسفند'];
    return `${jd} ${months[jm - 1]} ${jy}`;
  }

  function todayISO() {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  }

  function getMonthRange() {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return {
      from: start.toISOString().slice(0, 10),
      to: end.toISOString().slice(0, 10)
    };
  }

  function getWeekRange() {
    const now = new Date();
    const day = now.getDay(); // 0 Sun
    const diff = (day + 1) % 7; // start from Saturday for Iran
    const start = new Date(now);
    start.setDate(now.getDate() - diff);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return {
      from: start.toISOString().slice(0, 10),
      to: end.toISOString().slice(0, 10)
    };
  }

  // ==================== Number Formatting ====================
  function toPersianDigits(str) {
    return String(str).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]);
  }

  function toEnglishDigits(str) {
    return String(str).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
                      .replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
  }

  function formatMoney(amount, withUnit = true) {
    let val = Math.round(Number(amount) || 0);
    if (settings.currency === 'rial') val = val * 10;
    const formatted = val.toLocaleString('fa-IR');
    if (!withUnit) return formatted;
    return formatted + (settings.currency === 'rial' ? ' ریال' : ' تومان');
  }

  function parseAmount(str) {
    const cleaned = toEnglishDigits(str).replace(/[^\d]/g, '');
    return parseInt(cleaned, 10) || 0;
  }

  // ==================== IndexedDB ====================
  function openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('HesabYarDB', 1);
      request.onupgradeneeded = (e) => {
        const database = e.target.result;
        if (!database.objectStoreNames.contains('transactions')) {
          const store = database.createObjectStore('transactions', { keyPath: 'id', autoIncrement: true });
          store.createIndex('date', 'date', { unique: false });
          store.createIndex('type', 'type', { unique: false });
          store.createIndex('categoryId', 'categoryId', { unique: false });
        }
        if (!database.objectStoreNames.contains('categories')) {
          database.createObjectStore('categories', { keyPath: 'id' });
        }
        if (!database.objectStoreNames.contains('settings')) {
          database.createObjectStore('settings', { keyPath: 'key' });
        }
      };
      request.onsuccess = (e) => {
        db = e.target.result;
        resolve(db);
      };
      request.onerror = () => reject(request.error);
    });
  }

  function dbGetAll(storeName) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function dbPut(storeName, data) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.put(data);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function dbDelete(storeName, id) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  function dbClear(storeName) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async function loadSettings() {
    const rows = await dbGetAll('settings');
    rows.forEach(r => {
      if (r.key === 'appSettings') Object.assign(settings, r.value);
    });
    applyTheme();
  }

  async function saveSettings() {
    await dbPut('settings', { key: 'appSettings', value: settings });
  }

  async function loadCategories() {
    let cats = await dbGetAll('categories');
    if (cats.length === 0) {
      for (const c of DEFAULT_CATEGORIES) {
        await dbPut('categories', c);
      }
      cats = DEFAULT_CATEGORIES.slice();
    }
    categories = cats;
  }

  async function loadTransactions() {
    transactions = await dbGetAll('transactions');
    transactions.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  }

  // ==================== UI Helpers ====================
  function toast(msg, duration = 2500) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), duration);
  }

  function showModal(title, html) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = html;
    document.getElementById('modal').classList.add('show');
  }

  function hideModal() {
    document.getElementById('modal').classList.remove('show');
  }

  function applyTheme() {
    document.documentElement.setAttribute('data-theme', settings.theme);
    document.getElementById('btn-theme').textContent = settings.theme === 'dark' ? '☀️' : '🌙';
  }

  // ==================== Pages ====================
  function showPage(name) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('page-' + name).classList.add('active');
    document.querySelectorAll('.nav-item').forEach(n => {
      n.classList.toggle('active', n.dataset.page === name);
    });

    if (name === 'dashboard') renderDashboard();
    if (name === 'transactions') renderTransactions();
    if (name === 'add') prepareAddForm();
    if (name === 'reports') renderReports();
    if (name === 'settings') renderSettings();
  }

  // ==================== Dashboard ====================
  function renderDashboard() {
    const today = todayISO();
    const { from: monthStart, to: monthEnd } = getMonthRange();

    let totalIncome = 0, totalExpense = 0;
    let todayIncome = 0, todayExpense = 0;
    let monthIncome = 0, monthExpense = 0;

    transactions.forEach(t => {
      if (t.type === 'income') {
        totalIncome += t.amount;
        if (t.date === today) todayIncome += t.amount;
        if (t.date >= monthStart && t.date <= monthEnd) monthIncome += t.amount;
      } else {
        totalExpense += t.amount;
        if (t.date === today) todayExpense += t.amount;
        if (t.date >= monthStart && t.date <= monthEnd) monthExpense += t.amount;
      }
    });

    const balance = totalIncome - totalExpense;
    document.getElementById('total-balance').textContent = formatMoney(balance);
    document.getElementById('today-income').textContent = formatMoney(todayIncome, false);
    document.getElementById('today-expense').textContent = formatMoney(todayExpense, false);
    document.getElementById('month-income').textContent = formatMoney(monthIncome);
    document.getElementById('month-expense').textContent = formatMoney(monthExpense);

    // Budget
    const budgetCard = document.getElementById('budget-card');
    if (settings.monthlyBudget > 0) {
      budgetCard.style.display = 'block';
      const percent = Math.min(100, Math.round((monthExpense / settings.monthlyBudget) * 100));
      const fill = document.getElementById('budget-fill');
      fill.style.width = percent + '%';
      fill.className = 'budget-fill ' + (percent >= 90 ? 'danger' : percent >= 70 ? 'warn' : 'ok');
      document.getElementById('budget-percent').textContent = toPersianDigits(percent) + '٪';
      document.getElementById('budget-spent').textContent = formatMoney(monthExpense);
      document.getElementById('budget-limit').textContent = 'از ' + formatMoney(settings.monthlyBudget);
    } else {
      budgetCard.style.display = 'none';
    }

    // Recent
    const container = document.getElementById('recent-transactions');
    const recent = transactions.slice(0, 8);
    if (recent.length === 0) {
      container.innerHTML = `<div class="empty-state"><div class="icon">📝</div><p>هنوز تراکنشی ثبت نشده</p></div>`;
    } else {
      container.innerHTML = recent.map(t => txItemHTML(t)).join('');
    }
  }

  function txItemHTML(t) {
    const cat = categories.find(c => c.id === t.categoryId) || { name: 'نامشخص', icon: '❓' };
    const sign = t.type === 'income' ? '+' : '−';
    return `
      <div class="tx-item" data-id="${t.id}">
        <div class="tx-icon ${t.type}">${cat.icon}</div>
        <div class="tx-info">
          <div class="tx-title">${escapeHtml(t.title)}</div>
          <div class="tx-meta">${cat.name} • ${formatShamsi(t.date)}</div>
        </div>
        <div class="tx-amount ${t.type}">${sign}${formatMoney(t.amount, false)}</div>
      </div>
    `;
  }

  function escapeHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ==================== Transactions List ====================
  function renderTransactions() {
    const q = document.getElementById('search-input').value.trim().toLowerCase();
    let list = transactions;

    if (currentFilter === 'income') list = list.filter(t => t.type === 'income');
    if (currentFilter === 'expense') list = list.filter(t => t.type === 'expense');

    if (q) {
      list = list.filter(t =>
        (t.title || '').toLowerCase().includes(q) ||
        (t.note || '').toLowerCase().includes(q)
      );
    }

    const container = document.getElementById('transactions-list');
    if (list.length === 0) {
      container.innerHTML = `<div class="empty-state"><div class="icon">📂</div><p>تراکنشی یافت نشد</p></div>`;
    } else {
      container.innerHTML = list.map(t => txItemHTML(t)).join('');
    }
  }

  // ==================== Add / Edit ====================
  function prepareAddForm() {
    if (!editingId) {
      document.getElementById('tx-amount').value = '';
      document.getElementById('tx-title').value = '';
      document.getElementById('tx-note').value = '';
      document.getElementById('tx-date').value = todayISO();
      document.getElementById('tx-recurring').checked = false;
      document.getElementById('btn-cancel-edit').style.display = 'none';
      document.getElementById('btn-save-tx').textContent = 'ذخیره تراکنش';
      currentType = 'expense';
      updateTypeToggle();
    }
    updateShamsiPreview();
    renderCategoryChips();
  }

  function updateTypeToggle() {
    document.querySelectorAll('.type-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.type === currentType);
      btn.classList.toggle('income', btn.dataset.type === 'income');
      btn.classList.toggle('expense', btn.dataset.type === 'expense');
    });
    renderCategoryChips();
  }

  function renderCategoryChips() {
    const wrap = document.getElementById('category-chips');
    const filtered = categories.filter(c => c.type === currentType);
    wrap.innerHTML = filtered.map(c =>
      `<button class="chip" data-id="${c.id}">${c.icon} ${c.name}</button>`
    ).join('');
    // select first by default if none
    if (!wrap.querySelector('.chip.active') && filtered.length) {
      wrap.querySelector('.chip').classList.add('active');
    }
  }

  function updateShamsiPreview() {
    const val = document.getElementById('tx-date').value;
    document.getElementById('shamsi-date-preview').textContent =
      val ? '📅 ' + formatShamsi(val) : '';
  }

  async function saveTransaction() {
    const amount = parseAmount(document.getElementById('tx-amount').value);
    const title = document.getElementById('tx-title').value.trim();
    const note = document.getElementById('tx-note').value.trim();
    const date = document.getElementById('tx-date').value;
    const recurring = document.getElementById('tx-recurring').checked;
    const activeChip = document.querySelector('#category-chips .chip.active');
    const categoryId = activeChip ? activeChip.dataset.id : null;

    if (amount <= 0) { toast('مبلغ را وارد کنید'); return; }
    if (!title) { toast('عنوان را وارد کنید'); return; }
    if (!date) { toast('تاریخ را انتخاب کنید'); return; }
    if (!categoryId) { toast('دسته‌بندی را انتخاب کنید'); return; }

    const data = {
      amount,
      title,
      note,
      date,
      type: currentType,
      categoryId,
      recurring: !!recurring,
      updatedAt: new Date().toISOString()
    };

    if (editingId) {
      data.id = editingId;
      await dbPut('transactions', data);
      toast('تراکنش ویرایش شد');
    } else {
      data.createdAt = new Date().toISOString();
      await dbPut('transactions', data);
      toast('تراکنش ذخیره شد');
    }

    editingId = null;
    await loadTransactions();
    showPage('dashboard');
  }

  function openEdit(id) {
    const t = transactions.find(x => x.id === id);
    if (!t) return;
    editingId = id;
    currentType = t.type;
    updateTypeToggle();
    document.getElementById('tx-amount').value = t.amount;
    document.getElementById('tx-title').value = t.title;
    document.getElementById('tx-note').value = t.note || '';
    document.getElementById('tx-date').value = t.date;
    document.getElementById('tx-recurring').checked = !!t.recurring;
    document.getElementById('btn-cancel-edit').style.display = 'block';
    document.getElementById('btn-save-tx').textContent = 'ذخیره تغییرات';
    showPage('add');
    // select category
    setTimeout(() => {
      document.querySelectorAll('#category-chips .chip').forEach(c => {
        c.classList.toggle('active', c.dataset.id === t.categoryId);
      });
    }, 50);
  }

  async function deleteTransaction(id) {
    if (!confirm('آیا از حذف این تراکنش مطمئن هستید؟')) return;
    await dbDelete('transactions', id);
    await loadTransactions();
    toast('تراکنش حذف شد');
    renderTransactions();
    renderDashboard();
    hideModal();
  }

  // ==================== Reports ====================
  function getReportRange() {
    const today = todayISO();
    if (reportPeriod === 'day') return { from: today, to: today };
    if (reportPeriod === 'week') return getWeekRange();
    if (reportPeriod === 'month') return getMonthRange();
    // custom
    const from = document.getElementById('range-from').value || today;
    const to = document.getElementById('range-to').value || today;
    return { from, to };
  }

  function renderReports() {
    const { from, to } = getReportRange();
    let income = 0, expense = 0;
    const catMap = {};

    transactions.forEach(t => {
      if (t.date < from || t.date > to) return;
      if (t.type === 'income') income += t.amount;
      else {
        expense += t.amount;
        catMap[t.categoryId] = (catMap[t.categoryId] || 0) + t.amount;
      }
    });

    document.getElementById('report-income').textContent = formatMoney(income);
    document.getElementById('report-expense').textContent = formatMoney(expense);

    // Compare chart
    const ctx1 = document.getElementById('chart-compare').getContext('2d');
    if (charts.compare) charts.compare.destroy();
    charts.compare = new Chart(ctx1, {
      type: 'bar',
      data: {
        labels: ['درآمد', 'هزینه'],
        datasets: [{
          data: [income, expense],
          backgroundColor: ['#10b981', '#ef4444'],
          borderRadius: 8,
          barThickness: 48
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, ticks: { callback: v => formatMoney(v, false) } }
        }
      }
    });

    // Pie chart
    const labels = [], data = [], colors = [];
    const palette = ['#0d9488','#f59e0b','#ef4444','#8b5cf6','#3b82f6','#ec4899','#14b8a6','#f97316','#6366f1'];
    let i = 0;
    let topCat = null, topVal = 0;
    for (const [cid, val] of Object.entries(catMap)) {
      const cat = categories.find(c => c.id === cid) || { name: 'سایر', icon: '📦' };
      labels.push(cat.name);
      data.push(val);
      colors.push(palette[i % palette.length]);
      if (val > topVal) { topVal = val; topCat = cat.name; }
      i++;
    }

    const ctx2 = document.getElementById('chart-pie').getContext('2d');
    if (charts.pie) charts.pie.destroy();
    charts.pie = new Chart(ctx2, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{ data, backgroundColor: colors, borderWidth: 0 }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { font: { family: 'Vazirmatn' }, padding: 12 } }
        }
      }
    });

    document.getElementById('top-category').textContent =
      topCat ? `بیشترین هزینه: ${topCat} (${formatMoney(topVal)})` : 'داده‌ای برای نمایش وجود ندارد';
  }

  // ==================== Settings ====================
  function renderSettings() {
    document.getElementById('currency-label').textContent =
      settings.currency === 'rial' ? 'ریال' : 'تومان';
    document.getElementById('budget-label').textContent =
      settings.monthlyBudget > 0 ? formatMoney(settings.monthlyBudget) : 'تعیین نشده';
    document.getElementById('password-label').textContent =
      settings.pin ? 'فعال' : 'غیرفعال';
  }

  // ==================== Export / Backup ====================
  function exportCSV() {
    const headers = ['شناسه','نوع','عنوان','مبلغ','دسته‌بندی','تاریخ','توضیحات'];
    const rows = transactions.map(t => {
      const cat = categories.find(c => c.id === t.categoryId);
      return [
        t.id,
        t.type === 'income' ? 'درآمد' : 'هزینه',
        `"${(t.title || '').replace(/"/g, '""')}"`,
        t.amount,
        cat ? cat.name : '',
        t.date,
        `"${(t.note || '').replace(/"/g, '""')}"`
      ].join(',');
    });
    const csv = '\uFEFF' + headers.join(',') + '\n' + rows.join('\n');
    downloadFile(csv, 'hesabyar-export.csv', 'text/csv;charset=utf-8');
    toast('فایل CSV آماده شد');
  }

  function downloadFile(content, filename, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function backupData() {
    const data = {
      version: 1,
      exportedAt: new Date().toISOString(),
      settings,
      categories,
      transactions
    };
    downloadFile(JSON.stringify(data, null, 2), 'hesabyar-backup.json', 'application/json');
    toast('فایل پشتیبان ذخیره شد');
  }

  function restoreData() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (!data.transactions || !Array.isArray(data.transactions)) {
          throw new Error('فرمت نامعتبر');
        }
        if (!confirm('تمام داده‌های فعلی جایگزین می‌شوند. ادامه می‌دهید؟')) return;

        await dbClear('transactions');
        await dbClear('categories');
        await dbClear('settings');

        for (const c of (data.categories || DEFAULT_CATEGORIES)) {
          await dbPut('categories', c);
        }
        for (const t of data.transactions) {
          await dbPut('transactions', t);
        }
        if (data.settings) {
          Object.assign(settings, data.settings);
          await saveSettings();
        }
        await loadCategories();
        await loadTransactions();
        applyTheme();
        toast('اطلاعات با موفقیت بازیابی شد');
        showPage('dashboard');
      } catch (err) {
        toast('خطا در بازیابی فایل');
        console.error(err);
      }
    };
    input.click();
  }

  // ==================== PIN Lock ====================
  function checkLock() {
    if (settings.pin) {
      document.getElementById('lock-screen').classList.add('show');
      pinBuffer = '';
      updatePinDots();
    }
  }

  function updatePinDots() {
    document.querySelectorAll('.pin-dot').forEach((dot, i) => {
      dot.classList.toggle('filled', i < pinBuffer.length);
    });
  }

  function handlePin(num) {
    if (num === 'clear') {
      pinBuffer = pinBuffer.slice(0, -1);
    } else if (num === 'ok') {
      if (pinBuffer === settings.pin) {
        document.getElementById('lock-screen').classList.remove('show');
        pinBuffer = '';
      } else {
        toast('رمز اشتباه است');
        pinBuffer = '';
      }
    } else if (pinBuffer.length < 4) {
      pinBuffer += num;
      if (pinBuffer.length === 4) {
        setTimeout(() => handlePin('ok'), 150);
      }
    }
    updatePinDots();
  }

  // ==================== Event Bindings ====================
  function bindEvents() {
    // Nav
    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.addEventListener('click', () => showPage(btn.dataset.page));
    });

    // Theme
    document.getElementById('btn-theme').addEventListener('click', () => {
      settings.theme = settings.theme === 'dark' ? 'light' : 'dark';
      applyTheme();
      saveSettings();
    });

    // Type toggle
    document.querySelectorAll('.type-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        currentType = btn.dataset.type;
        updateTypeToggle();
      });
    });

    // Category chips
    document.getElementById('category-chips').addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      document.querySelectorAll('#category-chips .chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
    });

    // Date change
    document.getElementById('tx-date').addEventListener('change', updateShamsiPreview);

    // Save
    document.getElementById('btn-save-tx').addEventListener('click', saveTransaction);
    document.getElementById('btn-cancel-edit').addEventListener('click', () => {
      editingId = null;
      showPage('dashboard');
    });

    // Filters
    document.getElementById('filter-bar').addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      document.querySelectorAll('#filter-bar .chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      currentFilter = chip.dataset.filter;
      renderTransactions();
    });

    document.getElementById('search-input').addEventListener('input', renderTransactions);

    // Transaction click -> detail modal
    document.getElementById('app').addEventListener('click', (e) => {
      const item = e.target.closest('.tx-item');
      if (!item) return;
      const id = Number(item.dataset.id);
      const t = transactions.find(x => x.id === id);
      if (!t) return;
      const cat = categories.find(c => c.id === t.categoryId) || { name: 'نامشخص' };
      showModal('جزئیات تراکنش', `
        <div style="margin-bottom:16px;">
          <div class="text-muted" style="font-size:0.85rem;">عنوان</div>
          <div style="font-weight:600;font-size:1.1rem;">${escapeHtml(t.title)}</div>
        </div>
        <div style="margin-bottom:16px;">
          <div class="text-muted" style="font-size:0.85rem;">مبلغ</div>
          <div class="tx-amount ${t.type}" style="font-size:1.3rem;">${t.type==='income'?'+':'-'}${formatMoney(t.amount)}</div>
        </div>
        <div style="margin-bottom:16px;">
          <div class="text-muted" style="font-size:0.85rem;">دسته‌بندی</div>
          <div>${cat.icon || ''} ${cat.name}</div>
        </div>
        <div style="margin-bottom:16px;">
          <div class="text-muted" style="font-size:0.85rem;">تاریخ</div>
          <div>${formatShamsi(t.date)}</div>
        </div>
        ${t.note ? `<div style="margin-bottom:16px;"><div class="text-muted" style="font-size:0.85rem;">توضیحات</div><div>${escapeHtml(t.note)}</div></div>` : ''}
        <div class="btn-group">
          <button class="btn btn-primary" onclick="App.editTx(${id})">ویرایش</button>
          <button class="btn btn-danger" onclick="App.deleteTx(${id})">حذف</button>
        </div>
      `);
    });

    // Report period
    document.getElementById('report-period').addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      document.querySelectorAll('#report-period .chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      reportPeriod = chip.dataset.period;
      document.getElementById('custom-range').style.display =
        reportPeriod === 'custom' ? 'block' : 'none';
      if (reportPeriod !== 'custom') renderReports();
    });

    document.getElementById('btn-apply-range').addEventListener('click', renderReports);

    // Modal close
    document.getElementById('modal-close').addEventListener('click', hideModal);
    document.getElementById('modal').addEventListener('click', (e) => {
      if (e.target.id === 'modal') hideModal();
    });

    // Settings actions
    document.getElementById('setting-currency').addEventListener('click', () => {
      showModal('واحد پول', `
        <button class="btn ${settings.currency==='toman'?'btn-primary':'btn-outline'} mb-2" onclick="App.setCurrency('toman')">تومان</button>
        <button class="btn ${settings.currency==='rial'?'btn-primary':'btn-outline'}" onclick="App.setCurrency('rial')">ریال</button>
      `);
    });

    document.getElementById('setting-budget').addEventListener('click', () => {
      showModal('بودجه ماهانه', `
        <div class="form-group">
          <label>سقف بودجه ماهانه (${settings.currency==='rial'?'ریال':'تومان'})</label>
          <input type="text" class="form-control" id="budget-input" inputmode="numeric"
                 value="${settings.monthlyBudget || ''}" placeholder="مثلاً ۵۰۰۰۰۰۰" />
        </div>
        <button class="btn btn-primary" onclick="App.setBudget()">ذخیره</button>
        <button class="btn btn-outline mt-2" onclick="App.clearBudget()">حذف بودجه</button>
      `);
    });

    document.getElementById('setting-password').addEventListener('click', () => {
      if (settings.pin) {
        showModal('قفل برنامه', `
          <p class="mb-2">رمز عبور فعلی فعال است.</p>
          <button class="btn btn-danger" onclick="App.removePin()">حذف رمز عبور</button>
        `);
      } else {
        showModal('تنظیم رمز عبور', `
          <p class="text-muted mb-2">یک رمز ۴ رقمی وارد کنید</p>
          <div class="form-group">
            <input type="password" class="form-control" id="new-pin" inputmode="numeric" maxlength="4" placeholder="••••" />
          </div>
          <button class="btn btn-primary" onclick="App.setPin()">فعال‌سازی</button>
        `);
      }
    });

    document.getElementById('setting-export').addEventListener('click', exportCSV);
    document.getElementById('setting-backup').addEventListener('click', backupData);
    document.getElementById('setting-restore').addEventListener('click', restoreData);

    document.getElementById('setting-categories').addEventListener('click', () => {
      const list = categories.map(c =>
        `<div class="flex-between" style="padding:10px 0;border-bottom:1px solid var(--border);">
          <span>${c.icon} ${c.name} <small class="text-muted">(${c.type==='income'?'درآمد':'هزینه'})</small></span>
          ${c.id.startsWith('custom_') ? `<button class="chip" style="color:var(--danger)" onclick="App.deleteCategory('${c.id}')">حذف</button>` : ''}
        </div>`
      ).join('');
      showModal('دسته‌بندی‌ها', list + `
        <div class="form-group mt-3">
          <label>دسته جدید</label>
          <input type="text" class="form-control" id="new-cat-name" placeholder="نام دسته" />
        </div>
        <div class="type-toggle">
          <button class="type-btn expense active" data-type="expense" id="new-cat-type-exp">هزینه</button>
          <button class="type-btn income" data-type="income" id="new-cat-type-inc">درآمد</button>
        </div>
        <button class="btn btn-primary mt-2" onclick="App.addCategory()">افزودن</button>
      `);
      // bind type toggle inside modal
      document.getElementById('new-cat-type-exp').onclick = () => {
        document.getElementById('new-cat-type-exp').classList.add('active');
        document.getElementById('new-cat-type-inc').classList.remove('active');
      };
      document.getElementById('new-cat-type-inc').onclick = () => {
        document.getElementById('new-cat-type-inc').classList.add('active');
        document.getElementById('new-cat-type-exp').classList.remove('active');
      };
    });

    document.getElementById('setting-clear').addEventListener('click', async () => {
      if (!confirm('همه تراکنش‌ها و تنظیمات پاک می‌شوند. مطمئن هستید؟')) return;
      if (!confirm('این عمل غیرقابل بازگشت است!')) return;
      await dbClear('transactions');
      await dbClear('categories');
      await dbClear('settings');
      settings = { currency: 'toman', theme: 'light', monthlyBudget: 0, pin: null };
      await loadCategories();
      await loadTransactions();
      applyTheme();
      toast('همه داده‌ها پاک شد');
      showPage('dashboard');
    });

    // Add custom category button
    document.getElementById('btn-add-category').addEventListener('click', () => {
      showModal('دسته جدید', `
        <div class="form-group">
          <label>نام دسته</label>
          <input type="text" class="form-control" id="quick-cat-name" placeholder="مثلاً کادو" />
        </div>
        <button class="btn btn-primary" onclick="App.addCategoryQuick()">افزودن</button>
      `);
    });

    // PIN pad
    document.getElementById('pin-pad').addEventListener('click', (e) => {
      const btn = e.target.closest('.pin-btn');
      if (btn) handlePin(btn.dataset.num);
    });

    // Amount formatting on input
    document.getElementById('tx-amount').addEventListener('input', (e) => {
      const val = parseAmount(e.target.value);
      if (val) e.target.value = toPersianDigits(val.toLocaleString('en-US'));
      else e.target.value = '';
    });
  }

  // ==================== Public methods for inline handlers ====================
  return {
    async init() {
      try {
        await openDB();
        await loadSettings();
        await loadCategories();
        await loadTransactions();
        bindEvents();
        applyTheme();
        document.getElementById('tx-date').value = todayISO();
        updateShamsiPreview();
        renderDashboard();
        checkLock();

        // Register SW
        if ('serviceWorker' in navigator) {
          navigator.serviceWorker.register('./service-worker.js')
            .then(() => console.log('SW registered'))
            .catch(err => console.warn('SW failed', err));
        }
      } catch (err) {
        console.error(err);
        alert('خطا در راه‌اندازی برنامه: ' + err.message);
      }
    },

    showPage,
    editTx(id) { hideModal(); openEdit(id); },
    deleteTx(id) { deleteTransaction(id); },

    setCurrency(c) {
      settings.currency = c;
      saveSettings();
      hideModal();
      renderSettings();
      renderDashboard();
      toast('واحد پول تغییر کرد');
    },

    setBudget() {
      const val = parseAmount(document.getElementById('budget-input').value);
      settings.monthlyBudget = val;
      saveSettings();
      hideModal();
      renderSettings();
      renderDashboard();
      toast(val ? 'بودجه ذخیره شد' : 'بودجه حذف شد');
    },

    clearBudget() {
      settings.monthlyBudget = 0;
      saveSettings();
      hideModal();
      renderSettings();
      renderDashboard();
      toast('بودجه حذف شد');
    },

    setPin() {
      const pin = toEnglishDigits(document.getElementById('new-pin').value);
      if (!/^\d{4}$/.test(pin)) {
        toast('رمز باید ۴ رقم باشد');
        return;
      }
      settings.pin = pin;
      saveSettings();
      hideModal();
      renderSettings();
      toast('رمز عبور فعال شد');
    },

    removePin() {
      settings.pin = null;
      saveSettings();
      hideModal();
      renderSettings();
      toast('رمز عبور حذف شد');
    },

    async addCategory() {
      const name = document.getElementById('new-cat-name').value.trim();
      if (!name) { toast('نام دسته را وارد کنید'); return; }
      const type = document.getElementById('new-cat-type-inc').classList.contains('active') ? 'income' : 'expense';
      const id = 'custom_' + Date.now();
      const cat = { id, name, type, icon: type === 'income' ? '📥' : '📦' };
      await dbPut('categories', cat);
      categories.push(cat);
      hideModal();
      toast('دسته جدید اضافه شد');
    },

    async addCategoryQuick() {
      const name = document.getElementById('quick-cat-name').value.trim();
      if (!name) { toast('نام دسته را وارد کنید'); return; }
      const id = 'custom_' + Date.now();
      const cat = { id, name, type: currentType, icon: currentType === 'income' ? '📥' : '📦' };
      await dbPut('categories', cat);
      categories.push(cat);
      hideModal();
      renderCategoryChips();
      // select the new one
      setTimeout(() => {
        document.querySelectorAll('#category-chips .chip').forEach(c => {
          c.classList.toggle('active', c.dataset.id === id);
        });
      }, 50);
      toast('دسته اضافه شد');
    },

    async deleteCategory(id) {
      if (!confirm('این دسته حذف شود؟')) return;
      await dbDelete('categories', id);
      categories = categories.filter(c => c.id !== id);
      hideModal();
      toast('دسته حذف شد');
    }
  };
})();

// Boot
document.addEventListener('DOMContentLoaded', () => App.init());
