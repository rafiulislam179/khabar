'use strict';
(function () {
  const $ = (id) => document.getElementById(id);
  const sections = ['home', 'goals', 'loading', 'result', 'mealResult', 'error'];
  const ADV = window.KhabarAdvisor || null; // goals advisor (advisor.js)

  // Show OUR OWN unexpected errors as a small banner (helps find phone-only bugs).
  // Errors from Telegram/browser add-ons are ignored so they never break the app.
  function showBug(msg) {
    let bar = $('bugBar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'bugBar';
      bar.className = 'bug-bar';
      bar.addEventListener('click', () => bar.remove());
      document.body.prepend(bar);
    }
    bar.textContent = `⚠️ অ্যাপে একটা সমস্যা হয়েছে (স্ক্রিনশট পাঠান, ট্যাপ করে বন্ধ করুন): ${String(msg || 'unknown').slice(0, 140)}`;
  }
  const OUR_FILES = /\/(app|advisor)\.js/;
  window.addEventListener('error', (e) => {
    if (!e || !e.filename || !OUR_FILES.test(e.filename) || e.filename.indexOf(location.origin) !== 0) return;
    showBug(`${e.message} @${(e.filename.split('/').pop() || '').split('?')[0]}:${e.lineno}`);
  });

  const LABEL = { GREEN: 'কম', AMBER: 'মাঝারি', RED: 'বেশি', UNKNOWN: 'তথ্য নেই' };
  const VERDICT = {
    GREEN: 'ভালো পছন্দ',
    AMBER: 'মাঝে মাঝে খাওয়া যায়',
    RED: 'কম খাওয়াই ভালো',
    UNKNOWN: 'যথেষ্ট তথ্য নেই',
  };
  const NUTRIENTS = [
    { key: 'sodium', name: 'লবণ', value: (p) => (p.salt_g != null ? `${bn(p.salt_g)} গ্রাম` : '—') },
    { key: 'sugar', name: 'চিনি', value: (p) => (p.sugar_g != null ? `${bn(p.sugar_g)} গ্রাম` : '—') },
    { key: 'fat', name: 'চর্বি', value: (p) => (p.fat_g != null ? `${bn(p.fat_g)} গ্রাম` : '—') },
    { key: 'saturated_fat', name: 'স্যাচুরেটেড চর্বি', value: (p) => (p.saturated_fat_g != null ? `${bn(p.saturated_fat_g)} গ্রাম` : '—') },
  ];
  const BN = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
  function bn(n) {
    return Number(n).toLocaleString('en-US', { maximumFractionDigits: 1 }).replace(/\d/g, (d) => BN[d]);
  }

  function show(id) {
    sections.forEach((s) => { const el = $(s); if (el) el.hidden = s !== id; });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Resize + re-encode on the phone: smaller upload (saves data) and drops EXIF/GPS before it leaves the device.
  async function compress(file) {
    const MAX = 1600;
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      const scale = Math.min(1, MAX / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close && bitmap.close();
      const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.85));
      return blob || file;
    } catch {
      if (/heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name || '')) {
        throw new Error('এই ছবির ফরম্যাট (HEIC) পড়া যাচ্ছে না। ক্যামেরা দিয়ে সরাসরি ছবি তুলুন, অথবা স্ক্রিনশট নিয়ে সেটা দিন।');
      }
      return file; // older browsers: server still strips metadata
    }
  }

  async function scan(file) {
    if (!file) {
      $('errorText').textContent = 'ছবি পাওয়া যায়নি। আবার ছবি বেছে নিন।';
      show('error');
      return;
    }
    const previewUrl = URL.createObjectURL(file);
    $('preview').src = previewUrl;
    show('loading');

    const mode = document.querySelector('input[name="mode"]:checked').value;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90000);

    try {
      const blob = await compress(file);
      const form = new FormData();
      form.append('photo', blob, 'label.jpg');
      form.append('mode', mode);

      const res = await fetch('/api/scan', { method: 'POST', body: form, signal: controller.signal });
      let data = null;
      try { data = await res.json(); } catch { /* non-JSON */ }

      if (!res.ok || !data || !data.ok) {
        throw new Error((data && data.message) || 'এখন সমস্যা হচ্ছে, একটু পরে চেষ্টা করুন।');
      }
      if (data.type === 'meal') renderMeal(data);
      else renderResult(data);
      saveHistory(data);
    } catch (err) {
      const msg = err.name === 'AbortError'
        ? 'সময় বেশি লাগছে। ইন্টারনেট দেখে আবার চেষ্টা করুন।'
        : (navigator.onLine === false ? 'ইন্টারনেট সংযোগ নেই।' : err.message);
      $('errorText').textContent = msg;
      show('error');
    } finally {
      clearTimeout(timer);
      URL.revokeObjectURL(previewUrl);
      ['photoCamera', 'photoGallery', 'photo'].forEach((id) => { const el = $(id); if (el) el.value = ''; });
    }
  }

  function renderProduct(p) {
    const box = $('product');
    if (!p || !p.name) { box.hidden = true; return; }
    $('productName').textContent = [p.brand, p.name].filter(Boolean).join(' · ');
    $('productMemory').textContent = p.scan_count > 1
      ? `🧠 ${bn(p.scan_count)} বার স্ক্যান হয়েছে, তাই ফলাফল স্থির করা হয়েছে`
      : '🆕 প্রথমবার স্ক্যান হলো, পরের বার আরও স্থির হবে';
    box.hidden = false;
  }

  function renderResult(data) {
    renderProduct(data.product);
    const overall = (data.ratings && data.ratings.overall) || 'UNKNOWN';
    const v = $('verdict');
    v.className = `verdict ${overall}`;
    $('verdictText').textContent = VERDICT[overall] || VERDICT.UNKNOWN;

    const rows = $('rows');
    rows.textContent = '';
    for (const n of NUTRIENTS) {
      const rating = (data.ratings && data.ratings[n.key]) || 'UNKNOWN';
      const row = document.createElement('div');
      row.className = 'row';
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = n.name;
      const val = document.createElement('span');
      val.className = 'val';
      val.textContent = n.value(data.per100g || {});
      const chip = document.createElement('span');
      chip.className = `chip ${rating}`;
      chip.textContent = LABEL[rating] || LABEL.UNKNOWN;
      row.append(name, val, chip);
      rows.append(row);
    }

    renderAdvice('labelAdvice', ADV && ADV.adviseLabel(loadProfile(), data.ratings, data.per100g));

    // textContent only: server text is never treated as HTML.
    $('message').textContent = data.message || '';
    show('result');
  }

  // --- Meal result: portion buttons recalculate on the phone (no new AI call) ---
  const PORTION_BN = { small: 'ছোট', medium: 'মাঝারি', large: 'বড়' };
  const PORTIONS = ['small', 'medium', 'large'];
  const LEVEL_BN = { low: 'কম', med: 'মাঝারি', high: 'বেশি' };
  const r10 = (n) => Math.round(n / 10) * 10;
  function itemKcal(it, portion) {
    const amount = it.portion === portion && it.amount ? it.amount : it.portions[PORTIONS.indexOf(portion)];
    const f = it.unit === 'g' ? amount / 100 : amount;
    return { min: r10(it.kcal_per_unit[0] * f), max: r10(it.kcal_per_unit[1] * f), amount };
  }
  function amountText(it, amount) {
    return it.unit === 'g' ? `~${bn(amount)} গ্রাম` : `${bn(amount)} টা`;
  }
  let currentMeal = null;
  function renderMeal(data) {
    currentMeal = data.meal;
    const m = currentMeal;
    $('mealVerdict').className = `verdict ${m.overall}`;
    $('mealVerdictText').textContent = VERDICT[m.overall] || VERDICT.UNKNOWN;
    const list = $('mealItems');
    list.textContent = '';
    m.items.forEach((it) => {
      const box = document.createElement('div');
      box.className = 'meal-item';
      const head = document.createElement('div');
      head.className = 'head';
      const name = document.createElement('span');
      name.className = 'dname';
      name.textContent = it.name;
      head.append(name);
      box.append(head);
      if (!it.known) {
        const k = document.createElement('div');
        k.className = 'kcal';
        k.textContent = 'এই খাবারের হিসাব এখনো আমাদের তালিকায় নেই';
        box.append(k);
        list.append(box);
        return;
      }
      const chip = document.createElement('span');
      chip.className = `chip ${it.verdict}`;
      chip.textContent = { GREEN: 'ভালো', AMBER: 'মাঝে মাঝে', RED: 'কম খান' }[it.verdict];
      head.append(chip);
      const kcal = document.createElement('div');
      kcal.className = 'kcal';
      box.append(kcal);
      const lv = document.createElement('div');
      lv.className = 'levels';
      [['লবণ', it.salt], ['তেল', it.oil], ['চিনি', it.sugar]].forEach(([n, l]) => {
        const sp = document.createElement('span');
        sp.className = l;
        sp.textContent = `${n}: ${LEVEL_BN[l]}`;
        lv.append(sp);
      });
      box.append(lv);
      const row = document.createElement('div');
      row.className = 'portion';
      PORTIONS.forEach((p) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = PORTION_BN[p];
        b.setAttribute('aria-pressed', String(p === it.portion));
        b.addEventListener('click', () => {
          it.portion = p;
          it.amount = it.portions[PORTIONS.indexOf(p)];
          row.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
          updateMealNumbers();
        });
        row.append(b);
      });
      box.append(row);
      it._kcalEl = kcal;
      list.append(box);
    });
    updateMealNumbers();
    $('mealTip').textContent = data.message || m.tip || '';
    show('mealResult');
  }
  function updateMealNumbers() {
    let min = 0; let max = 0;
    currentMeal.items.filter((i) => i.known).forEach((it) => {
      const k = itemKcal(it, it.portion);
      min += k.min; max += k.max;
      it._kcalEl.textContent = `${amountText(it, k.amount)} · ${bn(k.min)}–${bn(k.max)} ক্যালরি`;
    });
    $('mealTotal').textContent = max > 0 ? `${bn(min)}–${bn(max)} ক্যালরি` : 'হিসাব করা যায়নি';
    currentMeal._total = { min, max };
    renderAdvice('mealAdvice', ADV && ADV.adviseMeal(loadProfile(), currentMeal, max > 0 ? max : NaN));
    const add = $('addToday');
    add.hidden = !(max > 0) || !ADV;
    add.disabled = !!currentMeal._added;
    add.textContent = currentMeal._added ? '✔ যোগ হয়েছে' : '➕ আজকের খাবারে যোগ করুন';
  }

  // --- Goals advisor UI ---
  const ADVICE_VERDICT = { GREEN: '✅ ঠিক আছে', AMBER: '⚠️ অল্প খান', RED: '❌ এড়িয়ে চলুন', UNKNOWN: 'তথ্য কম' };
  function renderAdvice(id, advice) {
    const box = $(id);
    if (!box) return;
    if (!advice) { box.hidden = true; return; }
    const v = $(`${id}Verdict`);
    v.className = advice.verdict;
    v.textContent = ADVICE_VERDICT[advice.verdict] || ADVICE_VERDICT.UNKNOWN;
    const ul = $(`${id}Lines`);
    ul.textContent = '';
    advice.lines.forEach((t) => { const li = document.createElement('li'); li.textContent = t; ul.append(li); });
    box.hidden = false;
  }

  const PROFILE_KEY = 'khabar-goals-v1';
  function readStoredProfile() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null'); } catch { raw = null; }
    return ADV ? ADV.cleanProfile(raw) : { goals: [] };
  }
  function saveProfile(p) {
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); } catch { /* storage blocked: works this session only */ }
    sessionProfile = p;
  }
  let sessionProfile = null;
  // If storage is blocked, fall back to what was saved this session.
  function loadProfile() {
    const p = readStoredProfile();
    return p.goals.length || !sessionProfile ? p : sessionProfile;
  }

  function renderGoalsSummary() {
    if (!ADV) { $('goalsBtn').hidden = true; return; }
    const p = loadProfile();
    $('goalsSummary').textContent = p.goals.length
      ? `আমার লক্ষ্য: ${p.goals.map((g) => ADV.GOALS[g].icon + ' ' + ADV.GOALS[g].bn.split(' (')[0]).join(', ')}`
      : 'আমার লক্ষ্য ঠিক করুন';
  }
  function readGoalsForm() {
    const goals = [...document.querySelectorAll('#goalOptions input:checked')].map((i) => i.value);
    const sex = (document.querySelector('input[name="sex"]:checked') || {}).value;
    const activity = (document.querySelector('input[name="activity"]:checked') || {}).value;
    return ADV.cleanProfile({ goals, sex, activity });
  }
  function updateBudgetPreview() {
    $('budgetPreview').textContent = `দিনে আনুমানিক ক্যালরি: ~${bn(ADV.dailyBudget(readGoalsForm()))} (সাধারণ প্রাপ্তবয়স্কের হিসাব)`;
  }
  function openGoals() {
    const p = loadProfile();
    const box = $('goalOptions');
    box.textContent = '';
    Object.entries(ADV.GOALS).forEach(([key, g]) => {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = key;
      input.checked = p.goals.includes(key);
      input.addEventListener('change', () => {
        const checked = document.querySelectorAll('#goalOptions input:checked');
        if (checked.length > 3) input.checked = false; // max 3
        updateBudgetPreview();
      });
      const text = document.createElement('span');
      text.textContent = `${g.icon} ${g.bn}`;
      label.append(input, text);
      box.append(label);
    });
    document.querySelectorAll('input[name="sex"]').forEach((i) => { i.checked = i.value === p.sex; });
    document.querySelectorAll('input[name="activity"]').forEach((i) => { i.checked = i.value === p.activity; });
    updateBudgetPreview();
    show('goals');
  }

  // --- Today's log ---
  const TODAY_KEY = 'khabar-today-v1';
  let sessionLog = null;
  function loadLog() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(TODAY_KEY) || 'null'); } catch { raw = null; }
    return ADV.cleanLog(raw || sessionLog);
  }
  function saveLog(log) {
    sessionLog = log;
    try { localStorage.setItem(TODAY_KEY, JSON.stringify(log)); } catch { /* ignore */ }
  }
  function renderToday() {
    const card = $('todayCard');
    if (!ADV) { card.hidden = true; return; }
    const log = loadLog();
    card.hidden = log.items.length === 0;
    if (!log.items.length) return;
    const t = ADV.logTotal(log);
    const budget = ADV.dailyBudget(loadProfile());
    $('todayTotal').textContent = `${bn(t.min)}–${bn(t.max)} ক্যালরি`;
    $('todayBudget').textContent = `আপনার দিনের আনুমানিক সীমা: ~${bn(budget)} ক্যালরি`;
    const mid = (t.min + t.max) / 2;
    const bar = $('todayBar');
    bar.style.width = `${Math.min(100, Math.round((mid / budget) * 100))}%`;
    bar.className = mid > budget ? 'RED' : mid > budget * 0.8 ? 'AMBER' : '';
    const ul = $('todayList');
    ul.textContent = '';
    log.items.forEach((i) => {
      const li = document.createElement('li');
      const a = document.createElement('span');
      a.textContent = i.name;
      const b = document.createElement('span');
      b.className = 'muted small';
      b.textContent = `${bn(i.min)}–${bn(i.max)}`;
      li.append(a, b);
      ul.append(li);
    });
  }
  function addMealToToday() {
    if (!ADV || !currentMeal || currentMeal._added || !currentMeal._total || !(currentMeal._total.max > 0)) return;
    currentMeal._added = true;
    const log = loadLog();
    const name = currentMeal.items.filter((i) => i.known).map((i) => i.name).join(', ').slice(0, 60);
    log.items.push({ name, min: currentMeal._total.min, max: currentMeal._total.max });
    saveLog(ADV.cleanLog(log));
    renderToday();
    const add = $('addToday');
    add.disabled = true;
    add.textContent = '✔ যোগ হয়েছে';
  }

  // --- History (this phone only; optional; safe if storage is blocked) ---
  const KEY = 'khabar-history';
  function readHistory() {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
  }
  function saveHistory(data) {
    try {
      const list = readHistory();
      const overall = data.type === 'meal' ? data.meal.overall : data.ratings.overall;
      list.unshift({ t: Date.now(), overall, kind: data.type === 'meal' ? 'meal' : 'label' });
      localStorage.setItem(KEY, JSON.stringify(list.slice(0, 5)));
    } catch { /* ignore */ }
    renderHistory();
  }
  function renderHistory() {
    const list = readHistory();
    $('historyCard').hidden = list.length === 0;
    const ul = $('history');
    ul.textContent = '';
    for (const h of list) {
      const li = document.createElement('li');
      const when = document.createElement('span');
      when.textContent = `${h.kind === 'meal' ? '🍛' : '📦'} ${new Date(h.t).toLocaleString('bn-BD', { dateStyle: 'medium', timeStyle: 'short' })}`;
      const chip = document.createElement('span');
      chip.className = `chip ${h.overall}`;
      chip.textContent = LABEL[h.overall] || LABEL.UNKNOWN;
      li.append(when, chip);
      ul.append(li);
    }
  }

  // --- Events ---
  ['photoCamera', 'photoGallery', 'photo'].forEach((id) => {
    const el = $(id);
    if (el) el.addEventListener('change', (e) => scan(e.target.files && e.target.files[0]));
  });

  // --- Consent (first visit; stored on this phone only) ---
  const CONSENT_KEY = 'khabar-consent-v1';
  function hasConsent() {
    try { return localStorage.getItem(CONSENT_KEY) === 'yes'; } catch { return false; }
  }
  if (!hasConsent() && $('consent')) $('consent').hidden = false;
  if ($('consentAccept')) $('consentAccept').addEventListener('click', () => {
    try { localStorage.setItem(CONSENT_KEY, 'yes'); } catch { /* still allow this session */ }
    $('consent').hidden = true;
  });
  $('againBtn').addEventListener('click', () => show('home'));
  if ($('mealAgainBtn')) $('mealAgainBtn').addEventListener('click', () => show('home'));
  if (ADV) {
    $('goalsBtn').addEventListener('click', openGoals);
    $('goalsCancel').addEventListener('click', () => show('home'));
    $('goalsSave').addEventListener('click', () => {
      saveProfile(readGoalsForm());
      renderGoalsSummary();
      renderToday();
      show('home');
    });
    document.querySelectorAll('input[name="sex"], input[name="activity"]').forEach((i) => i.addEventListener('change', updateBudgetPreview));
    $('addToday').addEventListener('click', addMealToToday);
    $('todayClear').addEventListener('click', () => { saveLog({ date: ADV.todayKey(), items: [] }); renderToday(); });
  }
  $('retryBtn').addEventListener('click', () => show('home'));

  // --- Install as app (Android Chrome) ---
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    $('installBtn').hidden = false;
  });
  $('installBtn').addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    $('installBtn').hidden = true;
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }

  renderHistory();
  renderGoalsSummary();
  renderToday();
})();
