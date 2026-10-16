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

  const data = history.data;
  const error = profiles.error || history.error;

  const difficultDirection =
    data?.directions?.find((row) => row.difficult_entries > 0)?.key ||
    profile?.preferred_direction;

  const difficultPracticeUrl = difficultDirection
    ? `/practice?mode=difficult&direction=${encodeURIComponent(
        difficultDirection,
      )}`
    : "/practice?mode=difficult";

  useEffect(() => {
    if ([profiles.error, history.error].some((error) => error?.status === 401)) {
      onLocked();
    }
  }, [profiles.error, history.error, onLocked]);

  function selectProfile(id) {
    setSelected(id);

    try {
      if (id) {
        localStorage.setItem("notebook-profile", id);
      } else {
        localStorage.removeItem("notebook-profile");
      }
    } catch {
      /* Selection works without device storage. */
    }
  }

  return (
    <section
      className={`progress-page${detailed ? "" : " lexi-home"}`}
    >
      <div className="progress-heading">
        <div>
          <h1>
            {detailed
              ? text.progress
              : profile
                ? text.greeting.replace("{name}", profile.display_name)
                : text.welcome}
          </h1>
        </div>

        <div className="profile-picker">
          {!detailed && profile && (
            <span className="profile-avatar" aria-hidden="true">
              {profile.display_name.trim().slice(0, 1).toUpperCase()}
            </span>
          )}

          <div className="profile-picker-field">
            <label htmlFor="progress-profile">{text.profile}</label>

            {!detailed && (
              <span className="profile-picker-name" aria-hidden="true">
                {profile?.display_name || text.chooseProfile}
              </span>
            )}
            <select
              id="progress-profile"
              value={profile?.id || ""}
              onChange={(event) => selectProfile(event.target.value)}
            >
              <option value="">{text.chooseProfile}</option>

              {profiles.data?.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.display_name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

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
            type="button"
            onClick={() =>
              profiles.isError ? profiles.refetch() : history.refetch()
            }
          >
            {text.retry}
          </button>
        </div>
      )}

      {!detailed && profile && (
        <section className="home-practice-banner">
          <div>
            <h2>{text.homePracticeTitle}</h2>
            <p>{text.homePracticeHint}</p>
          </div>

          <Link className="home-start-button" to="/practice">
            {text.startPractice}
            <span aria-hidden="true">→</span>
          </Link>
        </section>
      )}

      {profile && data && (
        <>
          {!detailed && (
            <div className="home-section-heading">
              <h2>{text.homeNotebook}</h2>
            </div>
          )}

          <dl
            className={`progress-stats${detailed ? "" : " home-stats"}`}
          >
            <div>
              <dt>{text.vocabularyCount}</dt>
              <dd>{data.vocabulary_count}</dd>
            </div>

            {detailed && (
              <div>
                <dt>{text.totalReviews}</dt>
                <dd>{data.total_reviews}</dd>
              </div>
            )}

            <div>
              <dt>{text.entriesPractised}</dt>
              <dd>{data.entries_practised}</dd>
            </div>

            <div>
              <dt>{text.difficultCount}</dt>
              <dd>{data.difficult_entries}</dd>
            </div>
          </dl>

          {!data.total_reviews && (
            <div className={detailed ? undefined : "home-empty"}>
              {!detailed && <h2>{text.homeEmptyTitle}</h2>}
              <p>{text.progressEmpty}</p>
            </div>
          )}

          {data.recent_session && (
            <section
              className={`progress-card${detailed ? "" : " home-recent"}`}
              aria-label={text.recentPractice}
            >
              <h2>{text.recentPractice}</h2>

              <dl
                className={`progress-stats${
                  detailed ? "" : " home-session-stats"
                }`}
              >
                <div>
                  <dt>{text.reviewed}</dt>
                  <dd>{data.recent_session.total_reviews}</dd>
                </div>

                <div>
                  <dt>{text.remembered}</dt>
                  <dd>
                    {Math.round(data.recent_session.remembered)}%
                  </dd>
                </div>
              </dl>

              {detailed && <p>{text.recallHint}</p>}
            </section>
          )}

          {!detailed && data.difficult_entries > 0 && (
            <div className="home-difficult">
              <span>
                {text.difficultCount}
                <strong>{data.difficult_entries}</strong>
              </span>

              <Link
                className="home-difficult-button"
                to={difficultPracticeUrl}
              >
                {text.practiseDifficult}
                <span aria-hidden="true">→</span>
              </Link>
            </div>
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
            label={(key, row) =>
              key ? `${key} · ${row.title}` : text.noUnit
            }
          />

          <Breakdown
            title={text.typeBreakdown}
            rows={data.word_types}
            text={text}
            label={(key) => text[key] || text.unspecified}
          />

          <section
            className="progress-card"
            aria-label={text.difficultCount}
          >
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

            {!data.difficult_entries && (
              <p>{text.noDifficultEntries}</p>
            )}
          </section>
        </>
      )}

      <div className={detailed ? "progress-actions" : "home-links"}>
        {(detailed || !profile) && (
          <Link className="primary" to="/practice">
            {text.startPractice}
          </Link>
        )}

        {detailed && profile && data?.difficult_entries > 0 && (
          <Link className="secondary" to={difficultPracticeUrl}>
            {text.practiseDifficult}
          </Link>
        )}

        {detailed && (
          <>
            <Link className="secondary" to="/">
              {text.returnHome}
            </Link>
            <Link to="/vocabulary">{text.openLibrary}</Link>
          </>
        )}
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

function DifficultEntries({
  text,
  profileId,
  direction,
  count,
  onLocked,
}) {
  const entries = useQuery({
    queryKey: ["progress-difficult", profileId, direction],
    queryFn: () =>
      request(
        `/api/profiles/${profileId}/difficult-entries?direction=${encodeURIComponent(
          direction,
        )}`,
      ),
    retry: false,
  });

  useEffect(() => {
    if (entries.error?.status === 401) {
      onLocked();
    }
  }, [entries.error, onLocked]);

  return (
    <div>
      <h3>{directionLabel(text, direction)}</h3>

      <Link
        to={`/practice?mode=difficult&direction=${encodeURIComponent(
          direction,
        )}`}
      >
        {text.practiseDifficult} ({count})
      </Link>

      {entries.isPending && <p role="status">{text.loading}</p>}

      {entries.isError && (
        <div>
          <p role="alert">
            {text.errors[entries.error.code] ||
              text.errors.request_failed}
          </p>

          <button type="button" onClick={() => entries.refetch()}>
            {text.retry}
          </button>
        </div>
      )}

      {entries.data?.length > 0 && (
        <ul>
          {entries.data.map((item) => (
            <li key={item.entry.id}>
              <span lang="it">{item.entry.italian}</span>
              {" · "}
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