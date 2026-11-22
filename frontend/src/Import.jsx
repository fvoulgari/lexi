import { useEffect, useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileDown, Upload } from "lucide-react";
import { request } from "./api.js";
import { collectionCopy } from "./collection-copy.js";
import CsvDialog from "./CsvDialog.jsx";
import ImportEntryDetails from "./ImportEntryDetails.jsx";

const PAGE_SIZE = 10;

function isImportDestination(collection) {
  return (
    collection?.can_edit &&
    collection.visibility === "private" &&
    [collection.source_language, collection.target_language].sort().join() ===
      "el,it"
  );
}

const format = (template, values) =>
  template.replace(/\{(\w+)\}/g, (_, key) => values[key]);

export default function Import({
  text,
  csrf,
  onLocked,
  onClose,
  onImported,
  selectedCollection,
  language,
}) {
  const t = collectionCopy[language];
  const [mode, setMode] = useState("existing");
  const [collectionId, setCollectionId] = useState(
    isImportDestination(selectedCollection) ? selectedCollection.id : "",
  );
  const [name, setName] = useState("");
  const [source, setSource] = useState("el");
  const target = source === "el" ? "it" : "el";
  const [file, setFile] = useState(null);
  const [previewRequested, setPreviewRequested] = useState(false);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [importing, setImporting] = useState(false);
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(1);
  const submitting = useRef(false);
  const newCollectionRequest = useRef(null);
  const fileId = useId();
  const {
    data: collections = [],
    isPending,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["collections"],
    queryFn: () => request("/api/collections"),
  });
  const destinations = collections.filter(isImportDestination);
  const destination =
    mode === "existing"
      ? destinations.find((collection) => collection.id === collectionId)?.name
      : name.trim();
  const params = new URLSearchParams({ fixed_destination: "true" });
  if (mode === "existing") params.set("collection_id", collectionId);
  else {
    params.set("new_name", name.trim());
    params.set("source_language", source);
    params.set("target_language", target);
  }
  const destinationKey = params.toString();
  const canPreview = Boolean(destination && file);
  const currentPreview = preview?.key === destinationKey;
  const report = preview?.report;

  useEffect(() => {
    if (!canPreview || !previewRequested) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setError(null);
      try {
        const report = await request(`/api/imports/preview?${destinationKey}`, {
          method: "POST",
          headers: { "X-CSRF-Token": csrf, "Content-Type": "text/csv" },
          body: file,
          signal: controller.signal,
        });
        if (!controller.signal.aborted)
          setPreview({ key: destinationKey, report });
      } catch (failure) {
        if (controller.signal.aborted) return;
        if (failure.status === 401) onLocked();
        else {
          setError(text.errors[failure.code] || failure.message);
          setPreviewRequested(false);
        }
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [
    canPreview,
    previewRequested,
    destinationKey,
    file,
    csrf,
    onLocked,
    text,
  ]);

  async function confirm() {
    if (
      submitting.current ||
      !canPreview ||
      !currentPreview ||
      !report?.counts.valid
    )
      return;
    submitting.current = true;
    setImporting(true);
    setError(null);
    let result;
    const confirmParams = new URLSearchParams(destinationKey);
    confirmParams.set("expected_valid", report.counts.valid);
    if (mode === "new") {
      const last = newCollectionRequest.current;
      if (last?.destinationKey !== destinationKey || last.file !== file) {
        newCollectionRequest.current = {
          destinationKey,
          file,
          id: crypto.randomUUID(),
        };
      }
      confirmParams.set("new_collection_id", newCollectionRequest.current.id);
    }
    try {
      result = await request(`/api/imports/confirm?${confirmParams}`, {
        method: "POST",
        headers: { "X-CSRF-Token": csrf, "Content-Type": "text/csv" },
        body: file,
      });
    } catch (failure) {
      if (failure.status === 401) onLocked();
      else {
        setError(text.errors[failure.code] || failure.message);
        if (failure.status === 409) {
          setPreview((previous) => ({ ...previous, key: null }));
          setPreviewRequested(false);
        }
      }
    } finally {
      submitting.current = false;
      setImporting(false);
    }
    if (result) onImported(result);
  }

  const rows = report?.rows || [];
  const groups = [
    ["all", text.csvAllRows, rows],
    [
      "valid",
      text.csvValidRows,
      rows.filter((row) => ["valid", "updated"].includes(row.status)),
    ],
    [
      "duplicate",
      text.csvDuplicateRows,
      rows.filter((row) => row.status === "duplicate"),
    ],
    ["error", text.csvErrorRows, rows.filter((row) => row.status === "error")],
  ];
  const filtered = groups.find(([key]) => key === filter)[2];
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const activePage = Math.min(page, pages);
  const validating = canPreview && previewRequested && !currentPreview;

  return (
    <CsvDialog
      title={text.toolsImport}
      cancelLabel={text.cancel}
      busy={importing}
      onClose={onClose}
    >
      <fieldset className="csv-fields" disabled={importing}>
        <fieldset className="csv-options">
          <legend>{text.csvDestination}</legend>
          {[
            ["existing", t.existingCollection],
            ["new", t.newCollection],
          ].map(([key, label]) => (
            <label key={key}>
              <input
                type="radio"
                name="destination-mode"
                checked={mode === key}
                onChange={() => setMode(key)}
              />
              {label}
            </label>
          ))}
        </fieldset>
        {mode === "existing" ? (
          <label className="collection-field">
            {t.collection}
            <select
              className="collection-select"
              value={collectionId}
              disabled={isPending || isError}
              onChange={(event) => setCollectionId(event.target.value)}
            >
              <option value="">{t.chooseCollection}</option>
              {destinations.map((collection) => (
                <option key={collection.id} value={collection.id}>
                  {collection.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <>
            <label className="collection-field">
              {t.name}
              <input
                value={name}
                maxLength={160}
                required
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <div
              className="csv-language-fields"
              role="group"
              aria-label={t.pair}
            >
              {[
                [source, setSource, t.sourceLanguage],
                [
                  target,
                  (value) => setSource(value === "el" ? "it" : "el"),
                  t.targetLanguage,
                ],
              ].map(([value, change, label]) => (
                <label className="collection-field" key={label}>
                  {label}
                  <select
                    className="collection-select"
                    value={value}
                    onChange={(event) => change(event.target.value)}
                  >
                    <option value="el">{text.greek}</option>
                    <option value="it">{text.italian}</option>
                  </select>
                </label>
              ))}
            </div>
            <span className="audience-badge">{t.private}</span>
          </>
        )}
        {mode === "existing" && isError && (
          <div className="form-actions">
            <span role="alert">{text.errors.request_failed}</span>
            <button
              type="button"
              className="secondary"
              onClick={() => refetch()}
            >
              {text.retry}
            </button>
          </div>
        )}
        <div className="csv-file-field">
          <label className="secondary csv-file-button" htmlFor={fileId}>
            <Upload size={16} aria-hidden="true" />
            {t.chooseCsv}
            <input
              id={fileId}
              className="sr-only"
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => {
                setFile(event.target.files[0] || null);
                setPreview(null);
                setPreviewRequested(false);
                setError(null);
                setFilter("all");
                setPage(1);
              }}
            />
          </label>
          {file && <span className="csv-filename">{file.name}</span>}
          {!file && (
            <a
              className="csv-example-link"
              href="/api/imports/example"
              download
            >
              <FileDown size={16} aria-hidden="true" /> {text.csvExample}
            </a>
          )}
        </div>
      </fieldset>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {report && (
        <section
          className="csv-import-preview"
          aria-label={text.csvPreviewTitle}
          aria-busy={validating}
        >
          <strong>{destination || report.destination_collection?.name}</strong>
          <div
            className="csv-filters"
            role="group"
            aria-label={text.csvFilters}
          >
            {groups.map(([key, label, items]) => (
              <button
                key={key}
                type="button"
                aria-pressed={filter === key}
                onClick={() => {
                  setFilter(key);
                  setPage(1);
                }}
              >
                {label} ({items.length})
              </button>
            ))}
          </div>
          <ol className="import-rows">
            {filtered
              .slice((activePage - 1) * PAGE_SIZE, activePage * PAGE_SIZE)
              .map((row) => (
                <li key={row.row}>
                  <div className="csv-row-meta">
                    {text.csvRow} {row.row} · {text.csvCounts[row.status]}
                  </div>
                  <p className="csv-row-words">
                    <span lang="it">{row.italian}</span> →{" "}
                    <span lang="el">{row.greek}</span>
                  </p>
                  {row.entry && <ImportEntryDetails row={row} text={text} />}
                  {row.errors?.map((message, index) => (
                    <p key={index} className="error">
                      {message}
                    </p>
                  ))}
                </li>
              ))}
          </ol>
          {pages > 1 && (
            <nav className="pagination" aria-label={text.csvPreviewTitle}>
              <button
                type="button"
                disabled={activePage === 1}
                onClick={() => setPage(activePage - 1)}
              >
                {text.previous}
              </button>
              <span>{format(text.csvPage, { page: activePage, pages })}</span>
              <button
                type="button"
                disabled={activePage >= pages}
                onClick={() => setPage(activePage + 1)}
              >
                {text.next}
              </button>
            </nav>
          )}
        </section>
      )}
      <div className="form-actions csv-dialog-actions">
        {currentPreview ? (
          <button
            type="button"
            className="primary"
            disabled={importing || !canPreview || !report.counts.valid}
            onClick={confirm}
          >
            {importing
              ? text.csvImporting
              : format(report.counts.valid === 1 ? t.importOne : t.importMany, {
                  count: report.counts.valid,
                  name: destination,
                })}
          </button>
        ) : (
          <button
            type="button"
            className="primary"
            disabled={!canPreview || validating}
            onClick={() => setPreviewRequested(true)}
          >
            {validating ? text.csvValidating : text.csvPreview}
          </button>
        )}
        <button
          type="button"
          className="secondary"
          disabled={importing}
          onClick={onClose}
        >
          {text.cancel}
        </button>
      </div>
    </CsvDialog>
  );
}
