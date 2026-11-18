const API_BASE_URL='https://functions.yandexcloud.net/d4evt0q80matet5dunuk';
function apiUrl(route,params={}){
  const url=new URL(API_BASE_URL);
  url.searchParams.set('route',route);
  Object.entries(params).forEach(([key,value])=>{
    if(value!==undefined&&value!==null&&value!=='')url.searchParams.set(key,String(value));
  });
  return url.toString();
}

let selectedDelivery=null;

const filters=document.querySelectorAll('[data-filter]');
const gallery=document.getElementById('works-gallery');
const workSlots=[...gallery.querySelectorAll('.work-slot')];
const workItems=[...gallery.querySelectorAll('.work-slide')];
let activeFilter='all';
const slotTimers=new WeakMap();

function activateSlide(slot,index){
  const slides=[...slot.querySelectorAll('.work-slide')];
  const next=index%slides.length;
  slot.dataset.activeIndex=String(next);
  slides.forEach((slide,i)=>{
    const active=i===next;
    slide.classList.toggle('is-active',active);
    slide.setAttribute('aria-hidden',String(!active));
    slide.inert=!active;
  });
}
function clearSlotTimer(slot){
  const timer=slotTimers.get(slot);
  if(timer)clearTimeout(timer);
  slotTimers.delete(slot);
}
function scheduleSlot(slot,delay=4600){
  clearSlotTimer(slot);
  if(activeFilter!=='all')return;
  slotTimers.set(slot,setTimeout(()=>{
    if(activeFilter==='all'&&!slot.matches(':hover')&&!slot.matches(':focus-within')){
      activateSlide(slot,Number(slot.dataset.activeIndex||0)+1);
    }
    scheduleSlot(slot,4600);
  },delay));
}
function showPortfolioFilter(filter){
  activeFilter=filter;
  gallery.classList.toggle('is-filtered',filter!=='all');
  workItems.forEach(item=>{const matches=filter==='all'||item.dataset.category===filter;item.hidden=!matches;item.inert=!matches;item.setAttribute('aria-hidden',String(!matches))});
  workSlots.forEach((slot,i)=>{
    clearSlotTimer(slot);
    if(filter==='all'){
      activateSlide(slot,Number(slot.dataset.activeIndex||0));
      scheduleSlot(slot,4600+i*520);
    }
  });
}
filters.forEach(button=>button.addEventListener('click',()=>{
  filters.forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button))});
  showPortfolioFilter(button.dataset.filter);
}));
workSlots.forEach((slot,i)=>{
  slot.addEventListener('mouseenter',()=>clearSlotTimer(slot));
  slot.addEventListener('mouseleave',()=>{if(activeFilter==='all')scheduleSlot(slot,4600)});
  slot.addEventListener('focusin',()=>clearSlotTimer(slot));
  slot.addEventListener('focusout',()=>{if(activeFilter==='all')scheduleSlot(slot,4600)});
  const active=slot.querySelector('.work-slide.is-active')||slot.querySelector('.work-slide');
  activateSlide(slot,[...slot.querySelectorAll('.work-slide')].indexOf(active));
  scheduleSlot(slot,4600+i*520);
});
const dialog=document.getElementById('lightbox');
document.querySelectorAll('[data-image]').forEach(button=>button.addEventListener('click',()=>{const img=document.getElementById('large-image');img.src=button.dataset.image;img.alt=button.querySelector('img').alt;document.getElementById('large-caption').textContent=button.dataset.title+(button.dataset.description?' — '+button.dataset.description:'');dialog.showModal()}));
dialog.querySelector('.close').addEventListener('click',()=>dialog.close());dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close()}});

document.getElementById('brief-form').addEventListener('submit',e=>{
  e.preventDefault();
  const f=new FormData(e.target);
  if(!String(f.get('details')).trim()){
    document.getElementById('details').setCustomValidity('Опишите вашу идею');
    document.getElementById('details').reportValidity();
    return;
  }
  const lines=[
    'Здравствуйте! Хочу обсудить заказ в Voxel 3D.',
    'Изделие: '+f.get('type'),
    'Количество: '+f.get('qty'),
    'Цвет: '+(String(f.get('color')).trim()||'подобрать вместе'),
    'Задача: '+String(f.get('details')).trim()
  ];
  if(selectedDelivery){
    lines.push('Доставка СДЭК: '+selectedDelivery.city+', ПВЗ '+selectedDelivery.pvz+', тариф «'+selectedDelivery.tariff+'» ('+rubles.format(selectedDelivery.price)+' ₽, '+selectedDelivery.days+')');
  }
  lines.push('Подскажите, пожалуйста, стоимость и срок изготовления.');
  document.getElementById('brief-text').value=lines.join('\n');
  document.getElementById('brief-result').hidden=false;
  document.getElementById('copy-status').textContent='';
  document.getElementById('brief-text').focus();
});
document.getElementById('details').addEventListener('input',e=>e.target.setCustomValidity(''));
document.getElementById('copy-brief').addEventListener('click',async()=>{const area=document.getElementById('brief-text');try{await navigator.clipboard.writeText(area.value);document.getElementById('copy-status').textContent='Скопировано. Отправьте текст мастеру удобным способом.'}catch{area.focus();area.select();document.getElementById('copy-status').textContent='Выделили текст. Скопируйте его вручную.'}});

document.querySelectorAll('[data-legal-dialog]').forEach(link=>link.addEventListener('click',event=>{
  event.preventDefault();
  const dialog=document.getElementById(link.dataset.legalDialog);
  if(dialog&&!dialog.open)dialog.showModal();
}));
document.querySelectorAll('.legal-dialog').forEach(dialog=>{
  dialog.querySelector('.legal-close').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close()});
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
  const paymentAmountField=document.getElementById('payment-amount');
  if(paymentAmountField&&!startsFrom){
    paymentAmountField.value=String(itemsTotal+(selectedDelivery?selectedDelivery.price:0));
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

cdekStatus.textContent='Проверяем подключение к API СДЭК…';
fetch(apiUrl('api/cdek/status'),{headers:{accept:'application/json'}}).then(response=>response.ok?response.json():null).then(data=>{
  cdekStatus.textContent=data&&data.ready?'Выберите город получения и укажите параметры упакованного заказа.':'Расчёт доставки пока недоступен. Оставьте заявку — уточним условия.';
}).catch(()=>{cdekStatus.textContent='Не удалось проверить подключение к СДЭК. Оставьте заявку — уточним доставку.'});
let cdekSearchTimer;
let cdekSearchController;
function hideCdekSuggestions(){cdekSuggestions.hidden=true;cdekCity.setAttribute('aria-expanded','false')}
function showCdekSuggestions(){cdekSuggestions.hidden=false;cdekCity.setAttribute('aria-expanded','true')}
async function loadCdekPvz(cityCode){
  cdekPvz.hidden=false;cdekDeliveryPoint.value='';selectedPvzLabel='';cdekPvzList.replaceChildren();cdekPvzStatus.textContent='Загружаем пункты выдачи…';
  try{
    const response=await fetch(apiUrl('api/cdek/delivery-points',{city_code:cityCode}),{headers:{accept:'application/json'}});
    const data=await response.json();if(!response.ok)throw new Error(data.error||'Не удалось загрузить ПВЗ.');
    const points=data.deliveryPoints||[];
    if(!points.length){cdekPvzStatus.textContent='В этом городе пункты выдачи не найдены.';return}
    cdekPvzStatus.textContent='Выберите пункт выдачи ('+points.length+').';
    points.forEach((point)=>{
      const label=document.createElement('label');label.className='cdek-pvz-card';
      const radio=document.createElement('input');radio.type='radio';radio.name='cdek-pvz-choice';radio.value=point.code;radio.required=true;
      radio.addEventListener('change',()=>{
        cdekDeliveryPoint.value=point.code;
        selectedPvzLabel=point.name+' ('+point.address+')';
        cdekStatus.textContent='ПВЗ выбран. Теперь можно рассчитать тариф.';
      });
      const details=document.createElement('span');details.className='cdek-pvz-details';
      const name=document.createElement('strong');name.textContent=point.name;
      const address=document.createElement('span');address.textContent=point.address;
      const hours=document.createElement('small');hours.textContent=point.workTime;
      details.append(name,address);if(point.workTime)details.append(hours);label.append(radio,details);cdekPvzList.append(label);
    });
  }catch(error){cdekPvzStatus.textContent=error.message||'Сервис СДЭК временно недоступен.'}
}
cdekCity.addEventListener('input',()=>{
  cdekCityCode.value='';
  cdekDeliveryPoint.value='';selectedPvzLabel='';selectedDelivery=null;
  cdekPvz.hidden=true;cdekPvzList.replaceChildren();
  cdekRates.hidden=true;
  clearTimeout(cdekSearchTimer);
  if(cdekSearchController)cdekSearchController.abort();
  const query=cdekCity.value.trim();
  if(query.length<2){hideCdekSuggestions();cdekSuggestions.replaceChildren();return}
  cdekStatus.textContent='Ищем город в справочнике СДЭК…';
  cdekSearchTimer=setTimeout(async()=>{
    cdekSearchController=new AbortController();
    try{
      const response=await fetch(apiUrl('api/cdek/cities',{name:query}),{signal:cdekSearchController.signal,headers:{accept:'application/json'}});
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||'Не удалось найти город.');
      cdekSuggestions.replaceChildren();
      (data.cities||[]).forEach(city=>{
        const option=document.createElement('button');
        option.type='button';option.className='cdek-suggestion';option.setAttribute('role','option');option.textContent=city.name;
        option.addEventListener('click',()=>{cdekCity.value=city.name;cdekCityCode.value=String(city.code);hideCdekSuggestions();cdekStatus.textContent='Город выбран. Загружаем пункты выдачи…';loadCdekPvz(city.code)});
        cdekSuggestions.append(option);
      });
      if(cdekSuggestions.childElementCount){showCdekSuggestions();cdekStatus.textContent='Выберите подходящий город из списка.'}
      else{hideCdekSuggestions();cdekStatus.textContent='Город не найден. Проверьте написание.'}
    }catch(error){
      if(error.name!=='AbortError'){hideCdekSuggestions();cdekStatus.textContent=error.message||'Сервис СДЭК временно недоступен.'}
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
  cdekStatus.textContent='Выбран тариф «'+tariff.name+'» ('+rubles.format(selectedDelivery.price)+' ₽) — прикрепится к вашей заявке ниже.';
}
function renderCdekRates(tariffs){
  cdekRates.replaceChildren();
  if(!tariffs.length){const empty=document.createElement('p');empty.className='cdek-empty';empty.textContent='Для этого направления тарифы не найдены.';cdekRates.append(empty);cdekRates.hidden=false;return}
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
  if(!cdekCityCode.value){cdekStatus.textContent='Выберите город из подсказок СДЭК.';cdekCity.focus();return}
  if(!cdekDeliveryPoint.value){cdekStatus.textContent='Выберите пункт выдачи СДЭК.';cdekPvz.scrollIntoView({behavior:'smooth',block:'center'});return}
  const weight=Number(document.getElementById('cdek-weight').value);
  if(!Number.isInteger(weight)||weight<1){cdekStatus.textContent='Укажите вес посылки в граммах.';document.getElementById('cdek-weight').focus();return}
  const dimensionIds=['cdek-length','cdek-width','cdek-height'];
  const dimensions=dimensionIds.map(id=>document.getElementById(id).value.trim());
  const hasDimensions=dimensions.some(Boolean);
  if(hasDimensions&&dimensions.some(value=>!value||!Number.isInteger(Number(value))||Number(value)<1)){
    cdekStatus.textContent='Заполните все три размера в сантиметрах или оставьте их пустыми.';return;
  }
  const button=cdekForm.querySelector('button[type="submit"]');
  const originalLabel=button.textContent;button.disabled=true;button.textContent='Считаем тарифы…';
  cdekStatus.textContent='Запрашиваем стоимость и срок доставки у СДЭК…';cdekRates.hidden=true;
  const payload={city_code:Number(cdekCityCode.value),weight_g:weight,delivery_point:cdekDeliveryPoint.value};
  if(hasDimensions){payload.length_cm=Number(dimensions[0]);payload.width_cm=Number(dimensions[1]);payload.height_cm=Number(dimensions[2])}
  try{
    const response=await fetch(apiUrl('api/cdek/rates'),{method:'POST',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify(payload)});
    const data=await response.json();
    if(!response.ok)throw new Error(data.error||'Не удалось рассчитать доставку.');
    renderCdekRates(data.tariffs||[]);
  }catch(error){cdekStatus.textContent=error.message||'Сервис СДЭК временно недоступен.'}
  finally{button.disabled=false;button.textContent=originalLabel}
});

const paymentButton=document.getElementById('create-payment');
const paymentStatus=document.getElementById('payment-status');
const paymentForm=document.getElementById('brief-form');
if(paymentButton){
  paymentButton.addEventListener('click',async()=>{
    const amountField=document.getElementById('payment-amount');
    const emailField=document.getElementById('payment-email');
    const consent=document.getElementById('legal-consent');
    const amount=Number(amountField.value);
    const email=emailField.value.trim();
    if(!paymentForm.reportValidity())return;
    if(!Number.isInteger(amount)||amount<1||amount>300000){paymentStatus.textContent='Укажите сумму от 1 до 300 000 ₽.';amountField.focus();return}
    if(!emailField.checkValidity()||!email){paymentStatus.textContent='Укажите корректный e-mail.';emailField.focus();return}
    if(!consent.checked){paymentStatus.textContent='Для перехода к оплате примите условия оферты и политику обработки данных.';consent.focus();return}
    paymentButton.disabled=true;
    paymentStatus.textContent='Создаём защищённую ссылку ЮKassa…';
    const returnUrl=new URL('/?payment=return',window.location.origin).toString();
    const description=(document.getElementById('type').value+' — '+document.getElementById('details').value.trim()).slice(0,128);
    try{
      const response=await fetch(apiUrl('api/create-payment'),{method:'POST',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify({amount_rub:amount,customer_email:email,description,return_url:returnUrl,legal_consent:consent.checked})});
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||'Не удалось создать платёж.');
      if(typeof data.confirmation_url!=='string'||!data.confirmation_url.startsWith('https://'))throw new Error('ЮKassa не вернула ссылку для оплаты.');
      paymentStatus.textContent='Ссылка создана. Переходим к защищённой оплате…';
      window.location.assign(data.confirmation_url);
    }catch(error){paymentStatus.textContent=error.message||'Сервис оплаты временно недоступен.';paymentButton.disabled=false}
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
  let count=window.innerWidth<768?28:52;

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
    count=width<768?28:52;
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
