import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {webcrypto, createHash} from 'node:crypto';
const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const other='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const model='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const folderId='1ZLyfOh_iJ-qmSKeU9YsA4g6rw-fTDIi1';
const token='valid-user-token-'.repeat(3), otherToken='another-user-token-'.repeat(3);
const bytes=Buffer.alloc(134); bytes.writeUInt32LE(1,80);
const files=new Map(), receipts=new Map();let row, counter=0, authOnline=true;
const blob=(b,type,name)=>({bytes:Buffer.from(b),name,getDataAsString:()=>Buffer.from(b).toString('utf8'),getBytes:()=>[...Buffer.from(b)]});
const iterator=items=>({hasNext:()=>!!items.length,next:()=>items.shift()});
const folder={getFiles:()=>iterator([...files.values()]),getFilesByName:name=>iterator([...files.values()].filter(f=>f.name===name&&!f.trashed)),createFile:b=>{
 const f={id:'Drive_file_'+(++counter),name:b.name,desc:'',trashed:false,bytes:b.bytes,
 getId(){return this.id},getName(){return this.name},getSize(){return this.bytes.length},
 setDescription(x){this.desc=x},getDescription(){return this.desc},setSharing(){this.public=true},
 setTrashed(x){this.trashed=x},isTrashed(){return this.trashed},getParents:()=>iterator([{getId:()=>folderId}]),
 getBlob(){return blob(this.bytes)}};files.set(f.id,f);return f;
}};
const ctx=vm.createContext({console,
 PropertiesService:{getScriptProperties:()=>({getProperty:k=>k==='SUPABASE_URL'?'https://example.supabase.co':'public-test-key'})},
 UrlFetchApp:{fetch:(url,opts)=>{
  const who=opts.headers.Authorization==='Bearer '+token?owner:opts.headers.Authorization==='Bearer '+otherToken?other:null;
  let result,code=200;
  if(!authOnline){code=503;result={};}
  else if(url.includes('/auth/v1/user')) {result={id:who,email:who===owner?'igorkruk747@gmail.com':'ordinary@example.com',email_confirmed_at:'now'};if(!who)code=401;}
  else {result=row?[row]:[]; if(url.includes('deleting=eq.false')&&row?.deleting)result=[];}
  return {getResponseCode:()=>code,getContentText:()=>JSON.stringify(result)};
 }},
 ContentService:{MimeType:{JSON:'json',JAVASCRIPT:'js'},createTextOutput:text=>({text,setMimeType(){return this}})},
 CacheService:{getScriptCache:()=>({get:k=>receipts.get(k),put:(k,v)=>receipts.set(k,v)})},
 LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},
 DriveApp:{getFileById:id=>{if(!files.has(id))throw Error('missing');return files.get(id)},getFolderById:()=>folder,Access:{ANYONE_WITH_LINK:'public'},Permission:{VIEW:'view'}},
 Utilities:{getUuid:()=>webcrypto.randomUUID(),DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},computeDigest:(algo,text)=>[...createHash('sha256').update(text).digest()],newBlob:blob,base64Decode:s=>[...Buffer.from(s,'base64')],base64Encode:b=>Buffer.from(b).toString('base64')},
 ScriptApp:{getService:()=>({getUrl:()=> 'https://script.google.com/macros/s/test/exec'})}
});
vm.runInContext(readFileSync(new URL('Code.gs',import.meta.url),'utf8'),ctx);
const post=body=>JSON.parse(ctx.doPost({postData:{contents:JSON.stringify({requestId:webcrypto.randomUUID(),accessToken:token,...body})}}).text);
const get=params=>JSON.parse(ctx.doGet({parameter:params}).text);
const requestId=webcrypto.randomUUID();
const upload={action:'upload',modelId:model,name:'part.stl',base64:bytes.toString('base64'),requestId};
assert.equal(post({...upload,accessToken:'bad'}).ok,false);
assert.equal(files.size,0);
assert.equal(post({...upload,name:'bad.exe',requestId:webcrypto.randomUUID()}).ok,false);
assert.equal(post({...upload,base64:'YWJj',requestId:webcrypto.randomUUID()}).ok,false);
const first=post(upload);assert.equal(first.ok,true);assert.equal(files.size,1);
assert.equal(files.get(first.fileId).public,true);
assert.equal(post(upload).fileId,first.fileId);assert.equal(files.size,1);
assert.equal(get({action:'status',requestId}).fileId,first.fileId);
assert.equal(get({id:first.fileId}).ok,false); // Unpublished bytes are not exposed by JSONP.
row={id:model,user_id:owner,stl_path:owner+'/'+model+'/drive-'+first.fileId+'.stl',deleting:false};
assert.equal(get({id:first.fileId}).base64,bytes.toString('base64'));
assert.equal(get({id:first.fileId,action:'delete'}).ok,false);
assert.equal(post({action:'delete',fileId:first.fileId,accessToken:otherToken}).ok,false);
assert.equal(post({action:'delete',fileId:first.fileId}).ok,false);
assert.equal(files.get(first.fileId).trashed,false);
assert.doesNotMatch(ctx.doGet({parameter:{id:first.fileId,callback:'alert(1)'}}).text,/alert/);
assert.match(ctx.doGet({parameter:{id:first.fileId,callback:'dexelDrive_'+'a'.repeat(32)}}).text,/^dexelDrive_a+\(/);
row.deleting=true;
assert.equal(post({action:'delete',fileId:first.fileId}).ok,true);
assert.equal(files.get(first.fileId).trashed,true);
assert.equal(get({id:first.fileId}).ok,false);
authOnline=false;assert.equal(post({...upload,requestId:webcrypto.randomUUID()}).ok,false);
console.log('Apps Script: auth, format validation, idempotency, publication checks, JSONP validation and owner-only deletion passed.');

// Test the actual browser adapter without sending any live writes.
const source=readFileSync(new URL('../script.js',import.meta.url),'utf8');
const start=source.indexOf('function driveFileId('), end=source.indexOf('async function loadSTL(');
let calls=[], jsonpCalls=0;
const frontend=vm.createContext({console,URL,Uint8Array,atob,DOMException,AbortSignal,crypto:webcrypto,
 GOOGLE_DRIVE_UPLOAD_URL:'https://script.google.com/macros/s/test/exec',MAX_FILE_SIZE:20*1024*1024,
 supabase:{auth:{getSession:async()=>({data:{session:{access_token:token}}})}},
 fetch:async (url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({ok:true,fileId:'Drive_file_99',base64:bytes.toString('base64')})};}
});
vm.runInContext(source.slice(start,end),frontend);
assert.equal(frontend.driveFileId(row.stl_path),first.fileId);
assert.equal(frontend.driveFileId(owner+'/'+model+'/legacy.stl'),undefined);
assert.equal((await frontend.driveRead(first.fileId)).byteLength,134);
assert.equal((await frontend.drivePost('upload',{modelId:model,base64:'AA=='})).ok,true);
const call=calls.at(-1);assert.equal(call.options.headers['Content-Type'],'text/plain;charset=utf-8');
assert.equal(call.options.headers.Authorization,undefined);
assert.equal(JSON.parse(call.options.body).accessToken,token);
frontend.fetch=async()=>{throw new TypeError('CORS')};
frontend.driveJSONP=async p=>{jsonpCalls++;return p.action==='status'?{ok:true,fileId:'Drive_file_99'}:{ok:true,base64:bytes.toString('base64')}};
assert.equal((await frontend.driveRead(first.fileId)).byteLength,134);
assert.equal((await frontend.drivePost('upload',{modelId:model,base64:'AA=='})).fileId,'Drive_file_99');
assert.equal(jsonpCalls,2);
vm.runInContext("GOOGLE_DRIVE_UPLOAD_URL = ''",frontend);
assert.throws(()=>frontend.driveEndpoint(),/GOOGLE_DRIVE_UPLOAD_URL/);
console.log('Browser adapter: Base64 roundtrip, text/plain POST, read fallback, ambiguous POST receipt and missing-config checks passed.');

// Common save path is used by both the single editor and sequential bulk upload.
let rows=new Map(), assets=[], removed=[], uploadedStl=0, failCover=false, failDB=false, ambiguousDB=false;
const stlPath=owner+'/'+model+'/drive-Drive_old_01.stl';
const oldCover=owner+'/'+model+'/dddddddd-dddd-4ddd-8ddd-dddddddddddd.png';
let newPayload;
function query(){
 let mode='read', payload;
 const q={insert(x){mode='insert';payload=x;return q},update(x){mode='update';payload=x;return q},
 eq(){return q},select(){return q},async maybeSingle(){
 if(mode==='read')return {data:rows.get(model)||null,error:null};
 newPayload=payload;
 if(failDB)return {data:null,error:{code:'failed'}};
 const saved={id:model,...payload};rows.set(model,saved);
 return ambiguousDB?{data:null,error:{code:'response-lost'}}:{data:saved,error:null};
 }};return q;
}
const saveCtx=vm.createContext({console,crypto:{randomUUID:()=>model},MAX_FILE_SIZE:20*1024*1024,BUCKET:'stl-models',accountStatus:{},
 supabase:{from:query,storage:{from:()=>({upload:async(path,data,options)=>{assets.push({path,options});return {error:failCover?new Error('cover failed'):null}}})}},
 drivePost:async(action)=>{assert.equal(action,'upload');uploadedStl++;return {fileId:'Drive_new_01'}},
 fileBase64:async()=>bytes.toString('base64'),webpCover:async()=>({arrayBuffer:async()=>new ArrayBuffer(8)}),
 removeAsset:async path=>removed.push(path),note(){}});
vm.runInContext(source.slice(source.indexOf('async function saveCloudModel('),source.indexOf('async function saveLocalModel(')),saveCtx);
const selection={file:{name:'part.stl',size:134},png:{},metrics:{width:1},azimuth:45,elevation:40};
const account={id:owner};
await saveCtx.saveCloudModel({title:'Part'},selection,null,account);
assert.equal(uploadedStl,1);assert.equal(assets[0].options.contentType,'image/webp');assert.match(assets[0].path,/\.webp$/);
assert.equal(newPayload.stl_path,owner+'/'+model+'/drive-Drive_new_01.stl');
assert.equal(assets.some(a=>a.path.endsWith('.stl')),false);
removed=[];ambiguousDB=true;
await saveCtx.saveCloudModel({title:'Part'},selection,{id:model,stl_path:stlPath,cover_path:oldCover},account);
assert.deepEqual(removed,[stlPath,oldCover]); // Lost save response resolved before old assets are removed.
ambiguousDB=false;failCover=true;removed=[];
await assert.rejects(saveCtx.saveCloudModel({title:'Part'},selection,null,account));
assert.equal(removed.some(p=>p.includes('drive-Drive_new_01')),true);
failCover=false;failDB=true;rows.clear();removed=[];
await assert.rejects(saveCtx.saveCloudModel({title:'Part'},selection,null,account));
assert.equal(removed.some(p=>p.includes('drive-Drive_new_01')),true);
console.log('Save flow: STL never enters Supabase, WebP cover upload, replacement cleanup, interrupted-save recovery and failed-upload cleanup passed.');

// Moderator-only list/read/adoption must not trust a supplied email.
authOnline=true;row=undefined;
const email='igorkruk747@gmail.com';
assert.equal(get({action:'list',email}).status,403);
assert.equal(post({action:'moderator-session',moderatorEmail:email,accessToken:otherToken}).status,403);
assert.equal(post({action:'moderator-session',moderatorEmail:'ordinary@example.com'}).status,403);
const mod=post({action:'moderator-session',moderatorEmail:email});
assert.equal(mod.ok,true);
const raw=folder.createFile(blob(bytes,'model/stl','new_part.stl'));
const importedId=ctx.importId_(raw.getId());
assert.equal(get({action:'list',email,ticket:mod.ticket}).files.some(f=>f.fileId===raw.getId()),true);
assert.equal(get({action:'list',email:'ordinary@example.com',ticket:mod.ticket}).status,403);
assert.equal(get({action:'import-read',email,id:raw.getId()}).status,403);
assert.equal(get({action:'import-read',email,id:raw.getId(),ticket:mod.ticket}).base64,bytes.toString('base64'));
assert.equal(get({id:raw.getId()}).ok,false);
assert.equal(post({action:'import-claim',fileId:raw.getId(),modelId:importedId,moderatorEmail:email,accessToken:otherToken}).status,403);
assert.equal(raw.desc,'');
const claim=post({action:'import-claim',fileId:raw.getId(),modelId:importedId,moderatorEmail:email});
assert.equal(claim.ok,true);assert.equal(raw.public,true);assert.equal(JSON.parse(raw.desc).owner,owner);
assert.equal(post({action:'import-claim',fileId:raw.getId(),modelId:importedId,moderatorEmail:email}).ok,true);
assert.equal(post({action:'import-claim',fileId:first.fileId,modelId:ctx.importId_(first.fileId),moderatorEmail:email}).ok,false);
const outsider=folder.createFile(blob(bytes,'model/stl','outside.stl'));
outsider.getParents=()=>iterator([{getId:()=> 'another-folder'}]);
assert.equal(get({action:'import-read',email,id:outsider.getId(),ticket:mod.ticket}).ok,false);
receipts.delete('moderator:'+mod.ticket);
assert.equal(get({action:'list',email,ticket:mod.ticket}).code,'TICKET_EXPIRED');
console.log('Moderator API: spoofed emails and ordinary sessions rejected; list/read require ticket; claim is moderator-only, folder-scoped and repeatable.');

// Source file must survive a failed imported-model database write.
failDB=true;failCover=false;rows.clear();removed=[];
saveCtx.checkImportAccount=()=>{};
saveCtx.drivePost=async(action,p)=>{assert.equal(action,'import-claim');return {fileId:p.fileId,modelId:p.modelId}};
await assert.rejects(saveCtx.saveCloudModel({title:'Imported'},{...selection,importDrive:{fileId:raw.getId(),modelId:model}},null,{...account,email}));
assert.equal(removed.some(path=>path.includes('/drive-')),false);
console.log('Import save: database failure cleans cover only, original Drive STL is retained.');
