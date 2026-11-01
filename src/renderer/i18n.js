/* Локализация интерфейса (ru / en).
   Исходный язык интерфейса — русский. Для английского текст узлов и атрибутов переводится «на лету»:
   точное совпадение по словарю, затем шаблоны с числами, затем замена известных фрагментов.
   Содержимое чатов, код и поля ввода не трогаем. Смена языка перезагружает окно. */
(function () {
  const KEY = 'stella.lang';
  const sys = (navigator.language || 'ru').toLowerCase().startsWith('ru') ? 'ru' : 'en';
  let lang = (function () { try { return localStorage.getItem(KEY) || sys; } catch (e) { return sys; } })();

  const PAIRS = [
    ['Основной лимит', 'Primary limit'], ['Дополнительный лимит', 'Additional limit'],
    ['● ЛИМИТЫ', '● LIMITS'], ['ЛИМИТЫ', 'LIMITS'],
    ['Лимиты аккаунта пока недоступны.', 'Account limits are not available yet.'],
    ['Лимиты подписки недоступны для API.', 'Subscription limits are unavailable for API access.'],
    ['Каталог моделей недоступен', 'Model catalog unavailable'],
    ['Выбранная модель недоступна в каталоге', 'Selected model is unavailable in the catalog'],
    ['Уровень размышлений не поддерживается моделью', 'Reasoning effort is unsupported by this model'],
    ['Авто', 'Auto'], ['Другой ответ', 'Other answer'], ['Отправить ответ', 'Send answer'],
    ['Ответьте на все вопросы', 'Answer all questions'], ['Ответ отправлен', 'Answer sent'],
    ['Не удалось отправить ответ', 'Failed to send answer'], ['Аккаунт подключён', 'Account connected'],
    ['Требуется вход', 'Sign-in required'], ['Авторизация не требуется', 'Authentication not required'],
    // шапка, вкладки, режимы
    ['ЯДРО STELLA · CLAUDE CODE', 'STELLA CORE · CLAUDE CODE'], ['ЯДРО STELLA · OPENAI CODEX', 'STELLA CORE · OPENAI CODEX'], ['ЯДРО STELLA · ЧАТ-АССИСТЕНТ', 'STELLA CORE · CHAT ASSISTANT'],
    ['СТУДИЯ', 'STUDIO'], ['Студия', 'Studio'], ['ТВОЙ КОМАНДНЫЙ ЦЕНТР', 'YOUR COMMAND CENTER'], ['Мостик', 'Bridge'], ['ПРОЕКТ', 'PROJECT'], ['Папка', 'Folder'],
    ['Спрашивать разрешение', 'Ask permission'], ['Сам правит файлы', 'Edits files itself'], ['Только план', 'Plan only'], ['Полный доступ', 'Full access'],
    ['Только чтение', 'Read only'], ['Правит в папке проекта', 'Edits in project folder'],
    ['ДУМАЕТ', 'THINKING'], ['ПИШЕТ ОТВЕТ', 'WRITING'], ['РАБОТАЕТ С ИНСТРУМЕНТАМИ', 'USING TOOLS'], ['ЖДЁТ ПОДТВЕРЖДЕНИЯ', 'WAITING FOR APPROVAL'], ['ОШИБКА', 'ERROR'],
    ['Спроси что угодно…', 'Ask anything…'], ['Спроси или дай задачу для папки проекта…', 'Ask or give a task for the project folder…'], ['Спроси или дай задачу…', 'Ask or give a task…'],
    ['Через API-ключ', 'Via API key'], ['Через аккаунт ChatGPT', 'Via ChatGPT account'],
    ['Полный доступ: агент будет выполнять любые действия без подтверждения.', 'Full access: the agent will perform any action without confirmation.'],
    ['Размышление: авто', 'Reasoning: auto'], ['Модель: авто', 'Model: auto'], ['Opus (план) + Sonnet', 'Opus (plan) + Sonnet'],
    ['Низкое', 'Low'], ['Среднее', 'Medium'], ['Высокое', 'High'], ['Очень высокое', 'Very high'], ['Максимум', 'Maximum'], ['Минимальное', 'Minimal'],
    // плагины
    ['Плагины', 'Plugins'], ['Codex · MCP-серверы', 'Codex · MCP servers'], ['Не получилось', 'Something went wrong'], ['Закрыть', 'Close'],
    ['Готово. Изменения применятся в новых чатах Claude.', 'Done. Changes apply to new Claude chats.'], ['Готово.', 'Done.'], ['Загрузка…', 'Loading…'],
    ['Все', 'All'], ['Установленные', 'Installed'], ['Ничего не найдено.', 'Nothing found.'], ['выключен', 'disabled'], ['установлен', 'installed'],
    ['Установить', 'Install'], ['Установка…', 'Installing…'], ['Выключить', 'Disable'], ['Включить', 'Enable'], ['Обновить', 'Update'], ['Обновление…', 'Updating…'],
    ['Удалить', 'Remove'], ['Удаление…', 'Removing…'], ['ИСТОЧНИКИ (МАРКЕТПЛЕЙСЫ)', 'SOURCES (MARKETPLACES)'],
    ['владелец/репозиторий на GitHub или ссылка на git', 'owner/repo on GitHub or a git URL'], ['Добавить источник', 'Add source'], ['Добавляю…', 'Adding…'],
    ['Обновить каталоги', 'Refresh catalogs'], ['Обновляю…', 'Refreshing…'],
    ['У Codex нет каталога плагинов: расширения подключаются как MCP-серверы. Добавьте сервер командой запуска (например, npx -y @modelcontextprotocol/server-filesystem C:\\папка) или адресом http(s).',
      'Codex has no plugin catalog: extensions are connected as MCP servers. Add a server by its launch command (e.g. npx -y @modelcontextprotocol/server-filesystem C:\\folder) or an http(s) address.'],
    ['MCP-серверов пока нет.', 'No MCP servers yet.'], ['ДОБАВИТЬ MCP-СЕРВЕР', 'ADD MCP SERVER'], ['имя', 'name'], ['команда запуска или https://адрес', 'launch command or https://address'],
    ['Добавить', 'Add'], ['Укажите имя и команду или адрес.', 'Enter a name and a command or address.'],
    ['Имя: латиница, цифры, точка, дефис.', 'Name: Latin letters, digits, dot, hyphen.'], ['Недопустимое имя плагина.', 'Invalid plugin name.'],
    ['Недопустимое имя маркетплейса.', 'Invalid marketplace name.'], ['Укажите владельца/репозиторий GitHub, URL или путь.', 'Enter a GitHub owner/repo, URL or path.'],
    ['Claude Code не найден. Установите его в панели «Системы».', 'Claude Code not found. Install it in the Systems panel.'],
    ['Codex не найден. Установите его в панели «Системы».', 'Codex not found. Install it in the Systems panel.'],
    ['Нужен адрес http(s)://…', 'An http(s):// address is required.'], ['Укажите команду запуска или адрес.', 'Enter a launch command or address.'],
    // чаты и боковая панель
    ['+ Добавить папку…', '+ Add folder…'], ['Убрать текущую папку из списка', 'Remove current folder from list'], [' Показывать чаты всех проектов', ' Show chats from all projects'],
    ['СЕГОДНЯ', 'TODAY'], ['ВЧЕРА', 'YESTERDAY'], ['НА ЭТОЙ НЕДЕЛЕ', 'THIS WEEK'], ['РАНЕЕ', 'EARLIER'], ['Здесь появятся чаты этого проекта.', 'Chats of this project will appear here.'],
    ['Удалить чат', 'Delete chat'], ['Удалить?', 'Delete?'], ['Новый чат', 'New chat'], ['Поиск по чатам', 'Search chats'], ['Поиск по чатам…  Ctrl K', 'Search chats…  Ctrl K'],
    ['Расписание', 'Schedule'], ['Терминал', 'Terminal'], ['Настройки', 'Settings'], ['Чаты', 'Chats'], ['Навыки', 'Skills'],
    ['Объясни простыми словами', 'Explain simply'], ['Улучши текст', 'Improve text'], ['Переведи на английский', 'Translate to English'], ['Идеи', 'Ideas'],
    ['Перенести в новую сессию', 'Move to a new session'], ['Сжать итоги этого чата и продолжить в новой сессии с меньшим расходом токенов', 'Condense this chat and continue in a new session using fewer tokens'],
    ['Нажмите, чтобы переименовать', 'Click to rename'],
    ['Агент ещё отвечает. Дождитесь ответа или нажмите «Стоп».', 'The agent is still replying. Wait for the answer or press Stop.'],
    ['Дождитесь ответа агента или нажмите «Стоп».', 'Wait for the agent or press Stop.'], ['В чате пока нечего переносить.', 'Nothing to move in this chat yet.'],
    ['Создана новая сессия с сжатым контекстом (локально, без расхода токенов).', 'New session created with condensed context (local, no tokens spent).'],
    // системы
    ['ИДЁТ', 'IN PROGRESS'], ['ГОТОВО', 'DONE'], ['Установить Claude Agent SDK', 'Install Claude Agent SDK'], ['Войти в Claude', 'Sign in to Claude'], ['Войти в Codex', 'Sign in to Codex'],
    ['Установить Claude Code', 'Install Claude Code'], ['Установить Codex', 'Install Codex'], ['Открыть настройки', 'Open settings'],
    ['В терминале Claude введите /login и пройдите вход в браузере.', 'In the Claude terminal type /login and sign in via the browser.'],
    ['Войдите через аккаунт ChatGPT в открывшемся браузере.', 'Sign in with your ChatGPT account in the browser that opens.'],
    ['НЕ НАЙДЕН', 'NOT FOUND'], ['НУЖЕН SDK', 'SDK NEEDED'], ['УСТАНОВЛЕН', 'INSTALLED'], ['Установить SDK', 'Install SDK'], ['Войти', 'Sign in'], ['Войти / сменить аккаунт', 'Sign in / switch account'],
    ['API-КЛЮЧ', 'API KEY'], ['НЕТ КЛЮЧА', 'NO KEY'], ['АККАУНТ CHATGPT', 'CHATGPT ACCOUNT'], ['Настроить', 'Configure'], ['НЕ НАСТРОЕНА', 'NOT SET UP'], ['Открыть', 'Open'], ['РАБОТАЕТ', 'RUNNING'],
    ['● СИСТЕМЫ', '● SYSTEMS'], ['● ЛИМИТЫ CLAUDE', '● CLAUDE LIMITS'], ['● РАСХОД ЗА НЕДЕЛЮ', '● USAGE THIS WEEK'], ['● ДИРЕКТИВЫ', '● DIRECTIVES'], ['● ФАЙЛЫ ЧАТА', '● CHAT FILES'],
    ['СИСТЕМЫ', 'SYSTEMS'], ['ЛИМИТЫ CLAUDE', 'CLAUDE LIMITS'], ['РАСХОД ЗА НЕДЕЛЮ', 'USAGE THIS WEEK'], ['ДИРЕКТИВЫ', 'DIRECTIVES'], ['ФАЙЛЫ ЧАТА', 'CHAT FILES'],
    ['ЗА 7 ДНЕЙ', 'LAST 7 DAYS'], ['ЗА 5 ЧАСОВ', 'LAST 5 HOURS'], ['7 ДНЕЙ · OPUS', '7 DAYS · OPUS'], ['7 ДНЕЙ · SONNET', '7 DAYS · SONNET'],
    ['Реальный процент лимита подписки Claude появится после первого ответа Claude.', 'The real Claude subscription limit will appear after Claude\'s first reply.'],
    ['Лимит исчерпан. ', 'Limit reached. '], ['Сброс: ', 'Resets: '], [' запр.', ' req.'], ['Токены за неделю: ', 'Tokens this week: '], [' на входе, ', ' in, '], [' на выходе', ' out'],
    ['. Оценка стоимости: $', '. Estimated cost: $'], ['Удалить директиву', 'Delete directive'], ['Новая директива', 'New directive'], ['Новая директива…', 'New directive…'], ['Добавить директиву', 'Add directive'],
    ['Войти в Claude и Codex', 'Sign in to Claude and Codex'], ['Добавить свою папку проекта', 'Add your project folder'], ['Настроить навыки под себя', 'Customize skills'],
    ['Файлы, которые агент создаст или изменит, появятся здесь.', 'Files the agent creates or changes will appear here.'],
    ['Этот файл нельзя показать здесь. Нажмите «Открыть», чтобы открыть его в программе по умолчанию.', 'This file can\'t be shown here. Press Open to open it in the default app.'],
    ['Предпросмотр HTML', 'HTML preview'], ['Предпросмотр', 'Preview'], ['Закрыть предпросмотр', 'Close preview'], ['Показать в папке', 'Show in folder'],
    // сообщения
    ['Размышления', 'Thinking'], ['Нет подробностей.', 'No details.'], ['Разрешено', 'Allowed'], ['Разрешено до конца сессии', 'Allowed for this session'], ['Отклонено', 'Denied'], ['Запрос устарел', 'Request expired'],
    ['Разрешить', 'Allow'], ['Разрешать всегда', 'Always allow'], ['Запретить', 'Deny'], ['Агент работает', 'Agent is working'], ['Остановлено.', 'Stopped.'], ['Копировать', 'Copy'], ['Скопировано', 'Copied'],
    [' вход · ', ' in · '], [' выход', ' out'], ['Убрать ', 'Remove '], ['вставка-', 'pasted-'], ['код', 'code'], ['Ошибка', 'Error'], ['Подробностей нет.', 'No details.'],
    ['РАЗМЫШЛЯЕТ', 'THINKING'], ['Агент собирается с мыслями…', 'The agent is gathering its thoughts…'], ['Ждёт подтверждения: ', 'Waiting for approval: '], ['ОТВЕТ', 'REPLY'],
    ['Отпустите файлы, чтобы прикрепить', 'Drop files to attach'], ['Прикрепить файлы', 'Attach files'], ['Отправить', 'Send'], ['Остановить', 'Stop'], ['Сообщение', 'Message'],
    ['Enter — отправить · Shift+Enter — новая строка', 'Enter — send · Shift+Enter — new line'], ['Режим', 'Mode'], ['Модель', 'Model'], ['Уровень размышлений', 'Reasoning level'], ['Агент', 'Agent'],
    // терминал
    ['установка Claude', 'installing Claude'], ['установка SDK', 'installing SDK'], ['установка Codex', 'installing Codex'], ['Готово. Вернитесь в Stella.', 'Done. Return to Stella.'],
    ['Терминалы', 'Terminals'], ['Скрыть терминалы', 'Hide terminals'], ['Нет открытых терминалов.', 'No open terminals.'], ['Не удалось открыть терминал: ', 'Could not open terminal: '],
    ['[сессия завершена, код ', '[session ended, code '], ['код выхода ', 'exit code '],
    // студия
    ['Квадрат 1024×1024', 'Square 1024×1024'], ['Широкая 16:9', 'Wide 16:9'], ['Вертикальная 9:16', 'Vertical 9:16'], ['Альбомная 4:3', 'Landscape 4:3'], ['Портретная 3:4', 'Portrait 3:4'], ['Большая 1536×1536', 'Large 1536×1536'],
    [' нейронов', ' neurons'], [' · хватит ещё примерно на ', ' · enough for about '], [' шт.', ' pcs.'], ['Использовано ≈ ', 'Used ≈ '], [' из ', ' of '], [' нейронов · картинок сегодня: ', ' neurons · images today: '],
    [' · обновление в 03:00 МСК. Это оценка Stella по ценам Cloudflare.', ' · resets at 03:00 MSK. This is Stella\'s estimate based on Cloudflare pricing.'],
    ['Подключите Cloudflare — это бесплатно', 'Connect Cloudflare — it\'s free'], ['Зарегистрируйтесь на Cloudflare (карта не нужна).', 'Sign up at Cloudflare (no card needed).'],
    ['В панели Cloudflare откройте раздел ', 'In the Cloudflare dashboard open '], ['и выберите ', 'and choose '], ['Скопируйте ', 'Copy '], [' и нажмите ', ' and click '], [', затем скопируйте токен.', ', then copy the token.'],
    ['Вставьте оба значения ниже.', 'Paste both values below.'], ['Открыть панель Cloudflare', 'Open Cloudflare dashboard'], ['32 символа', '32 characters'], ['API-токен', 'API token'], ['токен Workers AI', 'Workers AI token'],
    ['Сохранить и подключить', 'Save and connect'], ['Нужны оба значения: Account ID и токен.', 'Both values are required: Account ID and token.'], ['Cloudflare подключён. Можно создавать картинки.', 'Cloudflare connected. You can create images.'],
    ['СИНТЕЗ · 0 С', 'SYNTHESIS · 0 S'], ['СИНТЕЗ · ', 'SYNTHESIS · '], [' С', ' S'], ['СИНТЕЗ', 'SYNTHESIS'], ['Ещё вариант', 'Another variant'], ['Запрос', 'Prompt'], ['В папке', 'In folder'], ['Точно?', 'Sure?'],
    ['Здесь появятся ваши картинки. Опишите идею выше и нажмите «Создать».', 'Your images will appear here. Describe an idea above and press Create.'], ['Сначала подключите Cloudflare.', 'Connect Cloudflare first.'],
    ['Студия не подключена: нужен бесплатный аккаунт Cloudflare.', 'Studio is not connected: a free Cloudflare account is required.'], ['Генерация FLUX', 'FLUX generation'], ['Запрос для модели: ', 'Prompt for the model: '],
    ['СИНТЕЗ ИЗОБРАЖЕНИЯ · ', 'IMAGE SYNTHESIS · '], ['Открыть студию', 'Open studio'], ['Студия изображений', 'Image studio'],
    ['FLUX · CLOUDFLARE WORKERS AI · БЕСПЛАТНО С ДНЕВНЫМ ЛИМИТОМ', 'FLUX · CLOUDFLARE WORKERS AI · FREE WITH A DAILY LIMIT'], ['ЛИМИТ НА СЕГОДНЯ', 'TODAY\'S LIMIT'], ['Описание картинки', 'Image description'],
    ['Опишите картинку: например, неоновый город ночью под дождём, вид сверху, кинематографичный свет', 'Describe the image: e.g. a neon city at night in the rain, top view, cinematic light'],
    ['FLUX.1 schnell — быстрая', 'FLUX.1 schnell — fast'], ['FLUX.2 klein — качественнее', 'FLUX.2 klein — higher quality'], ['Размер', 'Size'], ['Шаги', 'Steps'], ['4 шага', '4 steps'], ['6 шагов', '6 steps'], ['8 шагов', '8 steps'],
    ['Количество', 'Count'], ['1 картинка', '1 image'], ['2 варианта', '2 variants'], ['4 варианта', '4 variants'], ['Перевести запрос на английский', 'Translate prompt to English'], ['Создать', 'Create'], ['seed (случайный)', 'seed (random)'],
    // мостик
    ['Задача для агентов', 'Task for agents'], ['Запустить', 'Run'], ['МОСТИК', 'BRIDGE'], ['Кому отправить', 'Send to'], ['Отметьте хотя бы одного агента.', 'Select at least one agent.'],
    ['Мостик — живая работа агентов (Ctrl+B)', 'Bridge — live agent work (Ctrl+B)'], ['Показать или скрыть панель системы', 'Show or hide the system panel'], ['Панель системы', 'System panel'],
    ['Задача для отмеченных агентов — например, сделай сайт-визитку в папке site', 'Task for the selected agents — e.g. build a landing page in the site folder'],
    ['Здесь видно, как агенты работают прямо сейчас: код печатается по символам, команды выводят результат, сайт собирается в превью, а каждый шаг загорается звездой на линии внизу.',
      'See how agents work right now: code is typed character by character, commands print their output, the site builds in the preview, and each step lights up as a star on the line below.'],
    ['Дайте задачу сразу нескольким агентам выше — или просто начните работу в любом чате: она появится здесь сама.', 'Give a task to several agents above — or just start working in any chat: it will appear here by itself.'],
    ['Остановить агента', 'Stop agent'], ['Открыть чат', 'Open chat'], ['Убрать дорожку', 'Remove lane'], ['Живое', 'Live'], ['Превью', 'Preview'], ['Шаги агента', 'Agent steps'], ['ОСТАНОВЛЕН', 'STOPPED'], [' с', ' s'],
    ['шаги агента появятся здесь', 'agent steps will appear here'], ['СОЗДАЁТ', 'CREATING'], ['ПРАВИТ', 'EDITING'], ['ИЗМЕНИЛ', 'EDITED'], [' симв.', ' chars'], ['Вернуться к живому', 'Back to live'], ['Задача', 'Task'],
    ['Предпросмотр', 'Preview'], ['Остановить', 'Stop'],
    // настройки
    ['Через аккаунт ChatGPT (вход как в Codex, без доплат)', 'Via ChatGPT account (sign in as in Codex, no extra charge)'], [' Через аккаунт ChatGPT (вход как в Codex, без доплат)', ' Via ChatGPT account (sign in as in Codex, no extra charge)'],
    [' Через OpenAI API-ключ (оплата по токенам)', ' Via OpenAI API key (pay per token)'], ['Модель для чата (пусто — по умолчанию)', 'Chat model (empty — default)'], ['например, gpt-5', 'e.g. gpt-5'],
    ['API-ключ OpenAI', 'OpenAI API key'], ['Сохранить', 'Save'], ['Модель API', 'API model'], ['Загрузить список', 'Load list'], ['Ключ сохранён в зашифрованном виде.', 'The key is stored encrypted.'],
    ['Ключ не задан. Его можно создать на platform.openai.com.', 'No key set. You can create one at platform.openai.com.'], ['Ключ сохранён.', 'Key saved.'], ['Не удалось сохранить ключ: ', 'Could not save the key: '],
    ['Найдено моделей: ', 'Models found: '], ['Не удалось получить список моделей. Проверьте ключ.', 'Could not get the model list. Check the key.'],
    ['СТУДИЯ · CLOUDFLARE', 'STUDIO · CLOUDFLARE'], ['API-токен Workers AI', 'Workers AI API token'], ['новый токен', 'new token'], ['Токен сохранён в зашифрованном виде.', 'The token is stored encrypted.'],
    ['Токен не задан.', 'No token set.'], ['Токен сохранён.', 'Token saved.'], ['Токен удалён.', 'Token removed.'], ['АГЕНТЫ', 'AGENTS'],
    ['Модель Claude (пусто — по умолчанию)', 'Claude model (empty — default)'], ['например, opus или sonnet', 'e.g. opus or sonnet'], ['Модель Codex (пусто — по умолчанию)', 'Codex model (empty — default)'],
    ['Путь к claude.exe (если не находится сам)', 'Path to claude.exe (if not found automatically)'], ['найден автоматически', 'found automatically'], ['Путь к codex.js (если не находится сам)', 'Path to codex.js (if not found automatically)'],
    ['ПРИЛОЖЕНИЕ', 'APPLICATION'], ['Горячая клавиша вызова Stella (нажмите сочетание)', 'Hotkey to show Stella (press a combination)'], ['Работает из любой программы: показывает или прячет окно.', 'Works from any app: shows or hides the window.'],
    [' При закрытии окна сворачивать в трей', ' Minimize to tray when the window is closed'], [' Запускать Stella вместе с Windows (в трее)', ' Start Stella with Windows (in tray)'],
    [' Уведомления о готовых ответах и запросах подтверждения', ' Notifications for finished replies and approval requests'], ['Нужен хотя бы один модификатор: Ctrl, Alt или Shift.', 'At least one modifier is required: Ctrl, Alt or Shift.'],
    ['Горячая клавиша: ', 'Hotkey: '], ['Это сочетание занято другой программой.', 'This combination is used by another program.'], ['ЯЗЫК', 'LANGUAGE'], ['Язык интерфейса', 'Interface language'],
    ['НАВЫКИ (быстрые задачи для Claude и Codex)', 'SKILLS (quick tasks for Claude and Codex)'], ['+ Добавить навык', '+ Add skill'], ['Название навыка', 'Skill name'], ['Текст задачи', 'Task text'], ['Удалить навык', 'Delete skill'], ['Новый навык', 'New skill'],
    ['ЛОКАЛЬНАЯ ПАМЯТЬ ПРОЕКТА', 'LOCAL PROJECT MEMORY'], [' Подмешивать заметки в новые чаты', ' Add notes to new chats'], ['Сохранить заметки', 'Save notes'],
    ['Короткие заметки по текущему проекту хранятся только на этом компьютере. Новый чат читает не всю старую переписку, а до ~2000 символов заметок. Кнопка «Перенести в новую сессию» в чате добавляет сюда итоги.',
      'Short notes about the current project are stored only on this computer. A new chat reads up to ~2000 characters of notes instead of the whole old conversation. The "Move to a new session" button in a chat adds a summary here.'],
    ['Заметки сохранены.', 'Notes saved.'], ['О ПРОГРАММЕ', 'ABOUT'], ['. Данные чатов хранятся только на этом компьютере. Панель разработчика: Ctrl+Shift+I.', '. Chat data is stored only on this computer. Developer tools: Ctrl+Shift+I.'],
    ['Проверить обновления', 'Check for updates'], ['Перезапустить для обновления до ', 'Restart to update to '],
    ['Установлена последняя версия (', 'You have the latest version ('], ['Не удалось проверить обновления', 'Could not check for updates'], ['Найдена версия ', 'Version found: '], [', скачиваю в фоне…', ', downloading in the background…'],
    ['Дождитесь ответа агента: при перезапуске он остановится.', 'Wait for the agent: it will stop on restart.'], ['Контрольная сумма не совпала', 'Checksum mismatch'],
    // расписание
    ['Пн', 'Mon'], ['Вт', 'Tue'], ['Ср', 'Wed'], ['Чт', 'Thu'], ['Пт', 'Fri'], ['Сб', 'Sat'], ['Вс', 'Sun'], ['каждый день', 'every day'], ['по будням', 'weekdays'],
    ['Задачи запускаются автоматически, пока Stella открыта или свёрнута в трей. Включите автозапуск в настройках, чтобы ничего не пропустить. Результат появится отдельным чатом.',
      'Tasks run automatically while Stella is open or minimized to the tray. Enable autostart in settings so nothing is missed. The result appears as a separate chat.'],
    ['Пока нет задач.', 'No tasks yet.'], ['Изменить', 'Edit'], ['Удалить задачу', 'Delete task'], ['Задача включена', 'Task enabled'], ['Включена', 'Enabled'], ['ИЗМЕНИТЬ ЗАДАЧУ', 'EDIT TASK'], ['НОВАЯ ЗАДАЧА', 'NEW TASK'],
    ['Название', 'Name'], ['Время', 'Time'], ['Папка проекта', 'Project folder'], ['Дни', 'Days'], ['Что сделать', 'What to do'],
    ['Для задач Claude в режиме «Спрашивать разрешение» Stella пришлёт уведомление, когда понадобится подтверждение.', 'For Claude tasks in "Ask permission" mode, Stella will send a notification when approval is needed.'],
    ['Добавить задачу', 'Add task'], ['Отмена', 'Cancel'], ['Задача сохранена.', 'Task saved.'], ['Задача добавлена.', 'Task added.'], ['По расписанию: ', 'Scheduled: '],
    // навыки по умолчанию
    ['Утренний бриф', 'Morning brief'], ['Ревью кода', 'Code review'], ['Разбор проекта', 'Project overview'], ['Починить тесты', 'Fix tests'], ['План недели', 'Weekly plan'], ['Объясни код', 'Explain the code'],
    ['Сделай короткий утренний бриф по этому проекту: что изменилось со вчера (git log, открытые TODO) и что стоит сделать сегодня.', 'Make a short morning brief for this project: what changed since yesterday (git log, open TODOs) and what is worth doing today.'],
    ['Проверь незакоммиченные изменения (git diff) и дай короткое ревью: баги, риски, что поправить.', 'Check the uncommitted changes (git diff) and give a short review: bugs, risks, what to fix.'],
    ['Изучи структуру этого проекта и опиши архитектуру, ключевые модули и слабые места.', 'Study this project\'s structure and describe the architecture, key modules and weak spots.'],
    ['Запусти тесты проекта, найди падающие и исправь их.', 'Run the project tests, find the failing ones and fix them.'],
    ['Посмотри TODO, issues и последние коммиты и предложи план работ на неделю.', 'Look at the TODOs, issues and recent commits and propose a work plan for the week.'],
    ['Объясни простыми словами, что делает этот проект и как его запустить.', 'Explain in simple terms what this project does and how to run it.'],
    ['Объясни простыми словами:', 'Explain in simple terms:'], ['Улучши этот текст, сохрани смысл:', 'Improve this text, keep the meaning:'], ['Переведи на английский:', 'Translate to English:'], ['Предложи 10 идей для', 'Suggest 10 ideas for'],
    // прочее из главного процесса
    ['Не удалось назначить горячую клавишу ', 'Could not set the hotkey '], ['Stella работает в фоне', 'Stella is running in the background'],
    ['Окно свёрнуто в трей. Выйти можно через значок в трее.', 'The window is minimized to the tray. Quit via the tray icon.'], ['Шифрование недоступно в этой системе', 'Encryption is not available on this system'],
    ['Это не файл', 'Not a file'], ['Файл не найден или недоступен', 'File not found or inaccessible'], ['Агент ещё отвечает в этом чате', 'The agent is still replying in this chat'], ['Чат не найден', 'Chat not found'],
    ['Сбой: ', 'Failure: '], ['Причина: ', 'Reason: '], ['Укажите Account ID и API-токен Cloudflare в настройках.', 'Enter your Cloudflare Account ID and API token in settings.'],
    ['Нет связи с Cloudflare: ', 'Cannot reach Cloudflare: '], ['. Проверьте интернет или VPN.', '. Check your internet or VPN.'], ['Cloudflare ответил ', 'Cloudflare replied '], ['. Проверьте токен и Account ID.', '. Check the token and Account ID.'],
    ['Ошибка Cloudflare', 'Cloudflare error'], ['Опишите, что нарисовать.', 'Describe what to draw.'], ['Cloudflare не вернул изображение.', 'Cloudflare returned no image.'],
    ['Codex не найден на компьютере. Установите его: npm.cmd install -g @openai/codex', 'Codex was not found on this computer. Install it: npm.cmd install -g @openai/codex'],
    ['Не удалось связаться с OpenAI: ', 'Could not reach OpenAI: '], ['OpenAI ответил ошибкой ', 'OpenAI replied with error ']
  ];

  const EXACT = new Map(PAIRS.map(([r, e]) => [r, e]));
  const FRAGS = PAIRS.filter(([r]) => r.trim().length >= 5).sort((a, b) => b[0].length - a[0].length);
  const GLOBAL = [[/(\d) из (\d)/g, '$1 of $2'], [/(\d) с(?=\s|$)/g, '$1 s'], [/(\d) С(?=\s|$)/g, '$1 S'], [/(\d) шт\./g, '$1 pcs.']];
  const RULES = [
    [/^Поиск среди (\d+) плагинов…$/, 'Search among $1 plugins…'],
    [/^Показаны первые (\d+) из (\d+)\. Уточните поиск\.$/, 'Showing the first $1 of $2. Refine your search.'],
    [/^Подробности: (.*)$/, 'Details: $1'],
    [/^(\d+) шт\.$/, '$1 pcs.']
  ];
  const CYR = /[А-Яа-яЁё]/;
  const SKIP_FRAG = 'textarea,input,pre,code,.md,.ci-title,.ci-sub,#chatTitle,.msg .user-text,.ti-text b,.skill,.skill-row';
  const ATTRS = ['placeholder', 'title', 'aria-label'];

  function translateText(s, allowFrag) {
    if (!CYR.test(s)) return s;
    const lead = s.match(/^\s*/)[0], trail = s.match(/\s*$/)[0], core = s.trim();
    if (EXACT.has(core)) return lead + EXACT.get(core) + trail;
    for (const [re, to] of RULES) if (re.test(core)) return lead + core.replace(re, to) + trail;
    if (!allowFrag) return s;
    let out = s;
    for (const [r, e] of FRAGS) if (out.includes(r)) out = out.split(r).join(e);
    for (const [re, to] of GLOBAL) out = out.replace(re, to);
    return out;
  }
  function inContent(el) {
    return !!(el && el.closest && el.closest(SKIP_FRAG));
  }
  function fixNode(n) {
    if (n.nodeType === 3) {
      const p = n.parentElement;
      if (!p || p.closest('script,style')) return;
      const t = translateText(n.nodeValue, !inContent(p) && !p.closest('.msg'));
      if (t !== n.nodeValue) n.nodeValue = t;
    } else if (n.nodeType === 1) {
      if (n.closest('script,style')) return;
      for (const a of ATTRS) if (n.hasAttribute(a)) { const v = n.getAttribute(a); const t = translateText(v, !inContent(n)); if (t !== v) n.setAttribute(a, t); }
      for (let c = n.firstChild; c; c = c.nextSibling) fixNode(c);
    }
  }
  let observer = null;
  function start() {
    if (lang !== 'en' || observer) return;
    document.title = translateText(document.title, true);
    fixNode(document.body);
    observer = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === 'childList') m.addedNodes.forEach(fixNode);
        else if (m.type === 'characterData') fixNode(m.target);
        else if (m.type === 'attributes') { const v = m.target.getAttribute(m.attributeName); const t = translateText(v || '', !inContent(m.target)); if (v && t !== v) m.target.setAttribute(m.attributeName, t); }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }

  window.I18N = {
    get lang() { return lang; },
    get locale() { return lang === 'en' ? 'en-US' : 'ru-RU'; },
    t: (s) => (lang === 'en' ? translateText(String(s), true) : s),
    // только точное совпадение (для пользовательского текста: промпты навыков)
    tx: (s) => (lang === 'en' ? translateText(String(s), false) : s),
    // Запоминаем язык синхронно (чтобы не мигал русский текст при следующем запуске).
    set(next) { try { localStorage.setItem(KEY, next); } catch (e) {} return next !== lang; },
    start
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
