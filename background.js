// background.js

const CACHE_KEY_PREFIX = 'cache:yasno:table';
const CACHE_TTL_MIN = 20;
const CURRENT_VERSION = chrome.runtime.getManifest().version;

const CITY = "м. Дніпро";
const STREET = "тупик Шкільний";

/* ---------- утиліти часу ---------- */
function minutesToTime(min) {
  if (min === 1440) return '00:00';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/* ---------- спільний рендер рядка ---------- */
function buildSlotHTML({ start, end, isOutage, isNow, slotIndex }) {
  const iconUrl = chrome.runtime.getURL('icons/no-electricity.svg');
  return `
    <div class="_table_element${isOutage ? ' outage' : ''}${isNow ? ' selected' : ''}">
      <div>
        <div class="_outage_time">
          ${isNow ? `<div class="_table_current_selected" data-index="${slotIndex}"></div>` : ''}
          ${minutesToTime(start)} - ${minutesToTime(end)}
        </div>
        <div class="_outage_type">${isOutage ? 'Світла немає' : 'Світло є'}</div>
      </div>
      ${isOutage ? `<img src="${iconUrl}" />` : ''}
    </div>
  `;
}

/* ---------- кешування ---------- */
function cacheKey(cacheParts) {
  if (Array.isArray(cacheParts)) {
    return [CACHE_KEY_PREFIX, ...cacheParts].join(':');
  }
  const sortedParts = Object.keys(cacheParts).sort().map(k => cacheParts[k]);
  return [CACHE_KEY_PREFIX, ...sortedParts].join(':');
}

async function getCached(cacheParts) {
  const key = cacheKey(cacheParts);
  const stored = await chrome.storage.local.get(key);
  if (!stored[key]) return null;

  const { ts, html } = stored[key];
  const valid = Date.now() - ts < CACHE_TTL_MIN * 60 * 1000;

  if (!valid) {
    await chrome.storage.local.remove(key);
    return null;
  }
  return html;
}

async function setCached(cacheParts, html) {
  const key = cacheKey(cacheParts);
  await chrome.storage.local.set({ [key]: { ts: Date.now(), html } });
}

// Окремі ключі для raw DTEK даних (не HTML, інший TTL не потрібен)
async function getCachedDTEKRawData() {
  const stored = await chrome.storage.local.get(['dtek:raw:data', 'dtek:raw:data:ts']);
  const ts = stored['dtek:raw:data:ts'];
  const data = stored['dtek:raw:data'];
  if (!data || !ts) return null;

  const valid = Date.now() - ts < CACHE_TTL_MIN * 60 * 1000;
  if (!valid) {
    await chrome.storage.local.remove(['dtek:raw:data', 'dtek:raw:data:ts']);
    return null;
  }
  return data;
}

async function setCachedDTEKRawData(data) {
  await chrome.storage.local.set({
    'dtek:raw:data': data,
    'dtek:raw:data:ts': Date.now()
  });
}

/* ---------- оновлення розширення ---------- */
async function checkUpdate(owner, repo) {
  try {
    const rsp = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases?per_page=1`);
    if (!rsp.ok) throw new Error('GitHub unreachable');
    const [latest] = await rsp.json();
    const { tag_name: latestVer, html_url: url, published_at: published, name: description } = latest;
    const cmp = semverCompare(CURRENT_VERSION, latestVer);

    if (cmp === -1) {
      chrome.notifications.create('update-available', {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'New version available',
        message: `${repo} ${latestVer} is out. Click to download.`
      });
      chrome.notifications.onClicked.addListener(id => {
        if (id === 'update-available') {
          chrome.tabs.create({ url });
          chrome.notifications.clear(id);
        }
      });
    }

    return { cmp, latestVer, published, description };
  } catch (e) {
    console.warn('[Update check]', e);
    return null;
  }
}

function semverCompare(a, b) {
  const clean = v => v.replace(/^[^0-9]*/, '').split('.').map(Number);
  const [va, vb] = [clean(a), clean(b)];
  for (let i = 0; i < 3; i++) {
    if (va[i] > vb[i]) return 1;
    if (va[i] < vb[i]) return -1;
  }
  return 0;
}

/* ========================================
   YASNO
   ======================================== */
async function buildTableHTML(group = 'all', osr = '301', currentDayNumber = new Date().getDate(), dayType = 'today') {
  const cached = await getCached({ group, osr, dayType });
  if (cached) {
    console.log('[BG] Yasno: кеш дійсний');
    return cached;
  }

  const url = `https://app.yasno.ua/api/blackout-service/public/shutdowns/regions/3/dsos/${osr}/planned-outages`;
  try {
    const data = await fetch(url).then(r => r.json());
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();

    const localizeType = t => (t === 'Definite' ? 'Світла немає' : 'Світло є');

    const rows = [];
    const groups = group === 'all' ? Object.keys(data) : [group];

    let hasAnySlots = false;
    let isEmergency = false;
    let isOutdated = false;
    let effectiveDayType = dayType;
    let slotIndex = 0;

    if (effectiveDayType === 'today') {
      const todayIso = data[groups[0]]?.today?.date;
      if (todayIso) {
        const scheduleDayNumber = new Date(todayIso).getDate();
        if (scheduleDayNumber !== currentDayNumber) {
          effectiveDayType = 'tomorrow';
        }
      }
    }

    for (const g of groups) {
      const schedules = data[g];
      const slots = schedules?.[effectiveDayType]?.slots || [];
      const iso = schedules?.[effectiveDayType]?.date;
      const scheduleDayNumber = new Date(iso).getDate();

      if (effectiveDayType === 'tomorrow' && scheduleDayNumber === currentDayNumber && effectiveDayType === dayType) {
        continue;
      }

      isOutdated = schedules?.[effectiveDayType]?.status === 'WaitingForSchedule';
      isEmergency = schedules?.[effectiveDayType]?.status === 'EmergencyShutdowns';

      if (slots.length) hasAnySlots = true;

      if (isOutdated && hasAnySlots) {
        rows.push(`<div class="_table_is_outdated">⏳ Очікуємо на більш актуальні дані</div>`);
      }

      for (const slot of slots) {
        const isNow = slot.start <= nowMin && nowMin < slot.end && effectiveDayType === 'today';
        rows.push(buildSlotHTML({
          start: slot.start,
          end: slot.end,
          isOutage: slot.type === 'Definite',
          isNow,
          slotIndex
        }));
        slotIndex++;
      }
    }

    if (isEmergency) {
      rows.push(`<div class="emergency-shutdown"><span class="police-car-emoji">🚨</span><span>Екстрені відключення, графіки не діють</span></div>`);
    } else if (!hasAnySlots) {
      rows.push(`<div class="waiting-for-updates"><span class="clock-emoji">⏳</span><span>Очікуємо оновлення</span></div>`);
    }

    const html = rows.join('');
    await setCached({ group, osr, dayType }, html);
    return html;
  } catch (e) {
    console.error('[BG] Yasno: помилка', e);
    return null;
  }
}

/* ========================================
   DTEK
   ======================================== */
async function fetchDTEKRawData() {
  const AJAX_URL = 'https://www.dtek-dnem.com.ua/ua/ajax';
  const MAIN_PAGE_URL = 'https://www.dtek-dnem.com.ua/ua/shutdowns';

  try {
    const pageResponse = await fetch(MAIN_PAGE_URL, { method: 'GET', credentials: 'include' });
    if (!pageResponse.ok) throw new Error('Не вдалося завантажити головну сторінку');

    const html = await pageResponse.text();
    const csrfToken = html.match(/<meta name="csrf-token" content="(.*?)">/)?.[1];
    const csrfParam = html.match(/<meta name="csrf-param" content="(.*?)">/)?.[1] || '_csrf';

    if (!csrfToken) throw new Error('CSRF токен не знайдено');

    const dateStr = new Date().toLocaleString('uk-UA', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    }).replace(/,/g, '');

    const formData = new URLSearchParams({
      [csrfParam]: csrfToken,
      method: 'getHomeNum',
      'data[0][name]': 'city',
      'data[0][value]': CITY,
      'data[1][name]': 'street',
      'data[1][value]': STREET,
      'data[2][name]': 'updateFact',
      'data[2][value]': dateStr
    });

    const response = await fetch(AJAX_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Referer': MAIN_PAGE_URL,
        'Origin': 'https://www.dtek-dnem.com.ua'
      },
      credentials: 'include',
      body: formData.toString()
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);

    const data = await response.json();
    return data.fact;
  } catch (error) {
    console.error('[DTEK] Помилка:', error);
    return null;
  }
}

function buildHalfHourSlots(hoursData) {
  const STATUS_MAP = { yes: ['power', 'power'], no: ['outage', 'outage'], first: ['outage', 'power'], second: ['power', 'outage'] };

  return Object.entries(hoursData).flatMap(([hour, value]) => {
    const base = (Number(hour) - 1) * 60;
    const [firstHalf, secondHalf] = STATUS_MAP[value] ?? ['power', 'power'];
    return [
      { start: base, end: base + 30, status: firstHalf },
      { start: base + 30, end: base + 60, status: secondHalf }
    ];
  });
}

function mergeSlots(slots) {
  if (!slots.length) return [];
  return slots.slice(1).reduce((acc, next) => {
    const current = acc[acc.length - 1];
    if (next.status === current.status && next.start === current.end) {
      current.end = next.end;
    } else {
      acc.push({ ...next });
    }
    return acc;
  }, [{ ...slots[0] }]);
}

function renderDTEKTable(factData, group, dayType) {
  const timestamp = factData.today;
  const dayData = dayType === 'today' ? factData.data[timestamp] : factData.data[timestamp + 86400];
  if (!dayData?.[group]) return '';

  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();

  const slots = mergeSlots(buildHalfHourSlots(dayData[group]));

  return slots.map((slot, slotIndex) => buildSlotHTML({
    start: slot.start,
    end: slot.end,
    isOutage: slot.status === 'outage',
    isNow: slot.start <= nowMin && nowMin < slot.end && dayType === 'today',
    slotIndex
  })).join('');
}

async function buildTableHTMLDTEK(group = 'all', dayType = 'today') {
  const cached = await getCached(['dtek', group, dayType]);
  if (cached) {
    console.log(`[BG] DTEK: кеш дійсний для ${dayType}`);
    return cached;
  }

  let rawData = await getCachedDTEKRawData();

  if (!rawData) {
    console.log('[BG] DTEK: запит до сервера...');
    rawData = await fetchDTEKRawData();
    if (!rawData) return null;
    await setCachedDTEKRawData(rawData);
  }

  const html = renderDTEKTable(rawData, `GPV${group}`, dayType);
  await setCached(['dtek', group, dayType], html);
  return html;
}

/* ---------- messaging ---------- */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handlers = {
    checkUpdate: () => checkUpdate(msg.owner, msg.repo).then(result => sendResponse({ result })),
    fetchYasno: () => buildTableHTML(msg.group, msg.osr, msg.currentDayNumber, msg.dayType).then(sendResponse),
    fetchDTEK: () => buildTableHTMLDTEK(msg.group, msg.dayType).then(sendResponse),
    clearCache: () => clearAllCache().then(() => sendResponse({ ok: true }))
  };

  const handler = handlers[msg.action];
  if (handler) { handler(); return true; }
});

async function clearAllCache() {
  const all = await chrome.storage.local.get();
  const toRemove = Object.keys(all).filter(k => k.startsWith(CACHE_KEY_PREFIX));

  if (toRemove.length) {
    await chrome.storage.local.remove(toRemove);
    console.log('[BG] кеш очищено, видалено ключів:', toRemove.length);
  } else {
    console.log('[BG] кеш порожній');
  }
}