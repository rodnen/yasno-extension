import { MODE_STRATEGIES } from './strategies/modeStrategies.js';
import { SETTLEMENTS } from './data/settlements.js';
import { Utils } from './utils/utils.js';
import { ErrorReporter } from './utils/reporter.js';

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
  INDICATOR_PADDING: 5,
  DEFAULT_QUEUE: 'all',
  DEFAULT_OSR: '301',
  MODES: Object.freeze(['yasno', 'dtek']),
  REFRESH_ANIMATION_DURATION: 300,
  REFRESH_MIN_DURATION: 1500,
  THEMES: ['system', 'dark', 'light'],
  EASTER_EGG_DATES: Object.freeze({ today: 6, tomorrow: 7 }),
  EASTER_EGG_GIF: 'https://cdn.7tv.app/emote/01K91ZKMKBW0EA884967R3MHCM/1x.gif',
  CHECK_INTERVAL: 6 * 60 * 60 * 1000
};

Object.freeze(CONSTANTS);

// ============================================================================
// TTL КЕШУ
// ============================================================================
const CACHE_TTL = Object.freeze({
  HOUSES: 24 * 60 * 60 * 1000,  // 24 год — список будинків по вулиці
  HOUSE_DATA: 15 * 60 * 1000,   // 15 хв  — дані про відключення
});

// ============================================================================
// КЕШ-МЕНЕДЖЕР
// Завантажується один раз при старті, живе в пам'яті до закриття розширення.
//
// Структура сховища (chrome.storage.local → ключ 'appCache'):
// {
//   select: { group, osr },          ← спільні значення селектів
//   dtek: {
//     location: { city, street, house, group },  ← преференції, без TTL
//     houses:   { city, street, data, updateTimestamp },  ← TTL 24 год
//     houseData: { data, updateTimestamp }               ← TTL 15 хв
//   }
// }
// ============================================================================
class CacheManager {
  #mem = {};
  #saveTimer = null;
  static #STORAGE_KEY = 'appCache';

  // Завантажити весь кеш із storage один раз
  async load() {
    try {
      const raw = await Utils.getStorageValue(CacheManager.#STORAGE_KEY);
      this.#mem = raw ? JSON.parse(raw) : {};
    } catch {
      this.#mem = {};
    }
  }

  // Дебаунсований запис у storage (300 мс)
  #scheduleSave() {
    clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(() => {
      Utils.setStorageData({ [CacheManager.#STORAGE_KEY]: JSON.stringify(this.#mem) });
    }, 300);
  }

  // Безпечний доступ до гілки режиму
  #modeObj(modeKey) {
    return (this.#mem[modeKey] ??= {});
  }

  // ── Спільні значення селектів ─────────────────────────────────────────
  getSelect() {
    return this.#mem.select ?? {};
  }

  setSelect(patch) {
    this.#mem.select = { ...this.getSelect(), ...patch };
    this.#scheduleSave();
  }

  // ── Location-преференції (тільки DTEK, без TTL) ───────────────────────
  getLocation() {
    return this.#modeObj('dtek').location ?? {};
  }

  setLocation(patch) {
    const dtek = this.#modeObj('dtek');
    dtek.location = { ...(dtek.location ?? {}), ...patch };
    this.#scheduleSave();
  }

  clearLocationFields(...keys) {
    const loc = this.#modeObj('dtek').location;
    if (!loc) return;
    keys.forEach(k => delete loc[k]);
    this.#scheduleSave();
  }

  // ── Список будинків (DTEK, TTL 24 год) ────────────────────────────────
  // Повертає дані лише якщо city+street збігаються і кеш ще актуальний
  getHouses(city, street) {
    const entry = this.#modeObj('dtek').houses;
    if (!entry || entry.city !== city || entry.street !== street) return null;
    if (Date.now() - entry.cachedAt > CACHE_TTL.HOUSES) return null;
    return entry;
  }

  setHouses(city, street, data, updateTimestamp) {
    this.#modeObj('dtek').houses = { city, street, data, updateTimestamp, cachedAt: Date.now() };
    this.#scheduleSave();
  }

  // ── Дані про відключення для конкретного будинку (DTEK, TTL 15 хв) ────
  getHouseData() {
    const entry = this.#modeObj('dtek').houseData;
    if (entry?.updateTimestamp == null) return null;
    if (Date.now() - entry.updateTimestamp > CACHE_TTL.HOUSE_DATA) return null;
    return entry;
  }

  setHouseData(data, updateTimestamp) {
    this.#modeObj('dtek').houseData = { data, updateTimestamp };
    this.#scheduleSave();
  }

  // ── Force-refresh: очищає кешовані дані, зберігає location-преференції ─
  clearModeData(modeKey) {
    const location = this.#modeObj(modeKey).location;
    this.#mem[modeKey] = location ? { location } : {};
    this.#scheduleSave();
  }
}

// ============================================================================
// DOM ЕЛЕМЕНТИ
// ============================================================================
class DOMElements {
  constructor() {
    this.header = document.querySelector('header');
    this.box = document.getElementById('content-box');
    this.controls = document.getElementById('controls');
    this.contentWrapper = document.getElementById('content-wrapper');
    this.queueSelect = document.querySelector('.queue-select');
    this.osrSelect = document.querySelector('.osr-select');
    this.versionContainer = document.getElementById('version');
    this.dialog = document.getElementById('dialog');
    this._dialog = dialog.querySelector("._dialog");
    this.dateGroup = document.getElementById('date-group');
    this.dotsBtn = document.querySelector('#dots-btn .menu');
    this.popupMenu = document.querySelector('.popup-menu');

    this.refreshBtn = this.popupMenu?.querySelector('button[data-action="refresh"]');
    this.modeBtn = this.popupMenu?.querySelector('button[data-action="mode"]');
    this.themeBtn = this.popupMenu?.querySelector('button[data-action="theme"]');
    this.aboutBtn = this.popupMenu?.querySelector('button[data-action="about"]');
    this.dialogTitle = this.dialog?.querySelector('.title');
    this.dialogContent = this.dialog?.querySelector('.content');

    //this.currentMode = document.getElementById('current-mode');
  }

  get dateIndicator() {
    return this.dateGroup?.querySelector('.date-indicator');
  }

  get activeDateBtn() {
    return this.dateGroup?.querySelector('.date-btn.active');
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
          `<div class="update-wrapper">${this.#getUpdateMessage(result)}</div>`,
          true
        );
      }
    } catch (error) {
      console.error('Update check error:', error);
      if (showResult) {
        this.dialogManager.updateContent(
          '<div class="update-wrapper">Помилка при перевірці оновлень</div>',
          true
        );
      }
    }
  }

  #getUpdateMessage({ cmp, latestVer }) {
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
    this.#updateButtonUI(theme);
  }

  #updateButtonUI(theme) {
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
// МЕНЕДЖЕР ДІАЛОГІВ
// ============================================================================
class DialogManager {
  #LOADER_HTML = '<div class="update-wrapper"><div class="loader"></div></div>';
  #footer_divider = null;
  #footer_content = null;
  constructor(dom, messageManager) {
    this.dom = dom;
    this.onCheckUpdate = null;
    this.messageManager = messageManager;
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

  appendFooter(content = null) {
    if (this.#footer_content) return;

    this.#footer_divider = document.createElement("div");
    this.#footer_divider.className = "divider";

    this.#footer_content = document.createElement("div");
    this.#footer_content.className = "footer-content";

    if (content) {
      this.#footer_content.append(content);
    }

    this.dom._dialog.appendChild(this.#footer_divider);
    this.dom._dialog.appendChild(this.#footer_content);
  }

  removeFooter() {
    if (!this.#footer_content) return;

    this.#footer_content.remove();
    this.#footer_divider.remove();

    this.#footer_content = null;
    this.#footer_divider = null;
  }

  replaceFooter(content) {
    this.removeFooter();
    this.appendFooter(content);
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
        <button data-action="check-update" title="Перевірити оновлення">Перевірити оновлення</button>
      </div>
    `, true);
    this.showDialog();
  }


  showBugReport(onSubmit) {
    const notify = this.messageManager;
    const saved = ['', ''];
    let isSubmitting = false;

    const mkValid = (required, min, minMsg, max, maxMsg) => ({
      required: true,
      minLength: min,
      maxLength: max,
      messages: { required, minLength: minMsg, maxLength: maxMsg }
    });

    const steps = [
      {
        fieldId: 'bug-message',
        placeholder: 'Наприклад: не відкривається налаштування при кліку на...',
        validation: mkValid("Опишіть проблему", 5, "Мінімум 5 символів", 500, "Занадто довге повідомлення"),
        footer: {
          left: { action: 'cancel-bug', text: 'Скасувати', variant: 'secondary', title: 'Скасувати' },
          right: { action: 'forward-bug', text: 'Далі', icon: 'right', title: 'Далі' }
        }
      },
      {
        fieldId: 'bug-stack',
        placeholder: '1. Відкрив сторінку X\n2. Натиснув кнопку Y\n3. З\'явилась помилка...',
        validation: mkValid("Опишіть кроки для відтворення", 5, "Мінімум 5 символів", 1000, "Занадто довгий опис дій"),
        footer: {
          left: { action: 'back-bug', text: 'Назад', icon: 'left', title: 'Назад' },
          right: { action: 'send-bug', text: 'Надіслати', variant: 'primary', title: 'Надіслати' }
        }
      }
    ];

    const cleanup = () => {
      if (this._bugReportHandler) {
        this.dom.dialog.removeEventListener('click', this._bugReportHandler);
        this._bugReportHandler = null;
      }
    };

    const showValidationToast = (field, validation) => {
      const duration = 2500;
      const value = field.value.trim();
      if (!value && validation.required) {
        notify?.showToast({
          text: validation.messages.required,
          icon: "ic_error",
          type: 'error',
          duration
        });
        return false;
      }
      if (validation.minLength && value.length < validation.minLength) {
        notify?.showToast({
          text: validation.messages.minLength,
          icon: "ic_error",
          type: 'error',
          duration
        });
        return false;
      }
      if (validation.maxLength && value.length > validation.maxLength) {
        notify?.showToast({
          text: validation.messages.maxLength,
          icon: "ic_error",
          type: 'error',
          duration
        });
        return false;
      }
      return true;
    };

    const renderStep = (index) => {
      const { fieldId, placeholder, validation, footer } = steps[index];

      this.updateDialog("Повідомити про помилку", `
      <div class="custom-textarea">
        <textarea 
          id="${fieldId}" 
          placeholder="${placeholder || ' '}"
          rows="${index === 0 ? '4' : '6'}"
        ></textarea>
        <div class="char-counter" data-field="${fieldId}">0/${validation.maxLength}</div>
      </div>
    `, true);

      const wrapper = document.createElement("div");
      wrapper.className = "footer-buttons";

      ['left', 'right'].forEach(side => {
        const btnData = footer[side];
        const btn = document.createElement("button");
        btn.title = btnData.title;
        btn.className = `btn ${btnData.variant || 'default'}`;
        btn.dataset.action = btnData.action;

        const arrowIcon = `<div class="arrow-icon _6px ${btnData.icon}"></div>`;
        if (btnData.icon === 'left') btn.innerHTML = `${arrowIcon}${btnData.text}`;
        else if (btnData.icon === 'right') btn.innerHTML = `${btnData.text}${arrowIcon}`;
        else btn.textContent = btnData.text;

        wrapper.appendChild(btn);
      });

      this.replaceFooter(wrapper);
      this.showDialog();

      const field = this.dom.dialogContent.querySelector(`#${fieldId}`);
      const counter = this.dom.dialogContent.querySelector(`[data-field="${fieldId}"].char-counter`);

      if (saved[index]) field.value = saved[index];

      const updateCounter = () => {
        const len = field.value.length;
        if (counter) {
          counter.textContent = `${len}/${validation.maxLength}`;
          counter.classList.toggle('warning', len > validation.maxLength * 0.9);
          counter.classList.toggle('error', len > validation.maxLength);
        }
        Utils.clearErrorTextarea(field);
      };

      field.addEventListener('input', updateCounter);
      updateCounter();

      cleanup();

      const handler = async (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;

        const action = btn.dataset.action;

        if (action === 'cancel-bug') {
          cleanup();
          this.closeDialog();
          notify?.showToast({ text: 'Відправку скасовано', type: 'info', duration: 2000 });
          return;
        }

        if (action === 'back-bug') {
          saved[index] = field.value.trim();
          cleanup();
          renderStep(0);
          return;
        }

        if (!showValidationToast(field, validation)) {
          Utils.setErrorTextarea(field);
          field.focus();
          return;
        }

        if (action === 'forward-bug') {
          saved[index] = field.value.trim();
          cleanup();
          renderStep(1);
          return;
        }

        if (action === 'send-bug') {
          if (isSubmitting) return;
          isSubmitting = true;

          btn.disabled = true;
          btn.innerHTML = 'Надсилання...';

          const reportData = {
            error: saved[0],
            stack: field.value.trim(),
            mode: CONSTANTS.MODES[(await Utils.getStorageData(['mode'])).mode ?? 0],
            userAgent: navigator.userAgent,
            platform: navigator.platform,
            language: navigator.language,
            screen: `${screen.width}x${screen.height}`,
            version: chrome.runtime.getManifest().version,
            timestamp: new Date().toISOString()
          };

          const sendingToastId = notify?.showToast({
            text: 'Надсилання звіту...',
            type: 'info',
            duration: 10000
          });

          try {
            await onSubmit?.(reportData);

            if (sendingToastId) notify.hideToast(sendingToastId);
            notify?.showToast({
              text: 'Звіт успішно відправлено! Дякуємо',
              icon: 'ic_check',
              type: 'success',
              duration: 4000
            });

            cleanup();
            this.closeDialog();
          } catch (error) {
            if (sendingToastId) notify.hideToast(sendingToastId);
            notify?.showToast({
              text: `Помилка відправки: ${error.message || 'Спробуйте ще раз'}`,
              icon: 'ic_error',
              type: 'error',
              duration: 5000
            });
            console.error('Bug report submission failed:', error);

            btn.disabled = false;
            btn.innerHTML = 'Надіслати';
            isSubmitting = false;
          }
        }
      };

      this._bugReportHandler = handler;
      this.dom.dialog.addEventListener('click', handler);
    };

    renderStep(0);
  }

  closeDialog() {
    this.dom.dialog.classList.remove('show');
    this.dom.dialogTitle.textContent = '';
    this.dom.dialogContent.innerHTML = this.#LOADER_HTML;
    this.removeFooter();
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
    this.#setupDateButtons();
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

    this.#checkEasterEgg(today);
  }

  #checkEasterEgg(today) {
    if (today.getDate() !== CONSTANTS.EASTER_EGG_DATES.today) return;
    if (this.dom.dateGroup.querySelector('.easter')) return;

    const easterEgg = Object.assign(document.createElement('img'), {
      src: CONSTANTS.EASTER_EGG_GIF,
      alt: '67',
      className: 'easter'
    });
    this.dom.dateGroup.appendChild(easterEgg);
  }

  #setupDateButtons() {
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
// Читає/пише значення через CacheManager (один об'єкт в пам'яті)
// ============================================================================
class SelectManager {
  constructor(dom, cacheManager, onSelectionChange) {
    this.dom = dom;
    this.cache = cacheManager;
    this.onSelectionChange = onSelectionChange;

    // type → ключ у cache.select
    this.selects = [
      { element: dom.queueSelect, cacheKey: 'group', type: 'queue', defaultValue: CONSTANTS.DEFAULT_QUEUE },
      { element: dom.osrSelect, cacheKey: 'osr', type: 'osr', defaultValue: CONSTANTS.DEFAULT_QUEUE }
    ];

    this.handleOutsideClick = this.handleOutsideClick.bind(this);
  }

  async init() {
    if (!this.dom.queueSelect || !this.dom.osrSelect) return;

    document.addEventListener('click', this.handleOutsideClick, true);

    this.selects.forEach(select => this.#setupSelect(select));
    this.loadSavedValues();
  }

  handleOutsideClick(e) {
    const clickedInsideSelect = this.selects.some(({ element }) =>
      element && element.contains(e.target)
    );
    if (!clickedInsideSelect) this.#closeAll();
  }

  #closeAll() {
    this.selects.forEach(({ element }) => element?.classList.remove('open'));
  }

  #setupSelect({ element, cacheKey, defaultValue, type }) {
    if (!element) return;

    element.addEventListener('click', (e) => {
      const option = e.target.closest('.option');

      if (option) {
        this.setSelectValue(element, type, option.dataset.value, defaultValue);
        this.cache.setSelect({ [cacheKey]: option.dataset.value });
        this.onSelectionChange?.();
        element.classList.remove('open');
      } else {
        e.stopPropagation();
        this.selects.forEach(({ element: other }) => {
          if (other !== element) other?.classList.remove('open');
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
    trigger.textContent = '';

    if (trigger && value !== defaultValue) trigger.textContent = option.textContent;

    element.classList.toggle('has-value', value !== defaultValue);
  }

  async setAndSaveValue(type, value) {
    const select = this.selects.find(s => s.type === type);
    if (!select) return;

    this.setSelectValue(select.element, select.type, value, select.defaultValue);
    this.cache.setSelect({ [select.cacheKey]: value });
    this.onSelectionChange?.();
  }

  // Читаємо з in-memory кешу — без звернення до storage
  loadSavedValues() {
    const saved = this.cache.getSelect();

    for (const { element, cacheKey, type, defaultValue } of this.selects) {
      this.setSelectValue(element, type, saved[cacheKey] || defaultValue, defaultValue);
    }

    this.onSelectionChange?.();
  }

  getValues() {
    return {
      group: this.dom.queueSelect?.dataset.value,
      osr: this.dom.osrSelect?.dataset.value
    };
  }
}

// ============================================================================
// МЕНЕДЖЕР ДРОПДАУНІВ ІНПУТІВ
// Відповідає виключно за UI дропдаунів
// ============================================================================
class InputDropdownManager {
  constructor(dom, inputMap) {
    this.dom = dom;
    this.inputMap = inputMap;

    this.dropdowns = {
      city: { wrapper: null },
      street: { wrapper: null },
      house: { wrapper: null }
    };
  }

  create(type) {
    if (this.dropdowns[type].wrapper) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'select-options';

    const parentInput = this.dom[this.inputMap[type]];
    parentInput.parentElement.appendChild(wrapper);

    this.dropdowns[type].wrapper = wrapper;
  }

  render(type, options, onSelect) {
    this.create(type);

    const wrapper = this.dropdowns[type].wrapper;
    wrapper.innerHTML = '';

    const container = this.dom[this.inputMap[type]].closest('.custom-input');
    container.classList.add('open');

    options.forEach(option => {
      const div = document.createElement('div');
      div.className = 'option';
      div.textContent = option;
      div.addEventListener('click', () => onSelect(type, option));
      wrapper.appendChild(div);
    });
  }

  remove(type) {
    if (!this.dropdowns[type]?.wrapper) return;
    this.dropdowns[type].wrapper.remove();
    this.dropdowns[type].wrapper = null;
  }

  closeAll() {
    Object.keys(this.dropdowns).forEach(type => this.remove(type));
  }
}

// ============================================================================
// СЕРВІС ДАНИХ ІНПУТІВ
// Відповідає за пошук і завантаження даних.
// Список будинків кешується через CacheManager (TTL 24 год, ключ city+street).
// ============================================================================
class InputDataService {
  constructor(settlements, cacheManager) {
    this.settlements = settlements;
    this.cache = cacheManager;

    // In-memory для поточної сесії (після завантаження / з кешу)
    this.housesData = {};
    this.updateTimestamp = null;
  }

  #parseTimestamp(responseData) {
    const raw = responseData?.updateTimestamp ?? null;
    if (raw == null) return null;
    return typeof raw === 'number' ? raw : Utils.parseToTimestamp(raw);
  }

  search(type, query, state) {
    const lowerQuery = query.toLowerCase();

    switch (type) {
      case 'city':
        return Object.keys(this.settlements)
          .filter(name => name.toLowerCase().includes(lowerQuery))
          .slice(0, 20);

      case 'street':
        if (!state.city || !this.settlements[state.city]) return [];
        return this.settlements[state.city]
          .filter(street => street.toLowerCase().includes(lowerQuery))
          .slice(0, 20);

      case 'house':
        return Object.keys(this.housesData)
          .filter(num => num.toLowerCase().includes(lowerQuery))
          .slice(0, 20);

      default:
        return [];
    }
  }

  async loadHousesForStreet(city, street, house = null) {
    if (!street) {
      this.housesData = {};
      return;
    }

    const cached = this.cache.getHouses(city, street);

    if (cached) {
      this.housesData = cached.data;
      this.updateTimestamp = cached.updateTimestamp;
    } else {
      await this.fetchHouses(city, street);
    }

    if (house) {
      await this.refreshHouseStatusIfNeeded(city, street, house);
    }
  }

  async fetchHouses(city, street) {
    const response = await chrome.runtime.sendMessage({
      action: 'fetchHouses',
      city,
      street
    });

    if (response.success && response.data) {
      const data = response.data.data || response.data || {};
      const updateTimestamp = this.#parseTimestamp(response.data) ?? this.#parseTimestamp(response);

      this.housesData = data;
      this.updateTimestamp = updateTimestamp;

      this.cache.setHouses(city, street, data, updateTimestamp);
    } else {
      console.error('[InputDataService.fetchHouses] Failed:', response.error);
    }
  }

  async refreshHouseStatusIfNeeded(city, street, house) {
    if (!house) return;

    const cached = this.cache.getHouseData();
    if (cached) {
      return;
    }

    const response = await chrome.runtime.sendMessage({
      action: 'fetchHouseData',
      city,
      street,
      house
    });

    const data = response.data;
    const timestamp = this.#parseTimestamp(response);

    if (response.success && data) {
      this.housesData = data
      this.updateTimestamp = timestamp;
      this.cache.setHouseData(data, timestamp);
    }
  }

  isValidStreet(city, street) {
    return !!(city && this.settlements[city]?.includes(street));
  }

  getHouseData(house) {
    return this.housesData[house] ?? null;
  }

  getUpdateTimestamp() {
    return this.updateTimestamp;
  }

  clearHouses() {
    this.housesData = {};
    // Не видаляємо з кешу — кеш очиститься автоматично по TTL
    // або при виборі іншої вулиці (getHouses перевіряє city+street)
  }
}

// ============================================================================
// МЕНЕДЖЕР ІНПУТІВ
// Зберігає location-преференції та house-дані через CacheManager
// ============================================================================
class InputManager {
  constructor(dom, cacheManager, onInputFinalSelect) {
    this.dom = dom;
    this.cache = cacheManager;
    this.onInputFinalSelect = onInputFinalSelect;

    this.minSearchLength = 1;
    this.inputsWrapper = null;
    this.refreshInterval = null;
    this.isRefreshing = false;

    this.inputMap = {
      city: 'cityInput',
      street: 'streetInput',
      house: 'houseInput'
    };

    this.dataService = new InputDataService(SETTLEMENTS, cacheManager);
    this.dropdownManager = new InputDropdownManager(this.dom, this.inputMap);

    this.state = { city: null, street: null, house: null };

    this.inputs = [
      {
        type: 'city',
        key: 'cityInput',
        cacheKey: 'city',
        validator: (value) => !value || !SETTLEMENTS[value],
        onInvalid: () => this.clearStreet()
      },
      {
        type: 'street',
        key: 'streetInput',
        cacheKey: 'street',
        validator: (value) => !value || !this.dataService.isValidStreet(this.state.city, value),
        onInvalid: () => this.clearHouse(),
        dependsOn: 'city'
      },
      {
        type: 'house',
        key: 'houseInput',
        cacheKey: 'house',
        validator: () => false,
        dependsOn: 'street'
      }
    ];

    this.handleOutsideClick = this.handleOutsideClick.bind(this);
  }

  async init() {
    if (!this.dom.cityInput) return;

    document.addEventListener('click', this.handleOutsideClick, true);

    this.inputs.forEach(input => this.setupInput(input));
    this.updateInputStates();
    this.startRefreshTimer();
  }

  startRefreshTimer() {
    this.stopRefreshTimer();
    this.scheduleNextRefresh();
  }

  scheduleNextRefresh() {
    if (this.refreshTimeout) {
      clearTimeout(this.refreshTimeout);
    }

    this.retryAttempt = this.retryAttempt || 0;

    const BASE_DELAY = 5000;
    const MAX_DELAY = 30000;
    const MULTIPLIER = 1.5;

    const houseData = this.cache.getHouseData();
    const updateTimestamp = houseData?.updateTimestamp;

    let delay;

    if (!updateTimestamp) {
      const calculatedDelay = BASE_DELAY * Math.pow(MULTIPLIER, this.retryAttempt);
      delay = Math.min(calculatedDelay, MAX_DELAY);

      this.retryAttempt++;
    } else {
      this.retryAttempt = 0;

      const elapsed = Date.now() - updateTimestamp;
      const remaining = CACHE_TTL.HOUSE_DATA - elapsed;
      delay = Math.max(0, remaining);
    }

    this.refreshTimeout = setTimeout(async () => {
      try {
        await this.checkAndRefreshData();
      } catch (error) {
        console.error('[scheduleNextRefresh] Refresh failed:', error);
      } finally {
        this.scheduleNextRefresh();
      }
    }, delay);
  }


  stopRefreshTimer() {
    if (this.refreshTimeout) {
      clearTimeout(this.refreshTimeout);
      this.refreshTimeout = null;
    }
  }

  async checkAndRefreshData() {
    if (this.isRefreshing) {
      return;
    }

    if (!this.state.city || !this.state.street || !this.state.house) {
      return;
    }

    this.isRefreshing = true;
    try {
      const cached = this.cache.getHouseData();
      const updateTimestamp = cached?.updateTimestamp;

      const needsRefresh = !updateTimestamp ||
        (Date.now() - updateTimestamp >= CACHE_TTL.HOUSE_DATA);

      if (needsRefresh) {
        await this.refreshHouseData();

        const newData = this.cache.getHouseData();
        if (newData?.data) {
          await this.showHouseData();
        }
      }
    } finally {
      this.isRefreshing = false;
    }
  }

  async refreshHouseData() {
    try {
      await this.dataService.loadHousesForStreet(
        this.state.city,
        this.state.street,
        this.state.house
      );

      const houseData = this.dataService.getHouseData(this.state.house);
      const timestamp = this.dataService.getUpdateTimestamp();

      if (!houseData) {
        return;
      }
      this.cache.setHouseData(houseData, timestamp);
      await this.showHouseData();

    } catch (error) {
      console.error('[refreshHouseData] CRITICAL ERROR:', error);
      throw error; // Перекинути помилку далі, щоб її побачив scheduleNextRefresh
    }
  }

  handleOutsideClick(e) {
    if (!this.inputsWrapper?.contains(e.target)) {
      this.dropdownManager.closeAll();
    }
  }

  closeAll() {
    this.dropdownManager.closeAll();
  }

  setupInput({ type, key, validator, onInvalid, dependsOn }) {
    const input = this.dom[key];
    if (!input || input.dataset.initialized) return;
    input.dataset.initialized = 'true';

    input.addEventListener('input', (e) => {
      const value = e.target.value.trim();

      if (dependsOn && !this.state[dependsOn]) {
        this.dropdownManager.remove(type);
        return;
      }

      if (validator(value) && this.state[type] !== null) {
        this.state[type] = null;
        onInvalid?.();
        this.updateInputStates();
      }

      if (value.length < this.minSearchLength) {
        this.dropdownManager.remove(type);
        return;
      }

      const matches = this.dataService.search(type, value, this.state);

      if (!matches.length) {
        this.dropdownManager.remove(type);
        return;
      }

      this.dropdownManager.render(type, matches, (t, option) => {
        this.selectOption(t, option);
        this.dropdownManager.remove(t);
      });
    });

    if (type !== 'house') {
      input.addEventListener('blur', () => {
        const value = input.value.trim();
        if (validator(value)) {
          input.value = '';
          this.state[type] = null;
          onInvalid?.();
          this.updateInputStates();
        }
      });
    }
  }

  setInputValue(type, value) {
    const config = this.inputs.find(i => i.type === type);
    const input = this.dom[config.key];
    if (!input) return;

    input.value = value ?? '';
    this.state[type] = value || null;
  }

  async setAndSaveValue(type, value) {
    const config = this.inputs.find(i => i.type === type);
    if (!config) return;

    this.setInputValue(type, value);
    this.cache.setLocation({ [config.cacheKey]: value });
    this.updateInputStates();
  }

  async selectOption(type, option) {
    await this.setAndSaveValue(type, option);

    if (type === 'city') {
      this.clearStreet();
    }

    if (type === 'street') {
      this.clearHouse();
      await this.dataService.loadHousesForStreet(this.state.city, option);
    }

    if (type === 'house') {
      const houseData = this.dataService.getHouseData(option);
      const updateTimestamp = this.dataService.getUpdateTimestamp();
      const group = houseData.sub_type_reason[0].replace('GPV', '');
      const { group: lastGroup } = this.cache.getSelect();

      this.cache.setLocation({ group });
      this.cache.setHouseData(houseData, updateTimestamp);

      if (group !== lastGroup) await this.onInputFinalSelect(group);
      await this.showHouseData();
    }
  }

  // Завантажуємо збережені значення з in-memory кешу (без звернення до storage)
  async loadSavedValues() {
    const loc = this.cache.getLocation();

    if (!loc.city || !SETTLEMENTS[loc.city]) return;
    this.setInputValue('city', loc.city);

    if (!loc.street || !this.dataService.isValidStreet(loc.city, loc.street)) return;
    this.setInputValue('street', loc.street);
    await this.dataService.loadHousesForStreet(loc.city, loc.street, loc.house ?? null);

    if (!loc.house) return;
    this.setInputValue('house', loc.house);

    const { group: selectGroup } = this.cache.getSelect();
    if (loc.group && loc.group !== selectGroup) {
      await this.onInputFinalSelect(loc.group);
    }

    await this.showHouseData();
    this.updateInputStates();
  }

  getValues() {
    return {
      city: this.state.city,
      street: this.state.street,
      house: this.state.house
    };
  }

  updateInputStates() {
    const hasCity = this.state.city !== null;
    const hasStreet = this.state.street !== null;

    if (this.dom.streetInput) {
      this.dom.streetInput.disabled = !hasCity;
      if (!hasCity) this.dom.streetInput.value = '';
    }
    if (this.dom.houseInput) {
      this.dom.houseInput.disabled = !hasStreet;
      if (!hasStreet) this.dom.houseInput.value = '';
    }
  }

  async showHouseData() {
    const cached = this.cache.getHouseData();
    const data = cached?.data;
    const updateTimestamp = cached?.updateTimestamp;
    const container = this.dom.contentWrapper.querySelector('#content-header');

    if (!data) {
      container.innerHTML = `<button id="toggle-outage-btn" title='Дані завантажуються'><div class="loader small"></div>Оновлення даних</button>`;
      return;
    }
    const hasOutage = data.sub_type?.trim() !== '';
    let outageHtml = '';

    if (hasOutage) {
      const { sub_type, start_date, end_date } = data;
      outageHtml = `
        <div class="outage-card popup">
          <div class="outage-body">
            <p>Причина: <strong>${sub_type}</strong></p>
            <p>Початок: <strong>${Utils.formatFullDateTime(start_date)}</strong></p>
            <p>Відновлення: <strong>до ${Utils.formatFullDateTime(end_date)}</strong></p>
            <p>Оновлено: <strong>${Utils.formatFullDate(new Date(updateTimestamp))}</strong></p>
          </div>
        </div>
      `;
    } else {
      outageHtml = `
        <div class="outage-card popup info-mode">
          <div class="outage-body info-text">
            <p>Якщо зараз у вас відсутнє світло, імовірно виникла <strong>аварійна ситуація</strong>, або діють стабілізаційні чи екстрені відключення.</p>
            <p>Просимо перевірити інформацію через <strong>15 хвилин</strong> (час на оновлення даних).</p>
            <p>Оновлено: <strong>${Utils.formatFullDate(new Date(updateTimestamp))}</strong></p>
          </div>
        </div>
      `;
    }

    container.innerHTML = `
      <button id="toggle-outage-btn" title='Переглянути стан електропостачання'>${hasOutage ? "⚠️ За адресою відсутня електроенергія" : "Стан електропостачання"}</button>
      ${outageHtml}
    `;

    const button = container.querySelector('#toggle-outage-btn');
    const popup = container.querySelector('.outage-card');

    button.addEventListener('click', (e) => {
      e.stopPropagation();
      popup.classList.toggle('active');
    });

    document.addEventListener('click', () => popup.classList.remove('active'));
    popup.addEventListener('click', (e) => e.stopPropagation());
  }

  clearStreet() {
    this.clearField('street');
    this.clearHouse();
  }

  clearHouse() {
    this.clearField('house');
    this.dataService.clearHouses();
  }

  clearField(type) {
    const config = this.inputs.find(i => i.type === type);
    this.state[type] = null;
    const input = this.dom[config.key];
    if (input) input.value = '';
    this.cache.setLocation({ [config.cacheKey]: '' });
  }

  async renderInputs() {
    if (this.inputsWrapper) return;

    const { extended } = await Utils.getStorageData(['extended']);
    const root = document.createElement('div');
    const disabled = extended !== true ? 'disabled' : '';
    root.className = 'location-root';
    root.dataset.extended = extended ?? 'false';
    root.innerHTML = `
      <div class="input-wrapper">
        <div class="custom-input">
          <input id="city" class="city-input" ${disabled} placeholder=" " />
          <label for="city" class="input-label">Населений пункт</label>
        </div>
        <div class="custom-input">
          <input id="street" class="street-input" ${disabled} placeholder=" " />
          <label for="street" class="input-label">Вулиця</label>
        </div>
        <div class="custom-input">
          <input id="house" class="house-number-input" ${disabled} placeholder=" " />
          <label for="house" class="input-label">Номер будинку</label>
        </div>
      </div>
      <button class="location-btn" title="Розкрити меню">
        <div class="arrow-icon ${extended === true ? 'up' : 'down'}"></div>
      </button>
    `;

    this.dom.controls.appendChild(root);
    this.inputsWrapper = root;

    this.dom.cityInput = root.querySelector('#city');
    this.dom.streetInput = root.querySelector('#street');
    this.dom.houseInput = root.querySelector('#house');
    this.dom.locationBtn = root.querySelector('.location-btn');

    this.dom.locationBtn.addEventListener('click', async () => {
      const newExtended = root.dataset.extended !== 'true';
      root.dataset.extended = String(newExtended);
      await Utils.setStorageData({ extended: newExtended });

      const arrowIcon = this.dom.locationBtn.querySelector('.arrow-icon');
      arrowIcon?.classList.toggle('down', !newExtended);
      arrowIcon?.classList.toggle('up', newExtended);

      const inputs = root.querySelectorAll('input');
      inputs.forEach(input => {
        input.disabled = !newExtended;
      });
    });

    if (!this.dom.contentWrapper.querySelector('#content-header')) {
      const container = document.createElement('div');
      container.id = 'content-header';
      this.dom.contentWrapper.insertBefore(container, this.dom.contentWrapper.firstChild);
    }

    await this.loadSavedValues();
    await this.init();
  }

  removeInputs() {
    if (!this.inputsWrapper) return;
    this.stopRefreshTimer();

    this.inputsWrapper.remove();
    this.inputsWrapper = null;

    this.dom.cityInput = null;
    this.dom.streetInput = null;
    this.dom.houseInput = null;

    this.state.city = null;
    this.state.street = null;
    this.state.house = null;

    this.dom.contentWrapper.querySelector('#content-header')?.remove();
  }
}

// ============================================================================
// МЕНЕДЖЕР ДАНИХ
// ============================================================================
class DataManager {
  constructor(dom, selectManager, dateManager, inputManager) {
    this.dom = dom;
    this.selectManager = selectManager;
    this.dateManager = dateManager;
    this.inputManager = inputManager;
  }

  async loadData() {
    const { mode } = await Utils.getStorageData(['mode']);
    const modeType = mode ?? 0;
    const strategy = MODE_STRATEGIES[CONSTANTS.MODES[modeType]];

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
        box.innerHTML = Utils.buildLoadErrorHTML();
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
// При force-refresh очищає кеш поточного режиму через CacheManager
// ============================================================================
class RefreshManager {
  #isRefreshing = false;

  constructor(dom, cacheManager, getModeKey, onRefresh) {
    this.dom = dom;
    this.cache = cacheManager;
    this.getModeKey = getModeKey;
    this.onRefresh = onRefresh;
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
      // Очищаємо background-кеш
      await Utils.sendMessage({ action: 'clearCache' });

      // Очищаємо popup-кеш поточного режиму (houses + houseData, location зберігається)
      const modeKey = await this.getModeKey();
      this.cache.clearModeData(modeKey);

      await this.onRefresh();
    } catch (error) {
      console.error('[RefreshManager] refresh error:', error);
      box.innerHTML = Utils.buildLoadErrorHTML();
    } finally {
      const remaining = CONSTANTS.REFRESH_MIN_DURATION - (Date.now() - startTime);
      if (remaining > 0) await Utils.delay(remaining);

      box.classList.remove('loading');
      btn.classList.replace('refreshing', 'ready');

      setTimeout(() => btn.classList.remove('ready'), CONSTANTS.REFRESH_ANIMATION_DURATION);
      this.#isRefreshing = false;
    }
  }
}

// ============================================================================
// МЕНЕДЖЕР ПОВІДОМЛЕНЬ
// ============================================================================
class MessageManager {
  #maxToastCount = 5;
  #activeToasts = new Map();
  #defaultDuration = 3000;

  #elements = {
    header: null,
    container: null
  };

  constructor(dom = {}) {
    this.#elements.header = dom.header || document.querySelector('header');
    this.#initContainer();
  }

  show({ text = '', icon = 'ℹ️', type = 'info', id = 'default', closable = true } = {}) {
    if (!this.#elements.header) return null;
    let block = this.#elements.header.querySelector(`.message-block[data-id="${id}"]`);

    if (block) {
      this.#updateMessageBlock(block, { text, icon, type });
      return block;
    }

    block = this.#createMessageElement({ text, icon, type, id, closable });
    this.#elements.header.prepend(block);

    requestAnimationFrame(() => {
      block.style.opacity = '1';
      block.style.transform = 'translateY(0)';
    });

    return block;
  }

  showToast({
    text = '',
    icon = 'ic_info',
    type = 'info',
    id = null,
    duration = this.#defaultDuration,
    emotional = false
  } = {}) {
    if (this.#activeToasts.size >= this.#maxToastCount) {
      const oldestId = this.#activeToasts.keys().next().value;
      this.hideToast(oldestId);
    }

    const toastId = id ?? `toast-${Date.now()}-${Math.random()}`;

    if (id && this.#activeToasts.has(id)) {
      this.#updateToast(id, { text, icon, type, emotional });
      return toastId;
    }

    const messageText = emotional && this.#activeToasts.size >= 1
      ? this.#addEmotionalEnding(text)
      : text;

    const toast = this.#createToastElement({
      text: messageText,
      icon,
      type,
      id: toastId
    });

    this.#elements.container.appendChild(toast);

    const timerId = setTimeout(() => this.hideToast(toastId), duration);
    this.#activeToasts.set(toastId, { element: toast, timerId });

    requestAnimationFrame(() => toast.classList.add('show'));

    return toastId;
  }

  hideToast(id) {
    const toastData = this.#activeToasts.get(id);
    if (!toastData) return;

    const { element, timerId } = toastData;
    clearTimeout(timerId);

    element.classList.remove('show');
    element.addEventListener('transitionend', () => {
      element.remove();
      this.#activeToasts.delete(id);
    }, { once: true });
  }

  hide(block) {
    if (!block) return;

    block.style.opacity = '0';
    block.style.transform = 'translateY(-10px)';

    block.addEventListener('transitionend', () => block.remove(), { once: true });
  }

  clearAllToasts() {
    this.#activeToasts.forEach((_, id) => this.hideToast(id));
  }

  clearHeader() {
    if (!this.#elements.header) return;
    const blocks = this.#elements.header.querySelectorAll('.message-block');
    blocks.forEach(block => this.hide(block));
  }

  #initContainer() {
    let container = document.querySelector('.validator-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'validator-container';
      document.body.appendChild(container);
    }
    this.#elements.container = container;
  }

  #createMessageElement({ text, icon, type, id, closable }) {
    const block = document.createElement('div');
    block.className = 'message-block';
    block.dataset.id = id;
    block.style.cssText = 'opacity: 0; transform: translateY(-10px); transition: all 0.2s ease;';

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

    item.append(iconEl, content);

    if (closable) {
      const closeBtn = document.createElement('button');
      closeBtn.className = 'cross-icon';
      closeBtn.innerText = '❌';
      closeBtn.title = 'Закрити';
      closeBtn.setAttribute('aria-label', 'Закрити');
      closeBtn.addEventListener('click', () => this.hide(block), { once: true });
      item.appendChild(closeBtn);
    }

    block.appendChild(item);
    return block;
  }

  #createToastElement({ text, icon, type, id }) {
    const toast = document.createElement('div');
    toast.className = `toast-msg toast-${type}`;
    toast.dataset.id = id;

    if (icon) {
      const iconEl = document.createElement('span');
      iconEl.className = `toast-icon ${icon}`;
      toast.appendChild(iconEl);
    }

    const textEl = document.createElement('span');
    textEl.className = 'toast-text';
    textEl.textContent = text;
    toast.appendChild(textEl);

    return toast;
  }

  #updateMessageBlock(block, { text, icon, type }) {
    const item = block.querySelector('.message-item');
    const iconEl = block.querySelector('.message-icon');
    const textEl = block.querySelector('.message-content span');

    if (item) item.className = `message-item message-${type}`;
    if (iconEl) iconEl.innerHTML = icon;
    if (textEl) textEl.textContent = text;
  }

  #updateToast(id, { text, icon, type, emotional }) {
    const { element } = this.#activeToasts.get(id);
    const iconEl = element.querySelector('.toast-icon');
    const textEl = element.querySelector('.toast-text');

    element.className = `toast-msg toast-${type} show`;
    if (iconEl) iconEl.classList.add(icon);
    if (textEl) textEl.textContent = emotional ? this.#addEmotionalEnding(text) : text;
  }

  #addEmotionalEnding(text) {
    const endings = ['!!!', '😠😡', '😤', '💢', '🤬', '!!! 😠', '😡💥'];
    const randomEnding = endings[Math.floor(Math.random() * endings.length)];
    return `${text} ${randomEnding}`;
  }
}

// ============================================================================
// МЕНЕДЖЕР POPUP-МЕНЮ
// ============================================================================
class PopupManager {
  constructor(dom, dialogManager, dataManager, themeManager, inputManager, errorReporter) {
    this.dom = dom;
    this.dialogManager = dialogManager;
    this.dataManager = dataManager;
    this.themeManager = themeManager;
    this.inputManager = inputManager;
    this.errorReporter = errorReporter;
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
      this.inputManager.renderInputs();
    } else {
      Utils.setYasnoMode(this.dom.osrSelect);
      this.inputManager.removeInputs();
    }

    dotsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      popupMenu.classList.toggle('active');
    });

    document.addEventListener('click', () => popupMenu.classList.remove('active'));

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
          this.inputManager.renderInputs();
        } else {
          Utils.setYasnoMode(this.dom.osrSelect);
          this.inputManager.removeInputs();
        }

        this.dataManager.loadData();
        break;
      }

      case 'theme':
        this.themeManager.toggleTheme();
        break;

      case 'bug-report':
        this.dialogManager.showBugReport((data) => {
          this.errorReporter.capture(data);
          this.errorReporter.flush();
        });
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

    this.cacheManager = new CacheManager();
    await this.cacheManager.load();

    this.themeManager = new ThemeManager(dom);
    this.messageManager = new MessageManager(dom);
    this.dialogManager = new DialogManager(dom, this.messageManager);
    this.versionManager = new VersionManager(dom, this.dialogManager, this.messageManager);
    this.dateManager = new DateManager(dom, () => this.dataManager.loadData());

    this.selectManager = new SelectManager(
      dom,
      this.cacheManager,
      () => this.dataManager.loadData()
    );

    this.inputManager = new InputManager(
      dom,
      this.cacheManager,
      async (g) => {
        await this.selectManager.setAndSaveValue('queue', g);
        await this.dataManager.loadData();
      }
    );

    this.dataManager = new DataManager(dom, this.selectManager, this.dateManager, this.inputManager);

    this.errorReporter = new ErrorReporter({
      endpoint: "https://docs.google.com/forms/d/e/1FAIpQLScSGSLvZoB6t3RG17AS2ueH0vgCaVl5T813QQElPqkIEMXJKQ/formResponse",
      fieldsMap: {
        error: "entry.581983976",
        stack: "entry.1526738214",
        mode: "entry.1382745580",
        userAgent: "entry.1303966238",
        platform: "entry.1541979604",
        language: "entry.804086390",
        screen: "entry.698707174",
        version: "entry.1787521461"
      }
    });

    this.popupManager = new PopupManager(
      dom,
      this.dialogManager,
      this.dataManager,
      this.themeManager,
      this.inputManager,
      this.errorReporter
    );

    // getModeKey — асинхронно зчитує поточний режим для RefreshManager
    const getModeKey = async () => {
      const { mode } = await Utils.getStorageData(['mode']);
      return CONSTANTS.MODES[mode ?? 0];
    };

    this.refreshManager = new RefreshManager(
      dom,
      this.cacheManager,
      getModeKey,
      async () => {
        await this.dataManager.loadData();
        this.dateManager.updateDateNumbers();
        this.dateManager.updateIndicator();
      }
    );

    this.themeManager.init();
    this.selectManager.init();
    this.popupManager.init();
  }
}

// ============================================================================
// ІНІЦІАЛІЗАЦІЯ
// ============================================================================
document.addEventListener('DOMContentLoaded', () => new App());