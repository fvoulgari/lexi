import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, ChevronLeft, ChevronRight, Leaf } from "lucide-react";
import PropTypes from "prop-types";
import Import from "./Import.jsx";
import OrganizationForm from "./OrganizationForm.jsx";
import Choices from "./Choices.jsx";
import VocabularyForm from "./VocabularyForm.jsx";
import { request } from "./api.js";

export default function Library({ text, csrf, onLocked }) {
  const client = useQueryClient();
  const [creating, setCreating] = useState(null);
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
    else deleteTrigger.current?.focus();
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
    tag_ids: [],
  });
  const units = useQuery({
    queryKey: ["units"],
    queryFn: () => request("/api/units"),
  });
  const tags = useQuery({
    queryKey: ["tags"],
    queryFn: () => request("/api/tags"),
  });
  function changeFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  }
  const params = new URLSearchParams({
    page: String(page),
    page_size: "6",
    q: filters.q,
  });
  for (const key of ["unit_ids", "word_types", "tag_ids"])
    for (const value of filters[key]) {
      if (value === "none" && key === "unit_ids") params.set("no_unit", "true");
      else params.append(key, value);
    }
  const library = useQuery({
    queryKey: ["vocabulary", page, filters],
    queryFn: () => request(`/api/vocabulary?${params}`),
  });
  useEffect(() => {
    if (
      [library.error, units.error, tags.error].some(
        (error) => error?.status === 401,
      )
    )
      onLocked();
  }, [library.error, units.error, tags.error, onLocked]);
  const pages = Math.max(1, Math.ceil((library.data?.total || 0) / 6));

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
          <span className="eyebrow">
            <Leaf size={15} aria-hidden="true" />
            {text.vocabulary}
          </span>
          <h1>{text.libraryTitle}</h1>
          <p>{text.libraryIntro}</p>
        </div>
        <span className="library-count">
          {library.data?.total ?? "—"}{" "}
          <small>{library.data?.total === 1 ? text.entry : text.entries}</small>
        </span>
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
          <summary>{text.filters}</summary>
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
            legend={text.wordTypes}
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
          <Choices
            legend={text.tags}
            options={(tags.data || []).map((tag) => ({
              id: tag.id,
              label: tag.name,
            }))}
            selected={filters.tag_ids}
            onChange={(value) => changeFilter("tag_ids", value)}
          />
        </details>
        <button
          className="secondary"
          onClick={() => {
            setFilters({ q: "", unit_ids: [], word_types: [], tag_ids: [] });
            setPage(1);
          }}
        >
          {text.clearFilters}
        </button>
        {[units, tags].some((query) => query.isError) && (
          <div>
            <p role="alert" className="error">
              {text.errors.request_failed}
            </p>
            <button
              className="secondary"
              onClick={() => {
                units.refetch();
                tags.refetch();
              }}
            >
              {text.retry}
            </button>
          </div>
        )}
      </section>
      <button
        className="primary"
        id="add-entry"
        disabled={isSaving || deletePending}
        onClick={() => {
          setSaved(null);
          setEditing(null);
        }}
      >
        {text.addEntry}
      </button>
      <div className="form-actions">
        {["units", "tags"].map((kind) => (
          <button
            id={`create-${kind}`}
            key={kind}
            className="secondary"
            disabled={isSaving || creating !== null}
            onClick={() => setCreating(kind)}
          >
            {kind === "units" ? text.createUnit : text.createTag}
          </button>
        ))}
      </div>
      {creating && (
        <OrganizationForm
          key={creating}
          kind={creating}
          text={text}
          csrf={csrf}
          onLocked={onLocked}
          onClose={() => {
            const kind = creating;
            setCreating(null);
            document.getElementById(`create-${kind}`)?.focus();
          }}
        />
      )}
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
        </div>
      )}
      <Import text={text} csrf={csrf} onLocked={onLocked} />
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
                      ? `${text.unit} ${entry.unit.code}`
                      : text.noUnit}
                  </span>
                </div>
                <div className="entry-tags">
                  {(entry.tags || []).map((tag) => (
                    <span key={tag.id}>{tag.name}</span>
                  ))}
                </div>
                <h2 lang="it">{entry.italian}</h2>
                <p lang="el">{entry.greek}</p>
                <button
                  className="secondary"
                  aria-label={`${text.editEntry}: ${entry.italian}`}
                  disabled={isSaving || deletePending}
                  onClick={() => {
                    setSaved(null);
                    setDeleted(false);
                    setEditing(entry);
                  }}
                >
                  {text.editEntry}
                </button>
                <button
                  id={`delete-${entry.id}`}
                  className="secondary"
                  aria-label={`${text.deleteEntry}: ${entry.italian}`}
                  disabled={isSaving || deletePending || deleting !== null}
                  onClick={() => {
                    deleteTrigger.current = document.getElementById(
                      `delete-${entry.id}`,
                    );
                    setDeleted(false);
                    setDeleteError(null);
                    setDeleting(entry);
                  }}
                >
                  {text.deleteEntry}
                </button>
                {entry.unit && (
                  <div className="entry-footer">
                    <span className="entry-dot" aria-hidden="true" />
                    {entry.unit.title}
                  </div>
                )}
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
