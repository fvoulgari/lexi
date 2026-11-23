import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { request } from "./api.js";
import { copy } from "./copy.js";
import CollectionCardForm from "./CollectionCardForm.jsx";
import Import from "./Import.jsx";
import LanguagePicker from "./LanguagePicker.jsx";
import PublicationDialog from "./PublicationDialog.jsx";
import { useAccount } from "./AccountContext.jsx";
import { cardLanguageIds, cardText, practiceSides } from "./card-sides.js";
import {
  directionLanguages,
  directionLabel,
  isSupportedLanguage,
  languageIds,
  languageLabel,
  languageOptions,
  languageTextProps,
  LEGACY_PAIR,
  pairDirections,
  samePair,
} from "./languages.js";
import {
  collectionCopy,
  collectionOwner,
  isMyCollection,
} from "./collection-copy.js";

function initialPair() {
  const requested = new URLSearchParams(window.location.search).get(
    "direction",
  );
  if (requested) {
    try {
      const languages = directionLanguages(requested);
      if (languages.every(isSupportedLanguage)) return languages;
    } catch {
      /* Fall back to the legacy pair below. */
    }
  }
  return [...LEGACY_PAIR];
}

export default function SharedCollections({
  language = "en",
  csrf,
  onLocked = () => {},
}) {
  const t = collectionCopy[language];
  const client = useQueryClient();
  const account = useAccount();
  const [pair, setPair] = useState(initialPair);
  const [tab, setTab] = useState("mine");
  const [selected, setSelected] = useState("");
  const [chosen, setChosen] = useState([]);
  const [name, setName] = useState("");
  const [createPublic, setCreatePublic] = useState(false);
  const [search, setSearch] = useState("");
  const [preview, setPreview] = useState(null);
  const [pendingAdd, setPendingAdd] = useState(null);
  const [editor, setEditor] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const [session, setSession] = useState(null);
  const [position, setPosition] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [reverse, setReverse] = useState(false);
  const [difficult, setDifficult] = useState(
    () =>
      new URLSearchParams(window.location.search).get("mode") === "difficult",
  );
  const directions = pairDirections(pair[0], pair[1]);
  const direction = reverse ? directions[1] : directions[0];
  const list = useQuery({
    queryKey: ["collections"],
    queryFn: () => request("/api/collections"),
    refetchOnWindowFocus: "always",
  });
  const collections = (list.data || []).filter((c) =>
    samePair(c.source_language, c.target_language, pair[0], pair[1]),
  );
  const listed = collections.filter((c) =>
    tab === "mine" ? isMyCollection(c) : c.visibility === "published",
  );
  const current = listed.find((c) => c.id === selected);
  useEffect(() => {
    if (!preview || !current) return;
    if (
      preview.id !== current.id ||
      preview.card_count !== current.card_count ||
      preview.visibility !== current.visibility
    )
      setPreview(null);
  }, [current, preview]);
  const availableChosen = chosen.filter((id) =>
    collections.some((c) => c.id === id),
  );
  const entries = useQuery({
    queryKey: ["collection-cards", selected],
    queryFn: () => request(`/api/collections/${selected}/entries`),
    enabled: !!current,
  });
  const readableEntries = entries.isError ? undefined : entries.data;
  const results = useQuery({
    queryKey: ["collection-search", selected, search],
    queryFn: () =>
      request(
        `/api/collections/${selected}/search?q=${encodeURIComponent(search)}`,
      ),
    enabled: !!current?.can_edit,
  });
  const progress = useQuery({
    queryKey: ["collection-progress", selected, direction],
    queryFn: () =>
      request(`/api/collections/${selected}/progress?direction=${direction}`),
    enabled: !!current,
  });
  const write = useMutation({
    mutationFn: ({ path, method = "POST", body }) =>
      request(path, {
        method,
        headers: { "X-CSRF-Token": csrf },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      }),
    onSuccess: async () => {
      await Promise.all(
        [
          "collections",
          "collection-cards",
          "collection-search",
          "collection-progress",
          "vocabulary",
          "progress",
        ].map((key) => client.invalidateQueries({ queryKey: [key] })),
      );
    },
  });
  async function act(action, after) {
    try {
      const result = await write.mutateAsync(action);
      after?.(result);
    } catch (error) {
      if (session && error.code === "entry_deleted") {
        try {
          const fresh = await request(`/api/sessions/${session.id}`);
          setSession(fresh);
          setRevealed(false);
        } catch {
          /* Keep the failed mutation visible and allow leaving practice. */
        }
      }
    }
  }
  const base = `/api/collections/${selected}`;
  const pairLabel = pair.map(languageLabel).join(" – ");
  function cardWords(card) {
    const [source, target] = cardLanguageIds(card);
    return (
      <>
        <span {...languageTextProps(source)}>{cardText(card, source)}</span> —{" "}
        <span {...languageTextProps(target)}>{cardText(card, target)}</span>
      </>
    );
  }
  const queueCard = session?.cards[position];
  const sides = queueCard?.snapshot
    ? practiceSides(queueCard.snapshot, direction)
    : null;
  const sideLanguages = directionLanguages(direction);
  async function start() {
    await act(
      {
        path: "/api/sessions",
        body: {
          profile_id: account.profile_id,
          collection_ids: availableChosen,
          direction,
          mode: difficult ? "difficult" : "random",
          size: null,
        },
      },
      (value) => {
        setSession(value);
        setPosition(0);
        setRevealed(false);
      },
    );
  }
  function changePair(index, value) {
    const next = [...pair];
    next[index] = value;
    setPair(next);
    setSelected("");
    setChosen([]);
    setPreview(null);
    setEditor(null);
    setPendingAdd(null);
    write.reset();
  }
  async function move(index, offset) {
    const order = entries.data.map((e) => e.id);
    [order[index], order[index + offset]] = [
      order[index + offset],
      order[index],
    ];
    await act({
      path: `${base}/order`,
      method: "PUT",
      body: { entry_ids: order },
    });
  }
  async function reviewVisibility(collection, makePublic) {
    await act(
      {
        path: `/api/collections/${collection.id}/${makePublic ? "publish-preview" : "unpublish-preview"}`,
        method: "GET",
      },
      (value) => setPreview({ ...value, unpublishing: !makePublic }),
    );
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
  const busy = write.isPending;
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
      {write.isError && (
        <p role="alert" className="error">
          {write.error?.code === "no_difficult_entries"
            ? t.noDifficult
            : t.error}
        </p>
      )}
      {session ? (
        <div className="collection-box" aria-live="polite">
          <h2>{pairLabel}</h2>
          {queueCard ? (
            queueCard.snapshot ? (
              <>
                <p>
                  {position + 1} / {session.cards.length}
                </p>
                <h3 {...languageTextProps(sideLanguages[0])}>{sides.prompt}</h3>
                {revealed ? (
                  <>
                    <p
                      className="collection-answer"
                      {...languageTextProps(sideLanguages[1])}
                    >
                      {sides.answer}
                    </p>
                    <div className="collection-actions">
                      {["again", "hard", "easy"].map((rating) => (
                        <button
                          key={rating}
                          disabled={busy}
                          onClick={() =>
                            act(
                              {
                                path: `/api/sessions/${session.id}/cards/${queueCard.position}/reviews`,
                                body: { direction, rating },
                              },
                              () => {
                                setPosition((p) => p + 1);
                                setRevealed(false);
                              },
                            )
                          }
                        >
                          {t[rating]}
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() =>
                      act(
                        {
                          path: `/api/sessions/${session.id}/cards/${queueCard.position}/reveal`,
                          body: { direction },
                        },
                        () => setRevealed(true),
                      )
                    }
                  >
                    {t.reveal}
                  </button>
                )}
              </>
            ) : (
              <button onClick={() => setPosition((p) => p + 1)}>
                {t.skipUnavailable}
              </button>
            )
          ) : (
            <h3>{t.complete}</h3>
          )}
          <button onClick={() => setSession(null)}>{t.back}</button>
        </div>
      ) : (
        <>
          <fieldset className="collection-pair">
            <legend>{t.pair}</legend>
            {pair.map((value, i) => (
              <LanguagePicker
                key={i}
                label={`${t.pair} ${i + 1}`}
                value={value}
                options={languageOptions()}
                exclude={[pair[1 - i]]}
                disabled={busy}
                onChange={(code) => changePair(i, code)}
              />
            ))}
          </fieldset>
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
              {t.error}{" "}
              <button onClick={() => list.refetch()}>{t.retry}</button>
            </p>
          )}
          <div className="collection-grid">
            {listed.map((c) => (
              <article className="collection-box" key={c.id}>
                <h2>{c.name}</h2>
                <p>
                  {pairLabel} · {c.card_count} {t.cards} · {t[c.visibility]}
                </p>
                <div className="collection-owner">
                  {c.saved && <span className="audience-badge">{t.saved}</span>}
                  {c.owner_name && <small>{collectionOwner(c, t)}</small>}
                </div>
                <div className="collection-actions">
                  <Link
                    className="collection-open-link"
                    to={`/vocabulary?collection_id=${encodeURIComponent(c.id)}`}
                    aria-disabled={busy}
                    onClick={(event) => {
                      if (busy) {
                        event.preventDefault();
                        return;
                      }
                      setPreview(null);
                      setPendingAdd(null);
                      setEditor(null);
                      write.reset();
                    }}
                  >
                    {t.open}
                  </Link>
                  <button
                    type="button"
                    aria-pressed={selected === c.id}
                    disabled={busy}
                    onClick={() => {
                      setSelected(c.id);
                      setPreview(null);
                      setPendingAdd(null);
                      setEditor(null);
                      write.reset();
                    }}
                  >
                    {t.details}
                  </button>
                  {!c.can_edit && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        act(
                          {
                            path: `/api/collections/${c.id}/saved`,
                            method: c.saved ? "DELETE" : "PUT",
                          },
                          () => {
                            if (c.saved)
                              setChosen((ids) =>
                                ids.filter((id) => id !== c.id),
                              );
                          },
                        )
                      }
                    >
                      {c.saved ? t.removeReference : t.saveReference}
                    </button>
                  )}
                  <label>
                    <input
                      type="checkbox"
                      aria-label={`${t.selected}: ${c.name}`}
                      checked={chosen.includes(c.id)}
                      onChange={(e) =>
                        setChosen((ids) =>
                          e.target.checked
                            ? [...ids, c.id]
                            : ids.filter((id) => id !== c.id),
                        )
                      }
                    />
                    {t.selected}
                  </label>
                </div>
              </article>
            ))}
          </div>
          <form
            className="collection-box collection-form"
            onSubmit={(e) => {
              e.preventDefault();
              act(
                {
                  path: "/api/collections",
                  body: {
                    name,
                    source_language: pair[0],
                    target_language: pair[1],
                  },
                },
                async (c) => {
                  setName("");
                  setSelected(c.id);
                  setTab("mine");
                  if (createPublic) await reviewVisibility(c, true);
                  setCreatePublic(false);
                },
              );
            }}
          >
            <label>
              {t.name}
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={160}
              />
            </label>
            {visibilityControl(createPublic, setCreatePublic)}
            <button className="primary" disabled={busy}>
              {t.create}
            </button>
          </form>
          <div className="collection-box collection-practice">
            <p>{t.choose}</p>
            <label>
              {t.direction}
              <select
                value={direction}
                onChange={(e) => setReverse(e.target.value !== directions[0])}
              >
                {directions.map((key) => (
                  <option key={key} value={key}>
                    {directionLabel(key, languageLabel)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={difficult}
                onChange={(e) => setDifficult(e.target.checked)}
              />
              {t.difficult}
            </label>
            <button
              className="primary"
              disabled={busy || !availableChosen.length}
              onClick={start}
            >
              {t.practise}
            </button>
          </div>
          {current && (
            <div className="collection-box" key={current.id}>
              <h2>{current.name}</h2>
              <p>
                {pairLabel} · {current.card_count} {t.cards} ·{" "}
                {t[current.visibility]}
              </p>
              {progress.data && (
                <p>
                  {t.count}: {progress.data.practised} /{" "}
                  {progress.data.card_count} · {t.difficult}:{" "}
                  {progress.data.difficult}
                </p>
              )}
              {current.can_edit && (
                <div className="collection-actions">
                  <button
                    onClick={() =>
                      setEditor({ collection: true, name: current.name })
                    }
                  >
                    {t.editCollection}
                  </button>
                  {current.visibility === "private" ? (
                    <button
                      disabled={busy}
                      onClick={() =>
                        act(
                          { path: `${base}/publish-preview`, method: "GET" },
                          setPreview,
                        )
                      }
                    >
                      {t.publish}
                    </button>
                  ) : (
                    <button
                      disabled={busy}
                      onClick={() =>
                        act(
                          { path: `${base}/unpublish-preview`, method: "GET" },
                          (value) =>
                            setPreview({ ...value, unpublishing: true }),
                        )
                      }
                    >
                      {t.unpublish}
                    </button>
                  )}
                  {current.visibility === "published" && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        act(
                          { path: `${base}/publish-preview`, method: "GET" },
                          setPreview,
                        )
                      }
                    >
                      {t.reviewSharing}
                    </button>
                  )}
                  {current.can_import && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setImportOpen(true)}
                    >
                      {t.toolsImport}
                    </button>
                  )}
                  <button
                    onClick={() =>
                      setEditor({
                        source_text: "",
                        target_text: "",
                        confirm_exposure: false,
                      })
                    }
                  >
                    {t.createCard}
                  </button>
                  <button
                    onClick={() =>
                      document.getElementById("collection-search")?.focus()
                    }
                  >
                    {t.addExisting}
                  </button>
                </div>
              )}
              <PublicationDialog
                open={Boolean(preview)}
                title={
                  preview?.unpublishing
                    ? t.confirmUnpublish
                    : t.publicationTitle
                }
                name={preview?.name || current?.name || ""}
                cardCount={preview?.card_count ?? current?.card_count ?? 0}
                cardsLabel={t.cards}
                explanation={
                  preview?.unpublishing
                    ? t.unpublishExposure
                    : t.publicationExplanation
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
                      ? { path: `${base}/unpublish` }
                      : {
                          path: `${base}/publish`,
                          body: {
                            preview_token: preview.preview_token,
                            confirm_private_ids: preview.private_cards.map(
                              (c) => c.id,
                            ),
                          },
                        },
                    () => setPreview(null),
                  );
                }}
              />
              {importOpen && current && (
                <Import
                  text={copy[language]}
                  csrf={csrf}
                  language={language}
                  languages={languageIds()}
                  selectedCollection={current}
                  onLocked={onLocked}
                  onClose={() => setImportOpen(false)}
                  onImported={(report) => {
                    setImportOpen(false);
                    setSelected(
                      report.destination_collection?.id || current.id,
                    );
                    Promise.all(
                      ["collections", "collection-cards", "vocabulary"].map(
                        (key) => client.invalidateQueries({ queryKey: [key] }),
                      ),
                    );
                  }}
                />
              )}
              {editor?.collection && (
                <form
                  className="collection-form publication-preview"
                  onSubmit={(e) => {
                    e.preventDefault();
                    act(
                      {
                        path: base,
                        method: "PATCH",
                        body: {
                          name: editor.name,
                          source_language: current.source_language,
                          target_language: current.target_language,
                        },
                      },
                      () => setEditor(null),
                    );
                  }}
                >
                  <h3>{t.editCollection}</h3>
                  {visibilityControl(
                    current.visibility === "published",
                    (value) => reviewVisibility(current, value),
                  )}
                  {current.can_publish === false && (
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
                  </div>
                </form>
              )}
              {editor && !editor.collection && (
                <CollectionCardForm
                  key={`${editor.id || "new"}-${pair.join("-")}`}
                  card={editor}
                  pair={pair}
                  collection={current}
                  text={copy[language]}
                  t={t}
                  busy={busy}
                  onCancel={() => setEditor(null)}
                  onSubmit={(body) =>
                    act(
                      {
                        path: editor.id
                          ? `/api/collections/cards/${editor.id}`
                          : `${base}/cards`,
                        method: editor.id ? "PATCH" : "POST",
                        body,
                      },
                      () => setEditor(null),
                    )
                  }
                />
              )}
              {entries.isError && (
                <p role="alert">
                  {t.error}
                  <button onClick={() => entries.refetch()}>{t.retry}</button>
                </p>
              )}
              <ol className="collection-card-list">
                {readableEntries?.map((c, i) => (
                  <li key={c.id}>
                    <div>
                      <strong>{cardWords(c)}</strong>
                    </div>
                    <div className="collection-actions">
                      {current.can_edit && (
                        <>
                          <button
                            disabled={busy || !i}
                            aria-label={`${t.up}: ${c.source_text}`}
                            onClick={() => move(i, -1)}
                          >
                            {t.up}
                          </button>
                          <button
                            disabled={busy || i === entries.data.length - 1}
                            aria-label={`${t.down}: ${c.source_text}`}
                            onClick={() => move(i, 1)}
                          >
                            {t.down}
                          </button>
                          <button
                            disabled={busy}
                            onClick={() =>
                              act({
                                path: `${base}/entries/${c.id}`,
                                method: "DELETE",
                              })
                            }
                          >
                            {t.remove}
                          </button>
                        </>
                      )}
                      {c.can_edit && (
                        <>
                          <button onClick={() => setEditor(c)}>{t.edit}</button>
                          {c.shared_via_collection && (
                            <button
                              disabled={busy}
                              onClick={() =>
                                act({
                                  path: `/api/collections/cards/${c.id}`,
                                  method: "PATCH",
                                  body: {
                                    source_text: c.source_text,
                                    target_text: c.target_text,
                                    withdraw: true,
                                  },
                                })
                              }
                            >
                              {t.withdraw}
                            </button>
                          )}
                          <button
                            disabled={busy}
                            onClick={() =>
                              act({
                                path: `/api/vocabulary/${c.id}`,
                                method: "DELETE",
                              })
                            }
                          >
                            {t.archive}
                          </button>
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
              {readableEntries?.length === 0 && <p>{t.empty}</p>}
              {current.can_edit &&
                current.unavailable_entry_ids?.map((id) => (
                  <button
                    key={id}
                    disabled={busy}
                    onClick={() =>
                      act({ path: `${base}/entries/${id}`, method: "DELETE" })
                    }
                  >
                    {t.unavailable}
                  </button>
                ))}
              {current.can_edit && (
                <div className="collection-search">
                  <h3>{t.addExisting}</h3>
                  <label>
                    {t.search}
                    <input
                      id="collection-search"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </label>
                  {results.isError && (
                    <p role="alert">
                      {t.error}
                      <button onClick={() => results.refetch()}>
                        {t.retry}
                      </button>
                    </p>
                  )}
                  <ul className="collection-card-list">
                    {results.data
                      ?.filter((c) => !current.entry_ids.includes(c.id))
                      .map((c) => (
                        <li key={c.id}>
                          <span>
                            {cardWords(c)} ·{" "}
                            {c.shared_via_collection
                              ? t.sharedCard
                              : t[c.visibility] || c.visibility}
                          </span>
                          <button
                            disabled={busy}
                            onClick={() =>
                              current.visibility === "published" &&
                              c.requires_confirmation
                                ? setPendingAdd(c)
                                : act({
                                    path: `${base}/entries`,
                                    body: { entry_id: c.id },
                                  })
                            }
                          >
                            {t.add}
                          </button>
                        </li>
                      ))}
                  </ul>
                  {results.data?.length === 0 && <p>{t.noMatches}</p>}
                  {pendingAdd && (
                    <div className="publication-preview">
                      <h3>{current.name}</h3>
                      <p>
                        {pairLabel} · {current.card_count + 1} {t.cards}
                      </p>
                      <p>{t.exposure}</p>
                      <p>{cardWords(pendingAdd)}</p>
                      <div className="collection-actions">
                        <button
                          className="primary"
                          disabled={busy}
                          onClick={() =>
                            act(
                              {
                                path: `${base}/entries`,
                                body: {
                                  entry_id: pendingAdd.id,
                                  confirm_private_ids: [pendingAdd.id],
                                  exposure_token: pendingAdd.exposure_token,
                                },
                              },
                              () => setPendingAdd(null),
                            )
                          }
                        >
                          {t.exposureAdd}
                        </button>
                        <button onClick={() => setPendingAdd(null)}>
                          {t.cancel}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
