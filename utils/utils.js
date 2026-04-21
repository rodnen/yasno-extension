// utils.js
const months = Object.freeze(["січ", "лют", "бер", "квіт", "трав", "чер", "лип", "серп", "вер", "жовт", "лист", "груд"]);

/**
 * Утилітарний клас для роботи з Chrome API та загальними функціями
 */
class Utils {
    /**
     * Надсилає повідомлення через chrome.runtime.sendMessage
     * @param {Object} message - повідомлення для відправки
     * @returns {Promise<any>} - відповідь
     */
    static sendMessage(message) {
        return new Promise(resolve => chrome.runtime.sendMessage(message, resolve));
    }

    /**
     * Форматує дату у вигляді "день місяць."
     * @param {Date} date - дата для форматування
     * @returns {string} - відформатована дата
     */
    static formatDate(date) {
        const d = new Date(date);
        return `${d.getDate()} ${months[d.getMonth()]}.`;
    }

    /**
     * Форматує рядок дати та часу у вигляді "HH:MM день місяць. рік р."
     * @param {string} dateStr - рядок у форматі "HH:MM DD.MM.YYYY"
     * @returns {string} - відформатований рядок або "—" якщо дані відсутні
     */
    static formatFullDateTime(dateStr) {
        if (!dateStr) return '—';
        const [time, datePart] = dateStr.split(' ');

        const [day, month, year] = datePart.split('.');

        const monthIndex = parseInt(month, 10) - 1;
        const dayNumber = parseInt(day, 10);

        return `${time} ${dayNumber} ${months[monthIndex]}. ${year} р.`;
    }

    /**
     * Форматує об'єкт Date у вигляді "HH:MM день місяць. рік р."
     * @param {Date|string|number} date - дата для форматування
     * @returns {string} - відформатований рядок
     */
    static formatFullDate(date) {
        const d = new Date(date);
        const hours = String(d.getHours()).padStart(2, '0');
        const minutes = String(d.getMinutes()).padStart(2, '0');
        return `${hours}:${minutes} ${d.getDate()} ${months[d.getMonth()]}. ${d.getFullYear()} р.`;
    }

    /**
     * Парсить рядок дати у timestamp
     * @param {string} str - рядок у форматі "HH:MM DD.MM.YYYY"
     * @returns {number} - timestamp у мілісекундах
     */
    static parseToTimestamp(str) {
        const [time, date] = str.split(' ');

        const [hours, minutes] = time.split(':').map(Number);
        const [day, month, year] = date.split('.').map(Number);

        const d = new Date(year, month - 1, day, hours, minutes);

        return d.getTime();
    }

    /**
     * Отримує дані з chrome.storage.local
     * @param {string|string[]} keys - ключ або масив ключів
     * @returns {Promise<Object>} - об'єкт з даними
     */
    static getStorageData(keys) {
        return chrome.storage.local.get(keys);
    }

    /**
     * Отримує значення за конкретним ключем
     * @param {string} key - ключ
     * @returns {Promise<any>} - значення
     */
    static async getStorageValue(key) {
        const result = await chrome.storage.local.get(key);
        return result[key];
    }

    /**
     * Зберігає дані у chrome.storage.local
     * @param {Object} data - об'єкт з даними для збереження
     * @returns {Promise<void>}
     */
    static setStorageData(data) {
        return chrome.storage.local.set(data);
    }

    /**
     * Видаляє дані з chrome.storage.local
     * @param {string|string[]} key - ключ або масив ключів
     * @returns {Promise<void>}
     */
    static removeStorageData(key) {
        return chrome.storage.local.remove(key);
    }

    /**
     * Створює затримку на вказаний час
     * @param {number} ms - мілісекунди
     * @returns {Promise<void>}
     */
    static delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Встановлює режим DTEK для селекта (блокує взаємодію)
     * @param {HTMLElement} el - елемент селекта
     * @param {HTMLElement} mEl - елемент з favicon режиму
     * @returns {void}
     */
    static setDTEKMode(el, mEl = null) {
        if (!el || el.dataset.hidden === "true") return;

        el.dataset.hidden = "true";

        const trigger = el.querySelector(".select-trigger");
        const options = el.querySelector(".select-options");

        if (trigger) {
            trigger.textContent = "ДТЕК";
        }

        if (options) {
            options.style.pointerEvents = "none";
            options.style.opacity = "0.5";
        }

        el.style.pointerEvents = "none";

        if (mEl) mEl.querySelector('img').src = "/icons/ic_dtek.png";
    }

    /**
     * Встановлює режим Yasno для селекта (розблоковує взаємодію та відновлює значення)
     * @param {HTMLElement} el - елемент селекта
     * @param {HTMLElement} mEl - елемент з favicon режиму
     * @returns {Promise<void>}
     */
    static async setYasnoMode(el, mEl = null) {
        if (!el) return;

        const trigger = el.querySelector(".select-trigger");
        const options = el.querySelector(".select-options");

        el.style.pointerEvents = "";
        if (options) {
            options.style.pointerEvents = "";
            options.style.opacity = "";
        }

        const data = await Utils.getStorageData(['lastGroup', 'lastOsr']);
        const savedValue = data?.lastOsr;

        const allOptions = el.querySelectorAll(".option");
        let selectedOption = null;

        if (savedValue) {
            selectedOption = [...allOptions].find(opt => opt.dataset.value === savedValue);
        }

        if (!selectedOption && allOptions.length > 0) {
            selectedOption = allOptions[0];
        }

        if (selectedOption) {
            if (trigger) {
                trigger.textContent = selectedOption.textContent;
            }
            el.dataset.value = selectedOption.dataset.value;
        }

        if (mEl) mEl.querySelector('img').src = "/icons/ic_yasno.png";

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                delete el.dataset.hidden;
            });
        });
    }

    static setErrorTextarea(el) {
        el.closest('.custom-textarea')?.classList.add('input-error');
    }

    static clearErrorTextarea(el) {
        el.closest('.custom-textarea')?.classList.remove('input-error');
    }

    /**
     * Генерує HTML для відображення помилки завантаження
     * @returns {string} - HTML рядок
     */
    static buildLoadErrorHTML() {
        return `
        <p class="message">Не вдалося завантажити дані 😢</p>
        <br>
        <p class="message secondary-text">Перевірте з'єднання або перезапустіть розширення</p>
      `;
    }
}

// Експорт для використання як модуль
export { Utils };

// Також експортуємо за замовчуванням для зручності
export default Utils;