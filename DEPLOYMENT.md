# Постійний запуск у мережі

Для цього проєкту потрібен не “sleeping” web-хостинг, а невелика VM із постійним диском. У репозиторії вже є production-запуск через Docker Compose:

- застосунок і Telegram-бот працюють постійно;
- SQLite лежить у `./data/database.sqlite`, тому не зникає після рестарту контейнера;
- Caddy автоматично видає HTTPS-сертифікат;
- перевірки цін запускаються щохвилини та використовують реальний MCP Silpo;
- у Telegram сповіщення відправляються реальним Bot API.

## Render + Turso без Docker

Для Render Free використовуємо зовнішню Turso-базу. Локальну SQLite на Render не використовуємо: файлове сховище Render ephemeral і втрачається після sleep/restart. Render-конфігурація вже лежить у `render.yaml`.

У Render створи `New → Blueprint` і вибери репозиторій. Після створення сервісу додай у Environment Variables:

```env
BOT_TOKEN=реальний_токен_бота
WEBAPP_URL=https://твій-сервіс.onrender.com
TURSO_DATABASE_URL=libsql://твоя-база.turso.io
TURSO_AUTH_TOKEN=токен_Turso
```

Render сам підставить `PORT`, а застосунок слухає `0.0.0.0`. Docker для цього способу не потрібен.

Free web service може засинати після 15 хвилин без вхідного трафіку, тому для щохвилинного сканера потрібен зовнішній health ping. Це можна додати після першого успішного deploy.

## Постійна VM

Створи одну VM у Google Compute Engine класу `e2-micro` у дозволеному free-tier регіоні, встанови Docker і відкрий TCP-порти 80 та 443. Для безкоштовного тарифу потрібен billing account; постав бюджетне сповіщення і не створюй зайві ресурси.

На VM:

```bash
git clone <URL_РЕПОЗИТОРІЮ> silpo-ai-factory
cd silpo-ai-factory
cp .env.production.example .env.production
nano .env.production
mkdir -p data
docker compose --env-file .env.production -f docker-compose.production.yml up -d --build
```

У `.env.production` задай:

```env
BOT_TOKEN=реальний_токен_бота
WEBAPP_URL=https://твій_хост
SITE_ADDRESS=твій_хост
```

`SITE_ADDRESS` має бути hostname без `https://`. Якщо окремого домену немає, можна використати hostname виду `<ПУБЛІЧНИЙ_IP>.sslip.io`, який вказує на IP VM. Для стабільності IP краще зарезервувати або підключити власний домен.

Після першого запуску відкрий бота, натисни `/start`, пройди авторизацію Silpo і додай товар. Для реальної перевірки умови сповіщення вистав цільову ціну вище поточної: сервер одразу виконає перевірку та надішле повідомлення, якщо Telegram і MCP налаштовані правильно.

## Перевірка після запуску

```bash
docker compose -f docker-compose.production.yml ps
docker compose -f docker-compose.production.yml logs --tail=100 app
curl -I https://твій_хост
```

Не запускай `npm run db:init` на production-базі: це команда для явного скидання локальної схеми. Production-контейнер сам створює відсутні таблиці без видалення даних.
