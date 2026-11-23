/* DEXEL 3D. Deploy as Web App: execute as Me; access Anyone.
 * Script Properties: SUPABASE_URL, SUPABASE_ANON_KEY (public key, NOT service_role).
 * Authentication is checked against Supabase; never trust a user_id from the browser.
 */
const MODERATOR_EMAILS = ['igorkruk747@gmail.com'];
const FOLDER_ID = '1ZLyfOh_iJ-qmSKeU9YsA4g6rw-fTDIi1';
const MAX_STL_BYTES = 20 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DRIVE_ID = /^[A-Za-z0-9_-]{10,160}$/;

function config_() {
  const p = PropertiesService.getScriptProperties();
  const url = (p.getProperty('SUPABASE_URL') || '').replace(/\/$/, '');
  const key = p.getProperty('SUPABASE_ANON_KEY');
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url) || !key) throw new Error('Настройте Script Properties: SUPABASE_URL и SUPABASE_ANON_KEY.');
  return {url: url, key: key};
}
function api_(path, token) {
  const c = config_();
  const headers = {apikey: c.key};
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = UrlFetchApp.fetch(c.url + path, {headers: headers, muteHttpExceptions: true});
  if (r.getResponseCode() !== 200) throw new Error('Не удалось проверить права в Supabase. Войдите заново или повторите позже.');
  return JSON.parse(r.getContentText());
}
function authenticatedUser_(token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 8192) throw new Error('Войдите в личный кабинет.');
  const user = api_('/auth/v1/user', token);
  if (!UUID.test(user.id) || !user.email_confirmed_at) throw new Error('Подтвердите e-mail и войдите заново.');
  return user;
}
function user_(token) { return authenticatedUser_(token).id; }
function output_(data, callback) {
  const text = JSON.stringify(data).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  if (callback) {
    if (!/^dexelDrive_[a-f0-9]{32}$/.test(callback)) return ContentService.createTextOutput('{"ok":false,"error":"Invalid callback"}').setMimeType(ContentService.MimeType.JSON);
    return ContentService.createTextOutput(callback + '(' + text + ');').setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.JSON);
}
function folderFile_(id) {
  if (!DRIVE_ID.test(id || '')) throw new Error('Неверный ID файла.');
  const file = DriveApp.getFileById(id);
  const parents = file.getParents();
  let inside = false;
  while (parents.hasNext()) if (parents.next().getId() === FOLDER_ID) inside = true;
  if (!inside) throw new Error('Файл не принадлежит каталогу.');
  return file;
}
function file_(id) {
  const file = folderFile_(id);
  let meta;
  try { meta = JSON.parse(file.getDescription()); } catch (_) { throw new Error('Файл не принадлежит каталогу.'); }
  if (meta.app !== 'dexel-stl-v1' || !UUID.test(meta.owner) || !UUID.test(meta.model)) throw new Error('Неверные данные владельца файла.');
  return {file: file, meta: meta};
}
function path_(id, meta) { return meta.owner + '/' + meta.model + '/drive-' + id + '.stl'; }
function links_(file) {
  const id = file.getId();
  return {ok: true, fileId: id, name: file.getName(), size: file.getSize(),
    viewUrl: 'https://drive.google.com/file/d/' + id + '/view',
    downloadUrl: 'https://drive.google.com/uc?export=download&id=' + id,
    readUrl: ScriptApp.getService().getUrl() + '?id=' + id};
}
function validSTL_(bytes) {
  if (!bytes.length || bytes.length > MAX_STL_BYTES) throw new Error('STL должен быть непустым и не больше 20 МБ.');
  if (bytes.length >= 84) {
    const n = (bytes[80]&255) + (bytes[81]&255)*256 + (bytes[82]&255)*65536 + (bytes[83]&255)*16777216;
    if (n > 0 && 84 + 50 * n === bytes.length) return;
  }
  const text = Utilities.newBlob(bytes).getDataAsString('UTF-8');
  if (!/^\s*solid\b/i.test(text) || !/facet\s+normal/i.test(text) || !/vertex\s+[-+\d.]/i.test(text) || !/endsolid\b/i.test(text)) throw new Error('Файл не похож на ASCII или бинарный STL.');
}
function unauthorized_() {
  const error = new Error('Unauthorized: доступ только для модераторов.');
  error.status = 403;
  return error;
}
function moderator_(account, email) {
  const verified = String(account.email || '').trim().toLowerCase();
  if (!MODERATOR_EMAILS.includes(verified) || verified !== String(email || '').trim().toLowerCase()) throw unauthorized_();
  return verified;
}
function moderatorTicket_(p) {
  if (!UUID.test(p.ticket || '')) throw unauthorized_();
  const saved = CacheService.getScriptCache().get('moderator:' + p.ticket);
  if (!saved) { const err = unauthorized_(); err.code = 'TICKET_EXPIRED'; throw err; }
  const account = JSON.parse(saved);
  moderator_(account, p.email);
  return account;
}
function importId_(fileId) {
  const hash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'dexel-drive:' + fileId, Utilities.Charset.UTF_8)
    .map(b => ('0' + (b & 255).toString(16)).slice(-2)).join('').slice(0,32).split('');
  hash[12] = '5'; hash[16] = ((parseInt(hash[16],16)&3)|8).toString(16);
  const h = hash.join('');
  return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);
}
function listSTL_(p) {
  moderatorTicket_(p);
  // Pagination avoids Apps Script execution/response limits for large folders.
  const iterator = p.cursor ? DriveApp.continueFileIterator(p.cursor) : DriveApp.getFolderById(FOLDER_ID).getFiles();
  const files = [];
  let scanned = 0;
  while (iterator.hasNext() && scanned++ < 200) {
    const candidate = iterator.next();
    const file = folderFile_(candidate.getId()); // Recheck folder even with a supplied continuation token.
    if (file.isTrashed() || !/\.stl$/i.test(file.getName())) continue;
    let name = file.getName();
    try { const meta = JSON.parse(file.getDescription()); if (meta.app === 'dexel-stl-v1') name = meta.originalName || name; } catch (_) {}
    files.push({fileId:file.getId(), fileName:name, size:file.getSize(), url:'https://drive.google.com/file/d/'+file.getId()+'/view'});
  }
  return {ok:true, files:files, cursor:iterator.hasNext() ? iterator.getContinuationToken() : null};
}
function doPost(e) {
  let receipt, authenticatedOwner;
  try {
    const raw = e && e.postData && e.postData.contents;
    if (!raw || raw.length > Math.ceil(MAX_STL_BYTES / 3) * 4 + 16384) throw new Error('Слишком большой или пустой запрос.');
    const body = JSON.parse(raw);
    const account = authenticatedUser_(body.accessToken);
    const owner = account.id;
    authenticatedOwner = owner;
    if (!UUID.test(body.requestId)) throw new Error('Неверный requestId.');
    receipt = 'receipt:' + body.requestId;
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) throw new Error('Сервис занят, повторите позже.');
    let result;
    try {
      const cached = CacheService.getScriptCache().get(receipt);
      if (cached) {
        const saved = JSON.parse(cached);
        if (saved.owner !== owner) throw new Error('Запрос принадлежит другому пользователю.');
        return output_(saved.result);
      }
      if (body.action === 'moderator-session') {
        const email = moderator_(account, body.moderatorEmail);
        const ticket = Utilities.getUuid();
        CacheService.getScriptCache().put('moderator:' + ticket, JSON.stringify({id:owner,email:email}), 600);
        result = {ok:true, ticket:ticket, expiresAt:Date.now()+600000};
      } else if (body.action === 'import-claim') {
        moderator_(account, body.moderatorEmail);
        const file = folderFile_(body.fileId);
        if (file.isTrashed() || !/\.stl$/i.test(file.getName()) || !file.getSize() || file.getSize()>MAX_STL_BYTES) throw new Error('Нужен STL до 20 МБ из папки каталога.');
        if (body.modelId !== importId_(body.fileId)) throw new Error('Неверный ID импортируемой модели.');
        let meta;
        try { meta = JSON.parse(file.getDescription()); } catch (_) {}
        if (meta && meta.app === 'dexel-stl-v1' && (meta.owner !== owner || meta.model !== body.modelId)) throw new Error('Файл уже закреплён за другой моделью или автором.');
        // A failed DB/cover write leaves the original file intact and retryable.
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        if (!meta || meta.app !== 'dexel-stl-v1') {
          file.setDescription(JSON.stringify({app:'dexel-stl-v1',owner:owner,model:body.modelId,originalName:file.getName(),imported:true,previousDescription:file.getDescription()}));
        }
        result = links_(file);
        result.modelId = body.modelId;
      } else if (body.action === 'upload') {
        if (!UUID.test(body.modelId)) throw new Error('Неверный modelId.');
        const rows = api_('/rest/v1/models?select=user_id&id=eq.' + body.modelId, body.accessToken);
        if (rows.length && rows[0].user_id !== owner) throw new Error('Модель принадлежит другому пользователю.');
        if (typeof body.base64 !== 'string' || body.base64.length > Math.ceil(MAX_STL_BYTES/3)*4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(body.base64)) throw new Error('Неверный Base64.');
        const bytes = Utilities.base64Decode(body.base64);
        validSTL_(bytes);
        const name = String(body.name || 'model.stl').replace(/[\x00-\x1f/\\]/g, '_').slice(0, 160);
        if (!/\.stl$/i.test(name)) throw new Error('Можно загрузить только .stl.');
        const folder = DriveApp.getFolderById(FOLDER_ID);
        // Deterministic physical name prevents duplicates even after the receipt cache expires.
        const physicalName = owner + '_' + body.requestId + '.stl';
        const previous = folder.getFilesByName(physicalName);
        let file;
        if (previous.hasNext()) {
          file = previous.next();
          const prior = file_(file.getId());
          if (prior.meta.owner !== owner || prior.meta.model !== body.modelId) throw new Error('Конфликт повторного запроса.');
        } else {
          file = folder.createFile(Utilities.newBlob(bytes, 'model/stl', physicalName));
          try {
            file.setDescription(JSON.stringify({app:'dexel-stl-v1', owner:owner, model:body.modelId, originalName:name}));
            file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
          } catch (err) { file.setTrashed(true); throw err; }
        }
        result = links_(file);
        result.name = name;
      } else if (body.action === 'delete') {
        const item = file_(body.fileId);
        if (item.meta.owner !== owner) throw new Error('Удалять файл может только его владелец.');
        const rows = api_('/rest/v1/models?select=stl_path,deleting&id=eq.' + item.meta.model, body.accessToken);
        if (rows.some(row => row.stl_path === path_(body.fileId, item.meta) && !row.deleting)) throw new Error('Сначала снимите модель с публикации или сохраните новый STL.');
        item.file.setTrashed(true);
        result = {ok:true, fileId:body.fileId, deleted:true};
      } else throw new Error('Неизвестное действие.');
      CacheService.getScriptCache().put(receipt, JSON.stringify({owner:owner, result:result}), 21600);
    } finally { lock.releaseLock(); }
    return output_(result);
  } catch (err) {
    const result = {ok:false, status:err.status || 400, code:err.code, error:err.message || 'Ошибка Google Диска.'};
    // Only authenticated requests get a receipt; tokens are never stored or returned.
    if (receipt && !CacheService.getScriptCache().get(receipt)) {
      CacheService.getScriptCache().put(receipt, JSON.stringify({owner:authenticatedOwner, result:result}), 600);
    }
    return output_(result);
  }
}
function doGet(e) {
  const p = e && e.parameter || {};
  try {
    // Moderator reads require a short-lived capability issued after Supabase authentication.
    if (p.action === 'list') return output_(listSTL_(p), p.callback);
    if (p.action === 'import-read') {
      moderatorTicket_(p);
      const file = folderFile_(p.id);
      if (file.isTrashed() || !/\.stl$/i.test(file.getName()) || !file.getSize() || file.getSize()>MAX_STL_BYTES) throw new Error('Нужен STL до 20 МБ.');
      return output_({ok:true,fileId:file.getId(),name:file.getName(),base64:Utilities.base64Encode(file.getBlob().getBytes())},p.callback);
    }
    // JSONP is read-only. Session tokens are never placed in URLs or returned.
    if (p.action === 'status') {
      if (!UUID.test(p.requestId)) throw new Error('Неверный requestId.');
      const saved = CacheService.getScriptCache().get('receipt:' + p.requestId);
      return output_(saved ? JSON.parse(saved).result : {ok:false, pending:true}, p.callback);
    }
    if (p.action) throw new Error('GET поддерживает только чтение.');
    const item = file_(p.id);
    if (item.file.isTrashed()) throw new Error('Файл удалён.');
    const rows = api_('/rest/v1/models?select=id&deleting=eq.false&stl_path=eq.' + encodeURIComponent(path_(p.id, item.meta)));
    if (!rows.length) throw new Error('Модель ещё не опубликована или уже удалена.');
    if (item.file.getSize() > MAX_STL_BYTES) throw new Error('Файл превышает 20 МБ.');
    const result = links_(item.file);
    result.name = item.meta.originalName;
    result.base64 = Utilities.base64Encode(item.file.getBlob().getBytes());
    return output_(result, p.callback);
  } catch (err) { return output_({ok:false, status:err.status || 400, code:err.code, error:err.message || 'Не удалось прочитать STL.'}, p.callback); }
}
