import { useState, type FormEvent } from "react";
import { dateKey, formatDate } from "../shared/dates";
import type { CaseRecord, TodoInput, TodoRecord } from "../shared/model";
import { Icon } from "./Icon";

function localReminder(value: string): string {
  const date = new Date(value);
  return `${dateKey(date)}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function TodoForm({ item, caseId, cases, busy, onSave, onCancel, onDelete }: {
  item?: TodoRecord; caseId?: string; cases: CaseRecord[]; busy: boolean;
  onSave: (input: TodoInput) => void; onCancel: () => void; onDelete: () => void;
}) {
  const [error, setError] = useState("");
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const reminder = String(data.get("reminderAt") || "");
    let reminderAt: string | null = null;
    if (reminder) {
      const date = new Date(reminder);
      if (!Number.isFinite(date.getTime()) || localReminder(date.toISOString()) !== reminder) {
        setError("La hora no es valida en la zona horaria de tu equipo. Elige otra hora.");
        return;
      }
      reminderAt = item?.reminderAt && localReminder(item.reminderAt) === reminder ? item.reminderAt : date.toISOString();
    }
    setError("");
    onSave({
      title: String(data.get("title") || ""), notes: String(data.get("notes") || ""),
      dueDate: String(data.get("dueDate") || "") || null,
      reminderAt, caseId: String(data.get("caseId") || "") || null
    });
  };
  const missingCaseId = item?.caseId && !cases.some(candidate => candidate.id === item.caseId) ? item.caseId : null;
  return <form onSubmit={submit}>
    {error && <div className="error-banner" role="alert">{error}</div>}
    <fieldset disabled={busy}>
      <label>Tarea<input name="title" required maxLength={240} defaultValue={item?.title} placeholder="Ej. Revisar los resultados del caso" autoFocus /></label>
      <label>Notas<textarea name="notes" maxLength={4000} rows={3} defaultValue={item?.notes} placeholder="Detalles opcionales" /></label>
      <label>Fecha l&iacute;mite<input name="dueDate" type="date" min="1900-01-01" max="9999-12-31" defaultValue={item?.dueDate || ""} /></label>
      <label>Recordatorio<input name="reminderAt" type="datetime-local" min="1900-01-01T00:00" max="9999-12-31T23:59" defaultValue={item?.reminderAt ? localReminder(item.reminderAt) : ""} /></label>
      <p className="field-hint">Fecha y hora de tu equipo. Cierres sigue en la bandeja al cerrar la ventana. Si estaba apagado o saliste, avisa al volver a abrirlo. La fecha l&iacute;mite por s&iacute; sola no activa un recordatorio.</p>
      <label>Caso relacionado<select name="caseId" aria-label="Caso relacionado" defaultValue={item?.caseId || caseId || ""}>
        <option value="">Sin caso relacionado</option>
        {missingCaseId && <option value={missingCaseId}>Caso eliminado (v&iacute;nculo conservado)</option>}
        {cases.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.number} - {candidate.title}{candidate.status === "closed" ? " (cerrado)" : ""}</option>)}
      </select></label>
      <div className="dialog-actions"><button className="button quiet" type="button" onClick={onCancel}>Cancelar</button><button className="button primary" type="submit">{busy ? "Guardando..." : item ? "Guardar tarea" : "Crear tarea"}</button></div>
      {item && <div className="danger-actions"><button className="link-button danger" type="button" onClick={onDelete}>Eliminar tarea</button></div>}
    </fieldset>
  </form>;
}

export function TodoList({ todos, cases, today, busy, onEdit, onComplete, onOpenCase }: {
  todos: TodoRecord[]; cases: CaseRecord[]; today: string; busy: boolean;
  onEdit: (item: TodoRecord) => void; onComplete: (item: TodoRecord) => void; onOpenCase: (item: CaseRecord) => void;
}) {
  const [completed, setCompleted] = useState(false);
  const [query, setQuery] = useState("");
  const [caseFilter, setCaseFilter] = useState("");
  const pending = todos.filter(item => !item.completedAt);
  const source = todos.filter(item => Boolean(item.completedAt) === completed);
  const normalized = query.trim().toLocaleLowerCase("es");
  const filtered = source.filter(item => {
    const related = cases.find(candidate => candidate.id === item.caseId);
    return (!caseFilter || item.caseId === caseFilter) &&
      `${item.title} ${item.notes} ${related?.number || ""} ${related?.title || ""}`.toLocaleLowerCase("es").includes(normalized);
  }).sort((a, b) => completed ? b.completedAt!.localeCompare(a.completedAt!)
    : (a.dueDate || "9999-12-31").localeCompare(b.dueDate || "9999-12-31") ||
      (a.reminderAt || "\uffff").localeCompare(b.reminderAt || "\uffff") || a.createdAt.localeCompare(b.createdAt));
  return <section className="table-panel todo-panel" aria-label="Lista de To Do">
    <div className="table-tools">
      <div className="tabs"><button aria-pressed={!completed} onClick={() => setCompleted(false)}>Pendientes <span>{pending.length}</span></button><button aria-pressed={completed} onClick={() => setCompleted(true)}>Completadas <span>{todos.length - pending.length}</span></button></div>
      <label className="search-box"><Icon name="search" size={15} /><input type="search" aria-label="Buscar tareas" placeholder="Buscar tarea o caso" value={query} onChange={event => setQuery(event.target.value)} /></label>
    </div>
    <label className="todo-filter">Filtrar por caso<select aria-label="Filtrar por caso" value={caseFilter} onChange={event => setCaseFilter(event.target.value)}>
      <option value="">Todos los casos</option>
      {cases.map(item => <option key={item.id} value={item.id}>{item.number}</option>)}
    </select></label>
    {filtered.length ? <ul className="todo-list">{filtered.map(item => {
      const related = cases.find(candidate => candidate.id === item.caseId);
      const overdue = !item.completedAt && item.dueDate && item.dueDate < today;
      return <li key={item.id} className={item.completedAt ? "todo-row completed" : "todo-row"} data-testid="todo-row">
        <button className="todo-check" disabled={busy} aria-label={`${item.completedAt ? "Reabrir tarea" : "Completar tarea"} ${item.title}`} aria-pressed={Boolean(item.completedAt)} onClick={() => onComplete(item)}>
          {item.completedAt && <Icon name="check" size={16} />}
        </button>
        <div className="todo-content"><button className="todo-title" onClick={() => onEdit(item)}>{item.title}</button>
          {item.notes && <p className="todo-notes">{item.notes}</p>}
          <div className="todo-meta">
            {item.dueDate && <span className={overdue ? "todo-overdue" : ""}><Icon name="clock" size={13} />{overdue ? "Vencida: " : item.dueDate === today ? "Hoy: " : "Fecha: "}{formatDate(item.dueDate, true)}</span>}
            {item.reminderAt && <span><Icon name="bell" size={13} />{item.completedAt ? "Recordatorio desactivado" : item.reminderNotifiedAt ? "Recordatorio enviado" : `Recordar: ${new Date(item.reminderAt).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" })}`}</span>}
            {item.caseId && (related ? <button className="link-button" onClick={() => onOpenCase(related)}>Ver caso {related.number}{related.status === "closed" ? " (cerrado)" : ""}</button> : <span>Caso eliminado (v&iacute;nculo conservado)</span>)}
          </div>
        </div>
        <button className="icon-button" aria-label={`Editar tarea ${item.title}`} onClick={() => onEdit(item)}><Icon name="edit" size={15} /></button>
      </li>;
    })}</ul> : <div className="empty"><span className="empty-symbol"><Icon name="check" size={29} /></span><h2>{query || caseFilter ? "Sin coincidencias" : completed ? "Todavia no hay tareas completadas." : "Tus pendientes, en un solo lugar."}</h2><p>{query || caseFilter ? "Prueba otra busqueda o filtro." : completed ? "Completar una tarea no cierra el caso relacionado." : "Crea una tarea, elige una fecha y agrega un recordatorio si lo necesitas."}</p></div>}
    <div className="table-footer"><span>{filtered.length} tareas {completed ? "completadas" : "pendientes"}</span><span>No modifican tus cierres semanales</span></div>
  </section>;
}
