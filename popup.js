console.log('[POPUP] старт');

const box   = document.getElementById('box');
const select= document.getElementById('groupSelect');

chrome.storage.local.get(['lastGroup']).then(({ lastGroup }) => {
  if (lastGroup) select.value = lastGroup;
  loadData();
});

async function loadData() {
  const group = select.value;

  chrome.storage.local.set({ lastGroup: group });

  console.log('[POPUP] запитуємо для групи', group);
  const tableHTML = await chrome.runtime.sendMessage({ getTable: true, group });

  if (!tableHTML) {
    box.innerHTML = '<p>Дані відсутні (див. консоль service-worker)</p>';
    return;
  }
  box.innerHTML = `
    <style>
      table{border-collapse:collapse;width:100%;font-size:13px}
      th,td{border:1px solid #ccc;padding:6px;text-align:center}
      th{background:#f2f2f2}
    </style>
    ${tableHTML}`;
}

select.addEventListener('change', loadData);