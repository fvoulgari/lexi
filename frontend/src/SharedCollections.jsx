import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { request } from "./api.js";
import { useAccount } from "./AccountContext.jsx";
import { collectionCopy } from "./collection-copy.js";

const LANGUAGES = ["el", "it", "en", "da"];
function directionKey(a, b) {
  if (a === "it" && b === "el") return "italian_to_greek";
  if (a === "el" && b === "it") return "greek_to_italian";
  return `${a}_to_${b}`;
}

export default function SharedCollections({ language = "en", csrf }) {
  const t = collectionCopy[language];
  const names = new Intl.DisplayNames([language], { type: "language" });
  const client = useQueryClient();
  const account = useAccount();
  const [pair, setPair] = useState(() => {
    const codes = new URLSearchParams(window.location.search)
      .get("direction")
      ?.split("_to_");
    return codes?.length === 2 &&
      codes.every((c) => LANGUAGES.includes(c)) &&
      codes[0] !== codes[1]
      ? codes
      : ["el", "it"];
  });
  const [tab, setTab] = useState("mine");
  const [selected, setSelected] = useState("");
  const [chosen, setChosen] = useState([]);
  const [name, setName] = useState("");
  const [search, setSearch] = useState("");
  const [preview, setPreview] = useState(null);
  const [pendingAdd, setPendingAdd] = useState(null);
  const [editor, setEditor] = useState(null);
  const [session, setSession] = useState(null);
  const [position, setPosition] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [reverse, setReverse] = useState(false);
  const [difficult, setDifficult] = useState(
    () =>
      new URLSearchParams(window.location.search).get("mode") === "difficult",
  );
  const direction = directionKey(...(reverse ? [...pair].reverse() : pair));
  const list = useQuery({
    queryKey: ["collections"],
    queryFn: () => request("/api/collections"),
  });
  const collections = (list.data || []).filter(
    (c) =>
      [c.source_language, c.target_language].sort().join() ===
      [...pair].sort().join(),
  );
  const current = collections.find((c) => c.id === selected);
  const entries = useQuery({
    queryKey: ["collection-cards", selected],
    queryFn: () => request(`/api/collections/${selected}/entries`),
    enabled: !!current,
  });
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
    } catch {
      /* Mutation renders a localised error. */
    }
  }
  const base = `/api/collections/${selected}`;
  const pairLabel = pair.map((code) => names.of(code)).join(" – ");
  const queueCard = session?.cards[position];
  async function start() {
    await act(
      {
        path: "/api/sessions",
        body: {
          profile_id: account.profile_id,
          collection_ids: chosen,
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
                <h3>
                  {(queueCard.snapshot.source_language || "it") ===
                  (reverse ? pair[1] : pair[0])
                    ? queueCard.snapshot.italian
                    : queueCard.snapshot.greek}
                </h3>
                {revealed ? (
                  <>
                    <p className="collection-answer">
                      {(queueCard.snapshot.source_language || "it") ===
                      (reverse ? pair[1] : pair[0])
                        ? queueCard.snapshot.greek
                        : queueCard.snapshot.italian}
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
                {t.unavailable}
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
              <label key={i}>
                <span className="sr-only">
                  {t.pair} {i + 1}
                </span>
                <select
                  disabled={busy}
                  value={value}
                  onChange={(e) => changePair(i, e.target.value)}
                >
                  {LANGUAGES.filter((code) => code !== pair[1 - i]).map(
                    (code) => (
                      <option value={code} key={code}>
                        {names.of(code)}
                      </option>
                    ),
                  )}
                </select>
              </label>
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
            {collections
              .filter((c) =>
                tab === "mine" ? c.can_edit : c.visibility === "published",
              )
              .map((c) => (
                <article className="collection-box" key={c.id}>
                  <h2>{c.name}</h2>
                  <p>
                    {pairLabel} · {c.card_count} {t.cards} · {t[c.visibility]}
                  </p>
                  <div className="collection-actions">
                    <button
                      disabled={busy}
                      aria-pressed={selected === c.id}
                      onClick={() => {
                        setSelected(c.id);
                        setPreview(null);
                        setPendingAdd(null);
                        setEditor(null);
                        write.reset();
                      }}
                    >
                      {t.open}
                    </button>
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
                (c) => {
                  setName("");
                  setSelected(c.id);
                  setTab("mine");
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
            <button className="primary" disabled={busy}>
              {t.create}
            </button>
          </form>
          <div className="collection-box collection-practice">
            <p>{t.choose}</p>
            <label>
              {t.direction}
              <select
                value={reverse ? "reverse" : "forward"}
                onChange={(e) => setReverse(e.target.value === "reverse")}
              >
                <option value="forward">
                  {names.of(pair[0])} → {names.of(pair[1])}
                </option>
                <option value="reverse">
                  {names.of(pair[1])} → {names.of(pair[0])}
                </option>
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
              disabled={busy || !chosen.length}
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
                    {t.rename}
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
                      onClick={() => act({ path: `${base}/unpublish` })}
                    >
                      {t.unpublish}
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
              {preview && (
                <div
                  className="publication-preview"
                  role="region"
                  aria-label={t.confirm}
                >
                  <h3>{preview.name}</h3>
                  <p>
                    {pairLabel} · {preview.card_count} {t.cards}
                  </p>
                  <p>{preview.private_cards.length ? t.exposure : t.none}</p>
                  <ul>
                    {preview.private_cards.map((c) => (
                      <li key={c.id}>
                        {c.source_text} — {c.target_text}
                      </li>
                    ))}
                  </ul>
                  <div className="collection-actions">
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() =>
                        act(
                          {
                            path: `${base}/publish`,
                            body: {
                              preview_token: preview.preview_token,
                              confirm_private_ids: preview.private_cards.map(
                                (c) => c.id,
                              ),
                            },
                          },
                          () => setPreview(null),
                        )
                      }
                    >
                      {t.confirm}
                    </button>
                    <button onClick={() => setPreview(null)}>{t.cancel}</button>
                  </div>
                </div>
              )}
              {editor && (
                <form
                  className="collection-form publication-preview"
                  onSubmit={(e) => {
                    e.preventDefault();
                    act(
                      editor.collection
                        ? {
                            path: base,
                            method: "PATCH",
                            body: {
                              name: editor.name,
                              source_language: pair[0],
                              target_language: pair[1],
                            },
                          }
                        : {
                            path: editor.id
                              ? `/api/collections/cards/${editor.id}`
                              : `${base}/cards`,
                            method: editor.id ? "PATCH" : "POST",
                            body: {
                              source_text: editor.source_text,
                              target_text: editor.target_text,
                              confirm_exposure:
                                editor.confirm_exposure || false,
                            },
                          },
                      () => setEditor(null),
                    );
                  }}
                >
                  <h3>
                    {editor.collection
                      ? t.rename
                      : editor.id
                        ? t.edit
                        : t.createCard}
                  </h3>
                  {editor.collection ? (
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
                  ) : (
                    <>
                      {["source", "target"].map((side, i) => (
                        <label key={side}>
                          {names.of(
                            editor[`${side}_language`] || [...pair].sort()[i],
                          )}
                          <input
                            required
                            maxLength={500}
                            value={editor[`${side}_text`]}
                            onChange={(e) =>
                              setEditor({
                                ...editor,
                                [`${side}_text`]: e.target.value,
                              })
                            }
                          />
                        </label>
                      ))}
                      {!editor.id && current.visibility === "published" && (
                        <>
                          <p>
                            {current.name} · {pairLabel} ·{" "}
                            {current.card_count + 1} {t.cards}
                          </p>
                          <p>{t.exposure}</p>
                          <label>
                            <input
                              type="checkbox"
                              required
                              checked={editor.confirm_exposure}
                              onChange={(e) =>
                                setEditor({
                                  ...editor,
                                  confirm_exposure: e.target.checked,
                                })
                              }
                            />
                            {t.exposureNew}
                          </label>
                        </>
                      )}
                    </>
                  )}
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
              {entries.isError && (
                <p role="alert">
                  {t.error}
                  <button onClick={() => entries.refetch()}>{t.retry}</button>
                </p>
              )}
              <ol className="collection-card-list">
                {entries.data?.map((c, i) => (
                  <li key={c.id}>
                    <div>
                      <strong>{c.source_text}</strong> — {c.target_text}
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
                          {c.visibility === "published" && (
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
              {entries.data?.length === 0 && <p>{t.empty}</p>}
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
                            {c.source_text} — {c.target_text} ·{" "}
                            {t[c.visibility] || c.visibility}
                          </span>
                          <button
                            disabled={busy}
                            onClick={() =>
                              current.visibility === "published" &&
                              c.visibility === "private"
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
                      <p>
                        {pendingAdd.source_text} — {pendingAdd.target_text}
                      </p>
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
