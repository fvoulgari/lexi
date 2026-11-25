import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import { request } from "./api.js";
import { copy } from "./copy.js";
import Import from "./Import.jsx";
import PublicationDialog from "./PublicationDialog.jsx";
import {
  LEGACY_PAIR,
  pairKey,
  pairLabel,
  useLanguageRegistry,
} from "./languages.js";
import {
  collectionCopy,
  collectionOwner,
  isMyCollection,
} from "./collection-copy.js";

function availablePairs(collections) {
  const found = new Map();
  for (const collection of collections) {
    const { source_language: source, target_language: target } = collection;
    if (!source || !target || source === target) continue;
    const key = pairKey(source, target);
    if (!found.has(key)) found.set(key, [source, target]);
  }
  if (!found.size) {
    found.set(pairKey(...LEGACY_PAIR), [...LEGACY_PAIR]);
  }
  return [...found].map(([key, languages]) => ({ key, languages }));
}

export default function SharedCollections({ language = "en", csrf, onLocked }) {
  const t = collectionCopy[language];
  const registry = useLanguageRegistry();
  const languageIds = registry?.ids || LEGACY_PAIR;
  const client = useQueryClient();
  const [tab, setTab] = useState("mine");
  const [pairFilter, setPairFilter] = useState("");
  const [importMode, setImportMode] = useState(null);
  const [preview, setPreview] = useState(null);
  const [editor, setEditor] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [importCollection, setImportCollection] = useState(null);
  const [notice, setNotice] = useState("");

  const list = useQuery({
    queryKey: ["collections"],
    queryFn: () => request("/api/collections"),
    refetchOnWindowFocus: "always",
  });
  const all = useMemo(() => list.data || [], [list.data]);
  const pairs = availablePairs(all);
  const listed = all.filter(
    (c) =>
      (tab === "mine" ? isMyCollection(c) : c.visibility === "published") &&
      (!pairFilter ||
        pairKey(c.source_language, c.target_language) === pairFilter),
  );
  const write = useMutation({
    mutationFn: ({ path, method = "POST", body }) =>
      request(path, {
        method,
        headers: { "X-CSRF-Token": csrf },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      }),
    onSuccess: async () => {
      await Promise.all(
        ["collections", "vocabulary", "progress"].map((key) =>
          client.invalidateQueries({ queryKey: [key] }),
        ),
      );
    },
  });
  const busy = write.isPending;

  async function act(action, after) {
    try {
      const result = await write.mutateAsync(action);
      after?.(result);
      return true;
    } catch {
      return false;
    }
  }

  useEffect(() => {
    if (!preview) return;
    const current = all.find((c) => c.id === preview.id);
    if (
      current &&
      (current.card_count !== preview.card_count ||
        current.visibility !== preview.visibility)
    )
      setPreview(null);
  }, [all, preview]);

  function resetWorkspaces() {
    setPreview(null);
    setEditor(null);
    setConfirmDelete(null);
    setImportCollection(null);
    write.reset();
  }

  async function reviewVisibility(collection, makePublic) {
    await act(
      {
        path: `/api/collections/${collection.id}/${makePublic ? "publish-preview" : "unpublish-preview"}`,
        method: "GET",
      },
      (value) =>
        setPreview({ ...value, id: collection.id, unpublishing: !makePublic }),
    );
  }

  async function finishImport() {
    setImportMode(null);
    setImportCollection(null);
    setTab("mine");
    setNotice(t.savedCollection);
    await Promise.all(
      ["collections", "vocabulary", "progress"].map((key) =>
        client.invalidateQueries({ queryKey: [key] }),
      ),
    );
    // An initial collections request may still be in flight; refetch after it
    // so a stale response cannot overwrite the newly created collection.
    await list.refetch();
  }

  function visibilityControl(checked, onChange) {
    return (
      <label className="collection-visibility-control">
        <span>{t.visibility}</span>
        <span>{t.private}</span>
        <input
          type="checkbox"
          role="switch"
          aria-label={t.visibility}
          checked={checked}
          disabled={busy}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span>{t.published}</span>
      </label>
    );
  }

  function changePairFilter(value) {
    setPairFilter(value);
    resetWorkspaces();
  }

  const previewCollection = preview && all.find((c) => c.id === preview.id);

  return (
    <section className="shared-collections">
      <h1>{t.title}</h1>
      <Link to="/vocabulary">
        ←{" "}
        {language === "el"
          ? "Λεξιλόγιο"
          : language === "it"
            ? "Vocabolario"
            : "Vocabulary"}
      </Link>
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      {write.isError && (
        <p role="alert" className="error">
          {t.error}
        </p>
      )}
      <label className="collection-filter">
        {t.pair}
        <select
          value={pairFilter}
          onChange={(e) => changePairFilter(e.target.value)}
        >
          <option value="">{t.allPairs}</option>
          {pairs.map((pair) => (
            <option value={pair.key} key={pair.key}>
              {pairLabel(pair.languages)}
            </option>
          ))}
        </select>
      </label>
      <div className="collection-actions">
        {["mine", "discover"].map((key) => (
          <button
            key={key}
            aria-pressed={tab === key}
            onClick={() => setTab(key)}
          >
            {t[key]}
          </button>
        ))}
      </div>
      {list.isPending && <p role="status">{t.loading}</p>}
      {list.isError && (
        <p role="alert">
          {t.error} <button onClick={() => list.refetch()}>{t.retry}</button>
        </p>
      )}
      <div className="collection-grid">
        {listed.map((c) => (
          <article className="collection-box" key={c.id}>
            <h2>{c.name}</h2>
            <p>
              {pairLabel([c.source_language, c.target_language])} ·{" "}
              {c.card_count} {t.cards} · {t[c.visibility]}
            </p>
            <div className="collection-owner">
              {c.saved && <span className="audience-badge">{t.saved}</span>}
              {c.owner_name && <small>{collectionOwner(c, t)}</small>}
            </div>
            <div className="collection-actions">
              {c.can_edit !== false ? (
                <button
                  type="button"
                  aria-pressed={editor?.id === c.id}
                  disabled={busy}
                  onClick={() => {
                    resetWorkspaces();
                    setEditor((open) =>
                      open?.id === c.id ? null : { id: c.id, name: c.name },
                    );
                  }}
                >
                  {t.editCollection}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    act({
                      path: `/api/collections/${c.id}/saved`,
                      method: c.saved ? "DELETE" : "PUT",
                    })
                  }
                >
                  {c.saved ? t.removeReference : t.saveReference}
                </button>
              )}
            </div>
            {editor?.id === c.id && (
              <form
                className="collection-form publication-preview"
                onSubmit={(e) => {
                  e.preventDefault();
                  act(
                    {
                      path: `/api/collections/${c.id}`,
                      method: "PATCH",
                      body: {
                        name: editor.name,
                        source_language: c.source_language,
                        target_language: c.target_language,
                      },
                    },
                    () => setEditor(null),
                  );
                }}
              >
                <h3>{t.editCollection}</h3>
                {visibilityControl(c.visibility === "published", (value) =>
                  reviewVisibility(c, value),
                )}
                {c.can_publish === false && (
                  <p role="note">{t.publishNotAllowed}</p>
                )}
                <label>
                  {t.name}
                  <input
                    required
                    maxLength={160}
                    value={editor.name}
                    onChange={(e) =>
                      setEditor({ ...editor, name: e.target.value })
                    }
                  />
                </label>
                <div className="collection-actions">
                  <button className="primary" disabled={busy}>
                    {t.save}
                  </button>
                  <button type="button" onClick={() => setEditor(null)}>
                    {t.cancel}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setImportCollection(c)}
                  >
                    {t.toolsImport}
                  </button>
                  <button
                    type="button"
                    className="danger"
                    disabled={busy}
                    onClick={() => setConfirmDelete(c)}
                  >
                    {t.deleteCollection}
                  </button>
                </div>
              </form>
            )}
            {confirmDelete?.id === c.id && (
              <div
                className="publication-preview"
                role="dialog"
                aria-labelledby={`delete-collection-${c.id}`}
              >
                <h3 id={`delete-collection-${c.id}`}>
                  {t.deleteCollection} · {c.name}
                </h3>
                <p>{t.deleteEffect}</p>
                <div className="collection-actions">
                  <button
                    type="button"
                    className="danger"
                    disabled={busy}
                    onClick={() =>
                      act(
                        { path: `/api/collections/${c.id}`, method: "DELETE" },
                        () => {
                          setConfirmDelete(null);
                          setEditor(null);
                          setNotice(t.deletedCollection);
                        },
                      )
                    }
                  >
                    {t.confirmDelete}
                  </button>
                  <button type="button" onClick={() => setConfirmDelete(null)}>
                    {t.cancel}
                  </button>
                </div>
              </div>
            )}
          </article>
        ))}
      </div>
      <div className="collection-actions">
        <button
          type="button"
          className="primary"
          aria-haspopup="dialog"
          onClick={() => {
            resetWorkspaces();
            setImportMode("new");
          }}
        >
          <Plus size={16} aria-hidden="true" /> {t.create}
        </button>
      </div>
      {(importMode || importCollection) && (
        <Import
          text={copy[language]}
          csrf={csrf}
          language={language}
          languages={languageIds}
          initialMode={importMode || "existing"}
          selectedCollection={importCollection}
          onLocked={onLocked}
          onClose={() => {
            setImportMode(null);
            setImportCollection(null);
          }}
          onCreated={finishImport}
          onImported={finishImport}
        />
      )}
      <PublicationDialog
        open={Boolean(preview)}
        title={preview?.unpublishing ? t.confirmUnpublish : t.publicationTitle}
        name={preview?.name || ""}
        cardCount={preview?.card_count ?? previewCollection?.card_count ?? 0}
        cardsLabel={t.cards}
        explanation={
          preview?.unpublishing ? t.unpublishExposure : t.publicationExplanation
        }
        confirmLabel={
          preview?.unpublishing ? t.confirmUnpublish : t.publishAction
        }
        cancelLabel={t.cancel}
        busy={busy}
        onCancel={() => setPreview(null)}
        onConfirm={() => {
          if (busy) return;
          act(
            preview.unpublishing
              ? { path: `/api/collections/${preview.id}/unpublish` }
              : {
                  path: `/api/collections/${preview.id}/publish`,
                  body: {
                    preview_token: preview.preview_token,
                    confirm_private_ids: preview.private_cards.map((c) => c.id),
                  },
                },
            () => setPreview(null),
          );
        }}
      />
    </section>
  );
}
