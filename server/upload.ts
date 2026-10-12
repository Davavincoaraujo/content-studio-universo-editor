import type { Plugin } from 'vite';
import { Buffer } from 'node:buffer';

const MAX_BYTES = 10 * 1024 * 1024;
const formats: Record<string, string[]> = {
  'image/png': ['png'], 'image/jpeg': ['jpg', 'jpeg'],
  'image/webp': ['webp'], 'image/gif': ['gif'], 'image/svg+xml': ['svg'],
};
export function localAssetUpload(env: Record<string, string>): Plugin {
  return {
    name: 'local-dam-upload',
    configureServer(server) {
      server.middlewares.use('/extension-api/upload', async (req, res) => {
        const reply = (code: number, message: string, path?: string) => {
          res.statusCode = code; res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ message, ...(path ? { path } : {}) }));
        };
        if (req.method !== 'POST') { reply(405, 'Use o envio de imagem.'); return; }
        if (req.headers['x-extension-upload'] !== 'image') { reply(400, 'Use o botão Enviar para a biblioteca.'); return; }
        try {
          const target = new URL(env.EXTENSION_AEM_URL || '');
          if (target.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(target.hostname)) {
            reply(503, 'O upload local ainda não está configurado.'); return;
          }
          const params = new URL(req.url || '/', 'http://localhost').searchParams;
          const folder = params.get('folder') || '';
          const name = params.get('name') || '';
          const root = (env.EXTENSION_UPLOAD_ROOT || '/content/dam').replace(/\/$/, '');
          const mime = String(req.headers['content-type'] || '').split(';')[0];
          if (!(folder === root || folder.startsWith(root + '/')) || !folder.startsWith('/content/dam') || folder.split('/').some(p => p === '..' || p === '.') || /[\\\x00-\x1f?#%]/.test(folder)) {
            reply(400, 'Escolha uma pasta válida da biblioteca.'); return;
          }
          if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,180}$/.test(name) || !formats[mime]?.includes(name.split('.').pop()?.toLowerCase() || '')) {
            reply(400, 'Use uma imagem PNG, JPEG, WebP, GIF ou SVG com nome válido.'); return;
          }
          if (Number(req.headers['content-length']) > MAX_BYTES) { reply(413, 'A imagem deve ter no máximo 10 MB.'); return; }
          const chunks: Buffer[] = []; let size = 0;
          for await (const chunk of req) {
            size += chunk.length;
            if (size > MAX_BYTES) { reply(413, 'A imagem deve ter no máximo 10 MB.'); return; }
            chunks.push(Buffer.from(chunk));
          }
          if (!size) { reply(400, 'Escolha um arquivo de imagem.'); return; }
          const auth = 'Basic ' + Buffer.from(`${env.EXTENSION_AEM_USER || ''}:${env.EXTENSION_AEM_PASSWORD || ''}`).toString('base64');
          const tokenResponse = await fetch(new URL('/libs/granite/csrf/token.json', target), { headers: { Authorization: auth }, signal: AbortSignal.timeout(15000) });
          if (!tokenResponse.ok) { reply(503, 'Não foi possível autenticar na biblioteca.'); return; }
          const token = await tokenResponse.json() as { token?: string };
          const path = `${folder}/${name}`;
          const api = '/api/assets' + path.slice('/content/dam'.length).split('/').map(encodeURIComponent).join('/');
          // POST creates; never use PUT, which replaces the existing asset binary.
          const response = await fetch(new URL(api, target), {
            method: 'POST', redirect: 'manual',
            headers: { Authorization: auth, 'Content-Type': mime, ...(token.token ? { 'CSRF-Token': token.token } : {}) },
            body: new Uint8Array(Buffer.concat(chunks)), signal: AbortSignal.timeout(120000),
          });
          if (response.status === 201) reply(201, 'Imagem enviada para a biblioteca.', path);
          else if (response.status === 409) reply(409, 'Já existe uma imagem com esse nome. Renomeie o arquivo e tente novamente.');
          else if ([401, 403].includes(response.status)) reply(403, 'O acesso configurado não permite enviar imagens nesta pasta.');
          else reply(502, 'A biblioteca não concluiu o envio. Tente novamente.');
        } catch { reply(502, 'Não foi possível enviar a imagem. Verifique a conexão com a biblioteca.'); }
      });
    },
  };
}
