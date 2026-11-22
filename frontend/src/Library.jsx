import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Plus,
  Upload,
  Download,
} from "lucide-react";
import PropTypes from "prop-types";
import Collections, { CollectionMembership } from "./Collections.jsx";
import BulkVocabularyActions from "./BulkVocabularyActions.jsx";
import CardActions from "./CardActions.jsx";
import Import from "./Import.jsx";
import CsvDialog from "./CsvDialog.jsx";
import Choices from "./Choices.jsx";
import VocabularyForm from "./VocabularyForm.jsx";
import { downloadLibrary, request } from "./api.js";
import {
  canViewCollection,
  collectionCopy,
  collectionOwner,
} from "./collection-copy.js";

export default function Library({ text, csrf, onLocked, language = "en" }) {
  const client = useQueryClient();
  const t = collectionCopy[language];
  const [searchParams, setSearchParams] = useSearchParams();
  const routeCollectionId = searchParams.get("collection_id") || "";
  const collections = useQuery({
    queryKey: ["collections"],
    queryFn: () => request("/api/collections"),
    refetchOnWindowFocus: "always",
  });
  const [requestedCollection, setCollectionId] = useState(routeCollectionId);
  const [archived, setArchived] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const cardAction = useMutation({
    mutationFn: ({ id }) =>
      request(`/api/vocabulary/${id}/restore`, {
        method: "POST",
        headers: { "X-CSRF-Token": csrf },
        body: "{}",
      }),
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: ["vocabulary"] }),
        client.invalidateQueries({ queryKey: ["collections"] }),
      ]),
  });
  const [importOpen, setImportOpen] = useState(false);
  function restoreFocus(target) {
    if (!target?.isConnected) return;
    const disclosure = target.closest("details");
    if (disclosure) disclosure.open = true;
    target.focus();
  }
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFiltered, setExportFiltered] = useState(false);
  const [exportState, setExportState] = useState("idle");
  const [exportError, setExportError] = useState(null);
  const [toast, setToast] = useState(null);
  const exportLock = useRef(false);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  async function exportCsv() {
    if (exportLock.current) return;
    exportLock.current = true;
    setExportState("pending");
    setExportError(null);
    try {
      const exportParams = new URLSearchParams(
        exportFiltered ? filterParams : scopeParams,
      );
      exportParams.set("include_ids", "true");
      await downloadLibrary(exportParams, selectedCollection?.name);
      setToast({ message: text.exportStarted });
      setExportOpen(false);
    } catch (error) {
      setExportError(error);
      if (error.status === 401) onLocked();
    } finally {
      exportLock.current = false;
      setExportState("idle");
    }
  }
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
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkNotice, setBulkNotice] = useState(null);
  useEffect(() => {
    if (bulkNotice && !bulkBusy) document.getElementById("add-entry")?.focus();
  }, [bulkNotice, bulkBusy]);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({
    q: "",
    word_types: [],
    tag_ids: [],
  });
  function changeFilter(key, value) {
    setSelectedIds([]);
    setBulkNotice(null);
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  }
  const selectedCollection = collections.data?.find(
    (item) => item.id === requestedCollection && canViewCollection(item),
  );
  const collectionId = selectedCollection?.id || "";
  const collectionUnavailable = Boolean(
    routeCollectionId && collections.data && !selectedCollection,
  );
  const selectedTitle = selectedCollection?.name || t.allAccessible;
  const legacyPair =
    !selectedCollection?.source_language ||
    [selectedCollection.source_language, selectedCollection.target_language]
      .sort()
      .join() === "el,it";
  const scopeParams = new URLSearchParams();
  if (collectionId) scopeParams.set("collection_id", collectionId);
  const filterParams = new URLSearchParams(scopeParams);
  if (filters.q.trim()) filterParams.set("q", filters.q.trim());
  for (const value of filters.word_types)
    filterParams.append("word_types", value);
  for (const value of filters.tag_ids || [])
    filterParams.append("tag_ids", value);
  if (archived) filterParams.set("archived", "true");
  const hasFilters = filterParams.toString() !== scopeParams.toString();
  const params = new URLSearchParams(filterParams);
  params.set("all_languages", "true");
  params.set("page", page);
  params.set("page_size", "12");

  const resetCollectionView = useCallback(() => {
    setPage(1);
    setArchived(false);
    setFilters({ q: "", word_types: [], tag_ids: [] });
    setSelectedIds([]);
    setSelecting(false);
    setOpenCard(null);
    setEditing(undefined);
    setDeleting(null);
    setDeleteError(null);
    setBulkNotice(null);
  }, []);

  function selectCollection(id) {
    setCollectionId(id);
    resetCollectionView();
    const next = new URLSearchParams(searchParams);
    if (id) next.set("collection_id", id);
    else next.delete("collection_id");
    setSearchParams(next);
  }

  const previousRouteCollection = useRef(routeCollectionId);
  useEffect(() => {
    if (previousRouteCollection.current === routeCollectionId) return;
    previousRouteCollection.current = routeCollectionId;
    setCollectionId(routeCollectionId);
    resetCollectionView();
  }, [routeCollectionId, resetCollectionView]);
  const library = useQuery({
    queryKey: ["vocabulary", page, filters, collectionId, archived],
    queryFn: () => request(`/api/vocabulary?${params}`),
  });
  const wholeScope = useQuery({
    queryKey: ["vocabulary", "scope", collectionId],
    queryFn: () =>
      request(`/api/vocabulary?${scopeParams}&all_languages=true&page_size=1`),
    enabled: hasFilters,
  });
  const tags = useQuery({
    queryKey: ["tags"],
    queryFn: () => request("/api/tags"),
    enabled: filtersOpen,
  });
  const wholeTotal =
    (hasFilters ? wholeScope.data?.total : library.data?.total) ??
    selectedCollection?.card_count;
  const filteredTotal = library.data?.total;

  function onImported(report) {
    const destination = report.destination_collection;
    selectCollection(destination.id);
    setFilters({ q: "", word_types: [] });
    setImportOpen(false);
    const counts = report.counts;
    setToast({
      message: `${t.importedInto.replace("{name}", () => destination.name)} · ${counts.valid} ${counts.valid === 1 ? t.oneCard : t.cards}`,
    });
    for (const key of [
      "collections",
      "collection-cards",
      "collection-search",
      "collection-progress",
      "vocabulary",
      "tags",
      "progress",
      "difficult-entries",
      "progress-difficult",
      "practice-summary",
    ]) {
      client.invalidateQueries({ queryKey: [key] });
    }
  }
  useEffect(() => {
    if (
      [library.error, collections.error].some((error) => error?.status === 401)
    )
      onLocked();
  }, [library.error, collections.error, onLocked]);
  const filterCount =
    filters.word_types.length +
    (filters.tag_ids?.length || 0) +
    Number(archived);
  const pages = Math.max(1, Math.ceil((library.data?.total || 0) / 12));

  async function refreshLibrary() {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["vocabulary"] }),
      client.invalidateQueries({ queryKey: ["collections"] }),
    ]);
    // Read the refreshed total for the active filters, including off-page deletions.
    const current = client.getQueryData([
      "vocabulary",
      page,
      filters,
      collectionId,
      archived,
    ]);
    if (current)
      setPage(Math.min(page, Math.max(1, Math.ceil(current.total / 12))));
    for (const key of [
      "progress",
      "difficult-entries",
      "progress-difficult",
      "practice-summary",
    ])
      await client.invalidateQueries({ queryKey: [key] });
  }

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
      await refreshLibrary();
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
      <a className="collection-workspace-link" href="/collections">
        {collectionCopy[language].title} →
      </a>
      <Collections
        language={language}
        collections={collections}
        selected={collectionId}
        onSelect={selectCollection}
        text={text}
        csrf={csrf}
      />
      {collectionUnavailable && (
        <div className="collection-unavailable" role="alert">
          <p>{t.collectionUnavailable}</p>
          <Link to="/collections">{t.back}</Link>
        </div>
      )}
      {cardAction.isError && (
        <p role="alert" className="error">
          {text.actionFailed}
        </p>
      )}
      <div className="collection-heading">
        <div>
          <h1>{selectedTitle}</h1>
          <div className="collection-heading-meta">
            <span className="library-count">
              {wholeTotal ?? "—"}{" "}
              <small>{wholeTotal === 1 ? t.oneCard : t.cards}</small>
            </span>
            {selectedCollection && (
              <span className="audience-badge">
                {t[selectedCollection.visibility]}
              </span>
            )}
            {selectedCollection?.saved && (
              <span className="audience-badge">{t.saved}</span>
            )}
            {selectedCollection?.owner_name && (
              <small>{collectionOwner(selectedCollection, t)}</small>
            )}
          </div>
        </div>
        <div className="collection-actions">
          <button
            className="primary"
            id="add-entry"
            disabled={
              isSaving ||
              deletePending ||
              selecting ||
              bulkBusy ||
              !legacyPair ||
              selectedCollection?.can_edit === false
            }
            onClick={() => {
              setSaved(null);
              setEditing(null);
            }}
          >
            <Plus size={18} aria-hidden="true" /> {text.addEntry}
          </button>
          <button
            type="button"
            className="secondary"
            aria-haspopup="dialog"
            onClick={() => setImportOpen(true)}
          >
            <Upload size={17} aria-hidden="true" /> {text.toolsImport}
          </button>
          <button
            type="button"
            className="secondary"
            aria-haspopup="dialog"
            disabled={Boolean(collectionId && !selectedCollection)}
            onClick={() => {
              setExportFiltered(false);
              setExportError(null);
              setExportOpen(true);
            }}
          >
            <Download size={17} aria-hidden="true" /> {text.toolsExport}
          </button>
        </div>
      </div>
      {toast && (
        <div className="csv-toast" role="status">
          {toast.message}
        </div>
      )}
      {importOpen && (
        <Import
          text={text}
          csrf={csrf}
          onLocked={onLocked}
          language={language}
          selectedCollection={selectedCollection}
          onClose={() => setImportOpen(false)}
          onImported={onImported}
        />
      )}
      {exportOpen && (
        <CsvDialog
          title={text.toolsExport}
          cancelLabel={text.cancel}
          busy={exportState === "pending"}
          onClose={() => setExportOpen(false)}
        >
          {hasFilters ? (
            <fieldset
              className="csv-options export-options"
              disabled={exportState === "pending"}
            >
              <legend className="sr-only">{text.toolsExport}</legend>
              <label>
                <input
                  type="radio"
                  name="export-scope"
                  checked={!exportFiltered}
                  onChange={() => setExportFiltered(false)}
                />
                {selectedTitle} · {wholeTotal ?? "—"}{" "}
                {wholeTotal === 1 ? t.oneCard : t.cards}
              </label>
              <label>
                <input
                  type="radio"
                  name="export-scope"
                  checked={exportFiltered}
                  onChange={() => setExportFiltered(true)}
                />
                {t.filteredResults} · {filteredTotal ?? "—"}{" "}
                {filteredTotal === 1 ? t.oneCard : t.cards}
              </label>
            </fieldset>
          ) : (
            <p>
              {selectedTitle} · {wholeTotal ?? "—"}{" "}
              {wholeTotal === 1 ? t.oneCard : t.cards}
            </p>
          )}
          {exportError && (
            <p role="alert" className="error">
              {text.errors[exportError.code] || text.errors.request_failed}
            </p>
          )}
          <div className="form-actions csv-dialog-actions">
            <button
              type="button"
              className="secondary"
              disabled={exportState === "pending"}
              onClick={() => setExportOpen(false)}
            >
              {text.cancel}
            </button>
            <button
              type="button"
              className="primary"
              disabled={
                exportState === "pending" ||
                (exportFiltered ? filteredTotal : wholeTotal) == null
              }
              onClick={exportCsv}
            >
              {exportState === "pending" ? text.exporting : text.toolsExport}
            </button>
          </div>
        </CsvDialog>
      )}
      <section className="library-filters" aria-label={text.filters}>
        <label className="search-field">
          {text.search}
          <input
            type="search"
            disabled={bulkBusy}
            maxLength={500}
            value={filters.q}
            onChange={(event) => changeFilter("q", event.target.value)}
          />
        </label>
        <details onToggle={(event) => setFiltersOpen(event.currentTarget.open)}>
          <summary>
            {text.filters}
            {filterCount > 0 && (
              <span className="filter-count">{filterCount}</span>
            )}
          </summary>
          <Choices
            legend={text.filterType}
            disabled={bulkBusy}
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
          {tags.data?.length > 0 && (
            <Choices
              legend={text.tags}
              disabled={bulkBusy}
              options={tags.data.map((tag) => ({
                id: tag.id,
                label: tag.name,
              }))}
              selected={filters.tag_ids || []}
              onChange={(value) => changeFilter("tag_ids", value)}
            />
          )}
          <label className="check-option">
            <input
              type="checkbox"
              checked={archived}
              disabled={bulkBusy}
              onChange={(event) => {
                setArchived(event.target.checked);
                setPage(1);
                setSelectedIds([]);
                setSelecting(false);
              }}
            />
            {text.archiveFilter}
          </label>
        </details>
        {(filters.q || filterCount > 0) && (
          <button
            className="secondary"
            disabled={bulkBusy}
            onClick={() => {
              setSelectedIds([]);
              setBulkNotice(null);
              setFilters({ q: "", word_types: [] });
              setArchived(false);
              setPage(1);
            }}
          >
            {text.clearFilters}
          </button>
        )}
      </section>
      {editing !== undefined && (
        <VocabularyForm
          key={editing?.id || "new"}
          entry={editing}
          initialCollectionId={selectedCollection?.can_edit ? collectionId : ""}
          text={text}
          csrf={csrf}
          onSavingChange={setIsSaving}
          onLocked={onLocked}
          onCancel={() => {
            setEditing(undefined);
            document.getElementById("add-entry")?.focus();
          }}
          onSaved={async (result) => {
            const wasEditing = Boolean(editing);
            if (!wasEditing) setPage(1);
            setSaved(result);
            setEditing(undefined);
            if (wasEditing) await refreshLibrary();
            else
              await Promise.all([
                client.invalidateQueries({ queryKey: ["vocabulary"] }),
                client.invalidateQueries({ queryKey: ["collections"] }),
              ]);
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

      {bulkNotice && (
        <p role="status" className="save-notice">
          {(bulkNotice.action === "add_to_collection"
            ? bulkNotice.count === 1
              ? text.bulkMovedOne
              : text.bulkMoved
            : bulkNotice.count === 1
              ? text.bulkDeletedOne
              : text.bulkDeleted
          ).replace("{count}", bulkNotice.count)}
        </p>
      )}
      {!selecting && library.data?.total > 0 && (
        <button
          id="select-cards"
          type="button"
          className="secondary bulk-start"
          disabled={
            isSaving ||
            deletePending ||
            deleting !== null ||
            editing !== undefined
          }
          onClick={() => {
            setSelecting(true);
            setBulkNotice(null);
            setOpenCard(null);
            setSaved(null);
            setDeleted(false);
          }}
        >
          {text.bulkSelect}
        </button>
      )}
      {selecting && (
        <BulkVocabularyActions
          text={text}
          csrf={csrf}
          onLocked={onLocked}
          ids={selectedIds}
          pageIds={(library.data?.items || [])
            .filter((entry) => entry.can_edit && !entry.archived_at)
            .map((entry) => entry.id)}
          collections={collections.data || []}
          onChange={setSelectedIds}
          onPendingChange={setBulkBusy}
          onExit={() => {
            setSelecting(false);
            setSelectedIds([]);
            requestAnimationFrame(() =>
              document.getElementById("select-cards")?.focus(),
            );
          }}
          onComplete={async (result) => {
            setBulkNotice(result);
            setSelectedIds([]);
            setSelecting(false);
            await refreshLibrary();
          }}
        />
      )}
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
                className={`entry-card type-${entry.word_type}${selectedIds.includes(entry.id) ? " is-selected" : ""}`}
                key={entry.id}
              >
                {selecting && (
                  <label className="card-selection">
                    <input
                      type="checkbox"
                      disabled={
                        bulkBusy ||
                        !entry.can_edit ||
                        Boolean(entry.archived_at)
                      }
                      checked={selectedIds.includes(entry.id)}
                      onChange={(event) =>
                        setSelectedIds((current) =>
                          event.target.checked
                            ? [...current, entry.id]
                            : current.filter((id) => id !== entry.id),
                        )
                      }
                    />
                    <span className="sr-only">
                      {text.bulkSelectCard}: {entry.italian} — {entry.greek}
                    </span>
                  </label>
                )}
                <div className="entry-meta">
                  <span className="audience-badge">
                    {text[entry.visibility] || text.private}
                    {entry.archived_at ? ` · ${text.archived}` : ""}
                  </span>
                  <span className="type-badge">
                    {text[entry.word_type] || text.other}
                  </span>
                </div>
                <h2 lang={entry.source_language || "it"}>{entry.italian}</h2>
                <p lang={entry.target_language || "el"}>{entry.greek}</p>
                <CardActions
                  entry={entry}
                  busy={isSaving || deletePending || selecting || bulkBusy}
                  text={text}
                  open={openCard === entry.id}
                  onOpenChange={(open) => setOpenCard(open ? entry.id : null)}
                  editDisabled={
                    (entry.source_language &&
                      entry.target_language &&
                      ![entry.source_language, entry.target_language].every(
                        (value) => value === "it" || value === "el",
                      )) ||
                    !entry.can_edit ||
                    Boolean(entry.archived_at) ||
                    isSaving ||
                    deletePending ||
                    selecting ||
                    bulkBusy
                  }
                  deleteDisabled={
                    !entry.can_edit ||
                    Boolean(entry.archived_at) ||
                    isSaving ||
                    deletePending ||
                    deleting !== null ||
                    selecting ||
                    bulkBusy
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
                {entry.archived_at && entry.can_edit && (
                  <button
                    className="secondary"
                    disabled={cardAction.isPending}
                    onClick={() => cardAction.mutate({ id: entry.id })}
                  >
                    {text.restore}
                  </button>
                )}
                {!entry.archived_at &&
                  entry.visibility !== "private" &&
                  (!entry.source_language ||
                    (entry.source_language === "it" &&
                      entry.target_language === "el")) && (
                    <button
                      className="secondary"
                      onClick={() => {
                        setEditing({
                          ...entry,
                          id: undefined,
                          unit: null,
                          tags: [],
                          visibility: "private",
                        });
                      }}
                    >
                      {text.personalVariant}
                    </button>
                  )}
                <CollectionMembership
                  entry={entry}
                  collections={collections.data || []}
                  selected={collectionId}
                  csrf={csrf}
                  text={text}
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
              disabled={page === 1 || bulkBusy}
              onClick={() => {
                setPage((value) => value - 1);
              }}
            >
              <ChevronLeft size={18} aria-hidden="true" />
              <span>{text.previous}</span>
            </button>
            <p aria-live="polite">
              {text.page} {page} {text.of} {pages}
            </p>
            <button
              aria-label={text.next}
              disabled={page >= pages || bulkBusy}
              onClick={() => {
                setPage((value) => value + 1);
              }}
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
