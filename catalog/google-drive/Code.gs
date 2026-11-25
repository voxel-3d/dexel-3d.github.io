/* DEXEL 3D. Deploy as Web App: execute as Me; access Anyone.
 * Script Properties: SUPABASE_URL, SUPABASE_ANON_KEY (public key, NOT service_role).
 * Authentication is checked against Supabase; never trust a user_id from the browser.
 */
const MODERATOR_EMAILS = ['igorkruk747@gmail.com'];
const FOLDER_ID = '1ZLyfOh_iJ-qmSKeU9YsA4g6rw-fTDIi1';
const MAX_MODEL_BYTES = 50 * 1024 * 1024;
const LEGACY_BODY_LIMIT = 20 * 1024 * 1024;
const DRIVE_CHUNK_SIZE = 8 * 1024 * 1024;
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
function modelExtension_(name) { const match = String(name).match(/\.(stl|3mf)$/i); return match && match[1].toLowerCase(); }
function path_(id, meta) { return meta.owner + '/' + meta.model + '/drive-' + id + '.' + (modelExtension_(meta.originalName) || 'stl'); }
function uploadName_(name) {
  const cleaned = String(name || 'model.stl').replace(/[\x00-\x1f/\\]/g, '_');
  const extension = modelExtension_(cleaned);
  if (!extension) throw new Error('Поддерживаются файлы STL и 3MF.');
  return cleaned.slice(0, -4).slice(0, 156) + '.' + extension;
}
function modelMime_(extension) { return extension === '3mf' ? 'model/3mf' : 'model/stl'; }
function matchAssetOwner_(body, account) {
  if (!UUID.test(body.modelId)) throw new Error('Неверный modelId.');
  const rows = api_('/rest/v1/models?select=user_id&id=eq.' + body.modelId, body.accessToken);
  const owner = rows.length ? rows[0].user_id : account.id;
  if (owner !== account.id) moderator_(account, body.moderatorEmail);
  return owner;
}
function decodeUpload_(value, limit) {
  if (typeof value !== 'string' || value.length > Math.ceil(limit / 3) * 4 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error('Некорректные данные файла.');
  const bytes = Utilities.base64Decode(value);
  if (!bytes.length || bytes.length > limit) throw new Error('Некорректный размер части файла.');
  return bytes;
}
function assertModelHeader_(bytes, size, extension) {
  if (extension === '3mf') {
    if (bytes.length < 4 || bytes[0] !== 80 || bytes[1] !== 75 ||
        bytes[2] !== 3 || bytes[3] !== 4) throw new Error('Файл не похож на архив 3MF.');
    return;
  }
  if (bytes.length >= 84) {
    const n = (bytes[80]&255) + (bytes[81]&255)*256 + (bytes[82]&255)*65536 + (bytes[83]&255)*16777216;
    if (n > 0 && 84 + 50 * n === size) return;
  }
  const text = Utilities.newBlob(bytes.slice(0, 84)).getDataAsString('UTF-8');
  if (!/^\s*solid(?:\s|$)/.test(text)) throw new Error('Файл не похож на STL.');
}
function driveRequest_(url, options) {
  return UrlFetchApp.fetch(url, {
    ...options, muteHttpExceptions:true, followRedirects:false,
    headers:{...options.headers,Authorization:'Bearer ' + ScriptApp.getOAuthToken()}
  });
}
function header_(response, name) {
  const headers = response.getHeaders();
  const key = Object.keys(headers).find(key => key.toLowerCase() === name.toLowerCase());
  return key ? String(headers[key]) : '';
}
function startUpload_(body, account) {
  if (!Number.isInteger(body.size) || body.size <= LEGACY_BODY_LIMIT || body.size > MAX_MODEL_BYTES) {
    throw new Error('Выберите непустой файл STL или 3MF размером до 50 МБ.');
  }
  const owner = matchAssetOwner_(body, account);
  const name = uploadName_(body.name);
  const extension = modelExtension_(name);
  const mime = modelMime_(extension);
  const uploadId = Utilities.getUuid();
  const description = JSON.stringify({app:'dexel-stl-v1',owner,model:body.modelId,originalName:name});
  const response = driveRequest_('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id', {
    method:'post', contentType:'application/json',
    headers:{'X-Upload-Content-Type':mime,'X-Upload-Content-Length':String(body.size)},
    payload:JSON.stringify({name: owner + '_' + uploadId + '.' + extension, mimeType:mime, parents:[FOLDER_ID], description})
  });
  const url = header_(response,'Location');
  if (response.getResponseCode() !== 200 || !/^https:\/\/www\.googleapis\.com\/upload\/drive\/v3\/files\?/.test(url)) {
    throw new Error('Не удалось начать загрузку. Проверьте Drive API в проекте Apps Script (HTTP ' + response.getResponseCode() + ').');
  }
  CacheService.getScriptCache().put('upload:'+uploadId, JSON.stringify({url,owner:account.id,name,extension,mime,size:body.size,nextOffset:0}),21600);
  return {ok:true,uploadId};
}
function putUploadChunk_(body, account) {
  if (!UUID.test(body.uploadId)) throw new Error('Неверный идентификатор загрузки.');
  const cache = CacheService.getScriptCache();
  const key = 'upload:'+body.uploadId;
  const raw = cache.get(key);
  if (!raw) throw new Error('Сеанс загрузки истёк. Выберите файл заново.');
  const session = JSON.parse(raw);
  if (session.owner !== account.id) throw unauthorized_();
  const offset = body.offset;
  if (!Number.isInteger(offset) || offset !== session.nextOffset) throw new Error('Неверный порядок частей файла.');
  const length = Math.min(DRIVE_CHUNK_SIZE, session.size - offset);
  const bytes = decodeUpload_(body.base64, length);
  if (bytes.length !== length) throw new Error('Получена неполная часть файла.');
  if (!offset) assertModelHeader_(bytes, session.size, session.extension);
  const nextOffset = offset + length;
  const response = driveRequest_(session.url, {method:'put', contentType:session.mime, payload:bytes,
    headers:{'Content-Range':'bytes '+offset+'-'+(nextOffset-1)+'/'+session.size}});
  const status = response.getResponseCode();
  if (status === 308 && nextOffset < session.size && header_(response,'Range') === 'bytes=0-'+(nextOffset-1)) {
    session.nextOffset = nextOffset;
    cache.put(key,JSON.stringify(session),21600);
    return {ok:true,nextOffset};
  }
  if ((status !== 200 && status !== 201) || nextOffset !== session.size) {
    throw new Error('Google Диск не подтвердил запись части файла (HTTP ' + status + ').');
  }
  const file = folderFile_(JSON.parse(response.getContentText()).id);
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); }
  catch (err) { file.setTrashed(true); throw err; }
  cache.remove(key);
  return {...links_(file),name:session.name,nextOffset};
}
function modelRead_(file, params, name) {
  const size = file.getSize();
  if (!size || size > MAX_MODEL_BYTES) throw new Error('Выберите непустой файл STL или 3MF размером до 50 МБ.');
  const result = {...links_(file),name};
  if (size <= LEGACY_BODY_LIMIT) {
    result.base64 = Utilities.base64Encode(file.getBlob().getBytes());
    return result;
  }
  if (params.offset === undefined) return {...result,chunked:true,chunkSize:DRIVE_CHUNK_SIZE};
  const offset = Number(params.offset);
  if (!/^\d+$/.test(params.offset) || !Number.isInteger(offset) || offset >= size || offset % DRIVE_CHUNK_SIZE) {
    throw new Error('Неверное смещение части файла.');
  }
  const end = Math.min(size,offset+DRIVE_CHUNK_SIZE)-1;
  const response = driveRequest_('https://www.googleapis.com/drive/v3/files/'+file.getId()+'?alt=media', {
    headers:{Range:'bytes='+offset+'-'+end}
  });
  if (response.getResponseCode() !== 206) throw new Error('Google Диск не вернул часть файла.');
  const bytes = response.getContent();
  if (bytes.length !== end-offset+1) throw new Error('Google Диск вернул неполную часть файла.');
  return {...result,offset,base64:Utilities.base64Encode(bytes)};
}
function links_(file) {
  const id = file.getId();
  return {ok: true, fileId: id, name: file.getName(), size: file.getSize(),
    viewUrl: 'https://drive.google.com/file/d/' + id + '/view',
    downloadUrl: 'https://drive.google.com/uc?export=download&id=' + id,
    readUrl: ScriptApp.getService().getUrl() + '?id=' + id};
}
function validSTL_(bytes) {
  if (!bytes.length || bytes.length > LEGACY_BODY_LIMIT) throw new Error('Некорректный размер файла. Для крупной модели используйте загрузку частями.');
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
    if (file.isTrashed() || !modelExtension_(file.getName())) continue;
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
    if (!raw || raw.length > Math.ceil(LEGACY_BODY_LIMIT / 3) * 4 + 16384) throw new Error('Слишком большой или пустой запрос.');
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
        if (file.isTrashed() || !modelExtension_(file.getName()) || !file.getSize() || file.getSize()>MAX_MODEL_BYTES) throw new Error('Нужен STL или 3MF размером до 50 МБ из папки каталога.');
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
      } else if (body.action === 'upload-start') {
        result = startUpload_(body, account);
      } else if (body.action === 'upload-chunk') {
        result = putUploadChunk_(body, account);
      } else if (body.action === 'upload') {
        const assetOwner = matchAssetOwner_(body, account);
        const bytes = decodeUpload_(body.base64, LEGACY_BODY_LIMIT);
        const name = uploadName_(body.name);
        const extension = modelExtension_(name);
        if (extension === 'stl') validSTL_(bytes);
        else assertModelHeader_(bytes, bytes.length, extension);
        const folder = DriveApp.getFolderById(FOLDER_ID);
        // Deterministic physical name prevents duplicates even after the receipt cache expires.
        const physicalName = assetOwner + '_' + body.requestId + '.' + extension;
        const previous = folder.getFilesByName(physicalName);
        let file;
        if (previous.hasNext()) {
          file = previous.next();
          const prior = file_(file.getId());
          if (prior.meta.owner !== assetOwner || prior.meta.model !== body.modelId) throw new Error('Конфликт повторного запроса.');
        } else {
          file = folder.createFile(Utilities.newBlob(bytes, modelMime_(extension), physicalName));
          try {
            file.setDescription(JSON.stringify({app:'dexel-stl-v1', owner:assetOwner, model:body.modelId, originalName:name}));
            file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
          } catch (err) { file.setTrashed(true); throw err; }
        }
        result = links_(file);
        result.name = name;
      } else if (body.action === 'delete') {
        const item = file_(body.fileId);
        if (item.meta.owner !== owner) moderator_(account, body.moderatorEmail);
        const rows = api_('/rest/v1/models?select=*&id=eq.' + item.meta.model, body.accessToken);
        if (rows.some(row => (row.stl_path === path_(body.fileId, item.meta) || (Array.isArray(row.stl_files) && row.stl_files.some(part => part.fileId === body.fileId))) && !row.deleting)) throw new Error('Сначала снимите модель с публикации или сохраните новый STL.');
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
      if (file.isTrashed() || !modelExtension_(file.getName()) || !file.getSize() || file.getSize()>MAX_MODEL_BYTES) throw new Error('Нужен STL или 3MF размером до 50 МБ.');
      return output_(modelRead_(file,p,file.getName()),p.callback);
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
    if (!rows.length) {
      const models = api_('/rest/v1/models?select=*&deleting=eq.false&id=eq.' + item.meta.model);
      if (!models.some(row => row.id === item.meta.model && row.user_id === item.meta.owner &&
          Array.isArray(row.stl_files) && row.stl_files.some(part => part.fileId === p.id))) {
        throw new Error('Модель ещё не опубликована или уже удалена.');
      }
    }
    return output_(modelRead_(item.file,p,item.meta.originalName),p.callback);
  } catch (err) { return output_({ok:false, status:err.status || 400, code:err.code, error:err.message || 'Не удалось прочитать STL.'}, p.callback); }
}
