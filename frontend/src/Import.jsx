import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileDown, Upload } from "lucide-react";
import { request } from "./api.js";
import { collectionCopy } from "./collection-copy.js";
import CsvDialog from "./CsvDialog.jsx";
import LanguagePicker from "./LanguagePicker.jsx";
import ImportEntryDetails from "./ImportEntryDetails.jsx";
import { cardLanguageIds, cardText } from "./card-sides.js";
import { languageLabel, languageTextProps, LEGACY_PAIR } from "./languages.js";

const PAGE_SIZE = 10;
const FORMULA_MARKERS = ["=", "+", "-", "@", "＝", "＋", "－", "＠"];

/** Minimal CSV parser used only to recognise and remap simple templates. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const source = text.replace(/^\uFEFF/, "");
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else cell += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += character;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((items) => items.some((item) => item !== ""));
}

function csvCell(value) {
  const text = value == null ? "" : String(value);
  const safe =
    text.startsWith("'") || FORMULA_MARKERS.some((mark) => text.trimStart().startsWith(mark))
      ? `'${text}`
      : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

function simpleToV2(text, base, learning) {
  const [header, ...rows] = parseCsv(text);
  const fields = header.map((name) => name.trim());
  const required = ["base", "learning", "word_type"];
  if (!required.every((name) => fields.includes(name)))
    throw new Error("The CSV is missing base, learning or word_type columns.");
  const index = Object.fromEntries(fields.map((name, position) => [name, position]));
  const output = [
    [
      "csv_format",
      "card_source_language",
      "card_target_language",
      `text_${base}`,
      `text_${learning}`,
      "word_type",
      "notes",
      "tags",
    ],
  ];
  for (const row of rows) {
    const value = (name) => row[index[name]] || "";
    output.push([
      "italian-notebook-v2",
      base,
      learning,
      value("base"),
      value("learning"),
      value("word_type"),
      value("notes"),
      value("tags") || "[]",
    ]);
  }
  return output.map((items) => items.map(csvCell).join(",")).join("\r\n");
}

function isImportDestination(collection, languages = LEGACY_PAIR) {
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
  onCreated = () => {},
  onImported,
  initialMode = "existing",
  selectedCollection,
  language,
  languages = LEGACY_PAIR,
}) {
  const t = collectionCopy[language];
  const destinationFor = (collection) =>
    isImportDestination(collection, languages);
  const [mode, setMode] = useState(initialMode);
  const [collectionId, setCollectionId] = useState(
    destinationFor(selectedCollection) ? selectedCollection.id : "",
  );
  const [name, setName] = useState("");
  const [makePublic, setMakePublic] = useState(false);
  const [publicConsent, setPublicConsent] = useState(false);
  // A new collection needs an explicit orientation; picking the first two
  // catalogue entries would silently invent a pair for the learner.
  const initialBase = selectedCollection?.source_language || "";
  const initialLearning = selectedCollection?.target_language || "";
  const [base, setBase] = useState(initialBase);
  const [learning, setLearning] = useState(initialLearning);
  const [templateFormat, setTemplateFormat] = useState("v2");
  const [file, setFile] = useState(null);
  const [sourceText, setSourceText] = useState("");
  const [detectedFormat, setDetectedFormat] = useState(null);
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
  const orientation =
    mode === "existing" && existingDestination
      ? [existingDestination.source_language, existingDestination.target_language]
      : [base, learning];
  const [sourceLanguage, targetLanguage] = orientation;
  const params = new URLSearchParams({ fixed_destination: "true" });
  if (mode === "existing") params.set("collection_id", collectionId);
  else {
    params.set("new_name", name.trim());
    if (sourceLanguage && targetLanguage) {
      params.set("source_language", sourceLanguage);
      params.set("target_language", targetLanguage);
    }
    if (makePublic) params.set("make_public", "true");
  }
  const destinationKey = params.toString();
  const exampleParams = new URLSearchParams({ format: templateFormat });
  if (mode === "existing" && collectionId)
    exampleParams.set("collection_id", collectionId);
  else if (sourceLanguage && targetLanguage) {
    exampleParams.set("source_language", sourceLanguage);
    exampleParams.set("target_language", targetLanguage);
  }
  const exampleHref = `/api/imports/example?${exampleParams}`;
  const isSimple = detectedFormat === "simple";
  const effectiveFile = useMemo(() => {
    if (!file || !isSimple || !sourceText) return file;
    return new File([simpleToV2(sourceText, sourceLanguage, targetLanguage)], file.name, {
      type: "text/csv",
    });
  }, [file, isSimple, sourceLanguage, sourceText, targetLanguage]);
  const mapping = isSimple
    ? [
        ["base", `text_${sourceLanguage}`],
        ["learning", `text_${targetLanguage}`],
        ["word_type", "word_type"],
        ["notes", "notes"],
        ["tags", "tags"],
      ]
    : [];
  const canCreate =
    mode === "new" && Boolean(destination && sourceLanguage && targetLanguage);
  const canPreview = Boolean(
    destination && effectiveFile && (mode === "existing" || (sourceLanguage && targetLanguage)),
  );
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
    if (!file) {
      setSourceText("");
      setDetectedFormat(null);
      return;
    }
    let active = true;
    file.text().then((value) => {
      if (!active) return;
      setSourceText(value);
      const header = value
        .replace(/^\uFEFF/, "")
        .split(/\r?\n/, 1)[0]
        .split(",")
        .map((name) => name.replace(/^"|"$/g, "").trim());
      if (["base", "learning", "word_type"].every((name) => header.includes(name)))
        setDetectedFormat("simple");
      else if (header.includes("schema_version") || value.includes("italian-notebook-v3"))
        setDetectedFormat("v3");
      else if (value.includes("italian-notebook-v2")) setDetectedFormat("v2");
      else setDetectedFormat("v1");
    });
    return () => {
      active = false;
    };
  }, [file]);

  useEffect(() => {
    if (!canPreview || !previewRequested) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setError(null);
      try {
        const report = await request(`/api/imports/preview?${destinationKey}`, {
          method: "POST",
          headers: { "X-CSRF-Token": csrf, "Content-Type": "text/csv" },
          body: effectiveFile,
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
    effectiveFile,
    csrf,
    onLocked,
    text,
  ]);

  async function create() {
    if (submitting.current || !canCreate) return;
    submitting.current = true;
    setImporting(true);
    setError(null);
    try {
      const created = await request("/api/collections", {
        method: "POST",
        headers: {
          "X-CSRF-Token": csrf,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: name.trim(),
          source_language: sourceLanguage,
          target_language: targetLanguage,
          make_public: makePublic,
        }),
      });
      onCreated(created);
    } catch (failure) {
      if (failure.status === 401) onLocked();
      else setError(text.errors[failure.code] || failure.message);
    } finally {
      submitting.current = false;
      setImporting(false);
    }
  }

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
      if (
        last?.destinationKey !== destinationKey ||
        last.file !== effectiveFile
      ) {
        newCollectionRequest.current = {
          destinationKey,
          file: effectiveFile,
          id: crypto.randomUUID(),
        };
      }
      confirmParams.set("new_collection_id", newCollectionRequest.current.id);
    }
    try {
      result = await request(`/api/imports/confirm?${confirmParams}`, {
        method: "POST",
        headers: { "X-CSRF-Token": csrf, "Content-Type": "text/csv" },
        body: effectiveFile,
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
        ) : null}
        {mode === "existing" && existingDestination && (
          <p className="csv-orientation">
            {t.baseLanguage}: {languageLabel(sourceLanguage)} · {t.learningLanguage}:{" "}
            {languageLabel(targetLanguage)}
          </p>
        )}
        {mode === "new" && (
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
            <p className="csv-orientation">{t.choosePair}</p>
            <div className="csv-language-pair">
              <label className="collection-field">
                {t.baseLanguage}
                <LanguagePicker
                  label={t.baseLanguage}
                  value={base}
                  onChange={(value) => changeDestination(setBase, value)}
                  exclude={[learning]}
                  recentKey="import-base"
                  emptyMessage={text.errors.request_failed}
                />
              </label>
              <label className="collection-field">
                {t.learningLanguage}
                <LanguagePicker
                  label={t.learningLanguage}
                  value={learning}
                  onChange={(value) => changeDestination(setLearning, value)}
                  exclude={[base]}
                  recentKey="import-learning"
                  emptyMessage={text.errors.request_failed}
                />
              </label>
            </div>
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
          <label className="csv-template-field">
            {text.csvTemplateFormat}
            <select
              value={templateFormat}
              disabled={Boolean(file)}
              onChange={(event) => setTemplateFormat(event.target.value)}
            >
              {[
                ["simple", text.csvTemplateSimple],
                ["v2", text.csvTemplateV2],
                ["v3", text.csvTemplateV3],
              ].map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {!file && (
            <a
              className="csv-example-link"
              href={exampleHref}
              download
            >
              <FileDown size={16} aria-hidden="true" /> {text.csvExample}
            </a>
          )}
        </div>
        {file && detectedFormat && (
          <p className="csv-detected-format">
            {text.csvDetectedFormat}: {text.csvFormatLabels[detectedFormat] || detectedFormat}
          </p>
        )}
        {mapping.length > 0 && (
          <details className="csv-mapping">
            <summary>{text.csvMapping}</summary>
            <dl>
              {mapping.map(([from, to]) => (
                <div key={from}>
                  <dt>{from}</dt>
                  <dd>→ {to}</dd>
                </div>
              ))}
            </dl>
          </details>
        )}
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
                      <span {...languageTextProps(source)}>
                        {cardText(row, source)}
                      </span>{" "}
                      →{" "}
                      <span {...languageTextProps(target)}>
                        {cardText(row, target)}
                      </span>
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
        {mode === "new" && !file && (
          <button
            type="button"
            className="primary"
            disabled={!canCreate || importing}
            onClick={create}
          >
            {importing ? text.csvImporting : t.create}
          </button>
        )}
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
        ) : mode === "existing" || file ? (
          <button
            type="button"
            className="primary"
            disabled={!canPreview || validating}
            onClick={() => setPreviewRequested(true)}
          >
            {validating ? text.csvValidating : text.csvPreview}
          </button>
        ) : null}
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
