import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus } from "lucide-react";
import { request } from "./api.js";
import PublicationDialog from "./PublicationDialog.jsx";
import {
  collectionCopy,
  collectionLabel,
  isMyCollection,
} from "./collection-copy.js";

export default function Collections({
  collections,
  selected,
  onSelect,
  text,
  csrf,
  language,
}) {
  const client = useQueryClient();
  const t = collectionCopy[language];
  const [mode, setMode] = useState(null);
  const [name, setName] = useState("");
  const [isPublic, setPublic] = useState(false);
  const [preview, setPreview] = useState(null);
  const [notice, setNotice] = useState("");
  const focusTarget = useRef(null);
  const focusReturn = useRef(null);
  const selector = useRef(null);
  const owned = collections.data?.filter(
    (c) =>
      c.can_edit !== false &&
      (!c.source_language ||
        [c.source_language, c.target_language].sort().join() === "el,it"),
  );
  const current = owned?.find((item) => item.id === selected);
  const available = collections.data?.filter(isMyCollection);

  const action = useMutation({
    mutationFn: ({ path = "", method = "POST", body }) =>
      request(`/api/collections${path}`, {
        method,
        headers: { "X-CSRF-Token": csrf },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    onSuccess: async (result, { method = "POST" }) => {
      if (method === "GET") {
        setPreview(result);
        return;
      }
      onSelect(method === "DELETE" ? "" : result.id);
      await Promise.all(
        [
          "collections",
          "collection-cards",
          "collection-search",
          "collection-progress",
          "vocabulary",
        ].map((key) => client.invalidateQueries({ queryKey: [key] })),
      );
      setNotice(method === "DELETE" ? t.deletedCollection : t.savedCollection);
      setPreview(null);
      setMode(null);
      if (method === "DELETE") focusReturn.current = selector.current;
    },
  });

  useEffect(() => {
    if (preview || action.isPending) return;
    if (mode) focusTarget.current?.focus();
    else if (notice) focusReturn.current?.focus();
  }, [mode, preview, action.isPending, notice]);

  useEffect(() => {
    if (!preview || !current) return;
    if (
      preview.id !== current.id ||
      preview.card_count !== current.card_count ||
      preview.visibility !== current.visibility
    )
      setPreview(null);
  }, [current, preview]);

  function open(next, event) {
    focusReturn.current = event.currentTarget;
    action.reset();
    setNotice("");
    setPreview(null);
    setName(next === "edit" ? current.name : "");
    setPublic(next === "edit" && current.visibility === "published");
    setMode(next);
  }

  function cancel() {
    setMode(null);
    setPreview(null);
    action.reset();
    if (mode === "delete") selector.current?.focus();
    else focusReturn.current?.focus();
  }

  function save(event) {
    event.preventDefault();
    const title = name.trim();
    if (!title) return;
    if (mode === "create") {
      action.mutate({ body: { name: title, make_public: isPublic } });
    } else if (isPublic !== (current.visibility === "published")) {
      action.mutate({
        method: "GET",
        path: `/${current.id}/${isPublic ? "publish" : "unpublish"}-preview`,
      });
    } else {
      action.mutate({
        method: "PATCH",
        path: `/${current.id}`,
        body: {
          name: title,
          source_language: current.source_language,
          target_language: current.target_language,
        },
      });
    }
  }

  function confirmVisibility() {
    if (action.isPending) return;
    action.mutate({
      path: `/${current.id}/${isPublic ? "publish" : "unpublish"}`,
      body: isPublic
        ? {
            name: name.trim(),
            preview_token: preview.preview_token,
            confirm_private_ids: preview.private_cards.map((card) => card.id),
          }
        : { name: name.trim() },
    });
  }

  return (
    <div className="collection-controls">
      <div className="collection-panel-content">
        {collections.isError && (
          <div className="form-actions">
            <p role="alert">{text.actionFailed}</p>
            <button className="secondary" onClick={() => collections.refetch()}>
              {text.retry}
            </button>
          </div>
        )}
        <div className="collection-panel-toolbar">
          <label className="collection-field">
            {t.collection}
            <select
              className="collection-select"
              ref={selector}
              value={selected}
              disabled={action.isPending || !available}
              onChange={(event) => {
                setMode(null);
                setPreview(null);
                setNotice("");
                action.reset();
                onSelect(event.target.value);
              }}
            >
              <option value="">{t.allAccessible}</option>
              {available?.map((collection) => (
                <option value={collection.id} key={collection.id}>
                  {collectionLabel(collection, t)}
                </option>
              ))}
            </select>
          </label>
          <button
            className="secondary"
            disabled={action.isPending}
            onClick={(event) => open("create", event)}
          >
            <Plus size={16} aria-hidden="true" /> {t.newCollection}
          </button>
          {current && (
            <button
              className="secondary"
              disabled={action.isPending}
              onClick={(event) => open("edit", event)}
            >
              <Pencil size={15} aria-hidden="true" /> {t.editCollection}
            </button>
          )}
        </div>

        {(mode === "create" || (mode === "edit" && current)) && !preview && (
          <form className="collection-panel-form" onSubmit={save}>
            <h3>{mode === "create" ? t.newCollection : t.editCollection}</h3>
            <label>
              {t.name}
              <input
                ref={focusTarget}
                value={name}
                maxLength={160}
                required
                disabled={action.isPending}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <div className="collection-visibility-control">
              <span>{t.visibility}</span>
              {t.private}
              <input
                type="checkbox"
                role="switch"
                aria-label={t.published}
                checked={isPublic}
                disabled={action.isPending}
                onChange={(event) => setPublic(event.target.checked)}
              />
              {t.published}
            </div>
            <div className="form-actions">
              <button
                className="primary"
                disabled={action.isPending || !name.trim()}
              >
                {mode === "create" ? t.create : t.save}
              </button>
              <button
                type="button"
                className="secondary"
                disabled={action.isPending}
                onClick={cancel}
              >
                {t.cancel}
              </button>
              {mode === "edit" && (
                <button
                  type="button"
                  className="collection-delete-link"
                  disabled={action.isPending}
                  onClick={(event) => open("delete", event)}
                >
                  {text.deleteCollection}
                </button>
              )}
            </div>
          </form>
        )}

        <PublicationDialog
          open={Boolean(preview && current)}
          title={isPublic ? t.publicationTitle : t.confirmUnpublish}
          name={preview?.name || current?.name || ""}
          cardCount={preview?.card_count ?? current?.card_count ?? 0}
          cardsLabel={t.cards}
          explanation={
            isPublic ? t.publicationExplanation : t.unpublishExposure
          }
          confirmLabel={isPublic ? t.publishAction : t.confirmUnpublish}
          cancelLabel={t.cancel}
          busy={action.isPending}
          onConfirm={confirmVisibility}
          onCancel={() => {
            action.reset();
            setPreview(null);
          }}
        />

        {current && mode === "delete" && (
          <div className="collection-panel-form">
            <h3>
              {text.deleteCollection} · {current.name}
            </h3>
            <p>{t.deleteEffect}</p>
            <div className="form-actions">
              <button
                ref={focusTarget}
                className="secondary"
                disabled={action.isPending}
                onClick={cancel}
              >
                {t.cancel}
              </button>
              <button
                className="secondary danger"
                disabled={action.isPending}
                onClick={() =>
                  action.mutate({ method: "DELETE", path: `/${current.id}` })
                }
              >
                {text.deleteCollection}
              </button>
            </div>
          </div>
        )}
        {action.isError && (
          <p role="alert" className="error">
            {preview ? t.error : text.actionFailed}
          </p>
        )}
        {(action.isPending || notice) && (
          <p role="status">{action.isPending ? t.loading : notice}</p>
        )}
      </div>
    </div>
  );
}

export function CollectionMembership({
  entry,
  collections,
  selected,
  csrf,
  text,
}) {
  const client = useQueryClient();
  const action = useMutation({
    mutationFn: ({ id, remove = false }) =>
      request(`/api/collections/${id}/entries${remove ? `/${entry.id}` : ""}`, {
        method: remove ? "DELETE" : "POST",
        headers: { "X-CSRF-Token": csrf },
        body: remove ? undefined : JSON.stringify({ entry_id: entry.id }),
      }),
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: ["collections"] }),
        client.invalidateQueries({ queryKey: ["vocabulary"] }),
      ]),
  });
  const available = collections.filter(
    (collection) =>
      collection.can_edit !== false &&
      collection.visibility !== "published" &&
      (!collection.source_language ||
        [collection.source_language, collection.target_language]
          .sort()
          .join() ===
          [entry.source_language || "it", entry.target_language || "el"]
            .sort()
            .join()) &&
      !collection.entry_ids?.includes(entry.id),
  );
  return (
    <div className="collection-membership">
      {available.length > 0 && (
        <label>
          <span className="sr-only">
            {text.addToCollection}: {entry.italian}
          </span>
          <select
            value=""
            disabled={action.isPending}
            onChange={(event) => {
              if (event.target.value) action.mutate({ id: event.target.value });
            }}
          >
            <option value="">{text.addToCollection}</option>
            {available.map((collection) => (
              <option key={collection.id} value={collection.id}>
                {collection.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {collections.some(
        (collection) =>
          collection.id === selected && collection.can_edit !== false,
      ) && (
        <button
          className="secondary"
          disabled={action.isPending}
          onClick={() => action.mutate({ id: selected, remove: true })}
        >
          {text.removeFromCollection}
        </button>
      )}
      {action.isError && (
        <p role="alert" className="error">
          {text.actionFailed}
        </p>
      )}
    </div>
  );
}
