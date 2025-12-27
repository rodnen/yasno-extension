let targetGroup = 'all';
const now   = new Date();
const nowMin = now.getHours() * 60 + now.getMinutes();

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.group) targetGroup = msg.group;
});

console.log('[OFF] render.js старт', Date.now());

(async () => {
  try {
    const url = 'https://app.yasno.ua/api/blackout-service/public/shutdowns/regions/3/dsos/301/planned-outages';
    const data = await fetch(url).then(r => r.json());

    function minutesToTime(m) {
      const h = Math.floor(m / 60);
      const min = m % 60;
      return `${h.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`;
    }

    function localizeType(t) {
      switch (t) {
        case 'Definite': return 'Відключення';
        case 'NotPlanned': return 'Немає відключень';
        default: return t;
      }
    }

    let rows = [];
    const groups = targetGroup === 'all' ? Object.keys(data) : [targetGroup];

    for (const group of groups) {
      const todaySlots = data[group]?.today.slots || [];
      if (!todaySlots.length) {
        rows.push(`<tr><td>${group}</td><td colspan="3">Немає відключень</td></tr>`);
        continue;
      }
      for (const slot of todaySlots) {
        const start = minutesToTime(slot.start);
        const end   = minutesToTime(slot.end);
        const isNow = slot.start <= nowMin && nowMin < slot.end;
        rows.push(`<tr${isNow ? ' class="now"' : ''}>
                     <td>${group}</td>
                     <td>${start}</td>
                     <td>${end}</td>
                     <td>${localizeType(slot.type)}</td>
                   </tr>`);
      }
    }

    const tableHTML = `
      <table class="rounded-table">
        <thead>
          <tr><th>Черга</th><th>Початок</th><th>Кінець</th><th>Статус</th></tr>
        </thead>
        <tbody>${rows.join('')}</tbody>
      </table>`;

    console.log('[OFF] НАДСИЛАЄМО tableHTML, length =', tableHTML.length);
    chrome.runtime.sendMessage({ tableHTML });
  } catch (e) {
    console.error('[OFF] помилка', e);
    chrome.runtime.sendMessage({ tableHTML: null });
  }
})();