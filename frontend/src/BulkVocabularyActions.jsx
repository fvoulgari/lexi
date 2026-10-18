import { useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import { FolderInput, Trash2 } from "lucide-react";
import { request } from "./api.js";

export default function BulkVocabularyActions({
  text,
  csrf,
  onLocked,
  ids,
  pageIds,
  units,
  onChange,
  onExit,
  onPendingChange,
  onComplete,
}) {
  const [pending, setPending] = useState(false);
  const [panel, setPanel] = useState(null);
  const [unitId, setUnitId] = useState("");
  const [error, setError] = useState(null);
  const cancel = useRef(null);
  const trigger = useRef(null);
  const pageCheckbox = useRef(null);
  const pageSelected = pageIds.filter((id) => ids.includes(id)).length;
  useEffect(() => {
    if (pageCheckbox.current)
      pageCheckbox.current.indeterminate =
        pageSelected > 0 && pageSelected < pageIds.length;
  }, [pageSelected, pageIds.length]);
  useEffect(() => {
    if (panel) cancel.current?.focus();
    else trigger.current?.focus();
  }, [panel]);
  function busy(value) {
    setPending(value);
    onPendingChange(value);
  }
  function failed(failure) {
    if (failure.status === 401) onLocked();
    else if (
      panel === "delete" &&
      failure.code === "bulk_blocked" &&
      failure.entry_ids?.length
    ) {
      const remaining = ids.filter((id) => !failure.entry_ids.includes(id));
      onChange(remaining);
      setError({
        ...failure,
        code: remaining.length
          ? "bulk_selection_updated"
          : "bulk_nothing_to_delete",
      });
    } else setError(failure);
  }
  async function submit() {
    if (pending || !ids.length || (panel === "move" && !unitId)) return;
    busy(true);
    setError(null);
    try {
      const result = await request("/api/vocabulary/bulk", {
        method: "POST",
        headers: { "X-CSRF-Token": csrf },
        body: JSON.stringify({
          action: panel,
          entry_ids: ids,
          ...(panel === "move" ? { unit_id: unitId } : {}),
        }),
      });
      await onComplete(result);
    } catch (failure) {
      failed(failure);
    } finally {
      busy(false);
    }
  }
  function close() {
    setPanel(null);
    setError(null);
  }
  function open(kind, event) {
    trigger.current = event.currentTarget;
    setPanel(kind);
    setError(null);
  }
  return (
    <section className="bulk-vocabulary" aria-label={text.bulkSelect}>
      <div className="bulk-selection-controls">
        <label>
          <input
            ref={pageCheckbox}
            type="checkbox"
            disabled={pending || !pageIds.length}
            checked={!!pageIds.length && pageSelected === pageIds.length}
            onChange={(event) =>
              onChange(
                event.target.checked
                  ? [...new Set([...ids, ...pageIds])]
                  : ids.filter((id) => !pageIds.includes(id)),
              )
            }
          />
          {text.bulkPage}
        </label>
        <span role="status">
          {(ids.length === 1
            ? text.bulkSelectedOne
            : text.bulkSelected
          ).replace("{count}", ids.length)}
        </span>
      </div>
      <div className="bulk-action-buttons">
        <button
          type="button"
          className="secondary"
          disabled={pending || !ids.length || !!panel}
          onClick={(event) => open("move", event)}
        >
          <FolderInput size={17} aria-hidden="true" />
          {text.bulkMove}
        </button>
        <button
          type="button"
          className="secondary destructive"
          disabled={pending || !ids.length || !!panel}
          onClick={(event) => open("delete", event)}
        >
          <Trash2 size={17} aria-hidden="true" />
          {text.bulkDelete}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={pending || !ids.length}
          onClick={() => onChange([])}
        >
          {text.setupClearFilters}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={pending}
          onClick={onExit}
        >
          {text.cancel}
        </button>
      </div>
      {pending && <p role="status">{panel ? text.saving : text.loading}</p>}
      {panel && (
        <section
          className="bulk-confirmation"
          role="dialog"
          aria-labelledby="bulk-action-title"
          aria-describedby="bulk-action-count"
          onKeyDown={(event) => {
            if (event.key === "Escape" && !pending) {
              event.stopPropagation();
              close();
            }
          }}
        >
          <h2 id="bulk-action-title">
            {panel === "delete" ? text.bulkDeleteTitle : text.bulkMove}
          </h2>
          <p id="bulk-action-count">
            {(ids.length === 1
              ? text.bulkSelectedOne
              : text.bulkSelected
            ).replace("{count}", ids.length)}
          </p>
          {panel === "move" ? (
            <label>
              {text.bulkDestination}
              <select
                required
                value={unitId}
                disabled={pending}
                onChange={(event) => {
                  setUnitId(event.target.value);
                  setError(null);
                }}
              >
                <option value="">{text.chooseUnit}</option>
                {units.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.code} · {unit.title}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p>{text.bulkDeleteWarning}</p>
          )}
          <div className="form-actions">
            <button
              ref={cancel}
              type="button"
              className="secondary"
              disabled={pending}
              onClick={close}
            >
              {text.cancel}
            </button>
            <button
              type="button"
              className={
                panel === "delete" ? "secondary destructive" : "primary"
              }
              disabled={pending || !ids.length || (panel === "move" && !unitId)}
              onClick={submit}
            >
              {pending
                ? text.saving
                : panel === "delete"
                  ? text.confirmDelete
                  : text.bulkMove}
            </button>
          </div>
        </section>
      )}
      {error && (
        <div>
          <p role="alert" className="error">
            {text.errors[error.code] || text.errors.request_failed}
          </p>
        </div>
      )}
    </section>
  );
}
BulkVocabularyActions.propTypes = {
  text: PropTypes.object.isRequired,
  csrf: PropTypes.string.isRequired,
  onLocked: PropTypes.func.isRequired,
  ids: PropTypes.array.isRequired,
  pageIds: PropTypes.array.isRequired,
  units: PropTypes.array.isRequired,
  onChange: PropTypes.func.isRequired,
  onExit: PropTypes.func.isRequired,
  onPendingChange: PropTypes.func.isRequired,
  onComplete: PropTypes.func.isRequired,
};
