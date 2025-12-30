const box        = document.getElementById('box');
const customSelect = document.querySelector('.custom-select');
const INDICATOR_PADDING = 5;

document.addEventListener('DOMContentLoaded', () => {
  const updateBtn = document.getElementById('check-updates');
  const reloadBtn = document.getElementById('reload');
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

  reloadBtn.addEventListener('click', async() => {
    reloadBtn.disabled = true;
    reloadBtn.classList.add("spin")
    try {
      await sendMessagePromise('clearCache');
      await loadData();
    } catch (e) {
      console.error(e);
    } finally {
      reloadBtn.disabled = false;
      reloadBtn.classList.remove("spin")
    }
  });

  group.addEventListener('click', e => {
    const btn = e.target.closest('.date-btn');
    if (!btn) return;
    if (btn.classList.contains('active')) return;

    group.querySelector('.date-btn.active')?.classList.remove('active');
    btn.classList.add('active');

    updateDateIndicator()
    loadData();
  });

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      updateDateIndicator();
    });
  });
  initCustomSelect();
});

function sendMessagePromise(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, resolve);
  });
}


function updateDateIndicator() {
  const group = document.getElementById('date-group');
  const indicator = group.querySelector('.date-indicator');
  const activeBtn = group.querySelector('.date-btn.active');

  if (!activeBtn) return;

  const btnRect = activeBtn.getBoundingClientRect();
  const groupRect = group.getBoundingClientRect();

  const left  = btnRect.left - groupRect.left - INDICATOR_PADDING;
  const width = btnRect.width;
  const height = btnRect.height;


  indicator.style.width = width + 'px';
  indicator.style.height = height + 'px';
  indicator.style.transform = `translateX(${left}px)`;
}

function initCustomSelect() {
  if (!customSelect) return;

  const trigger = customSelect.querySelector('.select-trigger');
  const options = customSelect.querySelectorAll('.option');

  customSelect.addEventListener('click', e => {
    e.stopPropagation();
    customSelect.classList.toggle('open');
  });

  document.addEventListener('click', () => {
    customSelect.classList.remove('open');
  });

  chrome.storage.local.get(['lastGroup']).then(({ lastGroup }) => {
    if (lastGroup) {
      setSelectValue(customSelect, lastGroup);
      if(lastGroup !== "all") customSelect.classList.add('has-value');   
    }
    loadData();
  });

  options.forEach(option => {
    option.addEventListener('click', () => {
      const value = option.dataset.value;
      const text = option.textContent;

      customSelect.dataset.value = value;
      customSelect.classList.add('has-value');   
      trigger.textContent = text;

      chrome.storage.local.set({ lastGroup: value });
      loadData();
    });
  });
}

function setSelectValue(select, value) {
  const option = select.querySelector(
    `.option[data-value="${value}"]`
  );
  if (!option) return;

  select.dataset.value = value;
  select.querySelector('.select-trigger').textContent =
    option.textContent;
}


async function loadData() {
  const group = customSelect?.dataset.value;
  if (!group) return;

  const activeBtn = document.querySelector('#date-group .date-btn.active');
  const currentDayNumber = new Date().getDate()
  const dayType = activeBtn ? activeBtn.dataset.type : 'today'; 

  chrome.storage.local.set({ lastGroup: group });

  console.log('[POPUP] запитуємо для групи - ', group, ' число - ', currentDayNumber, ' тип дня - ', dayType);
  const tableHTML = await chrome.runtime.sendMessage({ getTable: true, group, currentDayNumber, dayType });

  if (!tableHTML) {
    box.innerHTML = '<p class="message">Не вдалося завантажити дані 😢</p>';
    return;
  }
  box.classList.remove('loading');
  box.innerHTML = tableHTML;
}

function formatDate(date){
    const months = ["січ", "лют", "бер", "квіт", "трав", "чер", "лип", "серп", "вер", "жовт", "лист", "груд"];
    const day = date.getDate();
    const month = date.getMonth();

    return day + ' ' + months[month] + '.';
}