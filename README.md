# Content Studio — Universal Editor

Extensão independente para o Adobe AEM Universal Editor. Adiciona a ação **Content Studio** e um painel próprio para editar componentes em modal, sem substituir o painel nativo.

## Recursos

- Campos gerados a partir dos modelos do componente selecionado.
- Organização por abas e navegação entre lista e item.
- Adicionar, remover e reordenar itens; conteúdo e tagueamento por item.
- Texto, textarea, número, boolean, select, condições e validações de campos suportadas pelo renderer.
- Rich text com Tiptap; não é o editor nativo da Adobe incorporado.
- Biblioteca de imagens com substituição e remoção.
- Rascunho local, confirmação ao descartar e fechamento após salvar com sucesso.

A compatibilidade deve ser validada com os modelos e o backend do projeto. Salvar múltiplas propriedades não é uma transação: uma falha intermediária pode deixar alterações parciais já gravadas.

## Desenvolvimento local

Requisitos: Node.js 22 ou superior, npm, acesso ao Universal Editor e uma página instrumentada com modelos de componentes.

```sh
npm ci
mkdir -p .local-cert
mkcert -install
mkcert -key-file .local-cert/localhost-key.pem -cert-file .local-cert/localhost.pem localhost 127.0.0.1 ::1
npm run dev
```

Instale `mkcert` previamente. O servidor usa **https://localhost:9082**, com porta fixa. Abrir a extensão isoladamente não mostra um componente: ela recebe contexto do host Adobe.

No Universal Editor, acrescente `devMode=true` e `ext=https%3A%2F%2Flocalhost%3A9082` à URL conforme o mecanismo de preview do host. A posição dos parâmetros depende da URL/roteamento do editor; use a URL de desenvolvimento compatível com sua sessão Adobe.

## Upload de imagens no desenvolvimento

Opcional: copie `.env.example` para `.env.local` e configure o acesso local ao AEM. As variáveis `EXTENSION_*` são usadas no middleware do servidor Vite, não incorporadas ao bundle do navegador.

O upload atende somente AEM HTTP em localhost/127.0.0.1, limita arquivos a 10 MB, aceita PNG/JPEG/WebP/GIF/SVG e não sobrescreve assets existentes. O acesso usa a conta configurada no servidor local. Cancelar a edição não apaga um asset já enviado.

Esse middleware não acompanha o bundle estático e não deve ser exposto como serviço público de produção. Upload em produção precisa de uma integração de servidor autenticada apropriada ao ambiente.

## Build

```sh
npm run build
```

Gera `dist/`. O build não exige certificados ou credenciais locais. A versão atual gera um aviso Vite de tamanho do bundle; não impede a compilação.

## Publicação Adobe

Este repositório contém o código da extensão, não um pacote instalável no AEM Package Manager. Publicar no GitHub não registra a extensão no Adobe Extension Registry.

Para publicação Adobe, configure um projeto Developer Console/App Builder com o extension point `universal-editor/ui/1`, autentique o Adobe I/O CLI e valide a configuração para sua organização. O script `npm run deploy` executa build e `aio app deploy`; ativação/disponibilidade dependem do ciclo de publicação/aprovação Adobe.

## Estrutura

- `web-src/src/main.ts`: registro UIX, adaptação dos modelos e formulários.
- `web-src/src/rich-text.ts`: rich text e sanitização.
- `web-src/src/asset-picker.ts`: seleção de imagens.
- `web-src/src/asset-upload.ts`: interface do envio local.
- `server/upload.ts`: middleware de upload para desenvolvimento.
- `app.config.yaml` e `src/universal-editor-ui-1/ext.config.yaml`: configuração App Builder.

## Escopo

A extensão permanece em um projeto separado. Não exige adicionar rotas ou variáveis ao frontend do site. Ela utiliza `@adobe/uix-guest` para integração com o host. Credenciais, certificados, dependências instaladas e artefatos de build não fazem parte do repositório.
