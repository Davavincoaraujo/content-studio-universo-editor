import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyle, Color } from '@tiptap/extension-text-style';
import Superscript from '@tiptap/extension-superscript';
import Subscript from '@tiptap/extension-subscript';
import Image from '@tiptap/extension-image';
import { TableKit } from '@tiptap/extension-table';
import DOMPurify from 'dompurify';

export function renderRichText(parent: HTMLElement, label: string, html: string, onChange: (html: string) => void): void {
  const wrapper = document.createElement('section'); wrapper.className = 'rich-field';
  const heading = document.createElement('div'); heading.textContent = label;
  const toolbar = document.createElement('div'); toolbar.className = 'rich-toolbar'; toolbar.setAttribute('role', 'toolbar'); toolbar.setAttribute('aria-label', `Formatação de ${label}`);
  const content = document.createElement('div'); wrapper.append(heading, toolbar, content); parent.append(wrapper);
  // Legacy HTML may put text color on a block rather than an inline span.
  // Move that supported style to a text mark before parsing, after sanitizing.
  const safe = document.createElement('div'); safe.innerHTML = DOMPurify.sanitize(html);
  for (const block of safe.querySelectorAll<HTMLElement>('p[style],h1[style],h2[style],h3[style],h4[style],h5[style],h6[style]')) {
    if (block.style.color) { const span = document.createElement('span'); span.style.color = block.style.color; span.append(...Array.from(block.childNodes)); block.append(span); block.style.removeProperty('color'); }
  }
  const editor = new Editor({ element: content,
    extensions: [StarterKit.configure({ link: { openOnClick: false } }), TextAlign.configure({ types: ['heading', 'paragraph'] }), TextStyle, Color, Superscript, Subscript, Image.configure({ allowBase64: false }), TableKit],
    content: safe.innerHTML,
    editorProps: { attributes: { role: 'textbox', 'aria-label': label, 'aria-multiline': 'true' } },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });
  const syncs: (() => void)[] = [];
  const button = (group: HTMLElement, title: string, glyph: string, action: () => void, active?: () => boolean, enabled?: () => boolean) => {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = glyph; b.title = title; b.setAttribute('aria-label', title);
    b.onmousedown = e => e.preventDefault(); b.onclick = () => { action(); syncs.forEach(sync => sync()); }; group.append(b);
    const sync = () => { if (active) b.setAttribute('aria-pressed', String(active())); if (enabled) b.disabled = !enabled(); };
    syncs.push(sync); sync(); return b;
  };
  const group = (name: string) => { const g = document.createElement('div'); g.className = 'rich-tool-group'; g.setAttribute('role', 'group'); g.setAttribute('aria-label', name); toolbar.append(g); return g; };
  const style = document.createElement('select'); style.setAttribute('aria-label', 'Estilo do parágrafo');
  for (const [value, text] of [['paragraph','Parágrafo'], ...[1,2,3,4,5,6].map(n=>['h'+n,'Título '+n]), ['code','Bloco de código'], ['quote','Citação']]) { const o=document.createElement('option');o.value=value;o.textContent=text;style.append(o); }
  group('Estilo').append(style);
  style.onchange=()=>{ const c=editor.chain().focus(); if(style.value==='paragraph')c.setParagraph().run();else if(style.value==='code')c.toggleCodeBlock().run();else if(style.value==='quote')c.toggleBlockquote().run();else c.setHeading({level:Number(style.value.slice(1)) as 1|2|3|4|5|6}).run(); };
  syncs.push(()=>{style.value=editor.isActive('codeBlock')?'code':editor.isActive('blockquote')?'quote':editor.isActive('heading')?'h'+editor.getAttributes('heading').level:'paragraph';});
  const format=group('Formato');
  button(format,'Negrito','B',()=>editor.chain().focus().toggleBold().run(),()=>editor.isActive('bold'));
  button(format,'Itálico','𝘐',()=>editor.chain().focus().toggleItalic().run(),()=>editor.isActive('italic'));
  button(format,'Sublinhado','U̲',()=>editor.chain().focus().toggleUnderline().run(),()=>editor.isActive('underline'));
  button(format,'Tachado','S̶',()=>editor.chain().focus().toggleStrike().run(),()=>editor.isActive('strike'));
  button(format,'Código inline','‹›',()=>editor.chain().focus().toggleCode().run(),()=>editor.isActive('code'));
  const color=document.createElement('input');color.type='color';color.title='Cor do texto';color.setAttribute('aria-label','Cor do texto');color.oninput=()=>editor.chain().focus().setColor(color.value).run();format.append(color);
  button(format,'Sobrescrito','x²',()=>editor.chain().focus().toggleSuperscript().run(),()=>editor.isActive('superscript'));
  button(format,'Subscrito','x₂',()=>editor.chain().focus().toggleSubscript().run(),()=>editor.isActive('subscript'));
  const alignment=group('Alinhamento');
  for(const [value,title,glyph] of [['left','Alinhar à esquerda','≡←'],['center','Centralizar','≡'],['right','Alinhar à direita','→≡'],['justify','Justificar','☰']])button(alignment,title,glyph,()=>editor.chain().focus().setTextAlign(value).run(),()=>editor.isActive({textAlign:value}));
  const lists=group('Listas');
  button(lists,'Lista','• ≡',()=>editor.chain().focus().toggleBulletList().run(),()=>editor.isActive('bulletList'));
  button(lists,'Lista numerada','1. ≡',()=>editor.chain().focus().toggleOrderedList().run(),()=>editor.isActive('orderedList'));
  button(lists,'Aumentar recuo','⇥',()=>editor.chain().focus().sinkListItem('listItem').run(),undefined,()=>editor.can().sinkListItem('listItem'));
  button(lists,'Diminuir recuo','⇤',()=>editor.chain().focus().liftListItem('listItem').run(),undefined,()=>editor.can().liftListItem('listItem'));
  const insert=group('Inserir');
  const panel=document.createElement('div');panel.className='rich-insert-panel';panel.hidden=true;
  const address=document.createElement('input');address.type='text';address.placeholder='https://…, /caminho ou #âncora';
  const apply=document.createElement('button');apply.type='button';apply.textContent='Aplicar';
  const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Cancelar';
  let insertMode:'link'|'image'='link';let selection={from:0,to:0};
  const open=(mode:'link'|'image')=>{insertMode=mode;selection={from:editor.state.selection.from,to:editor.state.selection.to};address.setAttribute('aria-label',mode==='link'?'Endereço do link':'Endereço da imagem');address.value=mode==='link'?(editor.getAttributes('link').href||''):'';panel.hidden=false;address.focus();};
  button(insert,'Inserir ou editar link','↗',()=>open('link'),()=>editor.isActive('link'));
  button(insert,'Remover link','↛',()=>editor.chain().focus().unsetLink().run(),undefined,()=>editor.isActive('link'));
  button(insert,'Inserir imagem','▧',()=>open('image'));
  apply.onclick=()=>{const value=address.value.trim();if(!/^(https?:\/\/|\/[^/]|#|mailto:|tel:)/i.test(value)||(insertMode==='image'&&!/^(https?:\/\/|\/[^/])/i.test(value))){address.setCustomValidity('Informe um endereço válido.');address.reportValidity();return;}address.setCustomValidity('');const c=editor.chain().focus().setTextSelection(selection);if(insertMode==='link')c.extendMarkRange('link').setLink({href:value}).run();else c.setImage({src:value}).run();panel.hidden=true;};
  address.oninput=()=>address.setCustomValidity('');cancel.onclick=()=>{panel.hidden=true;editor.commands.focus();};panel.append(address,apply,cancel);wrapper.insertBefore(panel,content);
  const table=document.createElement('select');table.setAttribute('aria-label','Tabela');
  for(const [value,text] of [['','Tabela…'],['insert','Inserir tabela 3 × 3'],['row','Adicionar linha'],['column','Adicionar coluna'],['removeRow','Remover linha'],['removeColumn','Remover coluna'],['remove','Remover tabela']]){const o=document.createElement('option');o.value=value;o.textContent=text;table.append(o);}insert.append(table);
  table.onchange=()=>{const c=editor.chain().focus();switch(table.value){case'insert':c.insertTable({rows:3,cols:3,withHeaderRow:true}).run();break;case'row':c.addRowAfter().run();break;case'column':c.addColumnAfter().run();break;case'removeRow':c.deleteRow().run();break;case'removeColumn':c.deleteColumn().run();break;case'remove':c.deleteTable().run();}table.value='';};
  syncs.push(()=>{for(const o of table.options)o.disabled=!!o.value&&o.value!=='insert'&&!editor.isActive('table');});
  const utilities=group('Edição');
  button(utilities,'Limpar formatação','T×',()=>editor.chain().focus().unsetAllMarks().clearNodes().run());
  button(utilities,'Desfazer','↶',()=>editor.chain().focus().undo().run(),undefined,()=>editor.can().undo());
  button(utilities,'Refazer','↷',()=>editor.chain().focus().redo().run(),undefined,()=>editor.can().redo());
  button(utilities,'Expandir editor','⛶',()=>wrapper.classList.toggle('rich-expanded'),()=>wrapper.classList.contains('rich-expanded'));
  editor.on('transaction',()=>syncs.forEach(sync=>sync()));syncs.forEach(sync=>sync());
  const keydown=(event:KeyboardEvent)=>{if(event.key==='Tab' && (editor.isActive('bulletList') || editor.isActive('orderedList')) && content.contains(event.target as Node)){const changed=event.shiftKey?editor.commands.liftListItem('listItem'):editor.commands.sinkListItem('listItem');if(changed){event.preventDefault();event.stopPropagation();}}if(event.key==='Escape'){if(!panel.hidden){panel.hidden=true;editor.commands.focus();event.stopPropagation();}else if(wrapper.classList.contains('rich-expanded')){wrapper.classList.remove('rich-expanded');event.stopPropagation();}syncs.forEach(sync=>sync());}};
  wrapper.addEventListener('keydown',keydown);
  const observer=new MutationObserver(()=>{if(!wrapper.isConnected){editor.destroy();observer.disconnect();}});observer.observe(document.body,{childList:true,subtree:true});
}
