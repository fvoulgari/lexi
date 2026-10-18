import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import {
  Shuffle,
  ListFilter,
  RotateCcw,
  Layers,
  ArrowRight,
} from "lucide-react";
import PropTypes from "prop-types";
import { request } from "./api.js";
import Choices from "./Choices.jsx";
import PracticeCardView from "./PracticeCardView.jsx";

export default function Practice({ text, csrf, onLocked }) {
  const profiles = useQuery({
    queryKey: ["profiles"],
    queryFn: () => request("/api/profiles"),
  });
  const [profileId, setProfileId] = useState(() => {
    try {
      return localStorage.getItem("notebook-profile") || "";
    } catch {
      return "";
    }
  });
  const [session, setSession] = useState(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const profile = profiles.data?.find((p) => p.id === profileId);
  useEffect(() => {
    if (profiles.error?.status === 401) onLocked();
  }, [profiles.error, onLocked]);
  const post = (path, body) =>
    request(path, {
      method: "POST",
      headers: { "X-CSRF-Token": csrf },
      body: JSON.stringify(body),
    });
  function showError(error) {
    if (error.status === 401) onLocked();
    else setError(error);
  }
  async function start(direction, size, type, filters) {
    setPending(true);
    setError(null);
    try {
      const result = await post("/api/sessions", {
        profile_id: profile.id,
        direction,
        size,
        ...(type === "category" ? filters : {}),
        ...(["difficult", "mixed"].includes(type) ? { mode: type } : {}),
      });
      setSession({ ...result, direction, type });
      try {
        localStorage.setItem("notebook-profile", profile.id);
      } catch {
        /* Device storage is optional. */
      }
    } catch (error) {
      showError(error);
    } finally {
      setPending(false);
    }
  }
  if (profiles.isPending) return <p role="status">{text.loading}</p>;
  if (profiles.isError)
    return (
      <div className="status">
        <p role="alert">
          {text.errors[profiles.error.code] || text.errors.request_failed}
        </p>
        <button onClick={() => profiles.refetch()}>{text.retry}</button>
      </div>
    );
  if (session)
    return (
      <ActivePractice
        text={text}
        session={session}
        profile={profile}
        post={post}
        onLocked={onLocked}
        onAgain={() => {
          setSession(null);
          setError(null);
        }}
      />
    );
  return (
    <section className="practice-page practice-setup-page">
      <header className="setup-heading">
        <div>
          <h1>{text.practice}</h1>
        </div>
        <div className="setup-profile">
          {profile && (
            <span className="setup-avatar" aria-hidden="true">
              {profile.display_name.trim().slice(0, 1).toUpperCase()}
            </span>
          )}
          <div>
            <label htmlFor="practice-profile">{text.profile}</label>
            <select
              id="practice-profile"
              value={profile?.id || ""}
              disabled={pending}
              onChange={(e) => setProfileId(e.target.value)}
            >
              <option value="">{text.chooseProfile}</option>
              {profiles.data.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.display_name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </header>
      <div className="practice-setup">
        {!profiles.data.length && (
          <Link to="/settings">{text.createProfile}</Link>
        )}
        <Setup
          key={profile?.id || "none"}
          text={text}
          profile={profile}
          pending={pending}
          onStart={start}
          onLocked={onLocked}
          error={error}
        />
      </div>
    </section>
  );
}
function Direction({ text, value, onChange, disabled = false }) {
  return (
    <>
      <label htmlFor="practice-direction">{text.direction}</label>
      <select
        id="practice-direction"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="greek_to_italian">
          {text.greek} → {text.italian}
        </option>
        <option value="italian_to_greek">
          {text.italian} → {text.greek}
        </option>
      </select>
    </>
  );
}
function Setup({ text, profile, pending, onStart, onLocked, error }) {
  const [searchParams] = useSearchParams();
  const [type, setType] = useState(
    searchParams.get("mode") === "difficult" ? "difficult" : "random",
  );
  const emptyFilters = {
    unit_ids: [],
    no_unit: false,
    word_types: [],
  };
  const [filters, setFilters] = useState(emptyFilters);
  const units = useQuery({
    queryKey: ["units"],
    queryFn: () => request("/api/units"),
    enabled: type === "category",
  });
  useEffect(() => {
    if (units.error?.status === 401) onLocked();
  }, [units.error, onLocked]);
  const filterError = type === "category" && units.isError;
  const filterLoading = type === "category" && units.isPending;
  const changeFilter = (key, value) =>
    setFilters((current) => ({ ...current, [key]: value }));
  const [direction, setDirection] = useState(
    ["greek_to_italian", "italian_to_greek"].includes(
      searchParams.get("direction"),
    )
      ? searchParams.get("direction")
      : profile?.preferred_direction || "greek_to_italian",
  );
  const difficult = useQuery({
    queryKey: ["difficult-entries", profile?.id, direction],
    queryFn: () =>
      request(
        `/api/profiles/${profile.id}/difficult-entries?direction=${direction}`,
      ),
    enabled: !!profile && type === "difficult",
    staleTime: 0,
    retry: false,
  });
  useEffect(() => {
    if (difficult.error?.status === 401) onLocked();
  }, [difficult.error, onLocked]);
  const [size, setSize] = useState(
    String(profile ? (profile.default_session_size ?? "all") : 25),
  );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onStart(direction, size === "all" ? null : Number(size), type, filters);
      }}
    >
      <SetupOptions
        legend={text.setupPracticeType}
        name="practice-type"
        value={type}
        onChange={setType}
        disabled={pending}
        className="setup-mode-grid"
        options={[
          { value: "random", label: text.setupRandomPractice, icon: Shuffle },
          {
            value: "category",
            label: text.setupCategoryPractice,
            icon: ListFilter,
          },
          {
            value: "difficult",
            label: text.setupDifficultPractice,
            icon: RotateCcw,
          },
          { value: "mixed", label: text.mixedPractice, icon: Layers },
        ]}
      />
      {type === "mixed" && (
        <p className="setup-mixed-hint">{text.mixedExplanation}</p>
      )}
      {type === "category" && (
        <section className="setup-filters" aria-label={text.filters}>
          <p>{text.setupFilterHint}</p>
          {filterLoading && <p role="status">{text.loading}</p>}
          {filterError && (
            <div>
              <p role="alert">{text.errors.request_failed}</p>
              <button
                type="button"
                onClick={() => {
                  units.refetch();
                }}
              >
                {text.retry}
              </button>
            </div>
          )}
          <Choices
            legend={text.units}
            disabled={pending || filterLoading || filterError}
            options={(units.data || []).map((u) => ({
              id: u.id,
              label: `${u.code} — ${u.title}`,
            }))}
            selected={[
              ...filters.unit_ids,
              ...(filters.no_unit ? ["none"] : []),
            ]}
            onChange={(values) =>
              setFilters((current) => ({
                ...current,
                unit_ids: values.filter((v) => v !== "none"),
                no_unit: values.includes("none"),
              }))
            }
          />
          <Choices
            legend={text.setupWordTypes}
            disabled={pending}
            options={[
              "noun",
              "verb",
              "adjective",
              "adverb",
              "expression",
              "other",
            ].map((id) => ({ id, label: text[id] }))}
            selected={filters.word_types}
            onChange={(values) => changeFilter("word_types", values)}
          />
          <button
            type="button"
            className="secondary"
            disabled={pending}
            onClick={() => setFilters(emptyFilters)}
          >
            {text.setupClearFilters}
          </button>
        </section>
      )}
      <SetupOptions
        legend={text.setupDirection}
        name="setup-direction"
        value={direction}
        onChange={setDirection}
        disabled={pending}
        className="setup-direction-options"
        options={[
          {
            value: "greek_to_italian",
            label: `${text.greek} → ${text.italian}`,
          },
          {
            value: "italian_to_greek",
            label: `${text.italian} → ${text.greek}`,
          },
        ]}
      />
      {type === "difficult" && profile && (
        <section
          className="setup-difficult-info"
          aria-label={text.setupDifficultPractice}
        >
          <p>{text.difficultyExplanation}</p>
          {difficult.isPending ? (
            <p role="status">{text.loading}</p>
          ) : difficult.isError ? (
            <>
              <p role="alert">
                {text.errors[difficult.error.code] ||
                  text.errors.request_failed}
              </p>
              <button type="button" onClick={() => difficult.refetch()}>
                {text.retry}
              </button>
            </>
          ) : difficult.isSuccess && difficult.data.length > 0 ? (
            <span className="setup-available-badge">
              {(difficult.data.length === 1
                ? text.difficultAvailableOne
                : text.difficultAvailable
              ).replace("{count}", difficult.data.length)}
            </span>
          ) : (
            <p role="status">{text.noDifficultEntries}</p>
          )}
        </section>
      )}
      <SetupOptions
        legend={text.cardsPerSession}
        name="practice-size"
        value={size}
        onChange={setSize}
        disabled={pending}
        className="setup-size-options"
        options={["10", "25", "50", "all"].map((value) => ({
          value,
          label: value === "all" ? text.allEntries : value,
        }))}
      />
      {error && (
        <div>
          <p role="alert" className="error">
            {error.code === "no_difficult_entries"
              ? text.noDifficultEntries
              : error.code === "no_matches"
                ? type === "category"
                  ? text.noCategoryMatches
                  : text.practiceScopeEmpty
                : text.errors[error.code] || text.errors.request_failed}
          </p>
          {error.code === "no_matches" && (
            <Link to="/vocabulary">{text.vocabulary}</Link>
          )}
        </div>
      )}
      <button
        className="primary setup-start"
        disabled={!profile || pending || filterLoading || filterError}
      >
        {pending ? text.loading : text.startPractice}
        <ArrowRight size={18} aria-hidden="true" />
      </button>
    </form>
  );
}
function SetupOptions({
  legend,
  name,
  value,
  onChange,
  disabled,
  className,
  options,
}) {
  return (
    <fieldset className="setup-options" disabled={disabled}>
      <legend>{legend}</legend>
      <div className={className}>
        {options.map(({ value: optionValue, label, icon: Icon }) => (
          <label key={optionValue} className="setup-option">
            <input
              className="sr-only"
              type="radio"
              name={name}
              value={optionValue}
              checked={String(value) === String(optionValue)}
              onChange={(event) => onChange(event.target.value)}
            />
            <span>
              {Icon && <Icon size={18} aria-hidden="true" />}
              {label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
function ActivePractice({ text, session, profile, post, onLocked, onAgain }) {
  const [cards, setCards] = useState(() =>
    session.cards.filter((c) => !c.skipped),
  );
  const [skipped, setSkipped] = useState(() =>
    session.cards.some((c) => c.skipped),
  );
  const [position, setPosition] = useState(0);
  const [direction, setDirection] = useState(session.direction);
  const [finished, setFinished] = useState(() =>
    session.cards.every((c) => c.skipped),
  );
  const [busy, setBusy] = useState(false);
  const card = cards[position];
  return (
    <section className="practice-page">
      {skipped && <p role="status">{text.entrySkipped}</p>}
      {!finished && (
        <>
          <h1>
            {session.type === "category"
              ? text.categoryPractice
              : session.type === "difficult"
                ? text.difficultPractice
                : session.type === "mixed"
                  ? text.mixedPractice
                  : text.randomPractice}
          </h1>
          <p>
            {profile.display_name} · {position + 1} / {cards.length}
          </p>
          {session.requested_size !== null &&
            cards.length < session.requested_size && (
              <p role="status">
                {text.shortage
                  .replace("{count}", cards.length)
                  .replace("{size}", session.requested_size)}
              </p>
            )}
          <Flashcard
            key={card.position}
            text={text}
            card={card}
            direction={direction}
            onDirection={setDirection}
            post={post}
            sessionId={session.id}
            onLocked={onLocked}
            onBusy={setBusy}
            onSkipped={() => {
              setBusy(false);
              setSkipped(true);
              setCards((current) =>
                current.filter((c) => c.position !== card.position),
              );
              if (position + 1 === cards.length) setFinished(true);
            }}
            onSaved={() => {
              if (position + 1 === cards.length) setFinished(true);
              else setPosition(position + 1);
            }}
          />
          <button
            className="secondary"
            disabled={busy}
            onClick={() => setFinished(true)}
          >
            {text.finishPractice}
          </button>
        </>
      )}
      {finished && (
        <Summary
          text={text}
          sessionId={session.id}
          onAgain={onAgain}
          onLocked={onLocked}
        />
      )}
    </section>
  );
}
function Flashcard({
  text,
  card,
  direction,
  onDirection,
  post,
  sessionId,
  onLocked,
  onSaved,
  onSkipped,
  onBusy,
}) {
  const [revealed, setRevealed] = useState(false);
  const [pending, setPending] = useState(false);
  const [rating, setRating] = useState(null);
  const [error, setError] = useState(null);
  const revealButton = useRef(null);
  const answer = useRef(null);
  const inFlight = useRef(false);
  useEffect(() => {
    revealButton.current?.focus();
  }, []);
  useEffect(() => {
    if (revealed) answer.current?.focus();
  }, [revealed]);
  const entry = card.snapshot;
  function failed(error) {
    if (error.code === "entry_deleted") {
      onBusy(false);
      onSkipped();
    } else if (error.status === 401) onLocked();
    else setError(error);
  }
  async function reveal() {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    onBusy(true);
    setError(null);
    try {
      await post(`/api/sessions/${sessionId}/cards/${card.position}/reveal`, {
        direction,
      });
      setRevealed(true);
    } catch (error) {
      failed(error);
    } finally {
      inFlight.current = false;
      setPending(false);
      onBusy(false);
    }
  }
  async function save(value) {
    if (inFlight.current) return;
    inFlight.current = true;
    setRating(value);
    setPending(true);
    onBusy(true);
    setError(null);
    try {
      await post(`/api/sessions/${sessionId}/cards/${card.position}/reviews`, {
        direction,
        rating: value,
      });
      onBusy(false);
      onSaved();
    } catch (error) {
      failed(error);
    } finally {
      inFlight.current = false;
      setPending(false);
      // Until acceptance is confirmed, finishing could hide a review whose
      // response was lost. Keep the card available for the identical retry.
    }
  }
  return (
    <>
      <Direction
        text={text}
        value={direction}
        disabled={pending || !!rating}
        onChange={(value) => {
          onDirection(value);
          setRevealed(false);
          setError(null);
          revealButton.current?.focus();
        }}
      />
      <PracticeCardView
        entry={entry}
        text={text}
        direction={direction}
        revealed={revealed}
        answerRef={answer}
      >
        {!revealed && (
          <button
            ref={revealButton}
            className="primary"
            disabled={pending}
            onClick={reveal}
          >
            {pending ? text.loading : text.revealAnswer}
          </button>
        )}
      </PracticeCardView>

      <div className="rating-buttons">
        {["again", "hard", "easy"].map((value) => (
          <button
            key={value}
            disabled={!revealed || pending || !!rating}
            onClick={() => save(value)}
          >
            {text[value]}
          </button>
        ))}
      </div>
      {pending && rating && <p role="status">{text.saving}</p>}
      {error && (
        <div>
          <p className="error" role="alert">
            {text.errors[error.code] || text.errors.request_failed}
          </p>
          {rating && (
            <>
              <p>
                {text.selectedRating}: {text[rating]}
              </p>
              <button onClick={() => save(rating)} disabled={pending}>
                {text.practiceRetry}
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
}
function Summary({ text, sessionId, onAgain, onLocked }) {
  const summary = useQuery({
    queryKey: ["practice-summary", sessionId],
    queryFn: () => request(`/api/sessions/${sessionId}/summary`),
    retry: false,
  });
  useEffect(() => {
    if (summary.error?.status === 401) onLocked();
  }, [summary.error, onLocked]);
  const title = useRef(null);
  useEffect(() => {
    title.current?.focus();
  }, []);
  return (
    <div className="session-summary">
      <h1 ref={title} tabIndex={-1}>
        {text.sessionSummary}
      </h1>
      {summary.isPending ? (
        <p role="status">{text.loading}</p>
      ) : summary.isError ? (
        <>
          <p role="alert">
            {text.errors[summary.error.code] || text.errors.request_failed}
          </p>
          <button onClick={() => summary.refetch()}>{text.retry}</button>
        </>
      ) : (
        <>
          <p>
            {text.reviewed}: {summary.data.total}
          </p>
          <dl className="summary-counts">
            {["again", "hard", "easy"].map((value) => (
              <div key={value}>
                <dt>{text[value]}</dt>
                <dd>{summary.data.counts[value]}</dd>
              </div>
            ))}
          </dl>
          <h2>{text.remembered}</h2>
          <p className="remembered-value">
            {Math.round(summary.data.remembered)}%
          </p>
          {!summary.data.total && <p>{text.noReviews}</p>}
          {!!summary.data.needs_practice.length && (
            <>
              <h2>{text.needsPractice}</h2>
              <ul>
                {summary.data.needs_practice.map((e) => (
                  <li key={e.id}>
                    {e.snapshot.italian} · {e.snapshot.greek} — {text[e.rating]}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
      <div className="summary-actions">
        <button className="primary" onClick={onAgain}>
          {text.practiceAgain}
        </button>
        <Link to="/">{text.returnHome}</Link>
      </div>
    </div>
  );
}
Practice.propTypes = {
  text: PropTypes.object.isRequired,
  csrf: PropTypes.string.isRequired,
  onLocked: PropTypes.func.isRequired,
};
