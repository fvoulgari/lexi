import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { request } from "./api.js";

export default function Progress({ text, onLocked, detailed = false }) {
  const [selected, setSelected] = useState(() => {
    try {
      return localStorage.getItem("notebook-profile") || "";
    } catch {
      return "";
    }
  });
  const profiles = useQuery({
    queryKey: ["profiles"],
    queryFn: () => request("/api/profiles"),
    retry: false,
  });
  const profile = profiles.data?.find((p) => p.id === selected);
  const history = useQuery({
    queryKey: ["progress", profile?.id],
    queryFn: () => request(`/api/profiles/${profile.id}/progress`),
    enabled: !!profile,
    retry: false,
  });
  const difficultDirection =
    history.data?.directions.find((row) => row.difficult_entries > 0)?.key ||
    profile?.preferred_direction;
  useEffect(() => {
    if ([profiles.error, history.error].some((error) => error?.status === 401))
      onLocked();
  }, [profiles.error, history.error, onLocked]);
  function selectProfile(id) {
    setSelected(id);
    try {
      if (id) localStorage.setItem("notebook-profile", id);
      else localStorage.removeItem("notebook-profile");
    } catch {
      /* Selection works without device storage. */
    }
  }
  const error = profiles.error || history.error;
  const data = history.data;
  return (
    <section className="progress-page">
      <span className="eyebrow">ITALIAN NOTEBOOK</span>
      <h1>
        {detailed
          ? text.progress
          : profile
            ? text.greeting.replace("{name}", profile.display_name)
            : text.welcome}
      </h1>
      <p>{detailed ? text.progressIntro : text.homeIntro}</p>
      <label htmlFor="progress-profile">{text.profile}</label>
      <select
        id="progress-profile"
        value={profile?.id || ""}
        onChange={(e) => selectProfile(e.target.value)}
      >
        <option value="">{text.chooseProfile}</option>
        {profiles.data?.map((p) => (
          <option key={p.id} value={p.id}>
            {p.display_name}
          </option>
        ))}
      </select>
      {selected && profiles.isSuccess && !profile && (
        <p>{text.missingProfile}</p>
      )}
      {profiles.isSuccess && !profiles.data.length && (
        <Link to="/settings">{text.createProfile}</Link>
      )}
      {(profiles.isPending || (profile && history.isPending)) && (
        <p role="status">{text.loading}</p>
      )}
      {error && (
        <div>
          <p className="error" role="alert">
            {text.errors[error.code] || text.errors.request_failed}
          </p>
          <button
            onClick={() =>
              profiles.isError ? profiles.refetch() : history.refetch()
            }
          >
            {text.retry}
          </button>
        </div>
      )}
      {profile && data && (
        <>
          <dl className="progress-stats">
            <div>
              <dt>{text.vocabularyCount}</dt>
              <dd>{data.vocabulary_count}</dd>
            </div>
            <div>
              <dt>{text.totalReviews}</dt>
              <dd>{data.total_reviews}</dd>
            </div>
            <div>
              <dt>{text.entriesPractised}</dt>
              <dd>{data.entries_practised}</dd>
            </div>
            <div>
              <dt>{text.difficultCount}</dt>
              <dd>{data.difficult_entries}</dd>
            </div>
          </dl>
          {!data.total_reviews && <p>{text.progressEmpty}</p>}
          {data.recent_session && (
            <section className="progress-card" aria-label={text.recentPractice}>
              <h2>{text.recentPractice}</h2>
              <dl className="progress-stats">
                <div>
                  <dt>{text.reviewed}</dt>
                  <dd>{data.recent_session.total_reviews}</dd>
                </div>
                <div>
                  <dt>{text.remembered}</dt>
                  <dd>{Math.round(data.recent_session.remembered)}%</dd>
                </div>
              </dl>
              <p>{text.recallHint}</p>
            </section>
          )}
        </>
      )}
      {profile && data && detailed && (
        <>
          <section
            className="progress-card"
            aria-label={text.ratingDistribution}
          >
            <h2>{text.ratingDistribution}</h2>
            <RatingCounts text={text} counts={data.counts} />
          </section>
          <p>{text.historyHint}</p>
          <Breakdown
            title={text.directionBreakdown}
            rows={data.directions}
            text={text}
            label={(key) => directionLabel(text, key)}
          />
          <Breakdown
            title={text.unitBreakdown}
            rows={data.units}
            text={text}
            label={(key, row) => (key ? `${key} · ${row.title}` : text.noUnit)}
          />
          <Breakdown
            title={text.typeBreakdown}
            rows={data.word_types}
            text={text}
            label={(key) => text[key] || text.unspecified}
          />
          <section className="progress-card" aria-label={text.difficultCount}>
            <h2>{text.difficultCount}</h2>
            {data.directions
              .filter((row) => row.difficult_entries > 0)
              .map((row) => (
                <DifficultEntries
                  key={`${profile.id}-${row.key}`}
                  text={text}
                  profileId={profile.id}
                  direction={row.key}
                  count={row.difficult_entries}
                  onLocked={onLocked}
                />
              ))}
            {!data.difficult_entries && <p>{text.noDifficultEntries}</p>}
          </section>
        </>
      )}
      <div className="progress-actions">
        <Link className="primary" to="/practice">
          {text.startPractice}
        </Link>
        {profile && data?.difficult_entries > 0 && (
          <Link
            className="secondary"
            to={`/practice?mode=difficult&direction=${difficultDirection}`}
          >
            {text.practiseDifficult}
          </Link>
        )}
        <Link className="secondary" to={detailed ? "/" : "/progress"}>
          {detailed ? text.returnHome : text.progress}
        </Link>
        <Link to="/vocabulary">{text.openLibrary}</Link>
      </div>
    </section>
  );
}

function RatingCounts({ text, counts }) {
  return (
    <dl className="rating-counts">
      {["again", "hard", "easy"].map((rating) => (
        <div key={rating}>
          <dt>{text[rating]}</dt>
          <dd>{counts[rating]}</dd>
        </div>
      ))}
    </dl>
  );
}
function Breakdown({ title, rows, text, label }) {
  return (
    <section className="progress-card" aria-label={title}>
      <h2>{title}</h2>
      <div className="breakdown-grid">
        {rows.map((row, index) => (
          <article key={`${row.key}-${index}`}>
            <h3>{label(row.key, row)}</h3>
            <dl className="progress-stats">
              <div>
                <dt>{text.totalReviews}</dt>
                <dd>{row.total_reviews}</dd>
              </div>
              <div>
                <dt>{text.entriesPractised}</dt>
                <dd>{row.entries_practised}</dd>
              </div>
              {row.difficult_entries !== undefined && (
                <div>
                  <dt>{text.difficultCount}</dt>
                  <dd>{row.difficult_entries}</dd>
                </div>
              )}
            </dl>
            <RatingCounts text={text} counts={row.counts} />
          </article>
        ))}
      </div>
    </section>
  );
}

function DifficultEntries({ text, profileId, direction, count, onLocked }) {
  const entries = useQuery({
    queryKey: ["progress-difficult", profileId, direction],
    queryFn: () =>
      request(
        `/api/profiles/${profileId}/difficult-entries?direction=${direction}`,
      ),
    retry: false,
  });
  useEffect(() => {
    if (entries.error?.status === 401) onLocked();
  }, [entries.error, onLocked]);
  return (
    <div>
      <h3>{directionLabel(text, direction)}</h3>
      <Link to={`/practice?mode=difficult&direction=${direction}`}>
        {text.practiseDifficult} ({count})
      </Link>
      {entries.isPending && <p role="status">{text.loading}</p>}
      {entries.isError && (
        <div>
          <p role="alert">
            {text.errors[entries.error.code] || text.errors.request_failed}
          </p>
          <button onClick={() => entries.refetch()}>{text.retry}</button>
        </div>
      )}
      {entries.data?.length > 0 && (
        <ul>
          {entries.data.map((item) => (
            <li key={item.entry.id}>
              <span lang="it">{item.entry.italian}</span> ·{" "}
              <span lang="el">{item.entry.greek}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function directionLabel(text, direction) {
  return direction === "greek_to_italian"
    ? `${text.greek} → ${text.italian}`
    : `${text.italian} → ${text.greek}`;
}
