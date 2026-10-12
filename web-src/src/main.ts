import { renderRichText } from "./rich-text";
import { pickAsset, assetUrl, type AssetRules } from "./asset-picker";
import { attach, register } from "@adobe/uix-guest";
import "./styles.css";

let editorPageUrl = "";
const extensionId = "content-studio-universal-editor";
const toolbarIconKey = "content-studio-toolbar-icon-v2";
const toolbarIcons = [
  { value: "TextEdit", label: "Texto com lápis" },
  { value: "Settings", label: "Configurações" },
  { value: "Edit", label: "Lápis" },
  { value: "ViewGrid", label: "Grade de componentes" },
];
function toolbarIcon(): string {
  try {
    const saved = localStorage.getItem(toolbarIconKey);
    return toolbarIcons.find((item) => item.value === saved)?.value ?? "TextEdit";
  } catch { return "TextEdit"; }
}
const app = document.querySelector<HTMLDivElement>("#app")!;

type SchemaField = {
  name: string; label: string; type: string; description?: string;
  condition?: Record<string, unknown>; required?: boolean; maxLength?: number;
  placeholder?: string; options?: { label: string; value: string }[];
  defaultValue?: unknown; sectionLabel?: string;
  fields?: SchemaField[]; multi?: boolean; assetRules?: AssetRules;
};
async function boot(): Promise<void> {
  const route = location.hash.replace(/^#\/?/, "");
  const isCustomUi = route.startsWith("rail/") || route.startsWith("modal/") || route.startsWith("renderer/");
  if (!isCustomUi) {
    const guest = await register({
      id: extensionId,
      methods: {
        canvas: {
          getRenderers: () => [{ dataType: "content-studio-card-list", url: `${window.location.origin}/index.html#/renderer/cards` }],
        },
        headerMenu: {
          getButtons: () => [{
            id: "content-studio-open-component-editor",
            label: "Content Studio",
            icon: toolbarIcon(),
            onClick: () => openEditorModal(guest.host),
          }],
        },
        rightPanel: {
          addRails: () => [{
            id: "content-studio-component-editor",
            header: "Content Studio",
            url: `${window.location.origin}/index.html#/rail/editor`,
            icon: toolbarIcon(),
          }],
        },
      },
    });
    app.textContent = "Extensão do Universal Editor registrada.";
    return;
  }

  const connection = await attach({ id: extensionId });
  const host = connection.host as any;
  if (route.startsWith("renderer/")) {
    await renderNativeCardList(app, host);
    return;
  }
  await renderSelectedEditable(app, host, route.startsWith("modal/"));
}

async function renderNativeCardList(target: HTMLDivElement, host: any): Promise<void> {
  const [model, value, state] = await Promise.all([host.field.getModel(), host.field.getValue(), host.editorState.get()]);
  editorPageUrl = resolvePageUrl(state.location).href;
  const field = normalizeSchema({ fields: [{ ...model, component: "container", multi: true }] }, { id: "native-list" }).sections[0]?.fields[0];
  if (!field) throw new Error("Modelo de cards indisponível.");
  const draft: Record<string, unknown> = { [field.name]: structuredClone(value ?? []) };
  const dirty = new Set<string>();
  target.replaceChildren(); target.className = "native-card-list";
  renderItems(target, field, draft, dirty, `/${escapePointer(field.name)}`);
  const footer = document.createElement("footer");
  const status = document.createElement("span"); status.setAttribute("role", "status");
  const apply = actionButton("Aplicar alterações nos cards", async () => {
    apply.disabled = true;
    try { await host.field.onChange(draft[field.name]); dirty.clear(); status.textContent = "Cards atualizados."; }
    catch (error) { status.textContent = error instanceof Error ? error.message : "Não foi possível atualizar os cards."; }
    finally { apply.disabled = false; }
  });
  const cancel = actionButton("Cancelar", async () => {
    if (dirty.size && !await confirmDiscard()) return;
    await renderNativeCardList(target, host);
  });
  footer.append(cancel, status, apply); target.append(footer);
  if (model.readOnly) target.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>("input,button,select,textarea").forEach((control) => { control.disabled = true; });
  await host.field.setHeight(650);
}

async function openEditorModal(host: any): Promise<void> {
  const state = await host.editorState.get();
  sessionStorage.setItem("dialog-selection", JSON.stringify({
    location: state.location, selected: state.selected, editables: state.editables,
  }));
  await host.modal.showUrl({
    url: `${window.location.origin}/index.html#/modal/editor`,
    title: "Editor de componentes",
    width: "1100px",
    height: `${Math.min(620, Math.max(420, Math.round(window.screen.availHeight * 0.72)))}px`,
    isDismissable: false,
  });
}

async function renderSelectedEditable(target: HTMLDivElement, host: any, inModal: boolean): Promise<void> {
  const current = await host.editorState.get();
  const captured = inModal ? JSON.parse(sessionStorage.getItem("dialog-selection") || "null") : null;
  const state = captured && Object.values(captured.selected ?? {}).some(Boolean) ? captured : current;
  const selectedId = Object.keys(state.selected ?? {}).find((id) => state.selected[id]);
  let selected = state.editables?.find((item: { id: string }) => item.id === selectedId);
  const pageLocation = state.location ?? current.location;
  editorPageUrl = resolvePageUrl(pageLocation).href;
  if (selected && !selected.model) selected = await resolveComponent(pageLocation, selected, state.editables ?? []);
  const details = selected ? await host.editorActions.details(selected) : undefined;
  if (!selected || !details) {
    target.textContent = "Selecione um componente editável no canvas antes de abrir o Content Studio.";
    return;
  }
  const rawSchema = details.schema ?? await loadPageModel(pageLocation, selected.model);
  const schema = normalizeSchema(rawSchema, selected);
  if (!schema.sections.length) {
    target.replaceChildren();
    target.className = "empty-state";
    const message = document.createElement("p");
    message.textContent = "Não foi possível interpretar os campos deste componente.";
    target.append(message);
    console.warn("[Content Studio] Formato de schema não reconhecido", {
      schema: details.schema, editableType: selected.type, model: selected.model,
      detailKeys: Object.keys(details),
    });
    const diagnostic = document.createElement("pre");
    diagnostic.textContent = JSON.stringify({
      schemaType: Array.isArray(details.schema) ? "array" : typeof details.schema,
      schemaKeys: details.schema && typeof details.schema === "object" ? Object.keys(details.schema) : [],
      model: selected.model, detailKeys: Object.keys(details),
    }, null, 2);
    console.warn("[Content Studio] Diagnóstico", diagnostic.textContent);
    if (!inModal) appendModalButton(target, host);
    return;
  }
  renderForm(target, schema, details.data ?? {}, host, selected, inModal);
  if (!inModal) appendModalButton(target.querySelector("header")!, host);
}

function resolvePageUrl(location: any): URL {
  const value = typeof location === "string" ? location : location?.href ?? location?.url;
  if (value) return new URL(value);
  const canvas = document.referrer.split("/canvas/")[1];
  if (canvas) return new URL(`https://${canvas}`);
  throw new Error("O editor não informou o endereço da página. Feche a janela, selecione o componente e abra novamente.");
}

async function resolveComponent(location: unknown, selected: any, editables: any[]): Promise<any> {
  const response = await fetch(resolvePageUrl(location), { credentials: "omit" });
  if (!response.ok) throw new Error("Não foi possível identificar o componente na página.");
  const doc = new DOMParser().parseFromString(await response.text(), "text/html");
  const candidates = Array.from(doc.querySelectorAll("[data-aue-resource]"));
  const resource = selected.resource;
  if (!resource) return selected;
  const owner = candidates.find((element) => element.getAttribute("data-aue-resource") === resource);
  if (!owner) return selected;
  const field = selected.property ? Array.from(owner.querySelectorAll("[data-aue-prop]")).find((element) => element.getAttribute("data-aue-prop") === selected.property) : owner;
  const component = (field ?? owner).closest("[data-aue-model]");
  if (!component) return selected;
  const model = component.getAttribute("data-aue-model");
  const componentResource = component.getAttribute("data-aue-resource") ?? resource;
  const registered = editables.find((editable) => editable.model === model && editable.resource === componentResource);
  if (registered) return registered;
  // Only enrich the selected target when its resource matches the model owner.
  return componentResource === resource ? { ...selected, model, label: component.getAttribute("data-aue-label") ?? selected.label } : selected;
}

async function loadPageModel(location: unknown, modelId: string): Promise<unknown> {
  if (!modelId) throw new Error("Selecione o componente na árvore, em vez de um campo de texto interno, e reabra o editor.");
  const pageUrl = resolvePageUrl(location);
  const response = await fetch(pageUrl, { credentials: "omit" });
  if (!response.ok) throw new Error(`Não foi possível ler os modelos da página (${response.status}).`);
  const doc = new DOMParser().parseFromString(await response.text(), "text/html");
  const base = new URL(doc.querySelector("base[href]")?.getAttribute("href") ?? response.url, response.url);
  const definitions = await Promise.all(Array.from(doc.querySelectorAll('script[type="application/vnd.adobe.aue.model+json"]')).map(async (script) => {
    const src = script.getAttribute("src");
    if (!src) return JSON.parse(script.textContent || "[]");
    const modelResponse = await fetch(new URL(src, base), { credentials: "omit" });
    if (!modelResponse.ok) throw new Error(`Não foi possível carregar a definição do modelo (${modelResponse.status}).`);
    return modelResponse.json();
  }));
  const models = definitions.flatMap((definition) => Array.isArray(definition) ? definition : [definition]);
  const model = models.find((item) => item.id === modelId);
  if (!model) throw new Error(`A página não publicou o modelo ${modelId}.`);
  return model;
}

function appendModalButton(target: Element, host: any): void {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Abrir em janela";
  button.onclick = () => openEditorModal(host).catch((error) => {
    console.error("[Content Studio] Falha ao abrir modal", error);
    button.textContent = "Falha ao abrir janela — tente novamente";
  });
  target.append(button);
}

function normalizeSchema(raw: unknown, editable: { id: string; [key: string]: unknown }): {
  component: { key: string; title: string };
  sections: { id: string; label: string; fields: SchemaField[] }[];
} {
  const schema = raw && typeof raw === "object" ? raw as Record<string, any> : {};
  const sourceFields: any[] = Array.isArray(raw)
    ? raw
    : Array.isArray(schema.fields)
    ? schema.fields
    : Array.isArray(schema.properties)
      ? schema.properties
      : schema.properties && typeof schema.properties === "object"
        ? Object.entries(schema.properties).map(([name, field]) => ({ name, ...(field as object) }))
        : [];
  const sections: { id: string; label: string; fields: SchemaField[] }[] = [];
  let active = { id: "general", label: "Geral", fields: [] as SchemaField[] };
  sections.push(active);
  for (const field of sourceFields) {
    if (field.component === "tab" || field.type === "tab") {
      active = { id: String(field.name ?? field.id ?? `section-${sections.length}`), label: String(field.label ?? field.title ?? "Seção"), fields: [] };
      sections.push(active);
      continue;
    }
    const name = String(field.name ?? field.id ?? "");
    if (!name) continue;
    active.fields.push({
      defaultValue: field.value,
      sectionLabel: active.label,
      multi: Boolean(field.multi) || field.component === "content-studio-card-list",
      assetRules: { rootPath: field.filter?.path ?? field.validation?.rootPath, mimeTypes: field.filter?.mimeTypes },
      name,
      label: String(field.label ?? field.title ?? name),
      type: normalizeFieldType(field.component ?? field.type ?? field.valueType),
      description: field.description,
      condition: field.condition,
      required: Boolean(field.required ?? field.validation?.required),
      maxLength: typeof field.validation?.maxLength === "number" ? field.validation.maxLength : undefined,
      placeholder: field.placeholder,
      options: Array.isArray(field.options) ? field.options.map((option: any) => ({ label: String(option.label ?? option.name ?? option.value), value: String(option.value ?? option.name ?? "") })) : undefined,
      fields: Array.isArray(field.fields) ? normalizeSchema({ fields: field.fields }, editable).sections.flatMap((section) => section.fields) : undefined,
    });
  }
  return {
    component: {
      key: String(schema.id ?? schema.name ?? editable.type ?? editable.id),
      title: String(editable.label ?? schema.title ?? "Componente"),
    },
    sections: sections.filter((section) => section.id !== "general" || section.fields.length),
  };
}

function normalizeFieldType(value: unknown): string {
  const type = String(value ?? "text").toLowerCase();
  if (["text", "string", "textarea", "multiline"].includes(type)) return type === "textarea" || type === "multiline" ? "textarea" : "text";
  if (type === "content-studio-card-list") return "container";
  if (type === "aem-content") return "link";
  if (["number", "boolean", "select", "radio-group", "link"].includes(type)) return type;
  if (["container", "multifield"].includes(type)) return "container";
  return type;
}

function menuIcon(label: string, collection = false): SVGSVGElement {
  const paths = collection ? '<path d="m3 6 2 2-2 2m0 4 2 2-2 2M9 7h12M9 12h12M9 17h12"/>'
    : /^destino$/i.test(label) ? '<path d="m10 14 4-4M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 2 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0"/>'
    : /^imagem$/i.test(label) ? '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="15" cy="8" r="2"/><path d="m3 17 6-6 7 10"/>'
    : /^editar$/i.test(label) ? '<path d="m15 4 5 5M4 20l5-1L20 8a2 2 0 0 0-5-5L4 14Z"/>'
    : /apar[eê]ncia|design|estilo/i.test(label) ? '<path d="M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1-4c-1-1 0-3 2-3h2a3 3 0 0 0 3-3 9 9 0 0 0-9-8Z"/><circle cx="7" cy="10" r=".7"/><circle cx="10" cy="6.5" r=".7"/><circle cx="15" cy="7" r=".7"/>'
    : /comportamento|config|avan[cç]ado/i.test(label) ? '<path d="M3 6h7m4 0h7M3 12h2m4 0h12M3 18h11m4 0h3M10 3v6M5 9v6m9 0v6"/>'
    : /tagueamento|gtm|tracking/i.test(label) ? '<path d="M3 3h9l9 9-9 9-9-9Z"/><circle cx="8" cy="8" r="1"/>'
    : '<rect x="5" y="3" width="14" height="18" rx="3"/><path d="M9 8h6M9 12h6M9 16h3"/>';
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("fill", "none"); svg.setAttribute("stroke", "currentColor"); svg.setAttribute("stroke-width", "1.7"); svg.setAttribute("stroke-linecap", "round"); svg.setAttribute("stroke-linejoin", "round"); svg.setAttribute("aria-hidden", "true"); svg.classList.add("menu-icon"); svg.innerHTML = paths; return svg;
}

function collectionLabel(label: string): string {
  return label.replace(/\s+[—–]\s+expanda\b.*$/i, "").trim();
}

function organizeSections(sections: { id: string; label: string; fields: SchemaField[] }[]) {
  return sections.flatMap((section) => {
    const lists = section.fields.filter((field) => field.type === "container" && field.multi);
    if (!lists.length || (section.fields.length === 1 && section.label === lists[0].label)) return [{ ...section, label: lists.length === 1 && section.fields.length === 1 ? collectionLabel(lists[0].label) : section.label }];
    const regular = section.fields.filter((field) => !lists.includes(field));
    return [...(regular.length ? [{ ...section, fields: regular }] : []),
      ...lists.map((field) => ({ id: `${section.id}--${field.name}`, label: collectionLabel(field.label), fields: [field] }))];
  });
}

function renderToolbarPreference(parent: HTMLElement, host: any): void {
  const details = document.createElement("details"); details.className = "toolbar-preference";
  const summary = document.createElement("summary"); summary.textContent = "Personalizar botão Content Studio";
  const label = document.createElement("label"); label.textContent = "Ícone na barra do editor";
  const select = document.createElement("select");
  for (const item of toolbarIcons) { const option = document.createElement("option"); option.value = item.value; option.textContent = item.label; select.append(option); }
  select.value = toolbarIcon(); label.append(select);
  const status = document.createElement("small"); status.setAttribute("role", "status"); status.textContent = "Preferência deste navegador, aplicada ao escolher.";
  select.onchange = async () => {
    select.disabled = true;
    try {
      localStorage.setItem(toolbarIconKey, select.value);
      try { await host.editorActions.reloadExtension(extensionId); status.textContent = "Ícone atualizado na barra do editor."; }
      catch { status.textContent = "Preferência salva. Recarregue o editor para atualizar o ícone."; }
    } catch { status.textContent = "O navegador não permitiu salvar a preferência."; select.value = toolbarIcon(); }
    finally { select.disabled = false; }
  };
  details.append(summary, label, status); parent.append(details);
}

function renderForm(
  target: HTMLDivElement,
  schema: { component: { key: string; title: string }; sections: { id: string; label: string; fields: SchemaField[] }[] },
  data: Record<string, unknown>,
  connection: any,
  editable: { id: string },
  inModal = false,
): void {
  const draft: Record<string, unknown> = structuredClone(data);
  const dirty = new Set<string>();
  target.replaceChildren();
  target.className = "editor";

  const header = document.createElement("header");
  header.className = "studio-header";
  header.innerHTML = `<div class="studio-brand">Content Studio<span>Editor de componentes</span></div><div class="studio-component">${escapeHtml(schema.component.title)}</div>`;
  const modes = document.createElement("div"); modes.className = "studio-modes"; header.append(modes);

  target.append(header);

  const layout = document.createElement("div");
  layout.className = "layout";
  const nav = document.createElement("nav");
  nav.setAttribute("aria-label", "Seções do componente");
  const content = document.createElement("main");
  layout.append(nav, content);
  target.append(layout);

  const sections = schema.sections.length ? organizeSections(schema.sections) : [{ id: "content", label: "Conteúdo", fields: [] }];
  let active = 0;
  let advanced = false;
  const showSection = (index: number) => {
    active = index;
    nav.replaceChildren();
    const navTitle = document.createElement("small"); navTitle.className = "nav-caption"; navTitle.textContent = "ESTRUTURA"; nav.append(navTitle);
    sections.forEach((section, i) => {
      if (!advanced && /avan[cç]ado/i.test(section.label)) return;
      const button = document.createElement("button");
      button.type = "button";
      const caption = document.createElement("span"); caption.textContent = section.label;
      button.append(menuIcon(section.label, section.fields.some((field) => field.multi)), caption);
      button.className = i === active ? "active" : "";
      button.setAttribute("aria-current", i === active ? "true" : "false");
      const list = section.fields.find(field => field.multi);
      if (list) { const badge = document.createElement("span"); badge.className = "nav-count"; badge.dataset.path = "/" + escapePointer(list.name); button.append(badge); }
      button.onclick = () => showSection(i);
      nav.append(button);
    });
    const quality = document.createElement("div"); quality.className = "studio-quality"; nav.append(quality);
    renderToolbarPreference(nav, connection);
    content.replaceChildren();
    content.scrollTop = 0;
    const title = document.createElement("h2");
    title.textContent = sections[index].label;
    const collectionOnly = sections[index].fields.length === 1 && sections[index].fields[0].type === "container" && sections[index].fields[0].multi;
    if (!collectionOnly) content.append(title);
    if (!sections[index].fields.length) {
      const empty = document.createElement("p");
      empty.textContent = "Este componente não possui configurações nesta aba.";
      content.append(empty);
    }
    renderFields(content, sections[index].fields, draft, dirty);
  };
  const updateModes = () => {
    modes.replaceChildren();
    for (const [label, value] of [["Simples", false], ["Avançado", true]] as const) {
      const button = actionButton(label, () => { advanced = value; if (!advanced && /avan[cç]ado/i.test(sections[active].label)) active = 0; showSection(active); updateModes(); refreshSummary(); });
      button.setAttribute("aria-pressed", String(value === advanced)); modes.append(button);
    }
  };
  showSection(active); updateModes();

  const footer = document.createElement("footer");
  const status = document.createElement("span");
  status.textContent = "Sem alterações pendentes";
  status.setAttribute("role", "status");
  const save = document.createElement("button");
  save.type = "button";
  save.textContent = "Salvar alterações";
  let saveFailed = false;
  save.onclick = async () => {
    saveFailed = false;
    save.disabled = true;
    status.textContent = "Salvando…";
    try {
      for (const fieldName of [...dirty].filter((path) => ![...dirty].some((other) => other !== path && path.startsWith(other + "/")))) {
        await connection.editorActions.update({
          target: { editable },
          patch: [{ op: "replace", path: fieldName, value: getAtPath(draft, fieldName) }],
        });
      }
      dirty.clear();
      status.textContent = "Alterações salvas.";
      if (inModal) await connection.modal.close();
    } catch (error) {
      saveFailed = true;
      status.textContent = error instanceof Error ? error.message : "Falha ao salvar.";
    } finally {
      save.disabled = false;
    }
  };
  footer.append(status, save);
  if (inModal) {
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "Cancelar";
    close.className = "secondary";
    close.onclick = async () => {
      if (dirty.size && !await confirmDiscard()) return;
      await connection.modal.close();
    };
    footer.prepend(close);
  }
  target.append(footer);
  const refreshSummary = () => {
    if (!save.disabled && !saveFailed) status.textContent = dirty.size ? "Alterações ainda não salvas" : "Sem alterações pendentes";
    for (const badge of nav.querySelectorAll<HTMLElement>(".nav-count")) {
      const value = getAtPath(draft, badge.dataset.path!);
      badge.textContent = String(Array.isArray(value) ? value.length : value && typeof value === "object" ? Object.values(value).filter(item => item && typeof item === "object").length : 0);
    }
    const results = sections.flatMap(section => section.fields.filter(field => field.multi).flatMap(field => {
      const value = getAtPath(draft, "/" + escapePointer(field.name));
      const items = Array.isArray(value) ? value : value && typeof value === "object" ? Object.values(value).filter(item => item && typeof item === "object") : [];
      return items.map(item => itemCompleteness(field, item));
    })).filter(result => result !== null);
    const quality = nav.querySelector(".studio-quality");
    if (quality) {
      quality.replaceChildren();
      (quality as HTMLElement).hidden = results.length === 0;
      const label = document.createElement("strong"); label.textContent = "Preenchimento do conteúdo";
      const summary = document.createElement("small"); const complete = results.filter(Boolean).length;
      summary.textContent = results.length ? `${complete} de ${results.length} itens com campos obrigatórios preenchidos` : "Este modelo não define campos obrigatórios para avaliar os itens.";
      quality.append(label, summary);
      if (results.length) { const progress = document.createElement("progress"); progress.max = results.length; progress.value = complete; quality.append(progress); }
    }
  };
  target.oninput = target.onchange = target.onclick = () => { queueMicrotask(refreshSummary); };
  refreshSummary();

}

function renderTextCard(parent: HTMLElement, field: SchemaField, draft: Record<string, unknown>, dirty: Set<string>, parentPath: string): void {
  const path = `${parentPath}/${escapePointer(field.name)}`;
  const card = document.createElement("section"); card.className = "text-card";
  const top = document.createElement("div"); top.className = "text-card-heading";
  const icon = document.createElement("span"); icon.className = "text-type-icon"; icon.textContent = "T"; icon.setAttribute("aria-hidden", "true");
  const heading = document.createElement("h3"); heading.textContent = field.label;
  const type = document.createElement("span"); type.className = "text-type-badge"; type.textContent = field.type === "textarea" ? "Texto longo" : "Texto";
  top.append(icon, heading, type);
  const label = document.createElement("label"); label.className = "text-card-label";
  const instruction = document.createElement("span"); instruction.textContent = "Texto exibido na página";
  const input = document.createElement("textarea"); input.rows = field.type === "textarea" ? 4 : 1;
  input.value = typeof getAtPath(draft, path) === "string" ? String(getAtPath(draft, path)) : "";
  input.placeholder = field.placeholder || "Escreva o texto aqui…";
  input.setAttribute("aria-label", field.label); input.required = Boolean(field.required);
  if (field.maxLength && field.maxLength > 0) input.maxLength = field.maxLength;
  if (field.type === "text") input.onkeydown = event => { if (event.key === "Enter") event.preventDefault(); };
  label.append(instruction, input);
  const meta = document.createElement("div"); meta.className = "text-card-meta";
  const help = document.createElement("small"); help.textContent = field.description || (field.required ? "Campo obrigatório" : "");
  const count = document.createElement("small"); count.className = "text-character-count";
  meta.append(help, count);
  const sync = () => {
    count.textContent = field.maxLength ? `${input.value.length} / ${field.maxLength} caracteres` : `${input.value.length} caracteres`;
  };
  input.oninput = () => {
    if (field.type === "text") input.value = input.value.replace(/[\r\n]+/g, " ");
    setAtPath(draft, path, input.value); dirty.add(path); sync();
  };
  sync(); card.append(top, label, meta); parent.append(card);
}

function mediaFieldHeading(field: SchemaField): HTMLElement {
  const header = document.createElement("div"); header.className = "media-field-heading";
  const icon = document.createElement("span"); icon.className = "media-field-icon"; icon.append(menuIcon(field.type === "link" ? "Destino" : "Imagem"));
  const copy = document.createElement("div");
  const title = document.createElement("h3"); title.textContent = field.label; copy.append(title);
  if (field.description) { const help = document.createElement("p"); help.textContent = field.description; copy.append(help); }
  header.append(icon, copy); return header;
}

function renderFieldSummary(parent: HTMLElement, field: SchemaField, draft: Record<string, unknown>, dirty: Set<string>, parentPath: string): void {
  const path = `${parentPath}/${escapePointer(field.name)}`;
  const group = document.createElement("section"); group.className = "field-summary";
  if (field.type === "link") group.classList.add("link-field");
  parent.append(group);
  const show = () => {
    group.replaceChildren(); group.classList.remove("editing");
    const heading = document.createElement("h3"); heading.textContent = field.label;
    const row = document.createElement("div"); row.className = "field-summary-row";
    const value = getAtPath(draft, path);
    const empty = value == null || value === "";
    const text = document.createElement("span"); text.className = "field-summary-value";
    if (empty) { text.textContent = "Não preenchido"; text.classList.add("empty"); }
    else if (field.type === "boolean") text.textContent = value === true || value === "true" ? "Sim" : "Não";
    else if (["select", "radio-group"].includes(field.type)) text.textContent = field.options?.find(option => option.value === String(value))?.label ?? String(value);
    else if (field.type === "richtext") text.textContent = new DOMParser().parseFromString(String(value), "text/html").body.textContent || "Sem texto";
    else text.textContent = String(value);
    const actions = document.createElement("div"); actions.className = "field-summary-actions";
    const edit = actionButton(empty ? "Preencher" : "", () => {
      group.replaceChildren(); group.classList.add("editing");
      const top = document.createElement("div"); top.className = "field-detail-heading";
      const done = actionButton("Concluir edição", () => { show(); group.querySelector<HTMLButtonElement>("button")?.focus(); });
      top.append(heading, done); group.append(top);
      const body = document.createElement("div"); body.className = "field-detail-body"; group.append(body);
      renderField(body, field, draft, dirty, parentPath, true);
      requestAnimationFrame(() => body.querySelector<HTMLElement>('input,textarea,select,[contenteditable="true"]')?.focus());
    });
    edit.setAttribute("aria-label", `${empty ? "Preencher" : "Editar"} ${field.label}`); edit.title = `Editar ${field.label}`;
    if (!empty) edit.append(menuIcon("Editar"));
    actions.append(edit);
    if (!empty && !field.required && ["text", "textarea", "link", "richtext", "number"].includes(field.type)) {
      const remove = actionButton("×", () => { setAtPath(draft, path, field.type === "number" ? null : ""); dirty.add(path); show(); });
      remove.className = "remove-field"; remove.title = `Limpar ${field.label}`; remove.setAttribute("aria-label", `Limpar ${field.label}`); actions.append(remove);
    }
    if (field.type === "link") {
      const icon = document.createElement("span"); icon.className = "link-document-icon"; icon.append(menuIcon("Conteúdo"));
      const copy = document.createElement("div"); copy.className = "link-destination-copy";
      if (!empty) {
        const name = document.createElement("strong");
        try { const url = new URL(String(value), editorPageUrl || window.location.origin); name.textContent = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() || url.hostname); }
        catch { name.textContent = "Destino selecionado"; }
        copy.append(name);
      }
      copy.append(text); row.append(icon, copy, actions); group.append(mediaFieldHeading(field), row);
    } else { row.append(text, actions); group.append(heading, row); }
  };
  show();
}

function renderFields(parent: HTMLElement, fields: SchemaField[], draft: Record<string, unknown>, dirty: Set<string>, parentPath = ""): void {
  const grid = document.createElement("div"); grid.className = "editor-fields";
  for (const field of fields) {
    if (field.type === "tab") continue;
    const cell = document.createElement("div"); cell.className = "editor-field-cell";
    if (!field.condition && ["text", "select", "radio-group"].includes(field.type)) cell.classList.add("short-field");
    renderField(cell, field, draft, dirty, parentPath); grid.append(cell);
  }
  parent.append(grid);
}

function renderField(
  parent: HTMLElement,
  field: SchemaField,
  draft: Record<string, unknown>,
  dirty: Set<string>,
  parentPath = "",
  editing = false,
): void {
  if (["tab"].includes(field.type)) return;
  const path = `${parentPath}/${escapePointer(field.name)}`;
  if (!editing && !field.condition && ["text", "textarea"].includes(field.type)) {
    renderTextCard(parent, field, draft, dirty, parentPath); return;
  }
  if (!editing && !field.condition && ["text", "link", "textarea", "boolean", "number", "richtext"].includes(field.type)) {
    renderFieldSummary(parent, field, draft, dirty, parentPath); return;
  }
  if (field.type === "container" && field.multi) {
    renderItems(parent, field, draft, dirty, path);
    return;
  }
  if (field.type === "richtext" && !field.condition) {
    const value = getAtPath(draft, path);
    renderRichText(parent, field.label, typeof value === "string" ? value : "", (html) => {
      setAtPath(draft, path, html); dirty.add(path);
    });
    return;
  }
  if (field.type === "reference") {
    renderImage(parent, field, draft, dirty, path);
    return;
  }
  if (field.type === "container") {
    const group = document.createElement("fieldset");
    const legend = document.createElement("legend");
    legend.textContent = field.label;
    group.append(legend);
    renderFields(group, field.fields ?? [], draft, dirty, path);
    parent.append(group);
    return;
  }
  const label = document.createElement("label");
  label.className = "field";
  const caption = document.createElement("span");
  caption.textContent = field.label;
  label.append(caption);
  const value = getAtPath(draft, path);
  const supported = ["text", "link", "textarea", "boolean", "number", "select", "radio-group"].includes(field.type);
  if (!supported || field.condition) {
    const note = document.createElement("small");
    note.textContent = field.condition
      ? "Campo condicional: edição indisponível até interpretar a regra."
      : `Tipo ${field.type} requer um adaptador específico; valor preservado sem edição.`;
    label.append(note);
    parent.append(label);
    return;
  }
  let input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  if (field.type === "textarea") {
    input = document.createElement("textarea");
    input.value = typeof value === "string" ? value : "";
  } else if (field.type === "select" || field.type === "radio-group") {
    input = document.createElement("select");
    for (const option of field.options ?? []) {
      const el = document.createElement("option");
      el.value = option.value;
      el.textContent = option.label;
      input.append(el);
    }
    const current = String(value ?? "");
    if (!(field.options ?? []).some(option => option.value === current)) {
      const placeholder = document.createElement("option"); placeholder.value = current;
      placeholder.textContent = current ? `Valor atual: ${current}` : "Selecione uma opção";
      placeholder.disabled = true; input.prepend(placeholder);
    }
    input.value = current;
  } else {
    input = document.createElement("input");
    input.type = field.type === "boolean" ? "checkbox" : field.type === "number" ? "number" : "text";
    if (input.type === "checkbox") (input as HTMLInputElement).checked = value === true || value === "true";
    else input.value = value == null ? "" : String(value);
    if (field.placeholder) input.placeholder = field.placeholder;
  }
  input.setAttribute("aria-label", field.label);
  input.oninput = () => {
    const next = input instanceof HTMLInputElement && input.type === "checkbox"
      ? input.checked
      : input instanceof HTMLInputElement && input.type === "number"
        ? input.value === "" ? null : Number(input.value)
        : input.value;
    setAtPath(draft, path, next);
    dirty.add(path);
  };
  label.append(input);
  if (field.description) {
    const help = document.createElement("small");
    help.textContent = field.description;
    label.append(help);
  }
  parent.append(label);
}

function confirmDiscard(): Promise<boolean> {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "confirm-dialog";
    dialog.innerHTML = '<h2>Descartar alterações?</h2><p>As alterações ainda não salvas serão perdidas.</p>';
    const finish = (discard: boolean) => { dialog.close(); dialog.remove(); resolve(discard); };
    dialog.append(actionButton("Continuar editando", () => finish(false)), actionButton("Descartar alterações", () => finish(true)));
    dialog.addEventListener("cancel", (event) => { event.preventDefault(); finish(false); });
    document.body.append(dialog); dialog.showModal();
  });
}

function actionButton(text: string, action: () => void): HTMLButtonElement {
  const button = document.createElement("button"); button.type = "button";
  button.textContent = text; button.onclick = action; return button;
}

function isTrackingField(field: SchemaField): boolean {
  return /tagueamento|tracking|gtm|data.?layer/i.test(`${field.label} ${field.sectionLabel ?? ""}`)
    || /^(dl[A-Z]|.*Track[A-Z]|richTextDl)/.test(field.name);
}

function itemCompleteness(field: SchemaField, item: any): boolean | null {
  const required = (field.fields ?? []).filter(child => child.required && !child.condition && child.type !== "tab");
  if (!required.length) return null;
  return required.every(child => { const value = item?.[child.name]; return value != null && (typeof value !== "string" || value.trim().length > 0) && (!Array.isArray(value) || value.length > 0); });
}

function renderItems(parent: HTMLElement, field: SchemaField, draft: Record<string, unknown>, dirty: Set<string>, path: string): void {
  const group = document.createElement("section"); group.className = "item-list"; parent.append(group);
  const entries = (): [string, any][] => {
    const value = getAtPath(draft, path);
    return Array.isArray(value) ? value.map((item, index) => [String(index), item])
      : value && typeof value === "object" ? Object.entries(value).filter(([, item]) => item && typeof item === "object") : [];
  };
  const itemTitle = (key: string, item: any) => {
    const titleField = field.fields?.find((child) => !isTrackingField(child) && child.type === "text" && typeof item[child.name] === "string" && item[child.name]);
    return titleField ? String(item[titleField.name]) : `Item ${entries().findIndex(([id]) => id === key) + 1}`;
  };
  let compact = false;
  const showList = () => {
    group.replaceChildren();
    group.classList.toggle("compact", compact);
    const heading = document.createElement("h3"); heading.className = "collection-heading";
    const headingLabel = document.createElement("span"); headingLabel.textContent = `Gerenciar ${collectionLabel(field.label).toLocaleLowerCase()}`;
    const count = document.createElement("span"); count.className = "item-count"; count.textContent = `${entries().length} itens`;
    heading.append(headingLabel, count); group.append(heading);
    const help = document.createElement("p"); help.className = "item-hint"; help.textContent = "Organize e edite os itens da seção."; group.append(help);
    for (const [key, item] of entries()) {
      const row = document.createElement("div"); row.className = "item-row";
      const title = itemTitle(key, item);
      const label = document.createElement("strong"); label.textContent = title;
      const actions = document.createElement("div"); actions.className = "item-actions";
      const edit = actionButton("", () => showItem(key));
      edit.append(menuIcon("Editar"));
      edit.setAttribute("aria-label", `Editar ${title}`); edit.title = "Editar item";
      const remove = actionButton("×", () => {
        const value = getAtPath(draft, path);
        if (Array.isArray(value)) value.splice(Number(key), 1);
        else if (value && typeof value === "object") delete (value as Record<string, unknown>)[key];
        for (const changed of dirty) if (changed.startsWith(path + "/")) dirty.delete(changed);
        dirty.add(path);
        showList();
      });
      remove.className = "remove-item";
      remove.setAttribute("aria-label", `Remover ${title}`); remove.title = "Remover item";
      const position = entries().findIndex(([id]) => id === key);
      const move = (offset: number) => {
        const ordered = entries(); const next = position + offset;
        if (next < 0 || next >= ordered.length) return;
        [ordered[position], ordered[next]] = [ordered[next], ordered[position]];
        const current = getAtPath(draft, path);
        if (Array.isArray(current)) setAtPath(draft, path, ordered.map(([, value]) => value));
        else {
          const reordered = { ...(current as Record<string, unknown>) };
          for (const [id] of ordered) delete reordered[id];
          for (const [id, value] of ordered) reordered[id] = value;
          setAtPath(draft, path, reordered);
        }
        for (const changed of dirty) if (changed.startsWith(path + "/")) dirty.delete(changed);
        dirty.add(path); showList();
      };
      const up = actionButton("↑", () => move(-1)); up.disabled = position === 0; up.setAttribute("aria-label", `Mover ${title} para cima`); up.title = "Mover para cima";
      const down = actionButton("↓", () => move(1)); down.disabled = position === entries().length - 1; down.setAttribute("aria-label", `Mover ${title} para baixo`); down.title = "Mover para baixo";
      const menu = document.createElement("details"); menu.className = "item-more";
      const trigger = document.createElement("summary"); trigger.textContent = "•••"; trigger.setAttribute("aria-label", `Mais opções para ${title}`); menu.append(trigger);
      const menuBody = document.createElement("div"); menuBody.className = "item-more-options";
      up.textContent = "Mover para cima"; down.textContent = "Mover para baixo"; remove.textContent = "Remover item";
      menuBody.append(up, down, remove); menu.append(menuBody); actions.append(edit, menu);
      const icon = document.createElement("div"); icon.className = "studio-item-icon"; icon.append(menuIcon("Cards", true));
      const copy = document.createElement("div"); copy.className = "studio-item-copy"; copy.append(label);
      const summaryField = field.fields?.find(child => !isTrackingField(child) && ["text", "textarea"].includes(child.type) && typeof item[child.name] === "string" && item[child.name] && item[child.name] !== title);
      if (summaryField) { const subtitle = document.createElement("span"); subtitle.textContent = item[summaryField.name]; copy.append(subtitle); }
      const meta = document.createElement("div"); meta.className = "studio-item-meta";
      const completion = document.createElement("span"); const filled = itemCompleteness(field, item);
      completion.textContent = filled === null ? "" : filled ? "✓ Campos preenchidos" : "! Faltam informações";
      completion.className = filled ? "complete" : "incomplete";
      const itemNumber = document.createElement("span"); itemNumber.textContent = `Item ${position + 1}`;
      meta.append(completion, itemNumber);
      row.append(icon, copy, actions, meta); group.append(row);
    }
    const add = actionButton("＋ Novo", () => {
      let value = getAtPath(draft, path);
      if (value == null) { value = []; setAtPath(draft, path, value); }
      const item: Record<string, unknown> = {};
      for (const child of field.fields ?? []) if (child.defaultValue !== undefined) item[child.name] = structuredClone(child.defaultValue);
      let key: string;
      if (Array.isArray(value)) { key = String(value.length); value.push(item); }
      else if (typeof value === "object") { let i = 0; while (Object.hasOwn(value as object, `item${i}`)) i++; key = `item${i}`; (value as Record<string, unknown>)[key] = item; }
      else return;
      dirty.add(path);
      showItem(key);
    });
    add.className = "add-item"; heading.append(add);
    const view = document.createElement("label"); view.className = "list-display";
    const toggle = document.createElement("input"); toggle.type = "checkbox"; toggle.checked = compact;
    toggle.onchange = () => { compact = toggle.checked; showList(); };
    view.append(toggle, document.createTextNode("Exibição compacta")); group.append(view);
  };
  const showItem = (key: string) => {
    group.replaceChildren();
    const breadcrumb = document.createElement("div"); breadcrumb.className = "item-breadcrumb";
    breadcrumb.append(actionButton(`← ${collectionLabel(field.label)}`, showList));
    const separator = document.createElement("span"); separator.textContent = "›";
    const heading = document.createElement("strong"); heading.textContent = `Editar ${itemTitle(key, getAtPath(draft, `${path}/${escapePointer(key)}`))}`;
    breadcrumb.append(separator, heading); group.append(breadcrumb);
    const tabs = document.createElement("div"); tabs.className = "item-tabs"; tabs.setAttribute("role", "tablist");
    const body = document.createElement("div"); body.className = "item-body"; body.setAttribute("role", "tabpanel"); group.append(tabs, body);
    const showTab = (tracking: boolean) => {
      tabs.replaceChildren(); body.replaceChildren();
      for (const [label, isTracking] of [["Conteúdo", false], ["Tagueamento", true]] as const) {
        const button = actionButton(label, () => showTab(isTracking)); button.setAttribute("role", "tab"); button.setAttribute("aria-selected", String(tracking === isTracking)); tabs.append(button);
      }
      const fields = (field.fields ?? []).filter((child) => isTrackingField(child) === tracking);
      if (!fields.length) { const empty = document.createElement("p"); empty.textContent = "Este item não possui configurações nesta aba."; body.append(empty); }
      renderFields(body, fields, draft, dirty, `${path}/${escapePointer(key)}`);
    };
    showTab(false);
  };
  showList();
}

function renderImage(parent: HTMLElement, field: SchemaField, draft: Record<string, unknown>, dirty: Set<string>, path: string): void {
  const group = document.createElement("section"); group.className = "image-field";
  const heading = document.createElement("h3"); heading.textContent = field.label;
  const value = getAtPath(draft, path);
  let current = typeof value === "string" ? value : "";
  const unsupported = value != null && typeof value !== "string";
  const previewRow = document.createElement("div"); previewRow.className = "image-preview-row";
  const thumbnail = document.createElement("div"); thumbnail.className = "image-thumbnail";
  const preview = document.createElement("img"); preview.alt = field.label; preview.className = "asset-preview";
  const fallback = document.createElement("span"); fallback.textContent = "A prévia não está disponível"; fallback.className = "image-preview-fallback";
  thumbnail.append(preview, fallback);
  const name = document.createElement("span"); name.className = "image-asset-name";
  const metadata = document.createElement("span"); metadata.className = "image-asset-kind";
  const copy = document.createElement("div"); copy.className = "image-asset-copy";
  const note = document.createElement("small"); note.setAttribute("role", "status"); note.hidden = true;
  const refresh = () => {
    const hasImage = Boolean(current);
    choose.hidden = hasImage || unsupported;
    previewRow.hidden = !hasImage || unsupported;
    preview.hidden = true; fallback.hidden = false;
    if (!hasImage) { preview.removeAttribute("src"); return; }
    name.textContent = current.split("/").pop()?.split("?")[0] || "Imagem selecionada";
    const extension = name.textContent.split(".").pop()?.toUpperCase();
    metadata.textContent = ["SVG", "PNG", "JPG", "JPEG", "WEBP", "GIF"].includes(extension || "") ? `Imagem ${extension}` : "Imagem selecionada";
    try {
      const url = new URL(current.startsWith("/content/dam/") ? assetUrl(editorPageUrl, current) : current, editorPageUrl);
      if (!["https:", "http:"].includes(url.protocol)) return;
      preview.src = url.href;
    } catch { /* Keep the selected image and actions if its preview is unavailable. */ }
  };
  preview.onload = () => { preview.hidden = false; fallback.hidden = true; };
  preview.onerror = () => { preview.hidden = true; fallback.hidden = false; };
  const selectImage = async () => {
    choose.disabled = edit.disabled = true; note.hidden = true;
    try {
      const selected = await pickAsset(editorPageUrl, field.assetRules ?? {}, current);
      if (selected !== null) { current = selected; setAtPath(draft, path, selected); dirty.add(path); refresh(); }
    } catch {
      note.textContent = "Não foi possível abrir a biblioteca de imagens. Tente novamente."; note.hidden = false;
    } finally { choose.disabled = edit.disabled = false; }
  };
  const choose = actionButton("+ Adicionar imagem", selectImage); choose.className = "add-image";
  const edit = actionButton("", selectImage); edit.className = "edit-image";
  edit.title = "Trocar imagem"; edit.setAttribute("aria-label", `Trocar imagem: ${field.label}`);
  edit.append(menuIcon("Editar"));
  const remove = actionButton("×", () => {
    current = ""; setAtPath(draft, path, ""); dirty.add(path); refresh(); note.hidden = true; choose.focus();
  });
  remove.className = "remove-image"; remove.title = "Remover imagem"; remove.setAttribute("aria-label", `Remover imagem: ${field.label}`);
  const actions = document.createElement("div"); actions.className = "image-actions"; actions.append(edit, remove);
  copy.append(name, metadata);
  previewRow.append(thumbnail, copy, actions);
  group.append(heading, choose, previewRow, note);
  if (unsupported) { note.textContent = "Edite esta imagem pelo painel padrão do editor."; note.hidden = false; }
  refresh(); parent.append(group);
}

function escapePointer(value: string): string { return value.replaceAll("~", "~0").replaceAll("/", "~1"); }
function escapeHtml(value: string): string { const node = document.createElement("span"); node.textContent = value; return node.innerHTML; }
function getAtPath(source: Record<string, unknown>, pointer: string): unknown {
  return pointer.split("/").filter(Boolean).reduce<unknown>((value, segment) => {
    if (!value || typeof value !== "object") return undefined;
    return (value as Record<string, unknown>)[segment.replaceAll("~1", "/").replaceAll("~0", "~")];
  }, source);
}
function setAtPath(source: Record<string, unknown>, pointer: string, next: unknown): void {
  const segments = pointer.split("/").filter(Boolean).map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
  const last = segments.pop();
  if (!last) return;
  let current: Record<string, unknown> = source;
  for (const segment of segments) {
    const child = current[segment];
    if (!child || typeof child !== "object") current[segment] = {};
    current = current[segment] as Record<string, unknown>;
  }
  current[last] = next;
}

boot().catch((error: unknown) => {
  console.error("[Content Studio] Falha ao iniciar", error);
  app.className = "error";
  app.textContent = error instanceof Error ? error.message : "Falha ao iniciar a extensão.";
});
