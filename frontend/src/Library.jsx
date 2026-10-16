import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, ChevronLeft, ChevronRight, Plus, SlidersHorizontal, Upload, Download, FolderPlus } from "lucide-react";
import PropTypes from "prop-types";
import EnablePracticeUnit from "./EnablePracticeUnit.jsx";
import CardActions from "./CardActions.jsx";
import Import from "./Import.jsx";
import OrganizationForm from "./OrganizationForm.jsx";
import Choices from "./Choices.jsx";
import VocabularyForm from "./VocabularyForm.jsx";
import { downloadLibrary, request } from "./api.js";

export default function Library({ text, csrf, onLocked }) {
  const client = useQueryClient();
  const [importOpen, setImportOpen] = useState(false);
  const importPanelId = useId();
  const showImport = useCallback(() => setImportOpen(true), []);
  function restoreFocus(target) {
    if (!target?.isConnected) return;
    const disclosure = target.closest("details");
    if (disclosure) disclosure.open = true;
    target.focus();
  }
  const [exportState, setExportState] = useState("idle");
  const [exportError, setExportError] = useState(null);
  async function exportCsv() {
    setExportState("pending");
    setExportError(null);
    try {
      await downloadLibrary();
      setExportState("success");
    } catch (error) {
      setExportState("error");
      setExportError(error);
      if (error.status === 401) onLocked();
    }
  }
  const [creating, setCreating] = useState(null);
  const returnToTools = useRef(false);
  useEffect(() => {
    if (creating === null && returnToTools.current) {
      returnToTools.current = false;
      restoreFocus(document.getElementById("create-units"));
    }
  }, [creating]);
  const [openCard, setOpenCard] = useState(null);
  const [editing, setEditing] = useState(undefined);
  const [deleting, setDeleting] = useState(null);
  const [deleteError, setDeleteError] = useState(null);
  const [deleted, setDeleted] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const cancelDelete = useRef(null);
  const deleteTrigger = useRef(null);
  useEffect(() => {
    if (deleted && !deletePending)
      document.getElementById("add-entry")?.focus();
  }, [deleted, deletePending]);
  useEffect(() => {
    if (deleting) cancelDelete.current?.focus();
    else restoreFocus(deleteTrigger.current);
  }, [deleting]);
  const [saved, setSaved] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  useEffect(() => {
    if (saved && !isSaving) document.getElementById("add-entry")?.focus();
  }, [saved, isSaving]);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({
    q: "",
    unit_ids: [],
    word_types: [],
  });
  const units = useQuery({
    queryKey: ["units"],
    queryFn: () => request("/api/units"),
  });
  function changeFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  }
  const params = new URLSearchParams({
    page: String(page),
    page_size: "12",
    q: filters.q,
  });
  for (const key of ["unit_ids", "word_types"])
    for (const value of filters[key]) {
      if (value === "none" && key === "unit_ids") params.set("no_unit", "true");
      else params.append(key, value);
    }
  const library = useQuery({
    queryKey: ["vocabulary", page, filters],
    queryFn: () => request(`/api/vocabulary?${params}`),
  });
  useEffect(() => {
    if ([library.error, units.error].some((error) => error?.status === 401))
      onLocked();
  }, [library.error, units.error, onLocked]);
  const filterCount = filters.unit_ids.length + filters.word_types.length;
  const pages = Math.max(1, Math.ceil((library.data?.total || 0) / 12));

  function closeDelete() {
    setDeleting(null);
    setDeleteError(null);
  }
  async function deleteEntry() {
    if (deletePending) return;
    setDeletePending(true);
    setDeleteError(null);
    try {
      await request(`/api/vocabulary/${deleting.id}`, {
        method: "DELETE",
        headers: { "X-CSRF-Token": csrf },
      });
      setDeleting(null);
      setSaved(null);
      setEditing(undefined);
      // Return to a valid page even when deleting the last result on this page.
      setPage(1);
      await client.invalidateQueries({ queryKey: ["vocabulary"] });
      setDeleted(true);
    } catch (error) {
      if (error.status === 401) onLocked();
      else setDeleteError(error);
    } finally {
      setDeletePending(false);
    }
  }

  return (
    <section className="library-page">
      <div className="page-heading">
        <div>
          <h1>{text.libraryTitle}</h1>
        </div>
        <span className="library-count">
          {library.data?.total ?? "—"}{" "}
          <small>{library.data?.total === 1 ? text.entry : text.entries}</small>
        </span>
        <button
          className="primary"
          id="add-entry"
          disabled={isSaving || deletePending}
          onClick={() => {
            setSaved(null);
            setEditing(null);
          }}
        >
          <Plus size={18} aria-hidden="true" />
          {text.addEntry}
        </button>
      </div>
      <section className="library-filters" aria-label={text.filters}>
        <label className="search-field">
          {text.search}
          <input
            type="search"
            maxLength={500}
            value={filters.q}
            onChange={(event) => changeFilter("q", event.target.value)}
          />
        </label>
        <details>
          <summary>
            {text.filters}
            {filterCount > 0 && (
              <span className="filter-count">{filterCount}</span>
            )}
          </summary>
          <p>{text.filterHint}</p>
          <Choices
            legend={text.units}
            options={[
              { id: "none", label: text.noUnit },
              ...(units.data || []).map((unit) => ({
                id: unit.id,
                label: `${unit.code} — ${unit.title}`,
              })),
            ]}
            selected={filters.unit_ids}
            onChange={(value) => changeFilter("unit_ids", value)}
          />
          <Choices
            legend={text.filterType}
            options={[
              "noun",
              "verb",
              "adjective",
              "adverb",
              "expression",
              "other",
            ].map((id) => ({ id, label: text[id] }))}
            selected={filters.word_types}
            onChange={(value) => changeFilter("word_types", value)}
          />
        </details>
        {(filters.q || filterCount > 0) && (
          <button
            className="secondary"
            onClick={() => {
              setFilters({ q: "", unit_ids: [], word_types: [] });
              setPage(1);
            }}
          >
            {text.clearFilters}
          </button>
        )}
        {units.isError && (
          <div>
            <p role="alert" className="error">
              {text.errors.request_failed}
            </p>
            <button
              className="secondary"
              onClick={() => {
                units.refetch();
              }}
            >
              {text.retry}
            </button>
          </div>
        )}
      </section>
      <section
        className="library-tools"
        aria-labelledby="library-tools-heading"
      >
        <h2 id="library-tools-heading">
          <SlidersHorizontal size={17} aria-hidden="true" />
          {text.libraryTools}
        </h2>
        <div className="library-tools-buttons">
          <button
            type="button"
            className="secondary"
            aria-expanded={importOpen}
            aria-controls={importPanelId}
            onClick={() => setImportOpen((open) => !open)}
          >
            <Upload size={17} aria-hidden="true" />
            {text.toolsImport}
          </button>
          <button
            className="secondary"
            disabled={exportState === "pending"}
            onClick={exportCsv}
            aria-label={
              exportState === "pending" ? text.exporting : text.exportLibrary
            }
          >
            <Download size={17} aria-hidden="true" />
            {exportState === "pending" ? text.exporting : text.toolsExport}
          </button>
          <button
            id="create-units"
            className="secondary"
            disabled={isSaving || creating !== null}
            onClick={() => setCreating("units")}
          >
            <FolderPlus size={17} aria-hidden="true" />
            {text.toolsNewUnit}
          </button>
        </div>
        {exportState === "success" && <p role="status">{text.exportStarted}</p>}
        {exportState === "error" && (
          <p role="alert" className="error">
            {text.errors[exportError?.code] || text.errors.request_failed}
          </p>
        )}
        {creating && (
          <OrganizationForm
            key={creating}
            kind={creating}
            text={text}
            csrf={csrf}
            onLocked={onLocked}
            onClose={() => {
              returnToTools.current = true;
              setCreating(null);
            }}
          />
        )}
        <div id={importPanelId} hidden={!importOpen}>
          <Import
            text={text}
            csrf={csrf}
            onLocked={onLocked}
            onAttention={showImport}
          />
        </div>
      </section>
      {editing !== undefined && (
        <VocabularyForm
          key={editing?.id || "new"}
          entry={editing}
          text={text}
          csrf={csrf}
          onSavingChange={setIsSaving}
          onLocked={onLocked}
          onCancel={() => {
            setEditing(undefined);
            document.getElementById("add-entry")?.focus();
          }}
          onSaved={(result) => {
            setPage(1);
            setSaved(result);
            setEditing(undefined);
            client.invalidateQueries({ queryKey: ["vocabulary"] });
            document.getElementById("add-entry")?.focus();
          }}
        />
      )}
      {deleting && (
        <section
          className="delete-confirmation"
          role="dialog"
          aria-labelledby="delete-title"
          onKeyDown={(event) => {
            if (event.key === "Escape" && !deletePending) closeDelete();
          }}
        >
          <h2 id="delete-title">{text.deleteEntry}</h2>
          <p>
            <span lang="it">{deleting.italian}</span> —{" "}
            <span lang="el">{deleting.greek}</span>
          </p>
          <p>{text.deleteWarning}</p>
          {deleteError && (
            <p role="alert" className="error">
              {text.errors[deleteError.code] || text.errors.request_failed}
            </p>
          )}
          <div className="form-actions">
            <button
              ref={cancelDelete}
              className="secondary"
              disabled={deletePending}
              onClick={closeDelete}
            >
              {text.cancel}
            </button>
            <button
              className="primary"
              disabled={deletePending}
              onClick={deleteEntry}
            >
              {deletePending ? text.saving : text.confirmDelete}
            </button>
          </div>
        </section>
      )}
      {deleted && <p role="status">{text.entryDeleted}</p>}
      {saved && (
        <div className="save-notice" role="status">
          <p>
            {text.entrySaved} <span lang="it">{saved.entry.italian}</span> —{" "}
            <span lang="el">{saved.entry.greek}</span>
          </p>
          {saved.duplicate_ids.length > 0 && <p>{text.duplicateWarning}</p>}
          {saved.entry.unit?.id && <EnablePracticeUnit key={saved.entry.unit.id} unitId={saved.entry.unit.id} text={text} csrf={csrf} onLocked={onLocked} />}
        </div>
      )}

      <div className="library-caption">
        <span>
          {text.italian} <span aria-hidden="true">↔</span> {text.greek}
        </span>
        <span>{text.libraryNote}</span>
      </div>
      {library.isPending ? (
        <p className="status" role="status">
          {text.loading}
        </p>
      ) : library.isError ? (
        <div className="status">
          <p role="alert">
            {text.errors[library.error.code] || text.errors.request_failed}
          </p>
          <button className="primary" onClick={() => library.refetch()}>
            {text.retry}
          </button>
        </div>
      ) : library.data.items.length === 0 ? (
        <div className="empty-state">
          <BookOpen size={32} aria-hidden="true" />
          <h2>{text.empty}</h2>
          <p>{text.emptyText}</p>
        </div>
      ) : (
        <>
          <ul className="entry-grid">
            {library.data.items.map((entry) => (
              <li
                className={`entry-card type-${entry.word_type}`}
                key={entry.id}
              >
                <div className="entry-meta">
                  <span className="type-badge">
                    {text[entry.word_type] || text.other}
                  </span>
                  <span>
                    {entry.unit
                      ? `${entry.unit.code} · ${entry.unit.title}`
                      : text.noUnit}
                  </span>
                </div>
                <h2 lang="it">{entry.italian}</h2>
                <p lang="el">{entry.greek}</p>
                <CardActions
                  entry={entry}
                  text={text}
                  open={openCard === entry.id}
                  onOpenChange={(open) => setOpenCard(open ? entry.id : null)}
                  editDisabled={isSaving || deletePending}
                  deleteDisabled={
                    isSaving || deletePending || deleting !== null
                  }
                  onEdit={() => {
                    setSaved(null);
                    setDeleted(false);
                    setEditing(entry);
                  }}
                  onDelete={(trigger) => {
                    deleteTrigger.current = trigger;
                    setDeleted(false);
                    setDeleteError(null);
                    setDeleting(entry);
                  }}
                />
              </li>
            ))}
          </ul>
          <nav
            className="pagination"
            aria-label={`${text.library} — ${text.page}`}
          >
            <button
              aria-label={text.previous}
              disabled={page === 1}
              onClick={() => setPage((value) => value - 1)}
            >
              <ChevronLeft size={18} aria-hidden="true" />
              <span>{text.previous}</span>
            </button>
            <p aria-live="polite">
              {text.page} {page} {text.of} {pages}
            </p>
            <button
              aria-label={text.next}
              disabled={page >= pages}
              onClick={() => setPage((value) => value + 1)}
            >
              <span>{text.next}</span>
              <ChevronRight size={18} aria-hidden="true" />
            </button>
          </nav>
        </>
      )}
    </section>
  );
}

Library.propTypes = {
  text: PropTypes.object.isRequired,
  csrf: PropTypes.string.isRequired,
  onLocked: PropTypes.func.isRequired,
};
