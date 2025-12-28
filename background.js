const OWNER = 'rodnen';
const REPO  = 'yasno-extension';
const CURRENT_VERSION = chrome.runtime.getManifest().version;

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

  // 2. порівнюємо по частинах
  for (let i = 0; i < 3; i++) {
    const pa = va[i] || 0;
    const pb = vb[i] || 0;
    if (pa > pb) return 1;
    if (pa < pb) return -1;
  }
  return 0;
}


chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg === 'checkUpdate') {
    console.log("[BG] catch update check")
    checkUpdate().catch(console.error);
    return true;
  }

  if (msg.getTable) {
    (async () => {
      console.log('[BG] запит для групи', msg.group || 'all');
      console.log('[BG] запит за датою', msg.date || 'today');
      try {
        const existing = await chrome.offscreen.hasDocument?.() ||
        (await chrome.runtime.getContexts?.({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length > 0;
        if (existing) {
          console.log('[BG] закриваємо старий offscreen');
          await chrome.offscreen.closeDocument();
          await new Promise(r => setTimeout(r, 300));
        }
      } catch (e) {}

      try {
        await chrome.offscreen.createDocument({
          url: 'render.html?r=' + Date.now(),
          reasons: ['DOM_SCRAPING'],
          justification: 'Забрати зрендерену таблицю'
        });
        
        chrome.runtime.sendMessage({
          group: msg.group || 'all',
          date:  msg.date  || 'today'
        });
      } catch (e) {
        console.error('[BG] не вдалося створити offscreen', e);
        sendResponse(null);
        return;
      }

      const answer = await new Promise(res => {
        let timeoutId;
        const onMsg = (m, s, sr) => {
          if (Object.prototype.hasOwnProperty.call(m, 'tableHTML')) {
            chrome.runtime.onMessage.removeListener(onMsg);
            clearTimeout(timeoutId);
            res(m.tableHTML);
          }
        };

        chrome.runtime.onMessage.addListener(onMsg);
        timeoutId = setTimeout(() => {
          chrome.runtime.onMessage.removeListener(onMsg);
          console.warn('[BG] таймаут 15 с – немає відповіді');
          res(null);
        }, 15000);
      });

      try {
        console.log('[BG] закриваємо offscreen');
        await chrome.offscreen.closeDocument();
      } catch (e) {}
      sendResponse(answer);
    })();
    return true;
  }
});