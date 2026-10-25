# Примерный прогресс для Codex

Skill-плагин показывает одну задачу компактным блоком прогресса, несколько — полным пультом. Результат включает точную область, примерно оценённый процент/диапазон, принятую оценку checklist, стадию, evidence, препятствия и свежесть. Unknown остаётся неизвестным; общий процент требует явного состава и весов. Работа или потраченное время сами по себе не добавляют проценты.

Текущая версия распространения: **1.6.0**, закреплённый ref **v1.6.0**. Для одной задачи HTML показывает компактный круговой индикатор, линию этапов и кнопку «Подробнее». Раскрытый вид получил более спокойную иерархию: название задачи не повторяется, прогресс и состояние читаются вместе, а этапы образуют компактный вертикальный маршрут. Для нескольких задач полный пульт открыт сразу. Выбор полосы или круга, четырёх тем и показа этапов находится в закрытой по умолчанию панели «Настройки отображения». Кнопки тем — круглые пиктограммы без видимых подписей, с доступными названиями и подсказками. Примерную оценку можно подготовить по явному плану и подтверждённым шагам. [Репозиторий публичный](https://github.com/MaximillianVoss/codex-task-progress-plugin); для чтения и установки достаточно HTTPS.

В Codex с поддержкой inline-визуализации skill показывает графический результат в ленте беседы; текстовый Markdown остаётся запасным вариантом и форматом CLI по умолчанию. Закрепление блока над полем ввода в Codex не реализовано. Плагин не создаёт фоновые опросы, API-вызовы или записи в Planner. Нужен Node.js20+, установка npm-зависимостей не требуется.

## Если плагин уже подключён

Используйте доступный `$task-progress:task-progress` (либо `$task-progress`, если клиент показывает короткое имя). Не устанавливайте второй экземпляр ради нового чата. Для подготовки оценки из плана по обновлённой инструкции нужна версия не ниже 1.3.0. При обновлении проверьте существующий источник marketplace, версию и enabled только этого плагина.

Пример рабочего запроса: «Покажи примерный прогресс task TASK_ID из явно указанного файла `progress.safe.json`, сохрани источник и unknown». Для нескольких задач указать project/portfolio ID либо точные taskId. Данные должны отвечать [контракту](plugins/task-progress/skills/task-progress/references/contract.md). Если готовой оценки нет, но у задачи есть явный план и подтверждения выполненных шагов, агент сначала готовит отдельный безопасный снимок с примерной оценкой по этапам. Равные веса без весов в плане называют оценочным допущением; уже принятый checklist не заменяют.

## Установка в другой среде

Рекомендуется закреплённый tag, а для строгой повторяемости — SHA коммита из страницы Release. Не подменяйте установленный plugin cache вручную.

Для Windows с WSL:

```powershell
# Выберите свободную постоянную папку на X, вне OneDrive.
wsl -d Ubuntu-22.04 --exec git clone --branch v1.6.0 --single-branch https://github.com/MaximillianVoss/codex-task-progress-plugin.git /mnt/x/Проекты/codex-task-progress-plugin-install-v1.6.0
codex plugin marketplace add 'X:/Проекты/codex-task-progress-plugin-install-v1.6.0' --json
codex plugin add task-progress@task-progress-local --json
codex plugin list --marketplace task-progress-local --json
```

В новой Linux/macOS-среде:

```sh
git clone --branch v1.6.0 --single-branch https://github.com/MaximillianVoss/codex-task-progress-plugin.git ./codex-task-progress-plugin
codex plugin marketplace add ./codex-task-progress-plugin --json
codex plugin add task-progress@task-progress-local --json
codex plugin list --marketplace task-progress-local --json
```

Для записи в GitHub используйте существующий авторизованный SSH-профиль в WSL; для указанного клонирования он не требуется. Приватные ключи из этого проекта не копируются.

Marketplace называется `task-progress-local`; он указывает на локально проверенную копию из GitHub. Если такой источник уже зарегистрирован, сначала проверьте его существующий путь и версию; не заменяйте источник молча. Команда marketplace add только регистрирует источник, plugin add устанавливает плагин. Затем отдельно проверьте installed/enabled именно его карточки в Plugins.

Процедура не требует перезапуска приложения или изменений других плагинов. Автоматическое обновление каталога skills зависит от клиента: если skill не виден в текущем чате, рассчитывайте на следующую сессию либо явно прочитайте SKILL.md из фактической установленной копии и вызовите её renderer. Успешный пример не заменяет проверку installed/enabled.

Альтернатива: скачать ZIP из публичного GitHub Release, сверить размер/SHA256 по `release.safe.json`, распаковать в постоянную папку и зарегистрировать её как local marketplace.

## Проверка и сборка

Из корня репозитория:

```powershell
npm test
npm run example
pwsh -File scripts/Build-Release.ps1
```

Сборка не устанавливает плагин. Она проверяет код, собирает автономный ZIP с `.agents/plugins/marketplace.json` и `plugins/task-progress/`, извлекает пакет, сравнивает каждый файл и оба вывода renderer с исходниками. Результат — `dist/task-progress-1.6.0-marketplace.zip` и `dist/release.safe.json`. Публичная квитанция содержит только имя файла, размер, SHA256, версии и результаты проверок. Локальные абсолютные пути остаются в игнорируемых отчётах.

Для отдельной демонстрации:

```powershell
node plugins/task-progress/skills/task-progress/scripts/render.mjs --input plugins/task-progress/examples/single.safe.json --at 2026-10-21T12:10:00Z
node plugins/task-progress/skills/task-progress/scripts/render.mjs --input plugins/task-progress/examples/multiple.safe.json --at 2026-10-21T12:10:00Z --format html
node plugins/task-progress/skills/task-progress/scripts/render.mjs --input plugins/task-progress/examples/stages.safe.json --at 2026-10-21T12:10:00Z --format html --view ring --theme indigo --stages show
node plugins/task-progress/skills/task-progress/scripts/render.mjs --input plugins/task-progress/examples/plan.safe.json --at 2026-10-21T12:10:00Z --format html
```

Примеры синтетические. `--at` воспроизводит датированный пример, не освежает состояние. Для рабочих данных его не передавать.

HTML — автономный fragment без сети и сторонних ресурсов. Одна задача сначала видна компактно: круг с оценкой или явным неизвестным состоянием, линия этапов и кнопка «Подробнее» для раскрытия полного пульта. Для нескольких задач пульт открыт сразу. В полном виде панель «Настройки отображения» закрыта по умолчанию; внутри неё скрипт переключает только оформление: «Полоса»/«Круг», «Ночная»/«Светлая»/«Индиго»/«Лесная», показ этапов. Раскрытие пульта, настроек и подробностей этапов может быть плавным там, где клиент поддерживает анимацию; при `prefers-reduced-motion` или отсутствии такой поддержки остаётся обычное раскрытие. Начальные настройки задаются `--view bar|ring --theme night|light|indigo|forest --stages show|hide`. Skill сохраняет fragment в разрешённой папке текущего чата и показывает в ленте беседы; закрепления над вводом нет. Если клиент не поддерживает inline-визуализацию или разрешено только чтение, используйте Markdown. Renderer сам не пишет файлы. Источники и подробности раскрываются; неизвестное и устаревшее не превращаются в ноль.

Этапы поступают из `progress.stages`, когда оценка рассчитывается по весам, либо из необязательного `task.stages` с отдельным источником для пояснения фиксированного/примерного процента. Второй вариант не пересчитывает оценку. Без явного перечня показано «Этапы не переданы». Пример обоих способов — `examples/stages.safe.json`.

## Отключение

Отключить только «Примерный прогресс» в Plugins либо выполнить `codex plugin remove task-progress@task-progress-local`. Удалять marketplace командой `codex plugin marketplace remove task-progress-local` только если этот источник больше не нужен. Другие плагины, исходные задачи и Planner не изменяются.

Контракт, ограничения и правила evidence — в [SKILL.md](plugins/task-progress/skills/task-progress/SKILL.md) и [описании данных](plugins/task-progress/skills/task-progress/references/contract.md). Формат пакета — по [официальной документации OpenAI](https://developers.openai.com/plugins/build/plugins).
