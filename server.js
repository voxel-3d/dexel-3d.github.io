"use strict";

const express = require("express");
const { randomUUID } = require("node:crypto");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "24kb", type: "application/json" }));

const requestBuckets = new Map();
function limitRequests(name, maximum, windowMs = 60_000) {
  return (req, res, next) => {
    const now = Date.now();
    const key = `${name}:${req.ip || req.socket.remoteAddress || "unknown"}`;
    let bucket = requestBuckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      requestBuckets.set(key, bucket);
    }
    bucket.count += 1;
    if (requestBuckets.size > 5000) {
      for (const [storedKey, item] of requestBuckets) {
        if (item.resetAt <= now) requestBuckets.delete(storedKey);
      }
    }
    if (bucket.count > maximum) {
      return res.status(429).json({ error: "Слишком много запросов. Попробуйте позже." });
    }
    next();
  };
}

const publicDir = `${__dirname}/public`;
app.use(express.static(publicDir, { index: false, maxAge: "1h", fallthrough: true }));
app.get("/", (_req, res) => res.sendFile(`${publicDir}/index.html`));
app.get("/healthz", (_req, res) => res.json({ ok: true }));

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const allowedCdekHosts = new Set(["api.edu.cdek.ru", "api.cdek.ru"]);
function cdekSettings() {
  const clientId = process.env.CDEK_CLIENT_ID?.trim();
  const clientSecret = process.env.CDEK_CLIENT_SECRET?.trim();
  const senderCity = process.env.CDEK_SENDER_CITY?.trim();
  if (!clientId || !clientSecret || !senderCity) {
    throw new ApiError(503, "Расчёт СДЭК пока не настроен.");
  }
  let base;
  try {
    base = new URL(process.env.CDEK_API_URL || "https://api.edu.cdek.ru");
  } catch {
    throw new ApiError(503, "Адрес API СДЭК настроен неверно.");
  }
  if (base.protocol !== "https:" || !allowedCdekHosts.has(base.hostname) || !["", "/"].includes(base.pathname)) {
    throw new ApiError(503, "Адрес API СДЭК настроен неверно.");
  }
  base.pathname = "/";
  return { base, clientId, clientSecret, senderCity };
}

let cdekToken = null;
let cdekTokenExpiresAt = 0;
let cdekTokenPromise = null;
let senderCityCodeCache = null;
let senderCityCodeExpiresAt = 0;

async function cdekAccessToken() {
  const { base, clientId, clientSecret } = cdekSettings();
  if (cdekToken && cdekTokenExpiresAt > Date.now() + 60_000) return cdekToken;
  if (cdekTokenPromise) return cdekTokenPromise;
  cdekTokenPromise = (async () => {
    const tokenUrl = new URL("/v2/oauth/token", base);
    const form = new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret });
    let response;
    try {
      response = await fetch(tokenUrl, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
        body: form,
        redirect: "error",
        signal: AbortSignal.timeout(12_000),
      });
    } catch {
      throw new ApiError(502, "Не удалось связаться с API СДЭК.");
    }
    if (!response.ok) throw new ApiError(502, "СДЭК не принял данные авторизации.");
    const data = await response.json().catch(() => null);
    if (typeof data?.access_token !== "string" || !data.access_token) {
      throw new ApiError(502, "СДЭК вернул некорректный ответ авторизации.");
    }
    cdekToken = data.access_token;
    cdekTokenExpiresAt = Date.now() + Math.max(60, Number(data.expires_in) || 3600) * 1000;
    return cdekToken;
  })();
  try {
    return await cdekTokenPromise;
  } finally {
    cdekTokenPromise = null;
  }
}

async function cdekRequest(path, options = {}) {
  const { base } = cdekSettings();
  const token = await cdekAccessToken();
  const headers = { accept: "application/json", authorization: `Bearer ${token}` };
  if (options.body) headers["content-type"] = "application/json";
  if (process.env.CDEK_DEVELOPER_KEY?.trim()) headers["developer-key"] = process.env.CDEK_DEVELOPER_KEY.trim();
  let response;
  try {
    response = await fetch(new URL(path, base), {
      ...options,
      headers: { ...headers, ...options.headers },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new ApiError(502, "Не удалось связаться с API СДЭК.");
  }
  if (!response.ok) throw new ApiError(502, "СДЭК не смог выполнить запрос. Проверьте настройки и попробуйте позже.");
  return response.json().catch(() => { throw new ApiError(502, "СДЭК вернул некорректный ответ."); });
}

async function cdekSenderCityCode() {
  if (senderCityCodeCache && senderCityCodeExpiresAt > Date.now()) return senderCityCodeCache;
  const { senderCity } = cdekSettings();
  const query = new URLSearchParams({ name: senderCity, country_code: "RU" });
  const result = await cdekRequest(`/v2/location/suggest/cities?${query}`);
  const candidates = Array.isArray(result) ? result : Array.isArray(result?.cities) ? result.cities : Array.isArray(result?.items) ? result.items : [];
  const city = candidates.find((item) => Number.isInteger(Number(item?.code)) && Number(item.code) > 0);
  if (!city) throw new ApiError(503, "Не удалось найти город отправления СДЭК. Уточните CDEK_SENDER_CITY.");
  senderCityCodeCache = Number(city.code);
  senderCityCodeExpiresAt = Date.now() + 6 * 60 * 60 * 1000;
  return senderCityCodeCache;
}

function positiveInteger(value, max) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= max ? parsed : null;
}

function sendApiError(res, error, generic = "Не удалось выполнить запрос.") {
  if (error instanceof ApiError) return res.status(error.status).json({ error: error.message });
  return res.status(500).json({ error: generic });
}

app.get("/api/cdek/status", (_req, res) => {
  let ready = false;
  try {
    cdekSettings();
    ready = true;
  } catch {
    ready = false;
  }
  res.set("cache-control", "no-store").json({ ready });
});

app.get("/api/cdek/cities", limitRequests("cdek-cities", 30), async (req, res) => {
  const name = typeof req.query.name === "string" ? req.query.name.trim() : "";
  const countryCode = typeof req.query.country_code === "string" ? req.query.country_code.trim().toUpperCase() : "RU";
  if (name.length < 2 || name.length > 100 || !/^[A-Z]{2}$/.test(countryCode)) {
    return res.status(400).json({ error: "Укажите название города (от 2 символов)." });
  }
  try {
    const query = new URLSearchParams({ name, country_code: countryCode });
    const result = await cdekRequest(`/v2/location/suggest/cities?${query}`);
    const candidates = Array.isArray(result) ? result : Array.isArray(result?.cities) ? result.cities : Array.isArray(result?.items) ? result.items : (result && "code" in result ? [result] : []);
    const cities = candidates
      .filter((city) => Number.isInteger(Number(city?.code)) && typeof city?.full_name === "string")
      .slice(0, 10)
      .map((city) => ({ code: Number(city.code), name: city.full_name, countryCode: city.country_code || countryCode }));
    res.set("cache-control", "public, max-age=300").json({ cities });
  } catch (error) {
    sendApiError(res, error, "Не удалось найти город.");
  }
});

app.get("/api/cdek/delivery-points", limitRequests("cdek-pvz", 20), async (req, res) => {
  const cityCode = positiveInteger(req.query.city_code, 999_999_999);
  if (!cityCode) return res.status(400).json({ error: "Выберите город из списка СДЭК." });
  try {
    const query = new URLSearchParams({ city_code: String(cityCode), country_code: "RU", type: "PVZ", lang: "rus" });
    const result = await cdekRequest(`/v2/deliverypoints?${query}`);
    const candidates = Array.isArray(result) ? result : Array.isArray(result?.items) ? result.items : [];
    const deliveryPoints = candidates
      .filter((office) => typeof office?.code === "string")
      .slice(0, 100)
      .map((office) => ({
        code: office.code,
        name: String(office.name || "Пункт выдачи СДЭК"),
        address: String(office.location?.address_full || office.location?.address || office.address || "Адрес уточняется"),
        city: String(office.location?.city || office.location?.city_name || ""),
        workTime: String(office.work_time || ""),
      }));
    res.set("cache-control", "public, max-age=300").json({ deliveryPoints });
  } catch (error) {
    sendApiError(res, error, "Не удалось загрузить пункты выдачи.");
  }
});

app.post("/api/cdek/rates", limitRequests("cdek-rates", 8), async (req, res) => {
  const cityCode = positiveInteger(req.body?.city_code, 999_999_999);
  const weight = positiveInteger(req.body?.weight_g, 1_000_000);
  const rawDimensions = [req.body?.length_cm, req.body?.width_cm, req.body?.height_cm];
  const hasDimensions = rawDimensions.some((value) => value !== undefined && value !== null && value !== "");
  const dimensions = rawDimensions.map((value) => value === undefined || value === null || value === "" ? null : positiveInteger(value, 500));
  const deliveryPoint = typeof req.body?.delivery_point === "string" ? req.body.delivery_point.trim() : "";
  if (!cityCode || !weight || (hasDimensions && dimensions.some((value) => value === null)) ||
      (req.body?.delivery_point !== undefined && !/^[A-Z0-9_-]{2,32}$/i.test(deliveryPoint))) {
    return res.status(400).json({ error: "Проверьте код города, вес и размеры упаковки." });
  }
  try {
    const packageInfo = { weight };
    if (hasDimensions) [packageInfo.length, packageInfo.width, packageInfo.height] = dimensions;
    const result = await cdekRequest("/v2/calculator/tarifflist", {
      method: "POST",
      body: JSON.stringify({
        type: 1,
        lang: "rus",
        from_location: { code: await cdekSenderCityCode(), country_code: "RU" },
        to_location: { code: cityCode, country_code: "RU" },
        ...(deliveryPoint ? { delivery_point: deliveryPoint } : {}),
        packages: [packageInfo],
      }),
    });
    const tariffs = Array.isArray(result?.tariff_codes)
      ? result.tariff_codes.filter((tariff) => Number.isFinite(Number(tariff?.delivery_sum))).slice(0, 12).map((tariff) => ({
          code: Number(tariff.tariff_code),
          name: String(tariff.tariff_name || "Тариф СДЭК"),
          deliveryMode: Number(tariff.delivery_mode),
          price: Number(tariff.delivery_sum),
          currency: "RUB",
          daysMin: Number(tariff.period_min) || null,
          daysMax: Number(tariff.period_max) || null,
        }))
      : [];
    res.set("cache-control", "no-store").json({ tariffs });
  } catch (error) {
    sendApiError(res, error, "Не удалось рассчитать доставку СДЭК.");
  }
});

function yooKassaSettings() {
  const shopId = process.env.YOOKASSA_SHOP_ID?.trim();
  const secretKey = process.env.YOOKASSA_SECRET_KEY?.trim();
  if (!shopId || !secretKey) throw new ApiError(503, "Онлайн-оплата пока не настроена.");
  return { shopId, secretKey };
}

function sameOriginReturnUrl(req, value) {
  if (typeof value !== "string" || value.length > 500) return null;
  try {
    const url = new URL(value);
    const requestOrigin = `${req.protocol}://${req.get("host")}`;
    if (url.origin !== requestOrigin || !["http:", "https:"].includes(url.protocol)) return null;
    if (process.env.NODE_ENV === "production" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

async function yooKassaRequest(path, options = {}) {
  const { shopId, secretKey } = yooKassaSettings();
  let response;
  try {
    response = await fetch(`https://api.yookassa.ru/v3${path}`, {
      ...options,
      headers: {
        accept: "application/json",
        authorization: `Basic ${Buffer.from(`${shopId}:${secretKey}`).toString("base64")}`,
        ...(options.body ? { "content-type": "application/json" } : {}),
        ...options.headers,
      },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new ApiError(502, "Не удалось связаться с ЮKassa.");
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    console.error("YooKassa API request failed", response.status, payload?.type || "unknown_error");
    throw new ApiError(502, "ЮKassa не смогла создать платёж. Проверьте настройки магазина.");
  }
  return payload;
}

function buildReceipt(amountValue, email, description) {
  const vatCode = Number(process.env.YOOKASSA_VAT_CODE || "1");
  const paymentMode = process.env.YOOKASSA_PAYMENT_MODE || "full_prepayment";
  const paymentSubject = process.env.YOOKASSA_PAYMENT_SUBJECT || "commodity";
  if (!Number.isInteger(vatCode) || vatCode < 1 || vatCode > 12) throw new ApiError(503, "Проверьте YOOKASSA_VAT_CODE.");
  if (!new Set(["full_prepayment", "full_payment"]).has(paymentMode)) throw new ApiError(503, "Проверьте YOOKASSA_PAYMENT_MODE.");
  if (!new Set(["commodity", "service", "job"]).has(paymentSubject)) throw new ApiError(503, "Проверьте YOOKASSA_PAYMENT_SUBJECT.");
  return {
    customer: { email },
    items: [{
      description,
      quantity: 1.000,
      amount: { value: amountValue, currency: "RUB" },
      vat_code: vatCode,
      payment_mode: paymentMode,
      payment_subject: paymentSubject,
    }],
  };
}

app.post("/api/create-payment", limitRequests("create-payment", 6), async (req, res) => {
  const amountRub = Number(req.body?.amount_rub);
  const email = typeof req.body?.customer_email === "string" ? req.body.customer_email.trim().toLowerCase() : "";
  const description = typeof req.body?.description === "string" ? req.body.description.replace(/[<>\r\n]/g, " ").trim().replace(/\s+/g, " ").slice(0, 128) : "";
  const returnUrl = sameOriginReturnUrl(req, req.body?.return_url);
  if (!Number.isInteger(amountRub) || amountRub < 1 || amountRub > 300_000) {
    return res.status(400).json({ error: "Укажите сумму предоплаты от 1 до 300 000 ₽." });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return res.status(400).json({ error: "Укажите корректный e-mail для связи." });
  }
  if (description.length < 3) return res.status(400).json({ error: "Добавьте краткое описание заказа." });
  if (!returnUrl) return res.status(400).json({ error: "Адрес возврата должен совпадать с адресом сайта." });
  if (req.body?.legal_consent !== true) return res.status(400).json({ error: "Перед оплатой подтвердите согласие с документами." });

  try {
    const amountValue = `${amountRub.toFixed(2)}`;
    const receipt = buildReceipt(amountValue, email, description);
    const receiptMode = (process.env.YOOKASSA_RECEIPT_MODE || "manual").trim().toLowerCase();
    if (!new Set(["manual", "external"]).has(receiptMode)) throw new ApiError(503, "Проверьте YOOKASSA_RECEIPT_MODE.");
    const orderId = randomUUID();
    const paymentBody = {
      amount: { value: amountValue, currency: "RUB" },
      confirmation: { type: "redirect", return_url: returnUrl },
      capture: true,
      description,
      metadata: {
        voxel_order_id: orderId,
        receipt_mode: receiptMode,
        legal_consent: "true",
      },
      ...(receiptMode === "external" ? { receipt } : {}),
    };
    const payment = await yooKassaRequest("/payments", {
      method: "POST",
      headers: { "Idempotence-Key": randomUUID() },
      body: JSON.stringify(paymentBody),
    });
    const confirmationUrl = payment?.confirmation?.confirmation_url;
    if (typeof confirmationUrl !== "string" || !confirmationUrl.startsWith("https://")) {
      throw new ApiError(502, "ЮKassa не вернула ссылку для оплаты.");
    }
    res.status(201).json({
      payment_id: payment.id,
      confirmation_url: confirmationUrl,
      amount: payment.amount?.value || amountValue,
      currency: payment.amount?.currency || "RUB",
      receipt_mode: receiptMode,
      receipt_data_prepared: receiptMode === "external",
    });
  } catch (error) {
    sendApiError(res, error, "Не удалось создать платёж.");
  }
});

const recentWebhookIds = new Map();
async function notifyTelegram(payment) {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
  if (!token || !chatId) return;
  const amount = payment.amount?.value ? `${payment.amount.value} ${payment.amount.currency || "RUB"}` : "сумма неизвестна";
  const lines = [
    "✅ Оплата DEXEL 3D подтверждена",
    `Платёж: ${String(payment.id || "").slice(0, 48)}`,
    `Сумма: ${amount}`,
    `Заказ: ${String(payment.description || "").slice(0, 128)}`,
    (process.env.YOOKASSA_RECEIPT_MODE || "manual").trim().toLowerCase() === "manual"
      ? "Напоминание: зарегистрируйте доход и сформируйте чек в «Мой налог»."
      : "Проверьте статус регистрации чека в кабинете ЮKassa.",
  ];
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: lines.join("\n") }),
      redirect: "error",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) console.error("Telegram notification failed", response.status);
  } catch {
    console.error("Telegram notification failed");
  }
}

app.post("/api/yookassa-webhook", limitRequests("yookassa-webhook", 60), async (req, res) => {
  const event = req.body?.event;
  const paymentId = req.body?.object?.id;
  if (typeof event !== "string" || !event.startsWith("payment.")) return res.status(200).json({ ok: true });
  if (event !== "payment.succeeded" || typeof paymentId !== "string" || !/^[a-zA-Z0-9-]{10,80}$/.test(paymentId)) {
    return res.status(200).json({ ok: true });
  }
  try {
    const payment = await yooKassaRequest(`/payments/${encodeURIComponent(paymentId)}`);
    if (payment?.status !== "succeeded" || payment?.paid !== true || !payment?.metadata?.voxel_order_id) {
      return res.status(200).json({ ok: true });
    }
    const now = Date.now();
    for (const [id, expiresAt] of recentWebhookIds) if (expiresAt <= now) recentWebhookIds.delete(id);
    if (!recentWebhookIds.has(paymentId)) {
      recentWebhookIds.set(paymentId, now + 24 * 60 * 60 * 1000);
      await notifyTelegram(payment);
      console.info("YooKassa payment confirmed", paymentId, payment.amount?.value || "");
    }
    res.status(200).json({ ok: true });
  } catch (error) {
    if (error instanceof ApiError && error.status === 503) return res.status(503).json({ error: error.message });
    console.error("YooKassa webhook verification failed");
    res.status(503).json({ error: "Не удалось проверить уведомление ЮKassa." });
  }
});

app.use((err, _req, res, _next) => {
  if (err?.type === "entity.too.large") return res.status(413).json({ error: "Слишком большой запрос." });
  if (err instanceof SyntaxError && "body" in err) return res.status(400).json({ error: "Проверьте формат JSON." });
  console.error("Unhandled server error");
  res.status(500).json({ error: "Внутренняя ошибка сервера." });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`DEXEL 3D server listening on port ${PORT}`);
});
