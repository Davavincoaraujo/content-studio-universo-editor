import type { AssetRules } from './asset-picker';

export function uploadControls(rules: AssetRules, folder: () => string, uploaded: (path: string) => Promise<void>) {
  const area = document.createElement('section'); area.className = 'asset-upload';
  const open = document.createElement('button'); open.type = 'button'; open.textContent = '↑ Enviar imagem';
  const panel = document.createElement('div'); panel.className = 'upload-panel'; panel.hidden = true;
  const title = document.createElement('h3'); title.textContent = 'Enviar uma nova imagem';
  const description = document.createElement('p'); description.className = 'upload-description'; description.textContent = 'Escolha uma imagem do seu computador e envie para esta pasta.';
  const choose = document.createElement('button'); choose.type = 'button'; choose.className = 'upload-choose'; choose.textContent = 'Escolher imagem';
  const destination = document.createElement('p'); destination.className = 'upload-destination';
  const input = document.createElement('input'); input.type = 'file'; input.accept = (rules.mimeTypes?.length ? rules.mimeTypes : ['image/png','image/jpeg','image/webp','image/gif','image/svg+xml']).join(','); input.setAttribute('aria-label', 'Escolher imagem do computador'); input.hidden = true; choose.onclick = () => input.click();
  const preview = document.createElement('img'); preview.className = 'upload-preview'; preview.alt = 'Prévia da imagem escolhida'; preview.hidden = true;
  const name = document.createElement('p');
  const hint = document.createElement('small'); hint.textContent = 'Até 10 MB. A imagem será enviada para a pasta aberta. Cancelar a edição não apaga uma imagem já enviada.';
  const progress = document.createElement('progress'); progress.max = 100; progress.hidden = true;
  const status = document.createElement('p'); status.setAttribute('role','status');
  const send = document.createElement('button'); send.type = 'button'; send.textContent = 'Enviar para a biblioteca'; send.disabled = true;
  const close = document.createElement('button'); close.type = 'button'; close.textContent = 'Voltar à biblioteca';
  panel.append(title,description,destination,choose,input,preview,name,hint,progress,status,send,close); area.append(open,panel);
  let file: File | undefined, objectUrl = '', busy = false;
  const reset = () => { if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = ''; file = undefined; input.value = ''; preview.hidden = true; send.disabled = true; name.textContent = ''; status.textContent = ''; progress.hidden = true; };
  open.onclick = () => { destination.textContent = 'Pasta de destino: ' + (folder().split('/').pop() || 'Biblioteca'); panel.hidden = !panel.hidden; };
  close.onclick = () => { if (!busy) { reset(); panel.hidden = true; } };
  input.onchange = () => {
    resetFile(input.files?.[0]);
  };
  const resetFile = (next?: File) => {
    if (objectUrl) URL.revokeObjectURL(objectUrl); file = next; send.disabled = true; preview.hidden = true; status.textContent = ''; progress.hidden = true;
    if (!file) return;
    const allowed = ['image/png','image/jpeg','image/webp','image/gif','image/svg+xml'];
    if (!allowed.includes(file.type) || (rules.mimeTypes?.length && !rules.mimeTypes.includes(file.type))) { status.textContent = 'Escolha uma imagem no formato permitido para este campo.'; return; }
    if (!file.size || file.size > 10 * 1024 * 1024) { status.textContent = 'A imagem deve ter no máximo 10 MB e não pode estar vazia.'; return; }
    name.textContent = `${file.name} · ${(file.size/1024/1024).toFixed(2)} MB`;
    objectUrl = URL.createObjectURL(file); preview.src = objectUrl; preview.hidden = false; send.disabled = false;
  };
  send.onclick = async () => {
    if (!file || busy) return;
    const filename = file.name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9._-]/g,'-').replace(/^[^a-zA-Z0-9]+/,'');
    if (!filename || filename.length > 181) { status.textContent = 'Use um nome de arquivo mais curto.'; return; }
    busy = true; input.disabled = choose.disabled = send.disabled = close.disabled = open.disabled = true; progress.hidden = false; progress.value = 0; status.textContent = 'Enviando imagem…';
    try {
      const path = await new Promise<string>((resolve,reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `/extension-api/upload?folder=${encodeURIComponent(folder())}&name=${encodeURIComponent(filename)}`);
        xhr.setRequestHeader('X-Extension-Upload', 'image');
        xhr.setRequestHeader('Content-Type',file!.type); xhr.timeout = 130000;
        xhr.upload.onprogress = e => { if (e.lengthComputable) { progress.value = e.loaded/e.total*100; if (progress.value === 100) status.textContent = 'Concluindo envio na biblioteca…'; } };
        xhr.onload = () => { let payload: any; try { payload = JSON.parse(xhr.responseText); } catch { reject(new Error('Não foi possível concluir o envio.')); return; } if (xhr.status === 201 && typeof payload.path === 'string') resolve(payload.path); else reject(new Error(payload.message || 'Não foi possível enviar a imagem.')); };
        xhr.onerror = xhr.ontimeout = () => reject(new Error('A conexão foi interrompida. Confira a biblioteca antes de tentar novamente.'));
        xhr.send(file!);
      });
      await uploaded(path);
      reset();
      panel.hidden = true;
      open.focus();
    } catch (error) { status.textContent = error instanceof Error ? error.message : 'Não foi possível enviar a imagem.'; }
    finally { busy = false; input.disabled = choose.disabled = close.disabled = open.disabled = false; send.disabled = !file; }
  };
  return { area, isBusy: () => busy, dispose: () => { if(objectUrl) URL.revokeObjectURL(objectUrl); } };
}
