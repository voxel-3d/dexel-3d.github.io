import {modelExtension, modelMime, DRIVE_CHUNK_SIZE, MAX_MODEL_SIZE} from '../model-files.js';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
const source=readFileSync(new URL('../script.js',import.meta.url),'utf8');
const elements=new Map();
function element(){return {hidden:true,disabled:false,textContent:'',value:'',children:[],listeners:{},setAttribute(){},removeAttribute(){},replaceChildren(){this.children=[]},append(x){this.children.push(x)},addEventListener(name,fn){this.listeners[name]=fn}}}
const byId=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id)};
const moderator={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',email:'igorkruk747@gmail.com'};
let saved=[],reads=0,listPages=0,refreshes=0;
const fileId='Drive_file_001';
const ctx=vm.createContext({console,TextEncoder,crypto:webcrypto,Blob,File,Uint8Array,atob,Date,Map,Set,
 MODERATOR_EMAILS:['igorkruk747@gmail.com'],CATEGORIES:['Все','Другое','Для дома и быта'],DEFAULT_COLOR:'#23272e',MAX_FILE_SIZE:MAX_MODEL_SIZE,modelExtension,modelMime,DRIVE_CHUNK_SIZE,
 user:{id:'ordinary',email:'other@example.com'},byId,document:{createElement:element},
 note:(el,text)=>{el.textContent=text},driveEndpoint:()=> 'configured',driveFileId:path=>path.match(/drive-(.+)\.stl/)?.[1],
 supabase:{from:()=>({select(){return this},order(){return this},async range(){return {data:[{stl_path:'x/drive-Drive_existing_01.stl'}],error:null}}})},
 listPublicModels:async()=>{refreshes++},loadDashboard:async()=>{},
 queueCover:async sel=>{if(sel.file.name==='corrupt.stl')throw Error('Некорректный STL');sel.metrics={width:1,depth:2,height:3,volume:1};return 'data:image/png;base64,AA=='},
 saveCloudModel:async(fields,sel)=>{saved.push({fields,sel})},
 drivePost:async()=>({ok:true,ticket:'ticket',expiresAt:Date.now()+600000}),
 driveJSONP:async p=>{
  assert.equal(p.email,moderator.email);assert.equal(p.ticket,'ticket');
  if(p.action==='list'){
   listPages++;
   return {ok:true,files:p.cursor?[{fileId:'Drive_large_01',fileName:'large.stl',size:51*1024*1024},{fileId:'Drive_corrupt_01',fileName:'corrupt.stl',size:100}]:[{fileId:'Drive_existing_01',fileName:'old.stl',size:100},{fileId,fileName:'new_part.3mf',size:100}],cursor:p.cursor?null:'next'};
  }
  reads++;return {ok:true,base64:'AA=='};
 }
});
vm.runInContext(source.slice(source.indexOf('async function readDriveBytes('),source.indexOf('async function drivePost(')),ctx);
vm.runInContext(source.slice(source.indexOf('let driveImportRunning ='),source.indexOf('const cloudSetup = initCloud();')),ctx);
ctx.updateModeratorPanel();assert.equal(byId('drive-import-panel').hidden,true);
const submit=()=>byId('drive-import-form').listeners.submit({preventDefault(){}});
await submit();assert.equal(listPages,0);
ctx.user=moderator;ctx.updateModeratorPanel();assert.equal(byId('drive-import-panel').hidden,false);
assert.throws(()=>ctx.parseImportMetadata('{bad'),/JSON/);
assert.throws(()=>ctx.parseImportMetadata('[{"fileName":"a.stl","category":"Все"}]'),/категория/);
assert.throws(()=>ctx.parseImportMetadata('[{"fileName":"a.stl"},{"fileName":"a.stl"}]'),/повторяется/);
byId('drive-import-metadata').value='[{"fileName":"new_part.3mf","title":"Новая деталь","description":"Готовая деталь","category":"Для дома и быта"}]';
await submit();
assert.equal(saved.length,1);assert.equal(saved[0].fields.title,'Новая деталь');assert.equal(saved[0].fields.category,'Для дома и быта');
assert.equal(saved[0].sel.importDrive.fileId,fileId);assert.equal(saved[0].sel.metrics.volume,1);
assert.equal(reads,2);assert.equal(listPages,2);assert.equal(byId('drive-import-progress').value,4);
assert.equal(byId('drive-import-errors').children.length,2);
assert.match(byId('drive-import-status').textContent,/Добавлено: 1. Пропущено: 1. Ошибок: 2/);
assert.equal(refreshes,1);
assert.equal(byId('drive-import-start').disabled,false);
// Match the deterministic server ID exactly.
const backend=vm.createContext({Utilities:{DigestAlgorithm:{SHA_256:'sha'},Charset:{UTF_8:'utf8'},computeDigest:()=>[]}});
vm.runInContext(readFileSync(new URL('Code.gs',import.meta.url),'utf8'),backend);
const {createHash}=await import('node:crypto');backend.Utilities.computeDigest=(_a,t)=>[...createHash('sha256').update(t).digest()];
assert.equal(await ctx.driveImportModelId(fileId),backend.importId_(fileId));
// Sign out erases moderator-only data and hides the panel.
ctx.user=undefined;ctx.updateModeratorPanel();assert.equal(byId('drive-import-panel').hidden,true);assert.equal(byId('drive-import-metadata').value,'');
console.log('Import UI: moderator visibility, forged submit blocked, JSON validation, paginated listing, duplicate skips, per-file errors, metrics/cover handoff and matching deterministic IDs passed.');
