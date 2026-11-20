# Voxel 3D — запуск на Render

Сайт собран как одно Node.js/Express-приложение: сервер раздаёт `public/` и проксирует запросы к API СДЭК и ЮKassa. Требуется Node.js 22 или новее.

## Локальный запуск

1. Скопируйте `.env.example` в `.env` и заполните значения.
2. Установите зависимости и запустите сервер:

   ```bash
   npm install
   node --env-file=.env server.js
   ```

3. Откройте `http://localhost:3000`.

В Render не загружайте `.env`: добавьте нужные значения в **Environment** сервиса. Секреты уже исключены из архива и кода.

## Публикация на Render.com

1. Загрузите содержимое архива в новый GitHub-репозиторий.
2. В Render выберите **New → Web Service** и подключите этот репозиторий.
3. Укажите **Runtime: Node**, **Build Command: `npm install`**, **Start Command: `npm start`**. Бесплатного плана достаточно для первичной проверки.
4. В **Environment** задайте переменные из `.env.example`. Для СДЭК нужны `CDEK_CLIENT_ID`, `CDEK_CLIENT_SECRET`, `CDEK_SENDER_CITY`; тестовый API — `https://api.edu.cdek.ru`, рабочий — `https://api.cdek.ru`.
5. После первого деплоя добавьте публичный URL Render в настройках уведомлений ЮKassa как `https://<ваш-сервис>.onrender.com/api/yookassa-webhook` и включите событие `payment.succeeded`.
6. Установите URL возврата оплаты на ваш Render-домен в кабинете ЮKassa, если для магазина настроено ограничение адресов. Код формирует `return_url` из `window.location.origin`.

Сервер использует `process.env.PORT || 3000` и слушает `0.0.0.0`. API сайта остаются относительными: `/api/cdek/...`, `/api/create-payment`, `/api/yookassa-webhook`.

## API

- `GET /api/cdek/status` — готовность калькулятора.
- `GET /api/cdek/cities?name=Краснодар` — поиск города.
- `GET /api/cdek/delivery-points?city_code=...` — ПВЗ выбранного города.
- `POST /api/cdek/rates` — расчёт тарифов. JSON: `city_code`, `weight_g`, необязательные `length_cm`, `width_cm`, `height_cm`, `delivery_point`.
- `POST /api/create-payment` — создать платёж и получить `confirmation_url`. JSON: `amount_rub`, `customer_email`, `description`, `return_url`, `legal_consent: true`. Сумма валидируется на сервере в диапазоне 1–300 000 ₽.
- `POST /api/yookassa-webhook` — уведомления ЮKassa. Сервер повторно запрашивает платёж у ЮKassa и проверяет `succeeded` и `paid`; одного входящего webhook-сообщения недостаточно для подтверждения.
- `GET /healthz` — проверка доступности сервера.

## Важно о чеках самозанятого

ЮKassa указывает, что самозанятый регистрирует доход и формирует чек в приложении «Мой налог»; автоматическая отправка такого чека через ЮKassa недоступна. Поэтому рекомендуемый режим `YOOKASSA_RECEIPT_MODE=manual`: webhook может отправить вам напоминание в Telegram, если заданы `TELEGRAM_BOT_TOKEN` и `TELEGRAM_CHAT_ID`, но чек в «Мой налог» нужно оформить отдельно.

В режиме `external` сервер прикладывает к запросу ЮKassa объект `receipt` с e-mail покупателя, позицией, суммой, НДС и признаками расчёта. Включайте его только если для вашего магазина подключена совместимая внешняя касса и параметры соответствуют договору и типу оплаты. Настройки чека — `YOOKASSA_VAT_CODE`, `YOOKASSA_PAYMENT_MODE`, `YOOKASSA_PAYMENT_SUBJECT`. Режим внешнего `receipt` не заменяет регистрацию дохода в «Мой налог».

## Бесплатный план Render

Бесплатный веб-сервис засыпает после 15 минут без входящих запросов и может запускаться около минуты после простоя. Файловая система временная, поэтому эта сборка не сохраняет заказы и состояние платежей на диск. Настройте webhook ЮKassa и уведомления; если нужна гарантированная быстрая обработка платежных webhook без холодного старта, используйте постоянно работающий тариф.

## Отзывы покупателей

Новые отзывы с фото публикуются автоматически. Владелец скрывает и восстанавливает их через [панель модерации](https://voxel-3d-reviews-api.satinhyacinth.chatgpt.site/moderate) после входа в ChatGPT под аккаунтом владельца. Скрытый отзыв и его фото больше не выдаются публично.

[Форма отзыва](https://voxel-3d.github.io/reviews/) и [страница опубликованных отзывов](https://voxel-3d.github.io/reviews/published/) обслуживаются GitHub Pages. API отзывов и хранилище фото развёрнуты отдельно, на https://voxel-3d-reviews-api.satinhyacinth.chatgpt.site. Доступ к действиям модератора на сервере ограничен аккаунтом владельца.

Ранее опубликованные отзывы видны в той же панели. Исходный архив остаётся в `reviews/published.ndjson`, а правки и видимость сохраняются через панель.
