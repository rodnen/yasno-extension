console.log('[BG] старт');

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.getTable) {
    (async () => {
     console.log('[BG] запит для групи', msg.group || 'all');

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
        console.log('[BG] створюємо offscreen');
        await chrome.offscreen.createDocument({
          url: 'render.html?r=' + Date.now(),
          reasons: ['DOM_SCRAPING'],
          justification: 'Забрати зрендерену таблицю'
        });
        console.log('[BG] offscreen створено');
        chrome.runtime.sendMessage({ group: msg.group || 'all' });
      } catch (e) {
        console.error('[BG] не вдалося створити offscreen', e);
        sendResponse(null);
        return;
      }

      const answer = await new Promise(res => {
        const onMsg = (m, s, sr) => {
          if (Object.prototype.hasOwnProperty.call(m, 'tableHTML')) {
            chrome.runtime.onMessage.removeListener(onMsg);
            console.log('[BG] отримали tableHTML, length =', m.tableHTML?.length);
            res(m.tableHTML);
          }
        };
        chrome.runtime.onMessage.addListener(onMsg);
        setTimeout(() => {
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