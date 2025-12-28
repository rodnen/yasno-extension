const box        = document.getElementById('box');
const select     = document.getElementById('group-select');

document.addEventListener('DOMContentLoaded', () => {
  const updateBtn = document.getElementById('check-updates');
  const versionContainer = document.getElementById('ver');

  const today    = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  const group = document.getElementById('date-group');

  group.querySelector('[data-type="today"]').textContent    = formatDate(today);
  group.querySelector('[data-type="tomorrow"]').textContent = formatDate(tomorrow);

  if(updateBtn) {
    updateBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage('checkUpdate');
    });
  }

  if(versionContainer) {
    versionContainer.textContent = chrome.runtime.getManifest().version;
  }

  group.addEventListener('click', e => {
    const btn = e.target.closest('.date-btn');
    if (!btn) return;
    if (btn.classList.contains('active')) return;

    group.querySelector('.date-btn.active')?.classList.remove('active');
    btn.classList.add('active');

    loadData();
  });

});


chrome.storage.local.get(['lastGroup']).then(({ lastGroup }) => {
  if (lastGroup) select.value = lastGroup;
  loadData();
});

async function loadData() {
  const group = select.value;
  const activeBtn = document.querySelector('#date-group .date-btn.active');
  const date = activeBtn ? activeBtn.dataset.type : 'today'; 

  chrome.storage.local.set({ lastGroup: group });

  console.log('[POPUP] запитуємо для групи', group, 'дата', date);
  const tableHTML = await chrome.runtime.sendMessage({ getTable: true, group, date });

  if (!tableHTML) {
    box.innerHTML = '<p class="message">Не вдалося завантажити дані 😢</p>';
    return;
  }
  box.classList.remove('loading');
  box.innerHTML = `
    <style>
      table{border-collapse:collapse;width:100%;font-size:13px}
      th,td{border:1px solid #ccc;padding:6px;text-align:center}
      th{background:#f2f2f2}
    </style>
    ${tableHTML}`;
}

function formatDate(date){
    const months = ["січ", "лют", "бер", "квіт", "трав", "чер", "лип", "серп", "вер", "жовт", "лист", "груд"];
    const day = date.getDate();
    const month = date.getMonth();

    return day + ' ' + months[month] + '.';
}

select.addEventListener('change', loadData);