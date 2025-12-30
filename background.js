// background.js
const OWNER = 'rodnen';
const REPO  = 'yasno-extension';
const CACHE_KEY_PREFIX = 'cache:yasno:table';
const CACHE_TTL_MIN    = 20;                // хвилини
const CURRENT_VERSION = chrome.runtime.getManifest().version;

/* ---------- оновлення розширення ---------- */
async function checkUpdate() {
  try {
    const rsp = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases?per_page=1`);
    if (!rsp.ok) throw new Error('GitHub unreachable');
    const [latest] = await rsp.json();
    const latestVer = latest.tag_name;
    const url       = latest.html_url;

    switch (semverCompare(CURRENT_VERSION, latestVer)) {
      case -1:
        console.log('[BG] version new');
        chrome.notifications.create('update-available', {
          type:    'basic',
          iconUrl: 'icons/icon128.png',
          title:   'New version available',
          message: `${REPO} ${latestVer} is out. Click to download.`
        });
        chrome.notifications.onClicked.addListener(id => {
          if (id === 'update-available') {
            chrome.tabs.create({ url });
            chrome.notifications.clear(id);
          }
        });
        break;
      case 0:
        console.log('[BG] versions equal');
        break;
      case 1:
        console.log('[BG] local is NEWER');
        break;
    }
  } catch (e) {
    console.warn('[Update check]', e);
  }
}

function semverCompare(a, b) {
  const clean = v => v.replace(/^[^0-9]*/, '').split('.').map(Number);
  const va = clean(a);
  const vb = clean(b);
  for (let i = 0; i < 3; i++) {
    const pa = va[i] || 0;
    const pb = vb[i] || 0;
    if (pa > pb) return 1;
    if (pa < pb) return -1;
  }
  return 0;
}

/* ---------- кешування ---------- */
function cacheKey(group, date) {
  return `${CACHE_KEY_PREFIX}:${group}:${date}`;
}

async function getCached(group, dayType) {
  const key = cacheKey(group, dayType);
  const stored = await chrome.storage.local.get(key);
  if (!stored[key]) return null;
  const { ts, html } = stored[key];
  const now = Date.now();
  const valid = now - ts < CACHE_TTL_MIN * 60 * 1000;
  if (!valid) {
    await chrome.storage.local.remove(key); // протух – видаляємо
    return null;
  }
  return html;
}

async function setCached(group, date, html) {
  const key = cacheKey(group, date);
  await chrome.storage.local.set({ [key]: { ts: Date.now(), html } });
}

/* ---------- побудова HTML ---------- */
async function buildTableHTML(group = 'all', currentDayNumber = new Date().getDate(), dayType = 'today') {
  const cached = await getCached(group, dayType);
  if (cached) {
    console.log('[BG] кеш ще дійсний, повертаємо з storage');
    return cached;
  }

  const url = 'https://app.yasno.ua/api/blackout-service/public/shutdowns/regions/3/dsos/301/planned-outages';
  try {
    const data = await fetch(url).then(r => r.json());
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const iconUrl = chrome.runtime.getURL('icons/no-electricity.svg');

    const minutesToTime = m => {
      let h = Math.floor(m / 60);
      if (h === 24) h = 0;
      const min = m % 60;
      return `${h.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`;
    };
    const localizeType = t => (t === 'Definite' ? 'Світла немає' : 'Світло є');

    const rows = [];
    const groups = group === 'all' ? Object.keys(data) : [group];

    let hasAnySlots = false
    let effectiveDayType = dayType;

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
      const schedules = data[g]
      const slots = schedules?.[dayType]?.slots || [];
      const iso = schedules?.[dayType]?.date || [];
      const scheduleDayNumber = new Date(iso).getDate();

      if (effectiveDayType === 'tomorrow' && scheduleDayNumber !== currentDayNumber) {
        continue;
      }

      const isOutdated = schedules?.[dayType]?.status === "WaitingForSchedule"
      if (slots.length) hasAnySlots = true;
      
      if(isOutdated && hasAnySlots) {
        rows.push(`<div class="_table_is_outdated">⏳ Очікуємо на більш актуальні дані</div>`);
      }

      if (hasAnySlots) {
        for (const slot of slots) {
          const start = minutesToTime(slot.start);
          const end   = minutesToTime(slot.end);
          const isNow = slot.start <= nowMin && nowMin < slot.end && dayType === 'today';
          const isOutage = slot.type === 'Definite';
          rows.push(`
            <div class="_table_element${isOutage ? ' outage' : ''}">
              <div>
                <div class="_outage_time">
                  ${isNow ? '<div class="_table_current_selected"></div>' : ''}
                  ${start} - ${end}
                </div>
                <div class="_outage_type">${localizeType(slot.type)}</div>
              </div>
              ${isOutage ? `<img src="${iconUrl}" />` : ''}
            </div>
          `);
        }
      }
    }

    if (!hasAnySlots) {
      console.log("slots empty")
      rows.push(`<div class="waiting-for-updates"><span class="clock-emoji">⏳</span><span>Очікуємо оновлення</span></div>`);
    }

    const html = rows.join('');
    await setCached(group, dayType, html);
    return html;
  } catch (e) {
    console.error('[BG] помилка побудови таблиці', e);
    return null;
  }
}

/* ---------- messaging ---------- */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg === 'checkUpdate') {
    checkUpdate().catch(console.error);
    return true;
  }

  if (msg.getTable) {
    (async () => {
      const html = await buildTableHTML(msg.group, msg.currentDayNumber, msg.dayType);
      sendResponse(html);
    })();
    return true;
  }

  if (msg === 'clearCache') {
    clearAllCache().then(() => sendResponse({ ok: true }));
    return true;
  }

});

async function clearAllCache() {
  const all = await chrome.storage.local.get();
  const toRemove = [];

  for (const key in all) {
    if (key.startsWith(CACHE_KEY_PREFIX)) {
      toRemove.push(key);
    }
  }

  if (toRemove.length) {
    await chrome.storage.local.remove(toRemove);
    console.log('[BG] кеш очищено, видалено ключів:', toRemove.length);
  } else {
    console.log('[BG] кеш порожній');
  }
}