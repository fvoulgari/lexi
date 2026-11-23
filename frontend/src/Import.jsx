import { useEffect, useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileDown, Upload } from "lucide-react";
import { request } from "./api.js";
import { collectionCopy } from "./collection-copy.js";
import CsvDialog from "./CsvDialog.jsx";
import ImportEntryDetails from "./ImportEntryDetails.jsx";
import { cardLanguageIds, cardText } from "./card-sides.js";

const PAGE_SIZE = 10;
const LEGACY_LANGUAGES = ["el", "it"];

function isImportDestination(collection, languages = LEGACY_LANGUAGES) {
  if (!collection) return false;
  const pair = [collection.source_language, collection.target_language];
  const supported =
    pair[0] !== pair[1] &&
    pair.length === 2 &&
    pair.every((code) => languages.includes(code));
  if (languages.length === 2 && !supported) return false;
  if (typeof collection.can_import === "boolean") return collection.can_import;
  return collection.can_edit && supported;
}

function isPublicDestination(collection, mode, makePublic) {
  return mode === "new" ? makePublic : collection?.visibility === "published";
}

const format = (template, values) =>
  template.replace(/\{(\w+)\}/g, (_, key) => values[key]);

export default function Import({
  text,
  csrf,
  onLocked = () => {},
  onClose,
  onImported,
  selectedCollection,
  language,
  languages = LEGACY_LANGUAGES,
}) {
  const t = collectionCopy[language];
  const displayNames = new Intl.DisplayNames([language], {
    type: "language",
  });
  const languageLabel = (code) =>
    (code === "el" && text.greek) ||
    (code === "it" && text.italian) ||
    displayNames.of(code) ||
    code;
  const destinationFor = (collection) =>
    isImportDestination(collection, languages);
  const [mode, setMode] = useState("existing");
  const [collectionId, setCollectionId] = useState(
    destinationFor(selectedCollection) ? selectedCollection.id : "",
  );
  const [name, setName] = useState("");
  const [makePublic, setMakePublic] = useState(false);
  const [publicConsent, setPublicConsent] = useState(false);
  const initialPair = destinationFor(selectedCollection)
    ? [selectedCollection.source_language, selectedCollection.target_language]
    : languages;
  const [source, setSource] = useState(initialPair[0] || "el");
  const [target, setTarget] = useState(
    initialPair[1] || languages.find((code) => code !== initialPair[0]),
  );
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
    refetchOnMount: "always",
  });
  const destinations = collections.filter(destinationFor);
  const existingDestination = destinations.find(
    (collection) => collection.id === collectionId,
  );
  const destination =
    mode === "existing" ? !isError && existingDestination?.name : name.trim();
  const params = new URLSearchParams({ fixed_destination: "true" });
  if (mode === "existing") params.set("collection_id", collectionId);
  else {
    params.set("new_name", name.trim());
    params.set("source_language", source);
    params.set("target_language", target);
    if (makePublic) params.set("make_public", "true");
  }
  const destinationKey = params.toString();
  const canPreview = Boolean(destination && file);
  const currentPreview = canPreview && preview?.key === destinationKey;
  const report = currentPreview ? preview.report : null;
  const publicDestination = isPublicDestination(
    mode === "new" ? null : existingDestination,
    mode,
    makePublic,
  );
  const canConfirm =
    currentPreview && Boolean(report?.counts.valid) && (!publicDestination || publicConsent);

  function changeDestination(change, value) {
    setPreview(null);
    setError(null);
    setPublicConsent(false);
    setFilter("all");
    setPage(1);
    change(value);
  }

  function changeSource(value) {
    changeDestination(setSource, value);
    if (target === value)
      setTarget(languages.find((code) => code !== value) || "");
  }

  function changeTarget(value) {
    changeDestination(setTarget, value);
    if (source === value)
      setSource(languages.find((code) => code !== value) || "");
  }

  const destinationIds = destinations.map((collection) => collection.id).join(",");
  useEffect(() => {
    if (mode !== "existing" || isError || collectionId) return;
    const authorized = isImportDestination(selectedCollection, languages)
      ? selectedCollection.id
      : "";
    if (authorized && destinationIds.split(",").includes(authorized))
      setCollectionId(authorized);
  }, [collectionId, destinationIds, isError, languages, mode, selectedCollection]);

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
      !canConfirm
    )
      return;
    submitting.current = true;
    setImporting(true);
    setError(null);
    let result;
    const confirmParams = new URLSearchParams(destinationKey);
    confirmParams.set("expected_valid", report.counts.valid);
    if (publicDestination) {
      confirmParams.set("confirm_public_exposure", "true");
      if (report.preview_token)
        confirmParams.set("preview_token", report.preview_token);
    }
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
                onChange={() => changeDestination(setMode, key)}
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
              value={existingDestination?.id || ""}
              disabled={isPending || isError || destinations.length === 0}
              onChange={(event) =>
                changeDestination(setCollectionId, event.target.value)
              }
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
                onChange={(event) => {
                  const value = event.target.value;
                  if (value.trim() === name.trim()) setName(value);
                  else changeDestination(setName, value);
                }}
              />
            </label>
            <fieldset className="csv-language-fields">
              <legend>{t.collectionLanguages}</legend>
              <select
                className="collection-select"
                aria-label={t.sourceLanguage}
                value={source}
                onChange={(event) => changeSource(event.target.value)}
              >
                {languages.map((code) => (
                  <option key={code} value={code}>
                    {languageLabel(code)}
                  </option>
                ))}
              </select>
              <span aria-hidden="true">↔</span>
              <select
                className="collection-select"
                aria-label={t.targetLanguage}
                value={target}
                onChange={(event) => changeTarget(event.target.value)}
              >
                {languages.map((code) => (
                  <option key={code} value={code}>
                    {languageLabel(code)}
                  </option>
                ))}
              </select>
            </fieldset>
            <fieldset className="csv-options csv-visibility">
              <legend>{t.visibility}</legend>
              <label>
                <input
                  type="radio"
                  name="csv-visibility"
                  checked={!makePublic}
                  onChange={() => changeDestination(setMakePublic, false)}
                />
                {t.onlyYou}
              </label>
              <label>
                <input
                  type="radio"
                  name="csv-visibility"
                  checked={makePublic}
                  onChange={() => changeDestination(setMakePublic, true)}
                />
                {t.published}
              </label>
            </fieldset>
            <p className="csv-visibility-hint">
              {makePublic ? t.publicVisibilityHint : t.privateVisibilityHint}
            </p>
          </>
        )}
        {mode === "existing" &&
          !isError &&
          (isPending || destinations.length === 0) && (
            <span role="status">
              {isPending ? t.loading : t.noImportCollections}
            </span>
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
          <strong>{destination}</strong>
          {publicDestination && (
            <p className="csv-public-notice">{t.publicationExplanation}</p>
          )}
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
              .map((row) => {
                const [source, target] = cardLanguageIds(row);
                return (
                  <li key={row.row}>
                    <div className="csv-row-meta">
                      {text.csvRow} {row.row} · {text.csvCounts[row.status]}
                    </div>
                    <p className="csv-row-words">
                      <span lang={source}>{cardText(row, source)}</span>{" "}
                      → <span lang={target}>{cardText(row, target)}</span>
                    </p>
                    {row.entry && <ImportEntryDetails row={row} text={text} />}
                    {row.errors?.map((message, index) => (
                      <p key={index} className="error">
                        {message}
                      </p>
                    ))}
                  </li>
                );
              })}
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
      {publicDestination && currentPreview && (
        <label className="csv-public-consent">
          <input
            type="checkbox"
            checked={publicConsent}
            disabled={importing}
            onChange={(event) => setPublicConsent(event.target.checked)}
          />
          {t.publicImportConsent}
        </label>
      )}
      <div className="form-actions csv-dialog-actions">
        {currentPreview ? (
          <button
            type="button"
            className="primary"
            disabled={importing || !canConfirm}
            onClick={confirm}
          >
            {importing
              ? text.csvImporting
              : publicDestination
                ? t.importAndPublish
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
