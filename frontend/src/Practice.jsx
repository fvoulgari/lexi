import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import PropTypes from "prop-types";
import { request } from "./api.js";

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
  async function start(direction, size) {
    setPending(true);
    setError(null);
    try {
      const result = await post("/api/sessions", {
        profile_id: profile.id,
        direction,
        size,
      });
      setSession({ ...result, direction });
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
    <section className="practice-page">
      <span className="eyebrow">ITALIAN NOTEBOOK</span>
      <h1>{text.practice}</h1>
      <p>{text.randomPractice}</p>
      <div className="practice-setup">
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
        {!profiles.data.length && (
          <Link to="/settings">{text.createProfile}</Link>
        )}
        <Setup
          key={profile?.id || "none"}
          text={text}
          profile={profile}
          pending={pending}
          onStart={start}
        />
        {error && (
          <p role="alert" className="error">
            {error.code === "no_matches"
              ? text.noMatches
              : text.errors[error.code] || text.errors.request_failed}
          </p>
        )}
        <Link to="/">{text.returnHome}</Link>
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
function Setup({ text, profile, pending, onStart }) {
  const [direction, setDirection] = useState(
    profile?.preferred_direction || "greek_to_italian",
  );
  const [size, setSize] = useState(
    profile ? (profile.default_session_size ?? "all") : 25,
  );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onStart(direction, size === "all" ? null : Number(size));
      }}
    >
      <Direction
        text={text}
        value={direction}
        onChange={setDirection}
        disabled={pending}
      />
      <label htmlFor="practice-size">{text.practiceSize}</label>
      <select
        id="practice-size"
        value={size}
        disabled={pending}
        onChange={(e) => setSize(e.target.value)}
      >
        {[10, 25, 50].map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
        <option value="all">{text.allEntries}</option>
      </select>
      <button className="primary" disabled={!profile || pending}>
        {pending ? text.loading : text.startPractice}
      </button>
    </form>
  );
}
function ActivePractice({ text, session, profile, post, onLocked, onAgain }) {
  const [position, setPosition] = useState(0);
  const [direction, setDirection] = useState(session.direction);
  const [finished, setFinished] = useState(false);
  const [busy, setBusy] = useState(false);
  const card = session.cards[position];
  return (
    <section className="practice-page">
      {!finished && (
        <>
          <h1>{text.randomPractice}</h1>
          <p>
            {profile.display_name} · {position + 1} / {session.cards.length}
          </p>
          {session.requested_size !== null &&
            session.cards.length < session.requested_size && (
              <p role="status">
                {text.shortage
                  .replace("{count}", session.cards.length)
                  .replace("{size}", session.requested_size)}
              </p>
            )}
          <Flashcard
            key={position}
            text={text}
            card={card}
            direction={direction}
            onDirection={setDirection}
            post={post}
            sessionId={session.id}
            onLocked={onLocked}
            onBusy={setBusy}
            onSaved={() => {
              if (position + 1 === session.cards.length) setFinished(true);
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
  const front = direction === "greek_to_italian" ? "greek" : "italian";
  const back = front === "greek" ? "italian" : "greek";
  const entry = card.snapshot;
  function failed(error) {
    if (error.status === 401) onLocked();
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
      <div className="flashcard">
        <div className="card-metadata">
          <span>
            {entry.unit
              ? `${entry.unit.code} · ${entry.unit.title}`
              : text.noUnit}
          </span>
          {entry.word_type && <span>{text[entry.word_type]}</span>}
        </div>
        <p lang={front === "greek" ? "el" : "it"} className="card-prompt">
          {entry[front]}
        </p>
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
        {revealed && (
          <div className="card-answer" ref={answer} tabIndex={-1}>
            <h2 lang={back === "greek" ? "el" : "it"}>{entry[back]}</h2>
            <dl>
              {[
                "italian_gender",
                "greek_gender",
                "italian_plural",
                "greek_plural",
                "italian_example",
                "greek_example",
                "pronunciation",
                "notes",
              ]
                .filter((field) => entry[field])
                .map((field) => (
                  <div key={field}>
                    <dt>{text.fields[field]}</dt>
                    <dd>
                      {field.endsWith("_gender")
                        ? text[entry[field]]
                        : entry[field]}
                    </dd>
                  </div>
                ))}
            </dl>
          </div>
        )}
      </div>
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
