import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { addDays, dateKey, daysBetween, formatDate, inWeek, isWorkday, weekEnd, weekLabel, weekStart } from "../shared/dates";
import type { AppState, CaseInput, CaseRecord, Result, TodoInput, TodoRecord } from "../shared/model";
import { Icon } from "./Icon";
import { TodoForm, TodoList } from "./Todos";

type ModalState = { kind: "register" } | { kind: "edit"; item: CaseRecord } | { kind: "close" } |
  { kind: "delete" | "reopen"; item: CaseRecord } | { kind: "storage" } |
  { kind: "todo"; item?: TodoRecord; caseId?: string } | { kind: "delete-todo"; item: TodoRecord } | null;
async function unwrap<T>(promise: Promise<Result<T>>): Promise<T> {
  const result = await promise;
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
const statusLabels = { work: "En trabajo", waiting: "En espera", closed: "Cerrado" };

function CaseAge({ item, today, testId, naturalDays = false }: {
  item: CaseRecord; today: string; testId: string; naturalDays?: boolean;
}) {
  const days = daysBetween(item.openedAt, item.closedAt ?? today);
  const level = days >= 14 ? "overdue" : days >= 6 ? "warning" : "safe";
  const label = `${days} ${days === 1 ? "d\u00eda" : "d\u00edas"} ${item.status === "closed" ? "hasta el cierre" : "abierto"}`;
  const hint = level === "overdue" ? "Limite de 14 dias alcanzado o superado."
    : level === "warning" ? "Acercandose al limite de 14 dias." : "Dentro del plazo inicial de 0 a 5 dias.";
  return <span className={`case-age age-${level}`} data-testid={testId}
    title={`${hint} Meta: cerrar antes de 14 dias naturales, incluidos sabados y domingos. El dia de apertura cuenta como 0.`}>
    {label}{naturalDays && " \u00b7 d\u00edas naturales"}
  </span>;
}

function Modal({ title, subtitle, children, onClose, busy }: {
  title: string; subtitle?: string; children: ReactNode; onClose: () => void; busy: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className="modal" aria-labelledby="modal-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="dialog-head"><span className="dialog-symbol"><Icon name="circle" size={23} /></span><button className="icon-button" disabled={busy} aria-label="Cancelar" onClick={onClose}><Icon name="x" /></button></div>
    <h2 id="modal-title">{title}</h2>{subtitle && <p className="dialog-intro">{subtitle}</p>}{children}
  </dialog>;
}

function CaseForm({ item, busy, onSave, onCancel, onDelete, onReopen }: {
  item?: CaseRecord; busy: boolean; onSave: (input: CaseInput, closedAt: string | null) => void;
  onCancel: () => void; onDelete: () => void; onReopen: () => void;
}) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const product = data.get("product"), status = data.get("status");
    onSave({
      number: String(data.get("number") || ""), title: String(data.get("title") || ""),
      product: product === "MySQL" || product === "Otro" ? product : "PostgreSQL",
      status: status === "waiting" ? "waiting" : "work", openedAt: String(data.get("openedAt") || "")
    }, item?.status === "closed" ? String(data.get("closedAt") || "") : null);
  };
  return <form onSubmit={submit}>
    <fieldset disabled={busy}>
      <label>ID del caso<input name="number" required maxLength={80} defaultValue={item?.number} placeholder="Ej. 2609290010000000" autoFocus autoComplete="off" /></label>
      <label>Descripci&oacute;n breve<input name="title" required maxLength={240} defaultValue={item?.title} placeholder="Ej. Revision de conectividad" autoComplete="off" /></label>
      <div className="field-pair"><label>Producto<select name="product" defaultValue={item?.product || "PostgreSQL"}><option>PostgreSQL</option><option>MySQL</option><option>Otro</option></select></label>
        {item?.status !== "closed" && <label>Estado actual<select name="status" defaultValue={item?.status || "work"}><option value="work">En trabajo</option><option value="waiting">En espera</option></select></label>}</div>
      <label>Fecha de apertura<input name="openedAt" type="date" required min="1900-01-01" max={dateKey()} defaultValue={item?.openedAt || dateKey()} /></label>
      {item?.status === "closed" && <label>Fecha de cierre<input name="closedAt" type="date" required min="1900-01-01" max={dateKey()} defaultValue={item.closedAt || ""} /><small>Elige de lunes a viernes. Al corregir la fecha, el cierre cuenta en la semana laboral correspondiente.</small></label>}
      <div className="dialog-actions"><button className="button quiet" type="button" onClick={onCancel}>Cancelar</button><button className="button primary" type="submit">{busy ? "Guardando..." : item ? "Guardar cambios" : "Registrar caso"}</button></div>
      {item && <div className="danger-actions">{item.status === "closed" && <button className="link-button" type="button" onClick={onReopen}>Reabrir caso</button>}<button className="link-button danger" type="button" onClick={onDelete}>Eliminar caso</button></div>}
    </fieldset>
  </form>;
}

function CloseForm({ active, initialId, cases, goal, today, busy, onSubmit, onCancel }: {
  active: CaseRecord[]; initialId: string; cases: CaseRecord[]; goal: number; today: string; busy: boolean;
  onSubmit: (id: string, date: string) => void; onCancel: () => void;
}) {
  const [id, setId] = useState(initialId), [date, setDate] = useState(dateKey());
  const item = active.find(candidate => candidate.id === id);
  const targetWeek = isWorkday(date) ? weekStart(date) : null;
  const count = targetWeek ? cases.filter(candidate => candidate.status === "closed" && inWeek(candidate.closedAt, targetWeek)).length : 0;
  return <form onSubmit={event => { event.preventDefault(); onSubmit(id, date); }}>
    <fieldset disabled={busy}>
      <label>Caso que deseas cerrar<select required value={id} onChange={event => setId(event.target.value)} autoFocus><option value="">Selecciona un caso activo</option>{active.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.number} - {candidate.title}</option>)}</select></label>
      {item && <div className="close-details"><strong>{item.title}</strong><span>{item.product} &middot; Abierto el {formatDate(item.openedAt)}</span><span>Estado actual: {statusLabels[item.status]}</span><CaseAge item={item} today={today} testId="close-case-age" naturalDays /></div>}
      <label>Fecha de cierre<input type="date" required value={date} min={item?.openedAt || "1900-01-01"} max={dateKey()} onChange={event => setDate(event.target.value)} /></label>
      <p className="field-hint">Semana laboral: lunes a viernes. Cuenta por fecha de cierre, no de captura.</p>
      <div className="impact" aria-live="polite"><Icon name="target" /><p>{!targetWeek ? "Selecciona una fecha de lunes a viernes." : item ? `Al confirmar: ${count + 1} de ${goal} cierres (${weekLabel(targetWeek)}).` : "Elige un caso para continuar."}</p></div>
      <div className="dialog-actions"><button type="button" className="button quiet" onClick={onCancel}>Cancelar</button><button type="submit" className="button primary" disabled={!item || !targetWeek}><Icon name="check" />{busy ? "Guardando..." : "Confirmar cierre"}</button></div>
      <p className="dialog-note">Se guarda en tu equipo. No modifica el caso en otros sistemas.</p>
    </fieldset>
  </form>;
}

export function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [today, setToday] = useState(dateKey());
  const [week, setWeek] = useState(weekStart());
  const [tab, setTab] = useState<"active" | "closed">("active");
  const [section, setSection] = useState<"cases" | "todos">("cases");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const reload = useCallback(async () => setState(await unwrap(window.cierres.state())), []);
  useEffect(() => { void reload().catch(problem => setError(String(problem.message || problem))); }, [reload]);
  useEffect(() => {
    const unsubscribeChanged = window.cierres.onTodosChanged(() => { void reload().catch(problem => setError(String(problem.message || problem))); });
    const unsubscribeOpen = window.cierres.onOpenTodos(() => setSection("todos"));
    return () => { unsubscribeChanged(); unsubscribeOpen(); };
  }, [reload]);
  useEffect(() => {
    let previous = dateKey();
    const updateDate = () => {
      const current = dateKey();
      if (current !== previous) {
        const prior = previous;
        setWeek(selected => selected === weekStart(prior) ? weekStart(current) : selected);
        setToday(current);
        previous = current;
      }
    };
    const timer = setInterval(updateDate, 30000);
    window.addEventListener("focus", updateDate);
    return () => { clearInterval(timer); window.removeEventListener("focus", updateDate); };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 6000);
    return () => clearTimeout(timer);
  }, [toast]);
  const run = async (operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError("");
    try { await operation(); }
    catch (problem) { setError(problem instanceof Error ? problem.message : "No se pudo completar la operacion."); }
    finally { setBusy(false); }
  };
  const show = (value: ModalState) => { setError(""); setModal(value); };
  const dismiss = () => { if (!busy) { setModal(null); setError(""); } };
  if (!state) return <div className="startup"><span className="brand-icon"><Icon name="check" /></span><h1>Cierres</h1><p>{error || "Abriendo tu tracking local..."}</p>{error && <button className="button" onClick={() => void run(reload)}>Volver a intentar</button>}</div>;
  const active = state.cases.filter(item => item.status !== "closed").sort((a, b) => a.openedAt.localeCompare(b.openedAt));
  const closed = state.cases.filter(item => item.status === "closed" && inWeek(item.closedAt, week)).sort((a, b) => b.closedAt!.localeCompare(a.closedAt!));
  const selected = active.find(item => item.id === selectedId) || active[0] || null;
  const source = tab === "active" ? active : closed;
  const normalized = query.trim().toLocaleLowerCase("es");
  const filtered = source.filter(item => `${item.number} ${item.title} ${item.product}`.toLocaleLowerCase("es").includes(normalized));
  const missing = Math.max(0, state.goal - closed.length);
  const changeTab = (value: "active" | "closed") => { setSection("cases"); setTab(value); setQuery(""); };
  const saveTodo = (input: TodoInput) => void run(async () => {
    if (modal?.kind !== "todo") return;
    if (modal.item) await unwrap(window.cierres.updateTodo(modal.item.id, input));
    else await unwrap(window.cierres.createTodo(input));
    setModal(null); setSection("todos");
    await reload(); setToast("Tarea guardada.");
  });
  const save = (input: CaseInput, closedAt: string | null) => void run(async () => {
    const item = modal?.kind === "edit"
      ? await unwrap(window.cierres.update(modal.item.id, input, closedAt))
      : await unwrap(window.cierres.create(input));
    setModal(null);
    setSection("cases");
    setSelectedId(item.id); setQuery("");
    if (item.status === "closed") { setWeek(weekStart(item.closedAt!)); setTab("closed"); }
    else setTab("active");
    await reload();
    setToast(item.status === "closed" ? "Cambios guardados. El conteo se actualizo." : "Caso guardado en Activos. No suma un cierre.");
  });
  return <div className="app">
    <header className="titlebar"><span className="app-symbol"><Icon name="check" size={12} /></span>Cierres / Mesa enfocada<span className="titlebar-local">TU TRACKING &middot; EN TU EQUIPO</span></header>
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-icon"><Icon name="check" /></span>cierres<span className="brand-dot">.</span></div>
        <div className="eyebrow side-heading">Mi espacio</div>
        <button className={`side-nav ${section === "cases" && tab === "active" ? "active" : ""}`} onClick={() => changeTab("active")}><Icon name="grid" />Mis casos<span className="nav-count">{active.length}</span></button>
        <button className={`side-nav ${section === "cases" && tab === "closed" ? "active" : ""}`} onClick={() => changeTab("closed")}><Icon name="archive" />Cerrados<span className="nav-count">{closed.length}</span></button>
        <button className={`side-nav ${section === "todos" ? "active" : ""}`} onClick={() => setSection("todos")}><Icon name="check" />To Do<span className="nav-count">{state.todos.filter(item => !item.completedAt).length}</span></button>
        <div className="side-legend"><strong>Tu flujo de trabajo</strong>Registra tus casos actuales.<br />Ci&eacute;rralos cuando termines.<br />Tu semana se actualiza sola.</div>
        <div className="side-bottom">
          <button className="side-nav" onClick={() => show({ kind: "storage" })}><Icon name="shield" />Datos y respaldos</button>
          <button className="side-nav" onClick={() => void run(async () => { await unwrap(window.cierres.quit()); })}><Icon name="x" />Salir de Cierres</button>
          <div className="local"><span className="dot" />Guardado local &middot; sin nube</div>
          <div className="profile"><span className="avatar">YO</span><div><strong>Mi espacio personal</strong><small>Meta: {state.goal} cierres / semana</small></div></div>
        </div>
      </aside>
      <main>
        <header className="page-head"><div><div className="eyebrow">MI TRACKER PERSONAL</div><h1>{section === "todos" ? "To Do" : "Tus casos, bajo control."}</h1><p>{section === "todos" ? "Tareas, fechas y recordatorios conectados con tus casos." : "Lo que tienes en marcha y lo que ya lograste, en un solo lugar."}</p></div><button className="button" onClick={() => show(section === "todos" ? { kind: "todo" } : { kind: "register" })}><Icon name="plus" />{section === "todos" ? "Nueva tarea" : "Registrar caso"}</button></header>
        {error && !modal && <div className="error-banner" role="alert">{error}<button aria-label="Cerrar aviso" onClick={() => setError("")}><Icon name="x" /></button></div>}
        {state.reminderError && <div className="error-banner" role="alert">{state.reminderError}</div>}
        {section === "todos" ? <>
          <p className="todo-guidance"><Icon name="bell" />Al cerrar la ventana, Cierres sigue en la bandeja del sistema para recordarte tus tareas. Usa &ldquo;Salir de Cierres&rdquo; para detenerlo.</p>
          <TodoList todos={state.todos} cases={state.cases} today={today} busy={busy}
            onEdit={item => show({ kind: "todo", item })}
            onComplete={item => void run(async () => { await unwrap(window.cierres.completeTodo(item.id, !item.completedAt)); await reload(); setToast(item.completedAt ? "Tarea reabierta." : "Tarea completada. El caso no se ha cerrado."); })}
            onOpenCase={item => { setSection("cases"); setQuery(""); setSelectedId(item.id); setTab(item.status === "closed" ? "closed" : "active"); if (item.closedAt) setWeek(weekStart(item.closedAt)); }} />
        </> : <>
        <div className="weekbar"><span>Meta semanal</span><button className="icon-button" aria-label="Semana anterior" onClick={() => setWeek(addDays(week, -7))}><Icon name="left" size={13} /></button><strong>{weekLabel(week)}</strong><button className="icon-button" aria-label="Semana siguiente" disabled={week >= weekStart(today)} onClick={() => setWeek(addDays(week, 7))}><Icon name="right" size={13} /></button>{week !== weekStart(today) && <button className="link-button" onClick={() => setWeek(weekStart(today))}>Ir a hoy</button>}<span className="week-tag">{week === weekStart(today) && today <= weekEnd(week) ? "Semana actual" : "Semana finalizada"}</span></div>
        <section className="metrics">
          <div className="metric"><div className="metric-label">Mis casos activos<Icon name="grid" /></div><div className="metric-value" data-testid="active-total">{active.length}</div><small>Carga actual &middot; todas las fechas</small></div>
          <div className="metric goal-metric"><div className="metric-label">Cierres de la semana<Icon name="target" /></div><div className="goal-value"><div className="metric-value"><b data-testid="closed-total">{closed.length}</b><span> / {state.goal}</span></div><span className="percent">{Math.round(closed.length / state.goal * 100)}%</span></div><div className="progress" role="progressbar" aria-label="Meta semanal" aria-valuemin={0} aria-valuemax={state.goal} aria-valuenow={Math.min(closed.length, state.goal)}><div style={{ width: `${Math.min(closed.length / state.goal * 100, 100)}%` }} /></div></div>
          <div className="metric"><div className="metric-label">Para alcanzar tu meta<Icon name="circle" /></div><div className="metric-value">{missing}<span> {missing === 1 ? "cierre" : "cierres"}</span></div><small>{missing ? "No es tu numero de casos abiertos" : "Meta completada. Cada cierre extra suma."}</small></div>
        </section>
        <div className="workspace">
          <section className="table-panel">
            <div className="table-tools"><div className="tabs"><button aria-pressed={tab === "active"} onClick={() => changeTab("active")}>Activos <span>{active.length}</span></button><button aria-pressed={tab === "closed"} onClick={() => changeTab("closed")}>Cerrados <span>{closed.length}</span></button></div><label className="search-box"><Icon name="search" size={15} /><input type="search" aria-label="Buscar casos" placeholder="Buscar ID, tema o producto" value={query} onChange={event => setQuery(event.target.value)} /></label></div>
            <div className="age-legend" aria-label="Plazo de cierre"><span>Meta: antes de 14 d&iacute;as{tab === "active" && " \u00b7 M\u00e1s antiguos primero"}</span><span className="age-safe"><span className="dot" />0&ndash;5 d&iacute;as</span><span className="age-warning"><span className="dot" />6&ndash;13 d&iacute;as</span><span className="age-overdue"><span className="dot" />14+ d&iacute;as</span></div>
            {filtered.length ? <table><thead><tr><th className="col-pick" /><th>CASO / DESCRIPCI&Oacute;N</th><th className="col-age" scope="col" aria-sort={tab === "active" ? "descending" : undefined}>D&Iacute;AS ABIERTO</th><th>ESTADO</th><th><span className="sr-only">Editar</span></th></tr></thead><tbody>
              {filtered.map(item => <tr key={item.id} className={tab === "active" && selected?.id === item.id ? "selected" : ""}>
                <td className="col-pick">{tab === "active" ? <button className="case-picker" aria-label={`Seleccionar caso ${item.number}`} aria-pressed={selected?.id === item.id} onClick={() => setSelectedId(item.id)}>{selected?.id === item.id && <Icon name="check" size={12} />}</button> : <span className="mint"><Icon name="check" size={15} /></span>}</td>
                <td><span className="case-id">{item.number}</span><span className="case-title">{item.title}</span><span className="case-meta">{item.product} &middot; {item.status === "closed" ? `Cerrado ${formatDate(item.closedAt!)}` : `Abierto ${formatDate(item.openedAt)}`}</span></td>
                <td className="col-age"><CaseAge item={item} today={today} testId="case-age" /></td>
                <td><span className={`status ${item.status}`}><span className="dot" />{statusLabels[item.status]}</span></td>
                <td className="edit-cell"><button className="icon-button" aria-label={`Editar caso ${item.number}`} title="Editar caso" onClick={() => show({ kind: "edit", item })}><Icon name="edit" size={15} /></button></td>
              </tr>)}
            </tbody></table> : <div className="empty"><span className="empty-symbol"><Icon name={tab === "active" ? "grid" : "archive"} size={29} /></span><h2>{query ? "Sin coincidencias" : tab === "active" ? "Tu mesa esta lista." : "Cada cierre cuenta."}</h2><p>{query ? "Prueba otro ID, tema o producto." : tab === "active" ? "Registra tus casos actuales para empezar. Tus datos se guardan al confirmar, sin pasos extra." : "Todavia no hay cierres en esta semana. Puedes consultar otras semanas con las flechas."}</p>{!query && tab === "active" && <button className="button" onClick={() => show({ kind: "register" })}><Icon name="plus" />Registrar mi primer caso</button>}</div>}
            <div className="table-footer"><span>{filtered.length} de {source.length} {tab === "active" ? "casos activos" : "cierres de la semana"}</span><span>{tab === "active" && selected ? `${selected.number} seleccionado` : "Cuenta por fecha de cierre"}</span></div>
          </section>
          <aside className="focus-panel"><div className="eyebrow">Tu acci&oacute;n principal</div><div className="focus-check"><Icon name="circle" size={23} /></div><h2>Tu siguiente cierre<br />empieza aqu&iacute;.</h2>
            {selected ? <div className="focus-case"><span className="focus-id">{selected.number}</span><p>{selected.title}</p><div className="focus-meta">{selected.product}<br />Abierto el {formatDate(selected.openedAt)} &middot; {statusLabels[selected.status]}<CaseAge item={selected} today={today} testId="focus-case-age" /><span>Incluye s&aacute;bados y domingos.</span></div></div> : <div className="focus-case"><p>Un lugar para todos tus casos.</p><div className="focus-meta">Registra un caso actual para habilitar el cierre.</div></div>}
            <button className="button primary close-primary" disabled={!active.length || busy} onClick={() => show({ kind: "close" })}><Icon name="circle" size={21} />Cerrar Caso</button><p className="focus-help">T&uacute; confirmas el caso y la fecha.<br />No se cierra nada con un solo clic.</p>
            {selected && <button className="link-button todo-case-action" onClick={() => show({ kind: "todo", caseId: selected.id })}>Crear To Do para este caso</button>}
          </aside>
        </div>
        <p className="below-table"><Icon name="shield" />Registrar agrega un caso a Activos. Solo confirmar el cierre suma a tu meta semanal.</p>
        </>}
        <footer className="app-footer"><span>{section === "todos" ? "Tareas locales \u00b7 fechas y recordatorios todos los dias" : "Lunes a viernes \u00b7 fechas de tu equipo \u00b7 cada caso cuenta una vez"}</span><span>{formatDate(today, true)} &middot; v{state.version}</span></footer>
      </main>
    </div>
    {modal && <Modal busy={busy} onClose={dismiss}
      title={modal.kind === "todo" ? modal.item ? "Editar tarea" : "Nueva tarea" : modal.kind === "delete-todo" ? "Eliminar esta tarea?" : modal.kind === "register" ? "Registra tu caso actual." : modal.kind === "edit" ? "Editar caso" : modal.kind === "close" ? "Un caso menos. Un logro mas." : modal.kind === "storage" ? "Tus datos, en tu equipo." : modal.kind === "reopen" ? "Reabrir este caso?" : "Eliminar este caso?"}
      subtitle={modal.kind === "register" ? "Aparecera en Activos. Registrarlo no suma un cierre a tu meta semanal." : modal.kind === "close" ? "Revisa el caso y la fecha antes de confirmar. El cambio se guarda inmediatamente." : undefined}>
      {error && <div className="error-banner" role="alert">{error}</div>}
      {modal.kind === "todo" && <TodoForm item={modal.item} caseId={modal.caseId} cases={state.cases} busy={busy} onSave={saveTodo} onCancel={dismiss} onDelete={() => { if (modal.item) show({ kind: "delete-todo", item: modal.item }); }} />}
      {modal.kind === "delete-todo" && <><p className="dialog-intro">Se eliminar&aacute; &ldquo;{modal.item.title}&rdquo; y se desactivar&aacute; su recordatorio. El caso relacionado no cambia.</p><div className="dialog-actions"><button className="button quiet" disabled={busy} onClick={dismiss}>Cancelar</button><button className="button" disabled={busy} onClick={() => void run(async () => { await unwrap(window.cierres.removeTodo(modal.item.id)); setModal(null); await reload(); setToast("Tarea eliminada."); })}>Confirmar eliminacion de tarea</button></div></>}
      {(modal.kind === "register" || modal.kind === "edit") && <CaseForm item={modal.kind === "edit" ? modal.item : undefined} busy={busy} onSave={save} onCancel={dismiss}
        onDelete={() => modal.kind === "edit" && show({ kind: "delete", item: modal.item })}
        onReopen={() => modal.kind === "edit" && show({ kind: "reopen", item: modal.item })} />}
      {modal.kind === "close" && <CloseForm active={active} initialId={selected?.id || ""} cases={state.cases} goal={state.goal} today={today} busy={busy} onCancel={dismiss} onSubmit={(id, date) => void run(async () => {
        const item = await unwrap(window.cierres.close(id, date));
        setModal(null); setWeek(weekStart(date)); setTab("closed"); setQuery("");
        await reload(); setToast(`${item.number} cerrado y guardado en la semana correspondiente.`);
      })} />}
      {(modal.kind === "delete" || modal.kind === "reopen") && <><div className="close-details"><strong>{modal.item.number}</strong><span>{modal.item.title}</span></div><p className="dialog-intro">{modal.kind === "reopen" ? "Volvera a Activos. Se retirara su cierre de la semana original; el historial se conserva." : "Se quitara de la lista y, si estaba cerrado, del conteo semanal. Su historial local se conserva, pero no se puede reutilizar este ID."}</p><div className="dialog-actions"><button className="button quiet" disabled={busy} onClick={dismiss}>Cancelar</button><button className="button" disabled={busy} onClick={() => void run(async () => {
        if (modal.kind === "reopen") await unwrap(window.cierres.reopen(modal.item.id));
        else await unwrap(window.cierres.remove(modal.item.id));
        setModal(null); await reload(); setToast("Cambio guardado. El conteo esta actualizado.");
      })}>{busy ? "Guardando..." : modal.kind === "reopen" ? "Confirmar reapertura" : "Confirmar eliminacion"}</button></div></>}
      {modal.kind === "storage" && <div className="storage">
        <p className="dialog-intro">SQLite guarda cada cambio confirmado. No se conecta a servicios externos ni requiere iniciar sesi&oacute;n.</p>
        <label>Base de datos<code>{state.dataPath}</code></label><label>Respaldos locales<code>{state.backupPath}</code></label>
        <p className="field-hint">Copia autom&aacute;tica al iniciar el d&iacute;a y antes de restaurar. No se borran autom&aacute;ticamente. Para protegerte de una falla del disco, exporta un respaldo a otra ubicaci&oacute;n segura.</p>
        <div className="storage-actions">
          <button className="button" disabled={busy} onClick={() => void run(async () => { const file = await unwrap(window.cierres.exportBackup()); if (file) setToast(`Respaldo guardado: ${file}`); })}><Icon name="download" />Exportar respaldo</button>
          <button className="button" disabled={busy} onClick={() => void run(async () => { if (await unwrap(window.cierres.importBackup())) { await reload(); setSelectedId(null); setToast("Respaldo restaurado correctamente."); } })}><Icon name="archive" />Restaurar respaldo</button>
          <button className="button" disabled={busy} onClick={() => void run(async () => { const file = await unwrap(window.cierres.exportCsv()); if (file) setToast(`CSV guardado: ${file}`); })}><Icon name="download" />Exportar CSV</button>
          <button className="button quiet" disabled={busy} onClick={() => void run(async () => { await unwrap(window.cierres.openData()); })}><Icon name="folder" />Abrir carpeta de datos</button>
        </div><p className="dialog-note">Los archivos no est&aacute;n cifrados por la app. Se protegen con tu cuenta de Windows. Evita guardar secretos.</p>
      </div>}
    </Modal>}
    {toast && <div className="toast" role="status"><Icon name="check" />{toast}</div>}
  </div>;
}
