(() => {
  'use strict';
  // Codes must match ApiError codes in supabase/functions/kinpass-api.
  const messages = {
    REVISION_CONFLICT: 'Дело изменилось на другом устройстве. Список обновлён — проверьте его и повторите действие.',
    TELEGRAM_AUTH_EXPIRED: 'Сессия закончилась. Закройте приложение и откройте его снова из бота.',
    INVALID_TELEGRAM_AUTH: 'Telegram не подтвердил вход. Откройте приложение из кнопки бота.',
    TELEGRAM_AUTH_REQUIRED: 'Откройте приложение через кнопку в Telegram-боте.',
    AUTH_REQUIRED: 'Откройте приложение через кнопку в Telegram-боте.',
    INVALID_DOCUMENTS: 'В одном деле может быть до 100 документов.',
    INVALID_DOCUMENT: 'Проверьте название, город и даты документа.',
    INVALID_DOCUMENT_ID: 'Документ не найден. Обновите дело.',
    DUPLICATE_DOCUMENT_ID: 'Такой документ уже есть. Обновите дело.',
    INVALID_DATE: 'Проверьте даты документа.',
    INVALID_DATE_RANGE: 'Срок действия должен быть после даты выдачи, а готовность — после даты запроса.',
    FILE_TOO_LARGE: 'Выберите файл размером до 3 МБ.',
    REQUEST_TOO_LARGE: 'Выберите файл размером до 3 МБ.',
    INVALID_FILE: 'Фото не читается. Выберите JPG, PNG или WEBP.',
    INVALID_FILE_CONTENT: 'Содержимое файла не совпадает с форматом. Выберите фото JPG, PNG или WEBP.',
    INVALID_FILE_NAME: 'Переименуйте файл и повторите загрузку.',
    INVALID_ATTACHMENT: 'Файл не найден в деле. Загрузите его заново.',
    FILE_NOT_FOUND: 'Файл не найден. Загрузите его заново.',
    STORAGE_LIMIT: 'Хранилище заполнено. Удалите ненужные документы с вложениями и повторите загрузку.',
    DOCUMENT_NOT_FOUND: 'Документ не найден. Обновите дело.',
    INVALID_INSTITUTION: 'Проверьте название, город и ссылку учреждения.',
    INVALID_INSTITUTIONS: 'Можно сохранить до 100 учреждений.',
    INVALID_LOOKUP: 'Введите название учреждения — хотя бы 2 буквы.',
    AI_NOT_CONFIGURED: 'Помощник ИИ ещё не подключён: добавьте GEMINI_API_KEY в секреты GitHub.',
    AI_LIMIT: 'Лимит запросов к ИИ на сегодня исчерпан. Попробуйте завтра.',
    AI_UNAVAILABLE: 'ИИ сейчас не ответил. Попробуйте ещё раз через минуту.',
    AI_NOT_FOUND: 'ИИ не нашёл данных. Уточните название или город.'
  };
  class CloudError extends Error {
    constructor(code, status = 0, state = {}) {
      super(messages[code] || (status === 401 ? messages.AUTH_EXPIRED : 'Не удалось сохранить данные. Проверьте соединение и повторите действие.'));
      this.code = code;
      this.status = status;
      this.documents = state.documents;
      this.institutions = state.institutions;
      this.revision = state.revision;
    }
  }
  class KinpassCloud {
    constructor(apiUrl, initData) {
      if (!initData) throw new CloudError('AUTH_REQUIRED', 401);
      let url;
      try { url = new URL(apiUrl); } catch { throw new Error('Адрес сервера ещё не настроен. Запустите launch.sh.'); }
      const local = ['127.0.0.1', 'localhost'].includes(url.hostname) && ['127.0.0.1', 'localhost'].includes(location.hostname);
      if (url.protocol !== 'https:' && !local) throw new Error('Сервер приложения должен использовать HTTPS.');
      this.apiUrl = url.href;
      this.initData = initData;
      this.revision = 0;
      this.saving = false;
    }
    async request(action, payload = {}) {
      let response;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 25000);
      try {
        response = await fetch(this.apiUrl, {
          method: 'POST', credentials: 'omit', cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, action, initData: this.initData }),
          signal: controller.signal
        });
        const data = await response.json();
        if (!response.ok) throw new CloudError(data.error || 'REQUEST_FAILED', response.status, data);
        return data;
      } catch (error) {
        if (error instanceof CloudError) throw error;
        throw new Error('Нет связи с сервером. Проверьте интернет и повторите действие.');
      } finally { clearTimeout(timeout); }
    }
    async load() {
      const state = await this.request('load');
      this.validateState(state);
      this.revision = state.revision;
      return state;
    }
    validateState(state) {
      if (!Array.isArray(state.documents) || !Number.isSafeInteger(state.revision) || state.revision < 0) throw new Error('Сервер вернул неполные данные. Повторите загрузку.');
      if (!Array.isArray(state.institutions)) state.institutions = [];
    }
    async save(documents, institutions) {
      if (this.saving) throw new Error('Предыдущее изменение ещё сохраняется.');
      this.saving = true;
      try {
        const state = await this.request('save', { documents, ...(institutions ? { institutions } : {}), revision: this.revision });
        this.validateState(state);
        this.revision = state.revision;
        return state;
      } catch (error) {
        if (error.code === 'REVISION_CONFLICT' && Array.isArray(error.documents) && Number.isSafeInteger(error.revision)) this.revision = error.revision;
        throw error;
      } finally { this.saving = false; }
    }
    upload(documentId, fileName, dataUrl) { return this.request('upload', { documentId, fileName, dataUrl }); }
    file(documentId) { return this.request('file', { documentId }); }
    lookup(query, city) { return this.request('lookup', { query, city }); }
  }
  window.KinpassCloud = KinpassCloud;
})();
