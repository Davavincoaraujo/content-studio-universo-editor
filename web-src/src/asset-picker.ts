import { uploadControls } from "./asset-upload";
export type AssetRules = { rootPath?: string; mimeTypes?: string[] };
export function assetUrl(page: string, path: string): string {
  const url = new URL('/api/content', page);
  url.searchParams.set('path', path);
  return url.href;
}
export function assetEntries(payload: any, folder: string, rules: AssetRules) {
  return (payload.entities ?? []).flatMap((entity: any) => {
    const name = entity.properties?.name;
    if (typeof name !== 'string' || name.includes('/') || name === '..' || name === '.') return [];
    const directory = entity.class?.includes('assets/folder');
    const mime = entity.properties?.metadata?.['dc:format'] ?? entity.properties?.['dc:format'];
    if (!directory && (!String(mime).startsWith('image/') || (rules.mimeTypes?.length && !rules.mimeTypes.includes(mime)))) return [];
    return [{ name, directory, path: `${folder}/${name}`, mime }];
  });
}
export function pickAsset(page: string, rules: AssetRules, current: string): Promise<string | null> {
  const root = (rules.rootPath || '/content/dam').replace(/\/$/, '');
  if (!(root === '/content/dam' || root.startsWith('/content/dam/')) || root.split('/').includes('..')) return Promise.reject(new Error('Raiz do DAM inválida.'));
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog'); dialog.className = 'asset-picker';
    const heading = document.createElement('h2'); heading.textContent = 'Selecionar imagem';
    const bar = document.createElement('div'); bar.className = 'asset-toolbar';
    const up = document.createElement('button'); up.type = 'button'; up.textContent = '← Voltar à pasta';
    const breadcrumb = document.createElement('span');
    const search = document.createElement('input'); search.type = 'search'; search.placeholder = 'Buscar nesta pasta'; search.setAttribute('aria-label', 'Buscar imagens nesta pasta');
    bar.append(up, breadcrumb, search);
    const status = document.createElement('p'); status.setAttribute('role', 'status');
    const grid = document.createElement('div'); grid.className = 'asset-grid';
    const more = document.createElement('button'); more.type = 'button'; more.textContent = 'Carregar mais'; more.hidden = true;
    const footer = document.createElement('div'); footer.className = 'asset-footer';
    const selectedName = document.createElement('span');
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancelar';
    const select = document.createElement('button'); select.type = 'button'; select.textContent = 'Selecionar imagem'; select.disabled = true;
    footer.append(selectedName, cancel, select); dialog.append(heading, bar, status, grid, more, footer);
    let folder = root, selected: string | null = null, next: string | null = null, generation = 0;
    let entries: ReturnType<typeof assetEntries> = [];
    let controller: AbortController | undefined;
    const finish = (value: string | null) => { if (upload.isBusy()) { status.textContent = "Aguarde o envio terminar antes de fechar."; return; } upload.dispose(); controller?.abort(); dialog.close(); dialog.remove(); resolve(value); };
    cancel.onclick = () => finish(null);
    select.onclick = () => finish(selected);
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); finish(null); });
    const render = () => {
      grid.replaceChildren();
      const visible = entries.filter((entry: any) => entry.name.toLocaleLowerCase().includes(search.value.toLocaleLowerCase()));
      for (const entry of visible) {
        const card = document.createElement('button'); card.type = 'button'; card.className = 'asset-card';
        card.setAttribute('aria-pressed', String(entry.path === selected));
        if (entry.directory) { const icon = document.createElement('span'); icon.textContent = '📁'; icon.className = 'folder-icon'; card.append(icon); }
        else { const image = document.createElement('img'); image.src = assetUrl(page, entry.path); image.alt = ''; image.loading = 'lazy'; image.onerror = () => { image.remove(); }; card.append(image); }
        const label = document.createElement('span'); label.textContent = entry.name; card.append(label);
        card.onclick = () => {
          if (upload.isBusy()) return;
          if (entry.directory) { void load(entry.path); return; }
          selected = entry.path; selectedName.textContent = entry.name; select.disabled = false; render();
        };
        grid.append(card);
      }
      status.textContent = visible.length ? `${visible.length} pastas e imagens` : 'Nenhuma imagem compatível nesta pasta.';
    };
    const load = async (path: string, pagination?: string) => {
      if (upload.isBusy() || !(path === root || path.startsWith(root + '/'))) return;
      const request = ++generation; controller?.abort(); controller = new AbortController();
      if (!pagination) { folder = path; entries = []; search.value = ''; selected = null; selectedName.textContent = ''; select.disabled = true; }
      breadcrumb.textContent = folder; up.disabled = folder === root; more.hidden = true; grid.replaceChildren(); status.textContent = 'Carregando imagens…';
      try {
        const apiPath = pagination || `/api/assets${folder.slice('/content/dam'.length).split('/').map(encodeURIComponent).join('/')}.json`;
        const response = await fetch(assetUrl(page, apiPath), { credentials: 'omit', signal: controller.signal });
        if (!response.ok) throw new Error(`Não foi possível carregar o DAM (${response.status}).`);
        const payload = await response.json(); if (request !== generation) return;
        entries.push(...assetEntries(payload, folder, rules));
        const nextLink = payload.links?.find((link: any) => link.rel?.includes('next'))?.href;
        next = null;
        if (nextLink) { const url = new URL(nextLink, page); if (url.pathname.startsWith('/api/assets/')) next = url.pathname + url.search; }
        more.hidden = !next; render();
      } catch (error) { if (request === generation && !controller.signal.aborted) status.textContent = error instanceof Error ? error.message : 'Falha ao carregar imagens.'; }
    };
    const upload = uploadControls(rules, () => folder, async (path) => {
      const name = path.slice(path.lastIndexOf('/') + 1);
      entries.push({ name, directory: false, path, mime: '' });
      selected = path; selectedName.textContent = name; select.disabled = false;
      search.value = ''; render();
    });
    dialog.insertBefore(upload.area, status);
    search.oninput = render;
    up.onclick = () => { void load(folder.slice(0, folder.lastIndexOf('/'))); };
    more.onclick = () => { if (next) void load(folder, next); };
    document.body.append(dialog); dialog.showModal();
    const initialFolder = current.slice(0, current.lastIndexOf('/'));
    void load(initialFolder === root || initialFolder.startsWith(root + '/') ? initialFolder : root);
  });
}
