# Kinpass: публикация через GitHub

Код лежит в репозитории GitHub. Каждый `git push` в ветку `main` сам запускает публикацию (GitHub Actions):

1. тесты;
2. база данных и сервер в Supabase;
3. сайт приложения на GitHub Pages;
4. кнопка **Открыть Kinpass** в меню бота.

Токены хранятся в секретах репозитория GitHub — не в коде и не в чате.

## 1. Бот: BotFather

1. Открой [@BotFather](https://t.me/BotFather), отправь `/newbot`.
2. Укажи название и имя бота с окончанием `bot`.
3. Сохрани токен — это `BOT_TOKEN`. Никому его не отправляй.

## 2. Supabase: проект и токен

1. В [Supabase Dashboard](https://supabase.com/dashboard) создай проект **Kinpass**.
2. Пароль базы данных сохрани — это `SUPABASE_DB_PASSWORD`.
3. **Project ID / Reference ID** (20 латинских букв из адреса после `/project/`) — это `SUPABASE_PROJECT_REF`.
4. В [Access Tokens](https://supabase.com/dashboard/account/tokens) создай токен для этого проекта — это `SUPABASE_ACCESS_TOKEN`:

| Разрешение | Значение |
| --- | --- |
| Project Settings | Read |
| API Keys | Read |
| API Key Secrets | Read |
| Edge Functions | Read-write |
| Edge Function Secrets | Read-write |

## 3. Программы на Mac (один раз)

```sh
git --version
```

Если Mac предложит установить Command Line Tools — согласись.

Установи GitHub CLI: установщик `.pkg` с [cli.github.com](https://cli.github.com) или `brew install gh`. Затем войди в аккаунт:

```sh
gh auth login
```

Выбери: **GitHub.com → HTTPS → Login with a web browser**.

## 4. Первая публикация (один раз)

```sh
cd ~/Desktop/passmd
git init -b main
git add .
git commit -m "Kinpass: первая версия"
gh repo create kinpass --public --source=. --remote=origin
gh api -X POST "repos/{owner}/{repo}/pages" -f build_type=workflow
```

Последняя команда включает GitHub Pages в режиме «GitHub Actions». Теперь добавь четыре секрета. Каждая команда попросит вставить значение — оно не отображается на экране:

```sh
gh secret set BOT_TOKEN
gh secret set SUPABASE_ACCESS_TOKEN
gh secret set SUPABASE_DB_PASSWORD
gh secret set SUPABASE_PROJECT_REF
```

И отправь код:

```sh
git push -u origin main
gh run watch
```

`gh run watch` показывает публикацию по шагам. Через 3–5 минут приложение будет по адресу:

```text
https://ТВОЙ_ЛОГИН.github.io/kinpass/mini.html
```

## 5. Обновления

Поменял код — отправь его:

```sh
git add .
git commit -m "Что изменил"
git push
```

Всё остальное — база, сервер, сайт и кнопка бота — обновится само. Статус: `gh run watch` или вкладка **Actions** в репозитории.

Если поменялся токен или пароль — обнови секрет (`gh secret set ИМЯ`) и перезапусти публикацию: `gh workflow run deploy.yml`.

## 6. Открыть в Telegram

Открой своего бота, нажми **Start**, затем кнопку **Открыть Kinpass** рядом со строкой сообщения. При первом входе дело пустое. Добавь документ, закрой приложение и открой снова — запись загрузится из облака.

Приложение работает только из кнопки бота: сервер проверяет подпись Telegram. Обычная ссылка в Safari вход не даёт.

## Если публикация остановилась

Открой **Actions** → последний запуск → красный шаг.

| Шаг | Что сделать |
| --- | --- |
| Проверить секреты | Добавь недостающий секрет командой из ошибки. |
| Тесты | Код сломан — исправь и снова сделай push. |
| Supabase — база данных и сервер | 401/403 — проверь `SUPABASE_ACCESS_TOKEN` и его права. Ошибка пароля — `SUPABASE_DB_PASSWORD`. |
| Проверить сервер | Supabase → Edge Functions → kinpass-api → Logs. |
| configure-pages / Опубликовать | Settings → Pages → Source должен быть **GitHub Actions**. |
| Кнопка бота | Проверь `BOT_TOKEN`. |

## Что важно знать

- Репозиторий публичный — бесплатный GitHub Pages работает только так. Видно только код; документы, фото и токены в него не попадают.
- Дело привязано к Telegram ID. «Я», «Мама», «Дедушка» — разделы одного дела. Если мама зайдёт со своего Telegram, у неё будет своё отдельное дело.
- До 100 документов. Фото JPG, PNG или WEBP — до 3 МиБ, всего до 120 фото и 330 МиБ. Фото хранятся в закрытом хранилище Supabase; для просмотра выдаётся ссылка на 5 минут.
- Даты и список документов вводишь ты сам: приложение не знает официальных требований.
