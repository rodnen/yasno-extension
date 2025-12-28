let targetGroup = 'all';
let targetDate  = 'today';

const now   = new Date();
const nowMin = now.getHours() * 60 + now.getMinutes();
const fileName = 'no-electricity.svg';
const src = chrome.runtime.getURL(`icons/${fileName}`)
const OUTAGE_ICON = `<img src="${src}"/>`;

const plannedOutagesUrl  = 'https://app.yasno.ua/api/blackout-service/public/shutdowns/regions/3/dsos/301/planned-outages';

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.group) targetGroup = msg.group;
  if (msg.date)  targetDate  = msg.date;
});

(async () => {
  try {
    function minutesToTime(m) {
      let h = Math.floor(m / 60);
      if(h == 24) h = 0;
      const min = m % 60;
      return `${h.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`;
    }

    function localizeType(t) {
      switch (t) {
        case 'Definite': return 'Світла немає';
        case 'NotPlanned': return 'Світло є';
        default: return t;
      }
    }

    const data = await fetch(plannedOutagesUrl).then(r => r.json());

    let rows = [];
    const groups = targetGroup === 'all' ? Object.keys(data) : [targetGroup];
    
    for (const group of groups) {
      const slots = data[group]?.[targetDate].slots || [];
      if (!slots.length) {
        rows.push(`<div class="waiting-for-updates"><span class="clock-emoji">⏳</span><span>Очікуємо оновлення</span></div>`);
        continue;
      }
      for (const slot of slots) {
        const start = minutesToTime(slot.start);
        const end   = minutesToTime(slot.end);
        const isNow = slot.start <= nowMin && nowMin < slot.end && targetDate === 'today';
        const isOutage = slot.type == 'Definite'
        rows.push(`
        <div class="_table_element${isOutage ? ' outage' : ''}">
          <div>
            <div class="_outage_time">
              ${isNow ? '<div class="_table_current_selected"></div>' : ''}
              ${start} - ${end}
            </div>
            <div class="_outage_type">${localizeType(slot.type)}</div>
          </div>
          ${isOutage ? OUTAGE_ICON : ''}
        </div>
      `);
      }
    }

    const tableHTML = `${rows.join('')}`;
    chrome.runtime.sendMessage({ tableHTML });
  } catch (e) {
    console.error('[OFF] помилка', e);
    chrome.runtime.sendMessage({ tableHTML: null });
  }
})();