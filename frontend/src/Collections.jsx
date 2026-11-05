import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { request } from "./api.js";

export default function Collections({
  collections,
  selected,
  onSelect,
  text,
  csrf,
}) {
  const client = useQueryClient();
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const current = collections.data?.find((item) => item.id === selected);
  const action = useMutation({
    mutationFn: ({ method, id, name: value }) =>
      request(`/api/collections${id ? `/${id}` : ""}`, {
        method,
        headers: { "X-CSRF-Token": csrf },
        body:
          method !== "DELETE"
            ? JSON.stringify({ name: value.trim() })
            : undefined,
      }),
    onSuccess: async (result, variables) => {
      await client.invalidateQueries({ queryKey: ["collections"] });
      await client.invalidateQueries({ queryKey: ["vocabulary"] });
      setName("");
      setRenaming(false);
      if (variables.method === "DELETE") onSelect("");
      else if (result?.id) onSelect(result.id);
    },
  });
  return (
    <details className="collection-panel">
      <summary>{text.collections}</summary>
      {collections.isError ? (
        <>
          <p role="alert">{text.actionFailed}</p>
          <button onClick={() => collections.refetch()}>{text.retry}</button>
        </>
      ) : (
        <label>
          {text.collections}
          <select
            value={selected}
            onChange={(event) => {
              onSelect(event.target.value);
              setRenaming(false);
            }}
          >
            <option value="">{text.allCollections}</option>
            {collections.data
              ?.filter(
                (c) =>
                  c.can_edit !== false &&
                  (!c.source_language ||
                    [c.source_language, c.target_language].sort().join() ===
                      "el,it"),
              )
              .map((collection) => (
                <option value={collection.id} key={collection.id}>
                  {collection.name}
                </option>
              ))}
          </select>
        </label>
      )}
      <form
        className="collection-form"
        onSubmit={(event) => {
          event.preventDefault();
          action.mutate({
            method: renaming ? "PATCH" : "POST",
            id: renaming ? current.id : undefined,
            name,
          });
        }}
      >
        <label>
          {text.collectionName}
          <input
            value={name}
            maxLength={160}
            required
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <button className="secondary" disabled={action.isPending}>
          {renaming ? text.settingsSave : text.createCollection}
        </button>
      </form>
      {current && (
        <div className="form-actions">
          <button
            className="secondary"
            disabled={action.isPending}
            onClick={() => {
              setName(current.name);
              setRenaming(true);
            }}
          >
            {text.editEntry}
          </button>
          <button
            className="secondary"
            disabled={action.isPending}
            onClick={() => action.mutate({ method: "DELETE", id: current.id })}
          >
            {text.deleteCollection}
          </button>
        </div>
      )}
      {action.isError && (
        <p role="alert" className="error">
          {text.actionFailed}
        </p>
      )}
    </details>
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
      {selected && (
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
