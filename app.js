const API_BASE_URL='https://functions.yandexcloud.net/d4evt0q80matet5dunuk';
function reachMetrikaGoal(goal) {
  if (typeof ym === 'function') {
    try {
      ym(114411857, 'reachGoal', goal);
    } catch {
      // A tracking failure must not interrupt the user's action.
    }
  }
}

document.addEventListener('voxel:stl-loaded', () => reachMetrikaGoal('stl_upload'));

function apiUrl(route,params={}){
  const url=new URL(API_BASE_URL);
  url.searchParams.set('route',route);
  Object.entries(params).forEach(([key,value])=>{
    if(value!==undefined&&value!==null&&value!=='')url.searchParams.set(key,String(value));
  });
  return url.toString();
}

let selectedDelivery=null;
let calculatorApplied=false;
let calculatedItemsTotal=null;
let paymentMode=50;

const filters=document.querySelectorAll('#works [data-filter]');
const gallery=document.getElementById('works-gallery');
const workItems=[...gallery.querySelectorAll('.work-slide')];
const featuredWorks=new Set(workItems.filter(item=>item.classList.contains('is-active')));
const showMoreWorks=document.getElementById('works-more');
let activeFilter='all';
let portfolioExpanded=false;

for (const item of workItems) {
  const image=item.querySelector('.work-main-image');
  if (image) image.style.objectPosition=item.dataset.position || 'center center';
}

function renderPortfolio() {
  for (const item of workItems) {
    const visible=activeFilter === 'all'
      ? portfolioExpanded || featuredWorks.has(item)
      : item.dataset.category === activeFilter;
    item.hidden=!visible;
    item.inert=!visible;
    item.setAttribute('aria-hidden',String(!visible));
  }
  showMoreWorks.hidden=activeFilter !== 'all' || workItems.length <= featuredWorks.size;
  showMoreWorks.setAttribute('aria-expanded',String(portfolioExpanded));
  showMoreWorks.textContent=portfolioExpanded ? 'Показать меньше' : 'Показать ещё (все '+workItems.length+' работ)';
}

for (const button of filters) {
  button.addEventListener('click',()=>{
    activeFilter=button.dataset.filter;
    for (const filter of filters) {
      filter.classList.toggle('active',filter === button);
      filter.setAttribute('aria-pressed',String(filter === button));
    }
    renderPortfolio();
  });
}
showMoreWorks.addEventListener('click',()=>{
  portfolioExpanded=!portfolioExpanded;
  renderPortfolio();
});
renderPortfolio();
const dialog=document.getElementById('lightbox');
document.querySelectorAll('[data-image]').forEach(button=>button.addEventListener('click',()=>{const img=document.getElementById('large-image');img.src=button.dataset.image;img.alt=button.querySelector('.work-main-image').alt;document.getElementById('large-caption').textContent=button.dataset.title+(button.dataset.description?' — '+button.dataset.description:'');dialog.showModal()}));
dialog.querySelector('.close').addEventListener('click',()=>dialog.close());dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close()}});

function isValidOrderContact(value){
  const contact=String(value||'').trim();
  if(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact))return true;
  if(/^@[A-Za-z0-9_]{5,32}$/.test(contact))return true;
  const digits=contact.replace(/\D/g,'');
  return digits.length>=7&&digits.length<=15&&/^\+?[\d\s().-]+$/.test(contact);
}
const briefForm=document.getElementById('brief-form');
const catalogOrder = /^#request\?(.+)$/.exec(window.location.hash);
if (catalogOrder) {
  const params = new URLSearchParams(catalogOrder[1]);
  const value = (key, max) => (params.get(key) || '').trim().slice(0, max);
  const modelName = value('model', 100);
  const details = briefForm.elements.namedItem('details');
  if (modelName && details && !details.value) {
    briefForm.elements.namedItem('type').value = 'Печать по моей модели';
    const quantity = Number(params.get('qty'));
    const color = value('color', 120);
    const estimate = Number(params.get('estimate'));
    const lines = ['Модель из каталога: ' + modelName];
    const modelId = value('modelId', 100);
    if (modelId) lines.push('ID: ' + modelId);
    try {
      const link = new URL(params.get('modelURL'));
      if (link.origin === location.origin && link.pathname === '/catalog/' &&
          modelId && link.searchParams.get('model') === modelId) lines.push('Ссылка: ' + link.href);
    } catch { /* A locally stored model has no public link. */ }
    const material = value('material', 4);
    const strength = value('strength', 80);
    if (['PETG', 'PLA', 'ABS'].includes(material)) lines.push('Материал: ' + material);
    if (color) {
      briefForm.elements.namedItem('color').value = color;
      lines.push('Цвет: ' + color);
    }
    if (strength) lines.push('Прочность: ' + strength);
    if (Number.isInteger(quantity) && quantity >= 1 && quantity <= 10000) {
      briefForm.elements.namedItem('qty').value = quantity;
      lines.push('Тираж: ' + quantity + ' шт.');
    }
    if (Number.isSafeInteger(estimate) && estimate > 0) lines.push('Ориентир за тираж: ' + estimate + ' ₽');
    details.value = lines.join('\n');
  }
  history.replaceState(history.state, '', '#request');
  requestAnimationFrame(() => document.getElementById('request').scrollIntoView());
}

const orderContact=document.getElementById('contact');
const orderStatus=document.getElementById('order-status');
const orderSubmitButton=briefForm.querySelector('button[type="submit"]');
const orderModelInput=document.getElementById('order-stl-file');
const orderModelPanel=document.getElementById('order-stl');
const orderModelName=document.getElementById('order-stl-name');
const ORDER_MODEL_URL='https://voxel-3d-reviews-api.satinhyacinth.chatgpt.site/order-models';
const ORDER_MODEL_LIMIT=15*1024*1024;
let attachedModel=null;
let modelSummary='';
let uploadedModel=null;

function removeOrderModel(){
  orderModelInput.value='';
  orderModelPanel.hidden=true;
  attachedModel=null;
  uploadedModel=null;
}

briefForm.addEventListener('voxel:prepare-stl',event=>{
  const prepared=event.detail;
  if(orderSubmitButton.disabled){
    prepared.error='Заявка уже отправляется. Дождитесь завершения и добавьте модель снова.';
    return;
  }
  const details=document.getElementById('details');
  const previous=details.value.trim();
  const remaining=modelSummary&&previous.startsWith(modelSummary)
    ? previous.slice(modelSummary.length).trim()
    : previous;
  const summary=prepared.summary;
  const next=[summary,remaining].filter(Boolean).join('\n\n');
  if(next.length>details.maxLength){
    prepared.error='В заявке не хватает места для параметров модели. Сократите описание и попробуйте снова.';
    return;
  }

  removeOrderModel();
  details.value=next;
  if(typeof prepared.colorName==='string'&&prepared.colorName.trim()){
    document.getElementById('color').value=prepared.colorName.trim();
  }
  modelSummary=summary;
  details.setCustomValidity('');
  const orderType=document.getElementById('type');
  if(orderType.value!=='Печать по моей модели'){
    orderType.value='Печать по моей модели';
    orderType.dispatchEvent(new Event('change',{bubbles:true}));
  }
  if(prepared.file.size>ORDER_MODEL_LIMIT){
    prepared.error='STL больше 15 МБ. Параметры добавлены в заявку. Файл можно отправить отдельно.';
    return;
  }
  try{
    const transfer=new DataTransfer();
    transfer.items.add(prepared.file);
    orderModelInput.files=transfer.files;
    if(!orderModelInput.files.length)throw new Error();
  }catch{
    prepared.error='Браузер не смог прикрепить STL. Параметры добавлены в заявку. Скачайте файл для ручной отправки.';
    return;
  }
  attachedModel=prepared.file;
  orderModelName.textContent=prepared.file.name+' · '+(prepared.file.size/1024/1024).toFixed(2)+' МБ · загрузится при отправке заявки';
  orderModelPanel.hidden=false;
  prepared.attached=true;
});

document.getElementById('order-stl-remove').addEventListener('click',removeOrderModel);
document.getElementById('order-stl-download').addEventListener('click',()=>{
  if(!attachedModel)return;
  const url=URL.createObjectURL(attachedModel);
  const link=document.createElement('a');
  link.href=url;
  link.download=attachedModel.name;
  link.click();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
});

async function uploadOrderModel(file){
  if(uploadedModel?.file===file)return uploadedModel.url;
  const body=new FormData();
  body.set('file',file,file.name);
  const response=await fetch(ORDER_MODEL_URL,{method:'POST',body});
  const data=await response.json().catch(()=>null);
  const url=data?.url;
  if(!response.ok||typeof url!=='string'||!url.startsWith(ORDER_MODEL_URL+'/')){
    throw new Error('Не удалось загрузить STL. '+(data?.error||'Попробуйте ещё раз или скачайте файл для отправки через MAX.'));
  }
  uploadedModel={file,url};
  return url;
}

briefForm.addEventListener('submit',async event=>{
  event.preventDefault();
  const consent=document.getElementById('legal-consent');
  const detailsField=document.getElementById('details');
  orderContact.setCustomValidity('');
  detailsField.setCustomValidity('');
  if(!detailsField.value.trim()){
    detailsField.setCustomValidity('Опишите вашу идею');
  }
  if(!isValidOrderContact(orderContact.value)){
    orderContact.setCustomValidity('Укажите телефон, Telegram (@имя) или корректный e-mail.');
  }
  if(!consent.checked){
    orderStatus.textContent='Для отправки заявки примите условия оферты и согласие на обработку персональных данных.';
    orderStatus.className='form-note order-status is-error';
    consent.focus();
    return;
  }
  if(!briefForm.reportValidity())return;

  const formData=new FormData(briefForm);
  const item=String(formData.get('type')||'').trim();
  const quantity=Number(formData.get('qty'));
  const color=String(formData.get('color')||'').trim();
  const description=String(formData.get('details')||'').trim();
  const contact=String(formData.get('contact')||'').trim();
  const modelFile=attachedModel;
  if(modelFile&&description.length>1800){
    detailsField.setCustomValidity('Сократите описание до 1800 символов, чтобы добавить ссылку на STL.');
    detailsField.reportValidity();
    return;
  }
  const estimateText=calcTotal.textContent||'';
  const estimateValue=Number(estimateText.replace(/[^\d]/g,''));
  const total=calculatorApplied&&estimateValue>0
    ? estimateValue+Math.round(Number(selectedDelivery?.price||0))
    : null;
  const delivery=selectedDelivery?{
    method:'СДЭК',
    city:selectedDelivery.city,
    pvz:selectedDelivery.pvz,
    tariff:selectedDelivery.tariff,
    price:selectedDelivery.price,
    days:selectedDelivery.days
  }:null;
  const payload={item,quantity,color,description,contact,delivery};
  if(total!==null)payload.total=total;

  const lines=[
    'Здравствуйте! Хочу оформить заказ в DEXEL 3D.',
    'Изделие: '+item,
    'Количество: '+quantity,
    'Цвет: '+(color||'подобрать вместе'),
    'Контакт: '+contact,
    'Задача: '+description
  ];
  if(selectedDelivery){
    lines.push('Доставка СДЭК: '+selectedDelivery.city+', ПВЗ '+selectedDelivery.pvz+', тариф «'+selectedDelivery.tariff+'» ('+rubles.format(selectedDelivery.price)+' ₽, '+selectedDelivery.days+')');
  }
  if(total!==null)lines.push('Ориентировочная итоговая сумма: '+rubles.format(total)+' ₽');
  lines.push('Подскажите, пожалуйста, срок изготовления.');
  let modelLink='';

  const originalButtonMarkup=orderSubmitButton.innerHTML;
  orderSubmitButton.disabled=true;
  orderSubmitButton.textContent='Отправляем...';
  orderStatus.textContent='Отправляем заявку в мастерскую…';
  orderStatus.className='form-note order-status';
  try{
    if(modelFile){
      orderStatus.textContent='Загружаем STL…';
      modelLink=await uploadOrderModel(modelFile);
      payload.description='Скачать STL (ссылка действует 14 дней): '+modelLink+'\n\n'+description;
      orderStatus.textContent='STL загружен. Отправляем заявку в мастерскую…';
    }
    const response=await fetch(apiUrl('api/send-order'),{
      method:'POST',
      headers:{'content-type':'application/json','accept':'application/json'},
      body:JSON.stringify(payload)
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok||data.ok!==true){
      throw new Error(data.error||'Сервер не подтвердил отправку заявки. Попробуйте ещё раз.');
    }
    reachMetrikaGoal('order_submit');
    orderStatus.textContent='Заявка отправлена! Мы получили её на почту и скоро свяжемся с вами.';
    orderStatus.className='form-note order-status is-success';
    document.getElementById('brief-result').hidden=true;
    document.getElementById('copy-status').textContent='';
  }catch(error){
    const message=error instanceof TypeError
      ? 'Не удалось связаться с мастерской. Скопируйте текст заявки и отправьте его вручную.'
      : (error.message||'Не удалось отправить заявку. Скопируйте текст и отправьте его вручную.');
    orderStatus.textContent=message;
    orderStatus.className='form-note order-status is-error';
    document.getElementById('brief-text').value=[...lines,
      modelLink?'STL: '+modelLink:modelFile?'Файл STL отправлю отдельно.':''
    ].filter(Boolean).join('\n');
    document.getElementById('brief-result').hidden=false;
    document.getElementById('copy-status').textContent='Заявку можно отправить вручную по этому тексту.';
  }finally{
    orderSubmitButton.disabled=false;
    orderSubmitButton.innerHTML=originalButtonMarkup;
  }
});
orderContact.addEventListener('input',()=>orderContact.setCustomValidity(''));
document.getElementById('details').addEventListener('input',e=>e.target.setCustomValidity(''));
document.getElementById('copy-brief').addEventListener('click',async()=>{const area=document.getElementById('brief-text');try{await navigator.clipboard.writeText(area.value);document.getElementById('copy-status').textContent='Скопировано. Отправьте текст мастеру удобным способом.'}catch{area.focus();area.select();document.getElementById('copy-status').textContent='Выделили текст. Скопируйте его вручную.'}});

const toolHashes=new Map([
  ['#viewer','stl-viewer-dialog'], ['#stl','stl-viewer-dialog'], ['#stl-viewer','stl-viewer-dialog'],
  ['#cdek-delivery','cdek-dialog'], ['#pricing-details','pricing-dialog']
]);
let hashDialog;
function openLegalDialog(dialog) {
  if (!dialog || dialog.open) return;
  dialog.showModal();
  dialog.dispatchEvent(new Event('voxel:dialog-open'));
}
function followHomeHash() {
  const hash=window.location.hash;
  const dialogId=toolHashes.get(hash);
  const target=dialogId ? document.getElementById(dialogId) : null;
  if (hashDialog && hashDialog !== target && hashDialog.open) hashDialog.close();
  hashDialog=target;
  if (target) {
    openLegalDialog(target);
  } else if (hash === '#process' || hash === '#materials') {
    document.getElementById(hash.slice(1)).open=true;
  }
}
window.addEventListener('hashchange',followHomeHash);
window.addEventListener('DOMContentLoaded',followHomeHash,{once:true});
document.querySelectorAll('[data-legal-dialog]').forEach(link=>link.addEventListener('click',event=>{
  if (event.button > 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  openLegalDialog(document.getElementById(link.dataset.legalDialog));
}));
document.querySelectorAll('.legal-dialog').forEach(dialog=>{
  dialog.querySelector('.legal-close').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('click',event=>{
    if (event.target !== dialog) return;
    if (!dialog.classList.contains('tool-dialog')) {
      dialog.close();
      return;
    }
    const rect=dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right ||
        event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
  if (dialog.classList.contains('tool-dialog')) {
    dialog.addEventListener('close',()=>{
      if (!dialog.open && toolHashes.get(window.location.hash) === dialog.id) {
        history.replaceState(history.state,'',window.location.pathname+window.location.search);
      }
    });
    dialog.querySelectorAll('a[href="#request"]').forEach(link=>link.addEventListener('click',()=>dialog.close()));
  }
});

const calcProduct=document.getElementById('calc-product');
const calcQuantity=document.getElementById('calc-quantity');
const calcTotal=document.getElementById('calc-total');
const calcNote=document.getElementById('calc-note');
const calcOrderLink=document.getElementById('calc-order-link');
const calcMaterial=document.getElementById('calc-material');
const calcMaterialWrap=document.getElementById('calc-material-wrap');
const calcDimensions=document.getElementById('calc-dimensions');
const calcDimensionInputs=['calc-length','calc-width','calc-height'].map(id=>document.getElementById(id));
const rubles=new Intl.NumberFormat('ru-RU',{maximumFractionDigits:0});
function updatePriceEstimate(){
  const count=Number(calcQuantity.value);
  if(!Number.isInteger(count)||count<1){calcTotal.textContent='—';calcNote.textContent='Введите количество от 1 до 10 000.';calcOrderLink.setAttribute('aria-disabled','true');return}
  const quantity=Math.min(count,10000);
  if(quantity!==count)calcQuantity.value=String(quantity);
  const option=calcProduct.selectedOptions[0];
  const startsFrom=option.dataset.minimum==='true';
  calcDimensions.hidden=!startsFrom;
  calcMaterialWrap.hidden=startsFrom;
  const dimensions=calcDimensionInputs.map(input=>Number(input.value));
  const dimensionsReady=dimensions.every(value=>Number.isFinite(value)&&value>0);
  const material=calcMaterial.selectedOptions[0];
  const factor=startsFrom?1:Number(calcMaterial.value);
  const unitPrice=Math.round(Number(option.value)*factor);
  const total=unitPrice*quantity;
  calcTotal.textContent=(startsFrom?'от ':'')+rubles.format(total)+' ₽';
  calcNote.textContent=startsFrom?(dimensionsReady?'Размер '+dimensions.map(rubles.format).join(' × ')+' см учтём при подготовке точной сметы. Цена указана от базовой и зависит от габаритов и сложности модели.':'Укажите длину, ширину и высоту, чтобы приложить размеры к заявке. Цена от 200 ₽ — ориентир; итог зависит от габаритов и сложности.'):'Расчёт: '+quantity+' × '+rubles.format(unitPrice)+' ₽ за '+option.dataset.priceUnit+' ('+material.dataset.material+', коэффициент ×'+Number(calcMaterial.value).toFixed(2)+'). Точную сумму подтвердим после согласования деталей.';
  calcOrderLink.removeAttribute('aria-disabled');
}
calcProduct.addEventListener('change',updatePriceEstimate);
calcQuantity.addEventListener('input',updatePriceEstimate);
calcMaterial.addEventListener('change',updatePriceEstimate);
calcDimensionInputs.forEach(input=>input.addEventListener('input',updatePriceEstimate));
[calcProduct,calcQuantity,calcMaterial,...calcDimensionInputs,document.getElementById('type'),document.getElementById('qty')].forEach(field=>field.addEventListener(field.tagName==='SELECT'?'change':'input',()=>clearCalculatedOrderTotal()));
calcOrderLink.addEventListener('click',event=>{
  const count=Number(calcQuantity.value);
  if(!Number.isInteger(count)||count<1){event.preventDefault();calcQuantity.focus();return}
  const option=calcProduct.selectedOptions[0];
  const quantity=Math.min(count,10000);
  const startsFrom=option.dataset.minimum==='true';
  const dimensions=calcDimensionInputs.map(input=>input.value.trim());
  if(startsFrom&&!dimensions.every(value=>Number(value)>0)){event.preventDefault();calcDimensionInputs.find(input=>!Number(input.value)||Number(input.value)<=0)?.focus();return}
  const typeSelect=document.getElementById('type');
  const detailField=document.getElementById('details');
  typeSelect.value=option.dataset.requestType;
  document.getElementById('qty').value=String(quantity);
  const factor=startsFrom?1:Number(calcMaterial.value);
  const unitPrice=Math.round(Number(option.value)*factor);
  const itemsTotal=unitPrice*quantity;
  const amount=(startsFrom?'от ':'')+rubles.format(itemsTotal)+' ₽';
  const materialText=startsFrom?'':', пластик '+calcMaterial.selectedOptions[0].dataset.material+' (коэффициент ×'+Number(factor).toFixed(2)+')';
  const dimensionsText=startsFrom?', размеры '+dimensions.join(' × ')+' см':'';
  detailField.value='Расчёт в калькуляторе: '+option.textContent.split(' — ')[0]+', количество '+quantity+materialText+dimensionsText+'; ориентир '+amount+'. Прошу подтвердить итоговую стоимость.';
  calculatorApplied=true;
  calculatedItemsTotal=startsFrom?null:itemsTotal;
  const paymentAmountField=document.getElementById('payment-amount');
  if(paymentAmountField){
    paymentAmountField.readOnly=!startsFrom;
    paymentAmountField.value=startsFrom?'':String(itemsTotal+(selectedDelivery?selectedDelivery.price:0));
    const hint=document.getElementById('payment-base-hint');
    if(hint)hint.textContent=startsFrom?'Калькулятор показывает цену «от». Введите согласованную с мастером полную стоимость заказа.':'Полная стоимость подставлена из калькулятора и включает выбранную доставку СДЭК.';
    syncPaymentSummary();
  }
});
updatePriceEstimate();

const cdekForm=document.getElementById('cdek-form');
const cdekCity=document.getElementById('cdek-city');
const cdekCityCode=document.getElementById('cdek-city-code');
const cdekSuggestions=document.getElementById('cdek-city-suggestions');
const cdekStatus=document.getElementById('cdek-status');
const cdekRates=document.getElementById('cdek-rates');
const cdekPvz=document.getElementById('cdek-pvz');
const cdekPvzList=document.getElementById('cdek-pvz-list');
const cdekPvzStatus=document.getElementById('cdek-pvz-status');
const cdekDeliveryPoint=document.getElementById('cdek-delivery-point');
let selectedPvzLabel='';
let cdekSearchTimer;
let cdekSearchController;
let cdekPvzController;
let cdekRatesController;

async function cdekRequest(route,{params,signal,body}={}){
  const headers={accept:'application/json'};
  const options={headers,signal};
  if(body){
    options.method='POST';
    headers['content-type']='application/json';
    options.body=JSON.stringify(body);
  }
  let response, raw;
  try{
    response=await fetch(apiUrl('api/cdek/'+route,params),options);
    raw=await response.text();
  }catch(error){
    if(error.name==='AbortError')throw error;
    throw new Error('Нет связи с сервером СДЭК.',{cause:error});
  }
  const status='HTTP '+response.status;
  let data;
  if(raw.trim()){
    try{data=JSON.parse(raw)}
    catch{
      if(response.ok)throw new Error('Сервер вернул ответ не в формате JSON ('+status+').');
    }
  }
  const jsonError=[data?.error,data?.message].find(value=>typeof value==='string'&&value.trim());
  if(!response.ok || data?.ok===false || data?.error){
    const textError=!data&&!raw.trimStart().startsWith('<')?raw.trim().slice(0,300):'';
    const detail=jsonError || textError || (!raw.trim()?'пустой ответ сервера':'сервер не сообщил причину ошибки');
    throw new Error(status+' — '+detail);
  }
  if(!raw.trim())throw new Error('Сервер вернул пустой ответ ('+status+').');
  if(!data || typeof data!=='object')throw new Error('Сервер вернул ответ неожиданного формата ('+status+').');
  return data;
}

function cdekList(data,...keys){
  for(const key of keys){
    if(Array.isArray(data[key]))return data[key];
  }
  throw new Error('В ответе сервера нет ожидаемого списка ('+keys[0]+').');
}

function showCdekError(error,action,status=cdekStatus){
  if(error.name==='AbortError')return;
  console.error('[СДЭК] '+action,error);
  if(status)status.textContent=action+': '+error.message;
}

document.getElementById('cdek-dialog').addEventListener('voxel:dialog-open',()=>{
  const cdekCheckingStatus=cdekStatus.textContent;
  cdekRequest('status').then(data=>{
    if(cdekStatus.textContent!==cdekCheckingStatus)return;
    cdekStatus.textContent=(data.cdekConfigured??data.ready)
      ? 'Введите город получения и укажите вес упакованного заказа.'
      : 'Расчёт доставки пока недоступен. Оставьте заявку — уточним условия.';
  }).catch(error=>{
    showCdekError(error,'Не удалось проверить подключение',cdekStatus.textContent===cdekCheckingStatus?cdekStatus:null);
  });
},{once:true});

function hideCdekSuggestions(){cdekSuggestions.hidden=true;cdekCity.setAttribute('aria-expanded','false')}
function showCdekSuggestions(){cdekSuggestions.hidden=false;cdekCity.setAttribute('aria-expanded','true')}

function cancelCdekCitySearch(){
  clearTimeout(cdekSearchTimer);
  cdekSearchController?.abort();
  cdekSuggestions.replaceChildren();
  hideCdekSuggestions();
}

async function findCdekCities(query,signal){
  const data=await cdekRequest('cities',{params:{q:query},signal});
  const cities=cdekList(data,'cities');
  const suggestions=cities.map(city=>({
    code:Number(city?.code),
    name:city?.fullName||city?.name||[city?.city,city?.region].filter(Boolean).join(', ')
  })).filter(city=>Number.isInteger(city.code)&&city.code>0&&city.name);
  if(cities.length&&!suggestions.length)throw new Error('В ответе сервера нет городов с кодом и названием.');
  return suggestions;
}

function chooseCdekCity(city){
  cancelCdekCitySearch();
  cdekCity.value=city.name;
  cdekCityCode.value=String(city.code);
  loadCdekPvz(city.code);
}

async function loadCdekPvz(cityCode){
  cdekPvzController?.abort();
  const controller=cdekPvzController=new AbortController();
  cdekPvz.hidden=false;
  cdekDeliveryPoint.value='';
  selectedPvzLabel='';
  cdekPvzList.replaceChildren();
  cdekPvzStatus.textContent='Загружаем пункты выдачи…';
  try{
    const data=await cdekRequest('delivery-points',{params:{city_code:cityCode},signal:controller.signal});
    if(controller.signal.aborted)return;
    const points=cdekList(data,'points','deliveryPoints');
    if(!points.length){cdekPvzStatus.textContent='В этом городе пункты выдачи не найдены.';return}
    cdekPvzStatus.textContent='Выберите пункт выдачи ('+points.length+'), если нужен самовывоз.';
    points.forEach((point)=>{
      const label=document.createElement('label');label.className='cdek-pvz-card';
      const radio=document.createElement('input');radio.type='radio';radio.name='cdek-pvz-choice';radio.value=point.code;
      radio.addEventListener('change',()=>{
        cdekDeliveryPoint.value=point.code;
        selectedPvzLabel=point.name+' ('+point.address+')';
        if(selectedDelivery)selectedDelivery.pvz=selectedPvzLabel;
        cdekPvzStatus.textContent='Пункт выдачи выбран.';
      });
      const details=document.createElement('span');details.className='cdek-pvz-details';
      const name=document.createElement('strong');name.textContent=point.name;
      const address=document.createElement('span');address.textContent=point.address;
      const hours=document.createElement('small');hours.textContent=point.workTime;
      details.append(name,address);if(point.workTime)details.append(hours);label.append(radio,details);cdekPvzList.append(label);
    });
  }catch(error){
    if(!controller.signal.aborted)showCdekError(error,'Не удалось загрузить пункты выдачи',cdekPvzStatus);
  }
}

const cdekNoCity='Город не найден. Проверьте полное название.';
cdekCity.addEventListener('input',()=>{
  cancelCdekCitySearch();
  cdekPvzController?.abort();
  cdekRatesController?.abort();
  cdekCityCode.value='';
  cdekDeliveryPoint.value='';
  selectedPvzLabel='';
  selectedDelivery=null;
  refreshCalculatedPaymentTotal();
  cdekPvz.hidden=true;
  cdekPvzList.replaceChildren();
  cdekRates.hidden=true;
  const query=cdekCity.value.trim();
  if(query.length<2){
    cdekStatus.textContent='Введите название города получения.';
    return;
  }
  cdekStatus.textContent='Ищем город в справочнике СДЭК…';
  cdekSearchTimer=setTimeout(async()=>{
    const controller=cdekSearchController=new AbortController();
    try{
      const cities=await findCdekCities(query,controller.signal);
      if(controller.signal.aborted)return;
      if(!cities.length){
        cdekStatus.textContent=cdekNoCity;
        return;
      }
      for(const city of cities){
        const option=document.createElement('button');
        option.type='button';
        option.className='cdek-suggestion';
        option.setAttribute('role','option');
        option.textContent=city.name;
        option.addEventListener('click',()=>{
          chooseCdekCity(city);
          cdekStatus.textContent='Город выбран. Можно рассчитать тарифы.';
        });
        cdekSuggestions.append(option);
      }
      showCdekSuggestions();
      cdekStatus.textContent='Выберите город из списка или нажмите «Узнать тарифы СДЭК».';
    }catch(error){
      if(!controller.signal.aborted)showCdekError(error,'Не удалось найти город');
    }
  },300);
});
cdekCity.addEventListener('keydown',event=>{if(event.key==='Escape')hideCdekSuggestions()});
document.addEventListener('click',event=>{if(!event.target.closest('.cdek-city-field'))hideCdekSuggestions()});
function deliveryDays(min,max){
  if(!min&&!max)return '';
  if(min===max)return min+' раб. дн.';
  return 'от '+(min||max)+' до '+(max||min)+' раб. дн.';
}
function selectTariff(tariff,cardElement){
  document.querySelectorAll('.cdek-rate-card').forEach(el=>el.style.outline='');
  cardElement.style.outline='2px solid #d4a359';
  const days=deliveryDays(tariff.daysMin,tariff.daysMax);
  selectedDelivery={
    city:cdekCity.value.trim(),
    pvz:selectedPvzLabel||cdekDeliveryPoint.value,
    tariff:tariff.name,
    price:Number(tariff.price||0),
    days:days
  };
  refreshCalculatedPaymentTotal();
  cdekStatus.textContent='Выбран тариф «'+tariff.name+'» ('+rubles.format(selectedDelivery.price)+' ₽) — прикрепится к вашей заявке ниже.';
}
function renderCdekRates(tariffs){
  cdekRates.replaceChildren();
  if(!tariffs.length){
    cdekStatus.textContent='Для этого направления тарифы не найдены.';
    return;
  }
  const heading=document.createElement('h4');heading.textContent='Доступные тарифы (нажмите на нужный, чтобы добавить в заявку)';cdekRates.append(heading);
  const list=document.createElement('div');list.className='cdek-rate-list';
  tariffs.forEach((tariff,idx)=>{
    const card=document.createElement('article');card.className='cdek-rate-card';card.style.cursor='pointer';
    const name=document.createElement('h5');name.textContent=tariff.name;
    const period=document.createElement('p');period.textContent=deliveryDays(tariff.daysMin,tariff.daysMax);
    const price=document.createElement('strong');price.textContent=rubles.format(tariff.price)+' ₽';
    card.append(name,period,price);
    card.addEventListener('click',()=>selectTariff(tariff,card));
    list.append(card);
    if(idx===0)selectTariff(tariff,card);
  });
  cdekRates.append(list);cdekRates.hidden=false;
}
cdekForm.addEventListener('submit',async event=>{
  event.preventDefault();
  const button=cdekForm.querySelector('button[type="submit"]');
  if(button.disabled)return;
  const query=cdekCity.value.trim();
  if(query.length<2){
    cdekStatus.textContent='Введите название города получения.';
    cdekCity.focus();
    return;
  }
  const weightField=document.getElementById('cdek-weight');
  const weight=Number(weightField.value);
  if(!Number.isInteger(weight)||weight<1){
    cdekStatus.textContent='Укажите вес посылки в граммах.';
    weightField.focus();
    return;
  }
  const dimensions=['length','width','height'].map(key=>document.getElementById('cdek-'+key).value.trim());
  const hasDimensions=dimensions.some(Boolean);
  if(hasDimensions&&dimensions.some(value=>!value||!Number.isInteger(Number(value))||Number(value)<1)){
    cdekStatus.textContent='Заполните все три размера в сантиметрах или оставьте их пустыми.';
    return;
  }

  cancelCdekCitySearch();
  const controller=cdekRatesController=new AbortController();
  const originalMarkup=button.innerHTML;
  button.disabled=true;
  button.textContent='Считаем тарифы…';
  cdekRates.hidden=true;
  selectedDelivery=null;
  refreshCalculatedPaymentTotal();
  let errorAction='Не удалось найти город';
  try{
    if(!cdekCityCode.value){
      cdekStatus.textContent='Ищем город в справочнике СДЭК…';
      const cities=await findCdekCities(query,controller.signal);
      if(controller.signal.aborted)return;
      if(!cities.length){
        cdekStatus.textContent=cdekNoCity;
        cdekCity.focus();
        return;
      }
      chooseCdekCity(cities[0]);
    }
    errorAction='Не удалось рассчитать доставку';
    cdekStatus.textContent='Запрашиваем стоимость и срок доставки у СДЭК…';
    const body={cityCode:Number(cdekCityCode.value),weight};
    if(hasDimensions)[body.length,body.width,body.height]=dimensions.map(Number);
    const data=await cdekRequest('rates',{body,signal:controller.signal});
    if(controller.signal.aborted)return;
    const tariffs=cdekList(data,'tariffs').map(tariff=>({
      name:tariff?.tariff_name??tariff?.name,
      price:tariff?.delivery_sum??tariff?.price,
      daysMin:tariff?.period_min??tariff?.daysMin,
      daysMax:tariff?.period_max??tariff?.daysMax
    }));
    if(tariffs.some(tariff=>!tariff.name||tariff.price==null||!Number.isFinite(Number(tariff.price)))){
      throw new Error('Сервер вернул тариф без названия или стоимости.');
    }
    renderCdekRates(tariffs);
  }catch(error){
    if(!controller.signal.aborted)showCdekError(error,errorAction);
  }finally{
    button.disabled=false;
    button.innerHTML=originalMarkup;
  }
});

const paymentButton=document.getElementById('create-payment');
const paymentStatus=document.getElementById('payment-status');
const paymentForm=document.getElementById('brief-form');
const paymentEmail=document.getElementById('payment-email');
const yookassaDialog=document.getElementById('yookassa-dialog');
const yookassaPayForm=document.getElementById('yookassa-pay-form');
const yookassaHostedPayForm=document.getElementById('yk-hosted-pay-form');
const yookassaAmount=document.getElementById('yk-sum-input');
const paymentAmountField=document.getElementById('payment-amount');
const paymentModeSummary=document.getElementById('payment-mode-summary');
const yookassaOrderTotal=document.getElementById('yk-order-total');
const yookassaAmountSummary=document.getElementById('yk-amount-summary');
const yookassaOrderSummary=document.getElementById('yk-order-summary');
const yookassaFormStatus=document.getElementById('yookassa-form-status');
const yookassaSubmitButton=document.getElementById('yk-payment-submit');
let yookassaOrderReference='';

function makeYookassaOrderReference(){
  const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return 'V3D-'+Array.from({length:4},()=>chars[Math.floor(Math.random()*chars.length)]).join('');
}
function paymentDeliveryDetails(){
  return selectedDelivery?{
    method:'СДЭК',
    city:selectedDelivery.city||'',
    pvz:selectedDelivery.pvz||'',
    tariff:selectedDelivery.tariff||'',
    price:Number(selectedDelivery.price||0),
    days:selectedDelivery.days||''
  }:{method:'не выбран'};
}
function paymentDescription(orderId,contact,item,quantity,amount,total,mode){
  const modeLabel=mode===50?'Оплата 50%':'Оплата 100%';
  const ratio=' ('+amount+'/'+total+' ₽)';
  return ('Заказ #'+orderId+' | '+modeLabel+ratio+' | Контакт: '+contact+' | '+item+' × '+quantity).slice(0,128);
}
function validatePaymentContact(){
  const validContact=isValidOrderContact(orderContact.value);
  const emailValue=paymentEmail.value.trim();
  const validEmail=Boolean(emailValue)&&paymentEmail.checkValidity();
  orderContact.setCustomValidity(validContact?'':'Укажите телефон, Telegram (@имя) или e-mail для связи.');
  paymentEmail.setCustomValidity(validEmail?'':'Укажите корректный e-mail для чека.');
  orderContact.classList.toggle('payment-field-invalid',!validContact);
  paymentEmail.classList.toggle('payment-field-invalid',!validEmail);
  orderContact.setAttribute('aria-invalid',String(!validContact));
  paymentEmail.setAttribute('aria-invalid',String(!validEmail));
  if(!validContact){orderContact.reportValidity();orderContact.focus();return false}
  if(!validEmail){paymentEmail.reportValidity();paymentEmail.focus();return false}
  return paymentForm.reportValidity();
}
[orderContact,paymentEmail].forEach(field=>field.addEventListener('input',()=>{
  field.setCustomValidity('');
  field.classList.remove('payment-field-invalid');
  field.setAttribute('aria-invalid','false');
}));
document.getElementById('payment-amount').addEventListener('input',event=>event.target.classList.remove('payment-field-invalid'));
yookassaAmount.addEventListener('input',()=>yookassaAmount.classList.remove('payment-field-invalid'));
function selectedPaymentMode(){
  const selected=document.querySelector('input[name="payment-mode-main"]:checked');
  return selected?Number(selected.value):paymentMode;
}
function currentOrderTotal(){
  const total=Number(paymentAmountField.value);
  return Number.isFinite(total)&&total>=1&&total<=300000?Math.round(total):null;
}
function paymentAmountFor(total,mode){
  return mode===50?Math.round(total*0.5):total;
}
function paymentModeText(total,mode,amount){
  return mode===50
    ? 'К оплате: '+rubles.format(amount)+' ₽ (Предоплата 50% от '+rubles.format(total)+' ₽)'
    : 'К оплате: '+rubles.format(amount)+' ₽ (Полная оплата 100%)';
}
function syncPaymentSummary(){
  paymentMode=selectedPaymentMode();
  const total=currentOrderTotal();
  const amount=total===null?null:paymentAmountFor(total,paymentMode);
  if(paymentModeSummary)paymentModeSummary.textContent=total===null
    ? 'Укажите полную согласованную стоимость заказа, чтобы рассчитать сумму к оплате.'
    : paymentModeText(total,paymentMode,amount);
  if(yookassaOrderTotal)yookassaOrderTotal.textContent=total===null
    ? 'Полная стоимость заказа не указана.'
    : 'Полная стоимость заказа: '+rubles.format(total)+' ₽';
  if(yookassaAmount)yookassaAmount.value=amount===null?'':String(amount);
  if(yookassaAmountSummary)yookassaAmountSummary.textContent=total===null
    ? 'Сумма появится после ввода полной стоимости заказа.'
    : paymentModeText(total,paymentMode,amount);
}
function clearCalculatedOrderTotal(){
  calculatorApplied=false;
  calculatedItemsTotal=null;
  paymentAmountField.readOnly=false;
  paymentAmountField.value='';
  const hint=document.getElementById('payment-base-hint');
  if(hint)hint.textContent='Введите согласованную стоимость заказа вручную или примените точный расчёт в калькуляторе.';
  syncPaymentSummary();
}
function refreshCalculatedPaymentTotal(){
  if(calculatorApplied&&calculatedItemsTotal!==null){
    paymentAmountField.value=String(calculatedItemsTotal+(selectedDelivery?selectedDelivery.price:0));
    syncPaymentSummary();
  }
}
document.querySelectorAll('input[name="payment-mode-main"],input[name="payment-mode-dialog"]').forEach(radio=>{
  radio.addEventListener('change',()=>{
    if(!radio.checked)return;
    paymentMode=Number(radio.value);
    document.querySelectorAll('input[name="payment-mode-main"],input[name="payment-mode-dialog"]').forEach(peer=>{
      peer.checked=Number(peer.value)===paymentMode;
    });
    syncPaymentSummary();
  });
});
paymentAmountField.addEventListener('input',()=>{
  calculatorApplied=false;
  calculatedItemsTotal=null;
  paymentAmountField.readOnly=false;
  paymentAmountField.classList.remove('payment-field-invalid');
  syncPaymentSummary();
});
function syncYookassaAmount(){
  const total=currentOrderTotal();
  if(total===null)return false;
  yookassaAmount.value=String(paymentAmountFor(total,paymentMode));
  return true;
}
syncPaymentSummary();
if(paymentButton&&yookassaDialog&&yookassaPayForm){
  paymentButton.addEventListener('click',()=>{
    paymentStatus.textContent='';
    if(!validatePaymentContact())return;
    const amountField=paymentAmountField;
    const total=currentOrderTotal();
    if(total===null){
      paymentStatus.textContent='Укажите полную согласованную стоимость заказа от 1 до 300 000 ₽.';
      amountField.classList.add('payment-field-invalid');
      amountField.focus();
      return;
    }
    paymentMode=selectedPaymentMode();
    if(!document.getElementById('legal-consent').checked){
      paymentStatus.textContent='Для оплаты примите условия оферты и согласие на обработку персональных данных.';
      document.getElementById('legal-consent').focus();
      return;
    }
    yookassaOrderReference=makeYookassaOrderReference();
    syncYookassaAmount();
    document.querySelectorAll('input[name="payment-mode-dialog"]').forEach(radio=>{radio.checked=Number(radio.value)===paymentMode});
    syncPaymentSummary();
    yookassaOrderSummary.textContent='Заказ #'+yookassaOrderReference+' · '+document.getElementById('type').value+' × '+document.getElementById('qty').value;
    yookassaFormStatus.textContent='';
    yookassaDialog.showModal();
  });
  yookassaPayForm.addEventListener('submit',async event=>{
    event.preventDefault();
    if(!validatePaymentContact()){
      yookassaDialog.close();
      return;
    }
    paymentMode=Number(document.querySelector('input[name="payment-mode-dialog"]:checked')?.value||paymentMode);
    const total=currentOrderTotal();
    const amount=total===null?NaN:paymentAmountFor(total,paymentMode);
    if(!Number.isFinite(amount)||amount<1||amount>300000){
      yookassaFormStatus.textContent='Укажите полную согласованную стоимость заказа от 1 до 300 000 ₽.';
      paymentAmountField.classList.add('payment-field-invalid');
      yookassaDialog.close();
      paymentAmountField.focus();
      return;
    }
    if(!document.getElementById('legal-consent').checked){
      yookassaFormStatus.textContent='Для оплаты примите условия оферты и согласие на обработку персональных данных.';
      return;
    }

    const contact=orderContact.value.trim();
    const email=paymentEmail.value.trim();
    const item=document.getElementById('type').value.trim();
    const quantity=Number(document.getElementById('qty').value);
    const color=document.getElementById('color').value.trim();
    const taskDescription=document.getElementById('details').value.trim();
    const delivery=paymentDeliveryDetails();
    const orderId=yookassaOrderReference||makeYookassaOrderReference();
    const description=paymentDescription(orderId,contact,item,quantity,amount,total,paymentMode);
    const paymentLabel=paymentMode===50?'Оплата 50%':'Оплата 100%';
    const metadata={
      order_id:orderId,
      contact,
      email,
      item,
      quantity:String(quantity),
      color,
      delivery:JSON.stringify(delivery),
      description:taskDescription,
      payment_mode:paymentMode,
      payment_amount:String(amount),
      total:String(total)
    };
    const noticeDescription=(description+' | '+taskDescription).slice(0,1000);
    const orderNotice={
      order_id:orderId,
      item,
      quantity,
      color,
      description:noticeDescription,
      contact,
      email,
      customer_email:email,
      delivery,
      payment_mode:paymentMode,
      payment_amount:amount,
      total
    };
    yookassaSubmitButton.disabled=true;
    reachMetrikaGoal('yookassa_pay');
    yookassaFormStatus.textContent='Отправляем карточку заказа и создаём платёж…';
    try{
      const noticeResponse=await fetch(apiUrl('api/send-order'),{
        method:'POST',
        headers:{'content-type':'application/json','accept':'application/json'},
        body:JSON.stringify(orderNotice)
      });
      const noticeData=await noticeResponse.json().catch(()=>({}));
      if(!noticeResponse.ok||noticeData.ok!==true){
        throw new Error(noticeData.error||'Не удалось отправить карточку заказа в мастерскую. Платёж не создан.');
      }
      const returnUrl=new URL('/?payment=return',window.location.origin).toString();
      const paymentResponse=await fetch(apiUrl('api/create-payment'),{
        method:'POST',
        headers:{'content-type':'application/json','accept':'application/json'},
        body:JSON.stringify({
          amount_rub:amount,
          customer_email:email,
          description,
          return_url:returnUrl,
          legal_consent:true,
          metadata
        })
      });
      const paymentData=await paymentResponse.json().catch(()=>({}));
      // Use the hosted form only when the API explicitly rejects payment before creation.
      if(yookassaHostedPayForm && paymentResponse.status === 503 &&
          /ожидает\s+активации\s+боевых\s+ключей/iu.test(paymentData.error||'')){
        yookassaHostedPayForm.elements.namedItem('sum').value=amount.toFixed(2);
        yookassaHostedPayForm.elements.namedItem('customerNumber').value=description;
        yookassaFormStatus.textContent='Карточка заказа отправлена. Переходим к оплате…';
        yookassaHostedPayForm.submit();
        return;
      }
      if(!paymentResponse.ok)throw new Error(paymentData.error||'Не удалось создать платёж ЮKassa.');
      if(typeof paymentData.confirmation_url!=='string'||!paymentData.confirmation_url.startsWith('https://')){
        throw new Error('ЮKassa не вернула ссылку для оплаты.');
      }
      yookassaFormStatus.textContent='Карточка заказа отправлена. Переходим к оплате…';
      window.location.assign(paymentData.confirmation_url);
    }catch(error){
      const serverMessage=String(error&&error.message||'');
      yookassaFormStatus.textContent=/актив|ключ/i.test(serverMessage)
        ? 'Не удалось подготовить оплату. Свяжитесь с мастером, чтобы уточнить способ оплаты.'
        : (serverMessage||'Не удалось создать платёж. Попробуйте ещё раз.');
      yookassaSubmitButton.disabled=false;
    }
  });
  yookassaDialog.querySelector('.legal-close').addEventListener('click',()=>yookassaDialog.close());
  yookassaDialog.addEventListener('click',event=>{
    if(event.target===yookassaDialog){
      const rect=yookassaDialog.getBoundingClientRect();
      if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)yookassaDialog.close();
    }
  });
}
if(new URLSearchParams(window.location.search).get('payment')==='return'&&paymentStatus){
  paymentStatus.textContent='Вы вернулись со страницы оплаты. Статус платежа подтверждается ЮKassa; для самозанятого не забудьте зарегистрировать доход и чек в «Мой налог».';
}

/* Decorative ambient particles; kept independent from storefront interactions. */
(()=>{
  const canvas=document.getElementById('sparks-canvas');
  if(!canvas||!canvas.getContext)return;
  const ctx=canvas.getContext('2d');
  if(!ctx)return;
  const motionQuery=window.matchMedia('(prefers-reduced-motion: reduce)');
  const colors=['#f5b942','#ff8c24','#ffd97d'];
  let particles=[];
  let width=0,height=0,dpr=1,frameId=0,lastFrame=0,resizeTimer=0;
  let reduced=motionQuery.matches;
  let count=window.innerWidth<768?13:24;

  const random=(min,max)=>min+Math.random()*(max-min);
  function makeParticle(fromBottom=false){
    return {
      x:0,
      baseX:random(0,width),
      y:fromBottom?height+random(0,height*.08):random(height*.25,height*.98),
      size:random(1.2,2.8),
      speed:random(8,22),
      sway:random(4,13),
      phase:random(0,Math.PI*2),
      swayRate:random(.00025,.00055),
      alpha:random(.25,.65),
      color:colors[Math.floor(Math.random()*colors.length)]
    };
  }
  function resize(){
    width=window.innerWidth;
    height=window.innerHeight;
    dpr=Math.min(window.devicePixelRatio||1,2);
    canvas.width=Math.round(width*dpr);
    canvas.height=Math.round(height*dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);
    count=width<768?13:24;
    particles=Array.from({length:count},()=>makeParticle());
    ctx.clearRect(0,0,width,height);
  }
  function stop(){
    if(frameId)cancelAnimationFrame(frameId);
    frameId=0;
    lastFrame=0;
    ctx.clearRect(0,0,width,height);
  }
  function draw(time){
    frameId=0;
    if(reduced||document.hidden)return;
    const delta=lastFrame?Math.min((time-lastFrame)/1000,.05):0;
    lastFrame=time;
    ctx.clearRect(0,0,width,height);
    for(const spark of particles){
      spark.y-=spark.speed*delta;
      spark.x=spark.baseX+Math.sin(time*spark.swayRate+spark.phase)*spark.sway;
      if(spark.y<height*.24){
        Object.assign(spark,makeParticle(true));
        continue;
      }
      const fade=Math.max(0,Math.min(1,(spark.y-height*.24)/(height*.48)));
      ctx.globalAlpha=spark.alpha*fade;
      ctx.fillStyle=spark.color;
      ctx.shadowColor=spark.color;
      ctx.shadowBlur=spark.size*3;
      ctx.beginPath();
      ctx.arc(spark.x,spark.y,spark.size,0,Math.PI*2);
      ctx.fill();
    }
    ctx.globalAlpha=1;
    ctx.shadowBlur=0;
    frameId=requestAnimationFrame(draw);
  }
  function start(){
    if(reduced||document.hidden||frameId)return;
    lastFrame=0;
    frameId=requestAnimationFrame(draw);
  }
  function handleMotionChange(event){
    reduced=event.matches;
    if(reduced)stop();else start();
  }
  resize();
  if(motionQuery.addEventListener)motionQuery.addEventListener('change',handleMotionChange);
  else if(motionQuery.addListener)motionQuery.addListener(handleMotionChange);
  document.addEventListener('visibilitychange',()=>document.hidden?stop():start());
  window.addEventListener('resize',()=>{
    clearTimeout(resizeTimer);
    resizeTimer=setTimeout(()=>{resize();start()},140);
  });
  start();
})();
