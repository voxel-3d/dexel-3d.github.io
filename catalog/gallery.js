// Optional model gallery. GIF bytes are preserved so animation survives uploads.
const LIMIT = 8, MAX_BYTES = 10 * 1024 * 1024, BUCKET = 'model-media';
export function initModelGallery(api) {
  const $ = id => document.getElementById(id);
  let items = [], editorURLs = [], detailURLs = [], slides = [], index = 0, active, opener;
  const dialog = $('details-dialog');
  const mediaURL = path => api.getClient().storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  const revoke = urls => { urls.forEach(url => URL.revokeObjectURL(url)); urls.length = 0; };
  const message = text => { $('media-editor-status').textContent = text; };
  function renderEditor() {
    revoke(editorURLs); $('media-editor-list').replaceChildren();
    items.forEach((item, i) => {
      const figure = document.createElement('figure');
      const img = new Image();
      img.src = item.path ? mediaURL(item.path) : URL.createObjectURL(item.file);
      if (!item.path) editorURLs.push(img.src);
      img.alt = item.file?.name || `Фото модели ${i+1}`;
      const remove = document.createElement('button');
      remove.type='button'; remove.textContent='Удалить'; remove.setAttribute('aria-label',`Убрать изображение ${i+1}`);
      remove.addEventListener('click',()=>{items.splice(i,1);renderEditor();});
      figure.append(img,remove);$('media-editor-list').append(figure);
    });
  }
  $('library-media').addEventListener('change', event => {
    const files = [...event.target.files]; event.target.value='';
    if (items.length+files.length>LIMIT) {message('Можно добавить до 8 фото и GIF суммарно.');return;}
    for (const file of files) {
      if (!/\.(jpe?g|png|webp|gif)$/i.test(file.name)||!file.size||file.size>MAX_BYTES) {
        message('Выберите JPG, PNG, WebP или GIF до 10 МБ каждый.');return;
      }
    }
    items.push(...files.map(file=>({file})));message('');renderEditor();
  });
  async function compress(file) {
    const header=new Uint8Array(await file.slice(0,12).arrayBuffer());
    const gif = String.fromCharCode(...header.slice(0,6));
    const isGIF = gif === 'GIF87a' || gif === 'GIF89a';
    if (/\.gif$/i.test(file.name) && !isGIF) throw new Error('Повреждённый GIF: '+file.name);
    const url=URL.createObjectURL(file);
    try {
      const img=new Image(); img.src=url; await img.decode();
      if (!img.naturalWidth || !img.naturalHeight) throw new Error();
      if (isGIF) return {blob:new Blob([file],{type:'image/gif'}),extension:'gif'};
      const scale=Math.min(1,1600/Math.max(img.naturalWidth,img.naturalHeight));
      const canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
      canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',.84));
      if(!blob||blob.type!=='image/webp')throw new Error();
      return {blob,extension:'webp'};
    } catch {throw new Error('Не удалось обработать изображение: '+file.name);}
    finally {URL.revokeObjectURL(url);}
  }
  async function remove(paths) {
    if(!paths.length)return;
    const {error}=await api.getClient().storage.from(BUCKET).remove(paths);
    if(error)throw new Error('Не удалось удалить изображения модели. Повторите попытку.');
  }
  async function prepare(draft,row,id,account) {
    if(!draft)return;
    const kept=draft.filter(x=>x.path).map(x=>x.path), added=draft.filter(x=>x.file);
    if(!added.length&&JSON.stringify(kept)===JSON.stringify(row?.media_paths||[]))return;
    if(draft.length>LIMIT)throw new Error('Не больше 8 изображений.');
    if(kept.some(path=>!row?.media_paths?.includes(path)))throw new Error('Неверный список изображений.');
    // Detect a missing migration before uploading STL or images. Old flows still work.
    const {error}=await api.getClient().from('models').select('media_paths').limit(0);
    if(error)throw new Error('Галерея ещё не настроена: выполните catalog/model-media.sql в Supabase.');
    const paths=[...kept], uploaded=[];
    try {
      for(const item of added){
        if(!item.file.size||item.file.size>MAX_BYTES)throw new Error('Изображение превышает 10 МБ.');
        const {blob,extension}=await compress(item.file);
        const path=`${account.id}/${id}/${crypto.randomUUID()}.${extension}`;
        uploaded.push(path);
        const {error}=await api.getClient().storage.from(BUCKET).upload(path,await blob.arrayBuffer(),{contentType:blob.type,upsert:false});
        if(error)throw new Error('Не удалось загрузить фото/GIF. Проверьте bucket model-media и миграцию model-media.sql.');
        paths.push(path);
      }
      return {paths,uploaded};
    } catch(error){await remove(uploaded).catch(()=>{});throw error;}
  }
  function showSlide(next) {
    index=(next+slides.length)%slides.length;
    const image=$('details-image');
    if(!slides.length){image.hidden=true;image.removeAttribute('src');$('details-count').textContent='Нет изображений';return;}
    image.hidden=false;image.src=slides[index];image.alt=`${active.title} — изображение ${index+1}`;
    $('details-count').textContent=`${index+1} / ${slides.length}`;
    [...$('details-thumbs').children].forEach((button,i)=>button.setAttribute('aria-pressed',String(i===index)));
  }
  function open(entry) {
    if(dialog.open)dialog.close();
    revoke(detailURLs);active=entry;opener=document.activeElement;
    $('details-title').textContent=entry.title;
    $('details-description').textContent=entry.description||'Описание не добавлено.';
    $('details-meta').textContent=api.describeModel(entry);
    api.showSpecs($('details-specs'),entry.metrics);
    $('details-order').href=api.orderURL(entry);
    slides=[];
    const cover=entry.cover||entry.placeholder;if(cover)slides.push(cover);
    if(entry.remote)for(const path of entry.remote.media_paths||[])slides.push(mediaURL(path));
    else for(const blob of entry.mediaBlobs||[]){const url=URL.createObjectURL(blob);slides.push(url);detailURLs.push(url);}
    $('details-thumbs').replaceChildren();
    slides.forEach((url,i)=>{
      const button=document.createElement('button');button.type='button';button.setAttribute('aria-label',`Изображение ${i+1}`);
      const img=new Image();img.src=url;img.alt='';img.loading='lazy';button.append(img);button.addEventListener('click',()=>showSlide(i));$('details-thumbs').append(button);
    });
    $('details-prev').disabled=slides.length<2;$('details-next').disabled=slides.length<2;
    showSlide(0);dialog.showModal();
  }
  $('details-close').addEventListener('click',()=>dialog.close());
  $('details-prev').addEventListener('click',()=>showSlide(index-1));
  $('details-next').addEventListener('click',()=>showSlide(index+1));
  dialog.addEventListener('keydown',e=>{if(e.target.closest('a,input,textarea,select'))return;if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();showSlide(index+(e.key==='ArrowRight'?1:-1));}});
  $('details-image').addEventListener('error',()=>{$('details-count').textContent='Изображение недоступно. Выберите другое.';});
  $('details-3d').addEventListener('click',()=>{const entry=active;dialog.close();api.openModel(entry);});
  $('details-order').addEventListener('click',event=>api.recordOrder(event,active));
  dialog.addEventListener('close',()=>{if(dialog.open)return;revoke(detailURLs);slides=[];$('details-image').removeAttribute('src');$('details-thumbs').replaceChildren();opener?.focus();});
  return {
    open,prepare,remove,
    reset(row){revoke(editorURLs);items=(row?.media_paths||[]).map(path=>({path}));$('library-media').value='';message('');renderEditor();},
    draft:()=>items.map(item=>({...item})),
    async localBlobs(){const blobs=[];for(const item of items)if(item.file)blobs.push((await compress(item.file)).blob);return blobs;}
  };
}
