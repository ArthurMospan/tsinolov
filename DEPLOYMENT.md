# Production deployment

У репозиторії є два підтримувані варіанти розгортання: Render з Turso та власний сервер із Docker Compose. Для конкурсного стенду використовується конфігурація `render.yaml`.

## Render + Turso

### 1. Створити базу

Створіть базу Turso та збережіть:

- `TURSO_DATABASE_URL`;
- `TURSO_AUTH_TOKEN`.

Схема створюється й доповнюється автоматично під час старту застосунку без видалення наявних даних.

### 2. Створити Telegram-бота

Через `@BotFather` отримайте `BOT_TOKEN`. Після першого deployment задайте Menu Button URL як публічну HTTPS-адресу сервісу.

### 3. Розгорнути Blueprint

Підключіть репозиторій до Render як Blueprint. `render.yaml` уже містить команди збірки, запуску та health check `/health`.

Додайте секретні змінні:

```env
BOT_TOKEN=...
WEBAPP_URL=https://your-service.onrender.com
TURSO_DATABASE_URL=libsql://...
TURSO_AUTH_TOKEN=...
```

`NODE_ENV=production` і `SERVER_HOST=0.0.0.0` задані в `render.yaml`.

Workflow `.github/workflows/keep-render-awake.yml` перевіряє production health endpoint кожні 10 хвилин. Якщо адреса сервісу зміниться, оновіть URL у workflow.

## Docker Compose + Caddy

### 1. Підготувати конфігурацію

```bash
cp .env.production.example .env.production
```

Заповніть:

```env
BOT_TOKEN=...
WEBAPP_URL=https://prices.example.com
SITE_ADDRESS=prices.example.com
TURSO_DATABASE_URL=libsql://...
TURSO_AUTH_TOKEN=...
DATABASE_PATH=/data/database.sqlite
NODE_ENV=production
```

Якщо Turso не задано, SQLite зберігається у змонтованому каталозі `./data`. Для одного production-інстансу цього достатньо; для кількох реплік потрібна Turso.

### 2. Запустити

```bash
docker compose -f docker-compose.production.yml up -d --build
```

Caddy автоматично отримує TLS-сертифікат і проксіює запити до Node.js застосунку.

### 3. Перевірити

```bash
curl --fail https://prices.example.com/health
docker compose -f docker-compose.production.yml logs -f app
```

Очікувана відповідь health endpoint:

```json
{"status":"ok","checkedAt":"..."}
```

## Оновлення

Render автоматично збирає нову версію після push у підключену гілку. Для Docker:

```bash
git pull
docker compose -f docker-compose.production.yml up -d --build
```

## Безпека

- не комітьте `.env`, токени, локальні БД, логи або tunnel-бінарники;
- `WEBAPP_URL` має точно збігатися з реальною HTTPS-адресою;
- API Mini App перевіряє підпис Telegram `initData`;
- регулярно створюйте backup production-бази.
