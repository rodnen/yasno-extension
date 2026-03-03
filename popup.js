import { MODE_STRATEGIES } from './strategies/modeStrategies.js';
// ============================================================================
// КОНСТАНТИ
// ============================================================================
const CONSTANTS = {
  APP_VERSION: chrome.runtime.getManifest().version,
  APP_NAME: 'Yasno Extension',
  OWNER: 'rodnen',
  REPO: 'yasno-extension',
  UPDATE_STATE_KEY: "lastUpdateKey",
  LAST_CHECK_KEY: "lastUpdateCheck",
  LATEST_VER_KEY: "lastVerKey",
  CHECK_INTERVAL: 6 * 60 * 60 * 1000, // 6 часов
  INDICATOR_PADDING: 5,
  DEFAULT_QUEUE: 'all',
  DEFAULT_OSR: '301',
  MODES: Object.freeze(['yasno', 'dtek']),
  REFRESH_ANIMATION_DURATION: 300,
  REFRESH_MIN_DURATION: 1500,
  THEMES: ['system', 'dark', 'light'],
  MONTHS: Object.freeze(["січ", "лют", "бер", "квіт", "трав", "чер", "лип", "серп", "вер", "жовт", "лист", "груд"]),
  EASTER_EGG_DATES: Object.freeze({ today: 6, tomorrow: 7 })
};

Object.freeze(CONSTANTS);

// ============================================================================
// DOM ЕЛЕМЕНТИ
// ============================================================================
class DOMElements {
  constructor() {
    this.header = document.querySelector('header');
    this.box = document.getElementById('box');
    this.contentWrapper = document.getElementById('content-wrapper');
    this.queueSelect = document.querySelector('.queue-select');
    this.osrSelect = document.querySelector('.osr-select');
    this.versionContainer = document.getElementById('version');
    this.dialog = document.getElementById('dialog');
    this.dateGroup = document.getElementById('date-group');
    this.dotsBtn = document.querySelector('#dots-btn .menu');
    this.popupMenu = document.querySelector('.popup-menu');

    this.refreshBtn = this.popupMenu?.querySelector('button[data-action="refresh"]');
    this.modeBtn = this.popupMenu?.querySelector('button[data-action="mode"]');
    this.themeBtn = this.popupMenu?.querySelector('button[data-action="theme"]');
    this.aboutBtn = this.popupMenu?.querySelector('button[data-action="about"]');
    this.dialogTitle = this.dialog?.querySelector('.title');
    this.dialogContent = this.dialog?.querySelector('.content');
  }

  get dateIndicator() {
    return this.dateGroup?.querySelector('.date-indicator');
  }

  get activeDateBtn() {
    return this.dateGroup?.querySelector('.date-btn.active');
  }
}

// ============================================================================
// УТИЛІТИ
// ============================================================================
class Utils {
  static sendMessage(message) {
    return new Promise(resolve => chrome.runtime.sendMessage(message, resolve));
  }

  static formatDate(date) {
    return `${date.getDate()} ${CONSTANTS.MONTHS[date.getMonth()]}.`;
  }

  static getStorageData(keys) {
    return chrome.storage.local.get(keys);
  }

  static async getStorageValue(key) {
    const result = await chrome.storage.local.get(key);
    return result[key];
  }

  static setStorageData(data) {
    return chrome.storage.local.set(data);
  }

  static delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  static setDTEKMode(el) {
    console.log("SetDTEK MODE CALLED");
    if (!el || el.dataset.hidden === "true") return;

    el.dataset.hidden = "true";

    const trigger = el.querySelector(".select-trigger");
    const options = el.querySelector(".select-options");

    console.log(trigger);
    console.log(options);
    if (trigger) {
      trigger.textContent = "DTEK";
      console.log("SET DTEK Success");
    }

    if (options) {
      options.style.pointerEvents = "none";
      options.style.opacity = "0.5";
    }

    // блокуємо відкриття селекта
    el.style.pointerEvents = "none";
  }


  static async setYasnoMode(el) {
    if (!el) return;

    const trigger = el.querySelector(".select-trigger");
    const options = el.querySelector(".select-options");

    // розблокування
    el.style.pointerEvents = "";
    if (options) {
      options.style.pointerEvents = "";
      options.style.opacity = "";
    }

    // отримання збережених даних
    const data = await Utils.getStorageData(['lastGroup', 'lastOsr']);
    const savedValue = data?.lastOsr;

    const allOptions = el.querySelectorAll(".option");

    let selectedOption = null;

    if (savedValue) {
      selectedOption = [...allOptions].find(opt => opt.dataset.value === savedValue);
    }

    // якщо не знайдено — беремо перший
    if (!selectedOption && allOptions.length > 0) {
      selectedOption = allOptions[0];
    }

    if (selectedOption) {
      if (trigger) {
        trigger.textContent = selectedOption.textContent;
      }
      el.dataset.value = selectedOption.dataset.value;
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        delete el.dataset.hidden;
      });
    });
  }
}

// ============================================================================
// МЕНЕДЖЕР ВЕРСІЙ
// ============================================================================
class VersionManager {
  constructor(dom, dialogManager, messageManager) {
    this.dom = dom;
    this.dialogManager = dialogManager;
    this.messageManager = messageManager;
    this.init();
  }

  init() {
    this.dialogManager.onCheckUpdate = () => this.manualCheck();

    if (this.dom.versionContainer) {
      this.dom.versionContainer.textContent = CONSTANTS.APP_VERSION;
    }

    this.autoCheck();
  }

  semverCompare(a, b) {
    const clean = v => v.replace(/^[^0-9]*/, '').split('.').map(Number);
    const [va, vb] = [clean(a), clean(b)];
    for (let i = 0; i < 3; i++) {
      if (va[i] > vb[i]) return 1;
      if (va[i] < vb[i]) return -1;
    }
    return 0;
  }

  async autoCheck() {
    const lastCheck = await Utils.getStorageValue(CONSTANTS.LAST_CHECK_KEY) || 0;
    const updateState = await Utils.getStorageValue(CONSTANTS.UPDATE_STATE_KEY);
    const latestVer = await Utils.getStorageValue(CONSTANTS.LATEST_VER_KEY);

    const now = Date.now();

    if (!lastCheck || updateState === undefined) {
      await this.performCheck(false);
      return;
    }

    if (now - lastCheck < CONSTANTS.CHECK_INTERVAL) {
      const isNewer = latestVer && this.semverCompare(latestVer, CONSTANTS.APP_VERSION) === 1;
      if (updateState === -1 && isNewer) {
        this.messageManager?.show({
          text: `Доступне оновлення: ${latestVer}`,
          icon: '🚀',
          type: 'info',
          id: 'update'
        });
      }

      return;
    }

    await this.performCheck(false);
  }

  async manualCheck() {
    this.dialogManager.closeDialog();
    this.dialogManager.showDialog();
    this.dialogManager.updateTitle("Перевірка оновлення");

    await this.performCheck(true);
  }

  async performCheck(showResult) {
    try {
      const { result } = await Utils.sendMessage({
        action: 'checkUpdate',
        owner: CONSTANTS.OWNER,
        repo: CONSTANTS.REPO
      });

      const cmp = Number(result.cmp);
      const latestVer = result.latestVer;

      await Utils.setStorageData({
        [CONSTANTS.LAST_CHECK_KEY]: Date.now(),
        [CONSTANTS.UPDATE_STATE_KEY]: cmp,
        [CONSTANTS.LATEST_VER_KEY]: latestVer
      });

      if (cmp === -1) {
        this.messageManager?.show({
          text: `Доступне оновлення: ${latestVer}`,
          icon: '🚀',
          type: 'info'
        });
      }

      if (showResult) {
        this.dialogManager.updateContent(
          `<div class="update-wrapper">
             ${this.getUpdateMessage(result)}
           </div>`,
          true
        );
      }
    }
    catch (error) {
      console.error('Update check error:', error);

      if (showResult) {
        this.dialogManager.updateContent(
          '<div class="update-wrapper">Помилка при перевірці оновлень</div>',
          true
        );
      }
    }
  }

  getUpdateMessage({ cmp, latestVer }) {
    return {
      1: "У вас встановлена новіша версія розширення",
      0: "У вас встановлена остання версія розширення",
      [-1]: `Знайдено оновлення розширення Версія: ${latestVer}`
    }[cmp] ?? "Помилка: не вдалося знайти оновлення";
  }
}

// ============================================================================
// МЕНЕДЖЕР ТЕМИ
// ============================================================================
class ThemeManager {
  constructor(dom) {
    this.dom = dom;
    this.themes = CONSTANTS.THEMES;
  }

  async init() {
    const { theme } = await Utils.getStorageData(['theme']);
    this.applyTheme(theme || 'system');
  }

  async toggleTheme() {
    const { theme } = await Utils.getStorageData(['theme']);
    const current = theme || 'system';

    const next = this.getNextTheme(current);
    await Utils.setStorageData({ theme: next });
    this.applyTheme(next);
  }

  getNextTheme(current) {
    const index = this.themes.indexOf(current);
    return this.themes[(index + 1) % this.themes.length];
  }

  applyTheme(theme) {
    const root = document.documentElement;

    if (theme === 'system') {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', theme);
    }

    this.updateButtonUI(theme);
  }

  updateButtonUI(theme) {
    if (!this.dom.themeBtn) return;

    const icon = this.dom.themeBtn.querySelector('.menu-icon');
    const text = this.dom.themeBtn.querySelector('span:last-child');

    const map = {
      system: { icon: '🖥️', text: 'Системна' },
      dark: { icon: '🌙', text: 'Темна' },
      light: { icon: '☀️', text: 'Світла' }
    };

    if (icon) icon.textContent = map[theme].icon;
    if (text) text.textContent = map[theme].text;
  }
}

// ============================================================================
// МЕНЕДЖЕР ДІЛОГІВ
// ============================================================================
class DialogManager {
  #LOADER_HTML = '<div class="update-wrapper"><div class="loader"></div></div>';

  constructor(dom) {
    this.dom = dom;
    this.onCheckUpdate = null;
    this.init();
  }

  init() {
    if (!this.dom.dialog) return;

    this.dom.dialogContent.innerHTML = this.#LOADER_HTML;

    this.dom.dialog.addEventListener('click', (e) => {
      const actionEl = e.target.closest('[data-action]');

      if (actionEl) {
        if (actionEl.dataset.action === 'check-update') this.onCheckUpdate?.();
        return;
      }

      if (e.target === this.dom.dialog) this.closeDialog();
    });
  }

  showDialog() {
    this.dom.dialog.classList.add('show');
  }

  updateTitle(title) {
    this.dom.dialogTitle.textContent = title;
  }

  updateContent(content, isHTML = false) {
    this.dom.dialogContent[isHTML ? 'innerHTML' : 'textContent'] = content;
  }

  updateDialog(title, content, isHTML = false) {
    this.updateTitle(title);
    this.updateContent(content, isHTML);
  }

  showAbout(info) {
    this.updateDialog("Про розширення", `
      <div class="about-wrapper">
        <div class="version">
          <span class="main-text">${info.name}</span><br>
          <span class="secondary-text">Версія: ${info.version}</span>
        </div>
        <button data-action="check-update">Перевірити оновлення</button>
      </div>
    `, true);
    this.showDialog();
  }

  closeDialog() {
    this.dom.dialog.classList.remove('show');
    this.dom.dialogTitle.textContent = '';
    this.dom.dialogContent.innerHTML = this.#LOADER_HTML;
  }
}


// ============================================================================
// МЕНЕДЖЕР ДАТ
// ============================================================================
class DateManager {
  constructor(dom, onDateChange) {
    this.dom = dom;
    this.onDateChange = onDateChange;
    this.init();
  }

  init() {
    this.updateDateNumbers();
    this.setupDateButtons();
    this.updateIndicator();
  }

  updateDateNumbers() {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);

    const { dateGroup } = this.dom;
    const todayBtn = dateGroup.querySelector('[data-type="today"]');
    const tomorrowBtn = dateGroup.querySelector('[data-type="tomorrow"]');

    if (todayBtn) todayBtn.textContent = Utils.formatDate(today);
    if (tomorrowBtn) tomorrowBtn.textContent = Utils.formatDate(tomorrow);

    this.checkEasterEgg(today);
  }

  checkEasterEgg(today) {
    if (today.getDate() !== CONSTANTS.EASTER_EGG_DATES.today) return;

    const easterEgg = Object.assign(document.createElement('img'), {
      src: 'https://cdn.7tv.app/emote/01K91ZKMKBW0EA884967R3MHCM/1x.gif',
      alt: '67',
      className: 'easter'
    });
    this.dom.dateGroup.appendChild(easterEgg);
  }

  setupDateButtons() {
    this.dom.dateGroup.addEventListener('click', (e) => {
      const btn = e.target.closest('.date-btn');
      if (!btn || btn.classList.contains('active')) return;

      this.dom.activeDateBtn?.classList.remove('active');
      btn.classList.add('active');

      this.updateIndicator();
      this.onDateChange?.();
    });
  }

  updateIndicator() {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const { dateIndicator: indicator, activeDateBtn: activeBtn, dateGroup } = this.dom;
        if (!activeBtn || !indicator) return;

        const btnRect = activeBtn.getBoundingClientRect();
        const groupRect = dateGroup.getBoundingClientRect();

        indicator.style.cssText = `width:${btnRect.width}px;height:${btnRect.height}px;transform:translateX(${btnRect.left - groupRect.left - CONSTANTS.INDICATOR_PADDING}px)`;
      });
    });
  }
}

// ============================================================================
// МЕНЕДЖЕР СЕЛЕКТІВ
// ============================================================================
class SelectManager {
  constructor(dom, onSelectionChange) {
    this.dom = dom;
    this.onSelectionChange = onSelectionChange;
    this.selects = [
      { element: dom.queueSelect, storageKey: 'lastGroup', type: 'queue', defaultValue: CONSTANTS.DEFAULT_QUEUE },
      { element: dom.osrSelect, storageKey: 'lastOsr', type: 'osr', defaultValue: CONSTANTS.DEFAULT_QUEUE }
    ];

    this.handleOutsideClick = this.handleOutsideClick.bind(this);
  }

  async init() {
    if (!this.dom.queueSelect || !this.dom.osrSelect) return;

    document.addEventListener('click', this.handleOutsideClick, true);

    this.selects.forEach(select => this.setupSelect(select));
    await this.loadSavedValues();
  }

  handleOutsideClick(e) {
    const clickedInsideSelect = this.selects.some(({ element }) => {
      return element && element.contains(e.target);
    });

    if (!clickedInsideSelect) {
      this.closeAll();
    }
  }

  closeAll() {
    this.selects.forEach(({ element }) => {
      element?.classList.remove('open');
    });
  }

  setupSelect({ element, storageKey, defaultValue, type }) {
    if (!element) return;

    element.addEventListener('click', (e) => {
      const option = e.target.closest('.option');

      if (option) {
        this.setSelectValue(element, type, option.dataset.value, defaultValue);
        Utils.setStorageData({ [storageKey]: option.dataset.value });
        this.onSelectionChange?.();
        element.classList.remove('open');
      } else {
        e.stopPropagation();

        this.selects.forEach(({ element: otherElement }) => {
          if (otherElement !== element) {
            otherElement?.classList.remove('open');
          }
        });

        element.classList.toggle('open');
      }
    });
  }

  setSelectValue(element, type, value, defaultValue) {
    if (!element) return;

    const option = element.querySelector(`.option[data-value="${value}"]`);
    if (!option) return;

    const trigger = element.querySelector('.select-trigger');
    element.dataset.value = value;
    if (trigger) trigger.textContent = option.textContent;
    element.classList.toggle('has-value', value !== defaultValue);
  }

  async loadSavedValues() {
    try {
      const data = await Utils.getStorageData(['lastGroup', 'lastOsr']);

      for (const { element, storageKey, type, defaultValue } of this.selects) {
        this.setSelectValue(element, type, data[storageKey] || defaultValue, defaultValue);
      }

      this.onSelectionChange?.();
    } catch (error) {
      console.error('Error loading saved values:', error);
    }
  }

  getValues() {
    return {
      group: this.dom.queueSelect?.dataset.value,
      osr: this.dom.osrSelect?.dataset.value
    };
  }
}

// ============================================================================
// МЕНЕДЖЕР ДАНИХ
// ============================================================================
class DataManager {
  constructor(dom, selectManager, dateManager) {
    this.dom = dom;
    this.selectManager = selectManager;
    this.dateManager = dateManager;
  }

  async loadData() {
    const { mode } = await Utils.getStorageData(['mode']);
    const modeType = mode ?? 0;
    const strategy = MODE_STRATEGIES[CONSTANTS.MODES[modeType]];

    console.log(`modetype = ${modeType}`);
    console.log(`mode = ${mode}`);
    console.log(strategy);

    if (!strategy) {
      console.error(`Unknown mode: ${mode}`);
      return;
    }

    const { group, osr } = this.selectManager.getValues();
    if (!group) return;

    const dayType = this.dateManager.dom.activeDateBtn?.dataset.type ?? 'today';
    const currentDayNumber = new Date().getDate();

    await Utils.setStorageData(strategy.getStorageData({ group, osr }));

    try {
      const payload = strategy.buildPayload({ group, osr, currentDayNumber, dayType });
      const tableHTML = await chrome.runtime.sendMessage(payload);

      const { box } = this.dom;

      if (!tableHTML) {
        box.innerHTML = `
        <p class="message">Не вдалося завантажити дані 😢</p>
        <br>
        <p class="message secondary-text">Перевірте з'єднання або перезапустіть розширення</p>
      `;
        return;
      }

      box.classList.remove('loading');
      box.innerHTML = tableHTML;
      this.scrollToCurrentElement();
    } catch (error) {
      console.error(`[${mode}] Error loading data:`, error);
      this.dom.box.innerHTML = '<p class="message">Помилка завантаження 😢</p>';
    }
  }

  scrollToCurrentElement() {
    const selectedElement = this.dom.box.querySelector('._table_current_selected');
    const currentIndex = selectedElement?.dataset.index;

    if (currentIndex !== undefined && currentIndex >= 4) {
      selectedElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      this.dom.box.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }
}

// ============================================================================
// МЕНЕДЖЕР ОНОВЛЕННЯ
// ============================================================================
class RefreshManager {
  #isRefreshing = false;

  constructor(dom, dataManager, dateManager) {
    this.dom = dom;
    this.dataManager = dataManager;
    this.dateManager = dateManager;
    this.init();
  }

  init() {
    this.dom.refreshBtn?.addEventListener('click', () => {
      if (!this.#isRefreshing) this.refresh();
    });
  }

  async refresh() {
    this.#isRefreshing = true;

    const { refreshBtn: btn, box } = this.dom;
    const startTime = Date.now();

    box.innerHTML = '<div class="loading-wrapper"><div class="loader"></div><p>Йде завантаження…</p></div>';
    box.classList.add('loading');
    btn.classList.replace('ready', 'refreshing');

    try {
      await Utils.sendMessage({ action: 'clearCache' });
      await this.dataManager.loadData();
    } catch (error) {
      console.error('[RefreshManager] refresh error:', error);
      box.innerHTML = `
        <p class="message">Не вдалося завантажити дані 😢</p>
        <br>
        <p class="message secondary-text">Перевірте з'єднання або перезапустіть розширення</p>
      `;
    } finally {
      const remaining = CONSTANTS.REFRESH_MIN_DURATION - (Date.now() - startTime);
      if (remaining > 0) await Utils.delay(remaining);

      box.classList.remove('loading');
      btn.classList.replace('refreshing', 'ready');

      this.dateManager.updateDateNumbers();
      this.dateManager.updateIndicator();

      setTimeout(() => btn.classList.remove('ready'), CONSTANTS.REFRESH_ANIMATION_DURATION);

      this.#isRefreshing = false;
    }
  }
}

class MessageManager {
  constructor(dom) {
    this.header = dom.header;
  }

  show({ text = '', icon = 'ℹ️', type = 'info', id = 'default' } = {}) {
    if (!this.header) return;

    let block = this.header.querySelector(`.message-block[data-id="${id}"]`);

    if (block) {
      const item = block.querySelector('.message-item');
      const iconEl = block.querySelector('.message-icon');
      const textEl = block.querySelector('.message-content span');

      item.className = `message-item message-${type}`;

      if (iconEl) iconEl.innerHTML = icon;
      if (textEl) textEl.textContent = text;

      return block;
    }

    block = document.createElement('div');
    block.className = 'message-block';
    block.dataset.id = id;

    const item = document.createElement('div');
    item.className = `message-item message-${type}`;

    const iconEl = document.createElement('span');
    iconEl.className = 'message-icon';
    iconEl.innerHTML = icon;

    const content = document.createElement('div');
    content.className = 'message-content';

    const textEl = document.createElement('span');
    textEl.textContent = text;

    content.appendChild(textEl);

    const closeBtn = document.createElement('div');
    closeBtn.className = 'cross-icon';

    closeBtn.addEventListener('click', () => {
      this.hide(block);
    });

    item.appendChild(iconEl);
    item.appendChild(content);
    // item.appendChild(closeBtn);

    block.appendChild(item);

    this.header.prepend(block);

    return block;
  }

  hide(block) {
    if (!block) return;

    block.style.opacity = '0';
    block.style.transform = 'translateY(-10px)';

    setTimeout(() => {
      block.remove();
    }, 200);
  }
}

class PopupManager {
  constructor(dom, dialogManager, dataManager, themeManager) {
    this.dom = dom;
    this.dialogManager = dialogManager;
    this.dataManager = dataManager;
    this.themeManager = themeManager
  }

  async init() {
    const { dotsBtn, popupMenu } = this.dom;
    if (!dotsBtn || !popupMenu) return;

    const { mode } = await Utils.getStorageData(['mode']);
    const checkbox = popupMenu.querySelector('#checkbox');
    const modeIndex = mode ?? 0;
    checkbox.checked = modeIndex === 1;

    if (modeIndex === 1) {
      Utils.setDTEKMode(this.dom.osrSelect);
    } else {
      Utils.setYasnoMode(this.dom.osrSelect);
    }

    dotsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      popupMenu.classList.toggle('active');
    });

    document.addEventListener('click', () => {
      popupMenu.classList.remove('active');
    });

    popupMenu.addEventListener('click', (e) => {
      e.stopPropagation();
      const item = e.target.closest('[data-action]');
      if (!item) return;

      this.handleMenuAction(item);
      if (item.classList.contains('close-at-click')) popupMenu.classList.remove('active');
    });
  }

  handleMenuAction(item) {
    switch (item.dataset.action) {
      case 'mode': {
        const checkbox = item.querySelector('#checkbox');
        if (checkbox) checkbox.checked = !checkbox.checked;
        Utils.sendMessage({ action: 'clearCache' });

        const mode = checkbox.checked ? 1 : 0;
        Utils.setStorageData({ mode });

        if (mode === 1) {
          Utils.setDTEKMode(this.dom.osrSelect);
        } else {
          Utils.setYasnoMode(this.dom.osrSelect);
        }

        this.dataManager.loadData();
        break;
      }

      case 'theme':
        this.themeManager.toggleTheme();
        break;

      case 'about':
        this.dialogManager.showAbout({
          name: CONSTANTS.APP_NAME,
          version: chrome.runtime.getManifest().version
        });
        break;
    }
  }
}

// ============================================================================
// ГОЛОВНИЙ ДОДАТОК
// ============================================================================
class App {
  constructor() {
    this.dom = new DOMElements();
    this.init();
  }

  async init() {
    const { dom } = this;

    /* await chrome.storage.local.clear();
     await chrome.storage.sync?.clear();
     await chrome.storage.session?.clear();*/

    this.themeManager = new ThemeManager(dom);
    this.dialogManager = new DialogManager(dom);
    this.messageManager = new MessageManager(dom);
    this.versionManager = new VersionManager(dom, this.dialogManager, this.messageManager);
    this.dateManager = new DateManager(dom, () => this.dataManager.loadData());
    this.selectManager = new SelectManager(dom, () => this.dataManager.loadData());
    this.dataManager = new DataManager(dom, this.selectManager, this.dateManager);
    this.refreshManager = new RefreshManager(dom, this.dataManager, this.dateManager);
    this.popupManager = new PopupManager(dom, this.dialogManager, this.dataManager, this.themeManager);

    this.themeManager.init();
    this.selectManager.init();
    this.popupManager.init();
  }
}

// ============================================================================
// ІНІЦІАЛІЗАЦІЯ
// ============================================================================
document.addEventListener('DOMContentLoaded', () => new App());