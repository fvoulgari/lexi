import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
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
    if (
      [profiles.error, history.error].some((error) => error?.status === 401)
    ) {
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

  if (detailed)
    return (
      <DetailedProgress
        text={text}
        profile={profile}
        profiles={profiles}
        history={history}
        selected={selected}
        selectProfile={selectProfile}
        onLocked={onLocked}
      />
    );

  if (!profile) {
    return (
      <section
        className="progress-page lexi-home home-welcome"
        aria-labelledby="home-welcome-title"
      >
        <h1 id="home-welcome-title">{text.homeWelcomeTitle}</h1>
        {profiles.isPending ? (
          <p role="status">{text.loading}</p>
        ) : profiles.isError ? (
          <div>
            <p className="error" role="alert">
              {text.errors[profiles.error.code] || text.errors.request_failed}
            </p>
            <button
              className="secondary"
              type="button"
              onClick={() => profiles.refetch()}
            >
              {text.retry}
            </button>
          </div>
        ) : profiles.isSuccess ? (
          <>
            {selected && <p role="status">{text.missingProfile}</p>}
            <p className="home-welcome-hint">
              {profiles.data.length
                ? text.homeChooseProfileHint
                : text.homeCreateProfileHint}
            </p>
            {profiles.data.length > 0 && (
              <div className="home-welcome-picker">
                <label htmlFor="progress-profile">{text.profile}</label>
                <select
                  id="progress-profile"
                  value=""
                  onChange={(event) => selectProfile(event.target.value)}
                >
                  <option value="">{text.chooseProfile}</option>
                  {profiles.data.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.display_name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <Link
              className={profiles.data.length ? "home-text-link" : "primary"}
              to="/settings"
            >
              {profiles.data.length
                ? text.settingsNewProfile
                : text.createProfile}
            </Link>
          </>
        ) : null}
      </section>
    );
  }

  return (
    <section className={`progress-page${detailed ? "" : " lexi-home"}`}>
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

          <dl className={`progress-stats${detailed ? "" : " home-stats"}`}>
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
                  <dd>{Math.round(data.recent_session.remembered)}%</dd>
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

              <Link className="home-difficult-button" to={difficultPracticeUrl}>
                {text.practiseDifficult}
                <span aria-hidden="true">→</span>
              </Link>
            </div>
          )}
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

function DetailedProgress({
  text,
  profile,
  profiles,
  history,
  selected,
  selectProfile,
  onLocked,
}) {
  const data = history.data;
  const error = profiles.error || history.error;
  const metrics = data
    ? [
        [text.vocabularyCount, data.vocabulary_count],
        [text.entriesPractised, data.entries_practised],
        [text.totalReviews, data.total_reviews],
        [text.difficultCount, data.difficult_entries],
      ]
    : [];
  return (
    <section className="progress-page progress-detail">
      <header className="detail-heading">
        <div>
          <h1>{text.detailTitle}</h1>
        </div>
        <div className="detail-profile">
          {profile && (
            <span className="detail-avatar" aria-hidden="true">
              {profile.display_name.trim().slice(0, 1).toUpperCase()}
            </span>
          )}
          <div>
            <label htmlFor="progress-profile">{text.profile}</label>
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
      </header>
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
            className="secondary"
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
          <dl className="detail-metrics">
            {metrics.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          {!data.total_reviews && (
            <p className="detail-empty">{text.progressEmpty}</p>
          )}
          <div className="detail-overview">
            <ResponseDistribution text={text} counts={data.counts} />
            {data.recent_session && (
              <section
                className="detail-surface"
                aria-label={text.detailRecent}
              >
                <h2>{text.detailRecent}</h2>
                <dl className="detail-session-metrics">
                  <div>
                    <dt>{text.reviewed}</dt>
                    <dd>{data.recent_session.total_reviews}</dd>
                  </div>
                  <div>
                    <dt>{text.remembered}</dt>
                    <dd>
                      {data.recent_session.total_reviews > 0
                        ? `${Math.round(data.recent_session.remembered)}%`
                        : "—"}
                    </dd>
                  </div>
                </dl>
                <p className="detail-muted">{text.detailRecallHint}</p>
              </section>
            )}
          </div>
          <div className="detail-breakdowns">
            <Breakdown
              title={text.detailDirectionBreakdown}
              columnLabel={text.detailDirectionColumn}
              rows={data.directions}
              text={text}
              label={(key) => directionLabel(text, key)}
            />
            <Breakdown
              title={text.detailUnitBreakdown}
              columnLabel={text.unit}
              rows={data.units}
              text={text}
              label={(key, row) =>
                key ? `${key} · ${row.title}` : text.noUnit
              }
            />
            <Breakdown
              title={text.detailTypeBreakdown}
              columnLabel={text.setupWordTypes}
              rows={data.word_types}
              text={text}
              label={(key) => text[key] || text.unspecified}
            />
          </div>
          <details className="detail-calculation">
            <summary>{text.detailHowCalculated}</summary>
            <p>{text.historyHint}</p>
          </details>
          <section
            className="detail-surface detail-practice-cards"
            aria-label={text.detailCardsToReview}
          >
            <h2>{text.detailCardsToReview}</h2>
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
              <p className="detail-muted">{text.noDifficultEntries}</p>
            )}
          </section>
        </>
      )}
    </section>
  );
}

function ResponseDistribution({ text, counts }) {
  const ratings = ["again", "hard", "easy"];
  const total = ratings.reduce((sum, rating) => sum + counts[rating], 0);
  const description = `${text.detailOverallResponses} ${ratings.map((rating) => `${text[rating]}: ${counts[rating]}`).join(", ")}`;
  return (
    <section className="detail-surface" aria-label={text.detailResponses}>
      <h2>{text.detailResponses}</h2>
      <p className="detail-muted">{text.detailOverallResponses}</p>
      <div className="detail-response-bar" role="img" aria-label={description}>
        {ratings.map((rating) => (
          <span
            key={rating}
            className={`response-${rating}`}
            style={{
              width: `${total > 0 ? (counts[rating] / total) * 100 : 0}%`,
            }}
          />
        ))}
      </div>
      <dl className="detail-response-legend">
        {ratings.map((rating) => (
          <div key={rating}>
            <dt>
              <span
                className={`response-dot response-${rating}`}
                aria-hidden="true"
              />
              {text[rating]}
            </dt>
            <dd>{counts[rating]}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Breakdown({ title, columnLabel, rows, text, label }) {
  const showDifficult = rows.some((row) => row.difficult_entries !== undefined);
  return (
    <section className="detail-surface detail-table-section" aria-label={title}>
      <h2>{title}</h2>
      <div
        className="detail-table-scroll"
        tabIndex={0}
        role="group"
        aria-label={title}
      >
        <table>
          <caption className="sr-only">{title}</caption>
          <thead>
            <tr>
              <th scope="col">{columnLabel}</th>
              <th scope="col">{text.detailReviewsColumn}</th>
              <th scope="col">{text.detailPractisedColumn}</th>
              {showDifficult && (
                <th scope="col">{text.detailDifficultColumn}</th>
              )}
              {["again", "hard", "easy"].map((rating) => (
                <th scope="col" key={rating}>
                  {text[rating]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${row.key}-${index}`}>
                <th scope="row">{label(row.key, row)}</th>
                <td>{row.total_reviews}</td>
                <td>{row.entries_practised}</td>
                {showDifficult && <td>{row.difficult_entries ?? "—"}</td>}
                {["again", "hard", "easy"].map((rating) => (
                  <td key={rating}>{row.counts[rating]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && <p className="detail-muted">{text.detailNoActivity}</p>}
    </section>
  );
}

function DifficultEntries({ text, profileId, direction, count, onLocked }) {
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
    <div className="detail-difficult-group">
      <div className="detail-difficult-heading">
        <h3>
          {directionLabel(text, direction)}{" "}
          <span className="detail-count-badge">{count}</span>
        </h3>

        <Link
          to={`/practice?mode=difficult&direction=${encodeURIComponent(
            direction,
          )}`}
        >
          {text.practiseDifficult}
          <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </div>

      {entries.isPending && <p role="status">{text.loading}</p>}

      {entries.isError && (
        <div>
          <p role="alert">
            {text.errors[entries.error.code] || text.errors.request_failed}
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
