import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { request } from "./api.js";

export default function Admin({ text, csrf, onSessionChanged }) {
  const client = useQueryClient();
  const accounts = useQuery({
    queryKey: ["admin-accounts"],
    queryFn: () => request("/api/admin/accounts"),
  });
  const profiles = useQuery({
    queryKey: ["admin-legacy"],
    queryFn: () => request("/api/admin/legacy-profiles"),
  });
  const cases = useQuery({
    queryKey: ["admin-resolution-cases"],
    queryFn: () => request("/api/admin/legacy-resolution-cases"),
  });
  const history = useQuery({
    queryKey: ["admin-claim-history"],
    queryFn: () => request("/api/admin/claim-links"),
  });
  const requests = useQuery({
    queryKey: ["admin-requests"],
    queryFn: () => request("/api/admin/legacy-requests"),
  });
  const action = useMutation({
    mutationFn: ({ path, body, method = "PATCH" }) =>
      request(path, {
        method,
        headers: { "X-CSRF-Token": csrf },
        body: body ? JSON.stringify(body) : undefined,
      }),
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: ["admin-accounts"] }),
        client.invalidateQueries({ queryKey: ["admin-legacy"] }),
        client.invalidateQueries({ queryKey: ["admin-requests"] }),
        onSessionChanged?.(),
      ]),
  });
  return (
    <section className="settings-page">
      <h1>{text.admin}</h1>
      {action.isError && (
        <p role="alert" className="error">
          {text.actionFailed}
        </p>
      )}
      <section className="settings-card">
        <h2>{text.adminAccounts}</h2>
        <QueryStatus query={accounts} text={text} />
        {accounts.data?.map((account) => (
          <div key={account.id} className="admin-account">
            <h3>{account.display_name || account.id}</h3>
            <code>{account.id}</code>
            <label>
              {text.role}
              <select
                disabled={action.isPending}
                value={account.role}
                onChange={(event) =>
                  action.mutate({
                    path: `/api/admin/accounts/${account.id}`,
                    body: { role: event.target.value },
                  })
                }
              >
                <option value="learner">{text.learner}</option>
                <option value="editor">{text.editor}</option>
                <option value="admin">{text.adminRole}</option>
              </select>
            </label>
            <label className="check-option">
              <input
                type="checkbox"
                checked={account.legacy_access}
                disabled={action.isPending}
                onChange={(event) =>
                  action.mutate({
                    path: `/api/admin/accounts/${account.id}`,
                    body: { legacy_access: event.target.checked },
                  })
                }
              />
              {text.legacyAccess}
            </label>
          </div>
        ))}
      </section>
      <section className="settings-card">
        <h2>{text.adminLegacy}</h2>
        <QueryStatus query={profiles} text={text} />
        {profiles.data?.map((profile) => (
          <ClaimLink
            key={profile.id}
            profile={profile}
            csrf={csrf}
            text={text}
          />
        ))}
      </section>
      <section className="settings-card">
        <h2>{text.resolutionCases}</h2>
        <p>{text.resolutionHint}</p>
        <QueryStatus query={cases} text={text} />
        {cases.data?.map((item) => (
          <article key={item.id} className="admin-account">
            <p>
              <code>{item.id}</code> ·{" "}
              {text.caseStatuses[item.status] || text.caseStatuses.pending}
            </p>
            <p>
              {text.currentProfile}: <code>{item.current.profile_id}</code>
            </p>
            <p>
              {text.previousProfile}: <code>{item.legacy.profile_id}</code>
            </p>
            <div className="admin-report">
              <table>
                <thead>
                  <tr>
                    <th scope="col">{text.reportMetric}</th>
                    <th scope="col">{text.currentProfile}</th>
                    <th scope="col">{text.previousProfile}</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    "reviews",
                    "sessions",
                    "progress_records",
                    "private_cards",
                    "private_units",
                    "private_tags",
                    "collections",
                  ].map((metric) => (
                    <tr key={metric}>
                      <th scope="row">{text.reportMetrics[metric]}</th>
                      <td>{item.current[metric] ?? "—"}</td>
                      <td>{item.legacy[metric] ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        ))}
      </section>
      <section className="settings-card">
        <h2>{text.claimHistory}</h2>
        <QueryStatus query={history} text={text} />
        {history.data?.map((item, index) => (
          <article
            key={`${item.profile_id}-${index}`}
            className="admin-account"
          >
            <h3>{item.display_name}</h3>
            <p>{text.claimStatuses[item.status] || text.claimInvalid}</p>
            <time dateTime={item.expires_at}>
              {text.claimExpires}: {new Date(item.expires_at).toLocaleString()}
            </time>
          </article>
        ))}
      </section>
      <section className="settings-card">
        <h2>{text.adminRequests}</h2>
        <QueryStatus query={requests} text={text} />
        {requests.data?.map((item) => (
          <LegacyRequestRow
            key={item.id}
            item={item}
            profiles={profiles.data || []}
            text={text}
            csrf={csrf}
          />
        ))}
      </section>
    </section>
  );
}
function QueryStatus({ query, text }) {
  if (query.isPending) return <p role="status">{text.loading}</p>;
  if (query.isError)
    return (
      <>
        <p role="alert">{text.actionFailed}</p>
        <button onClick={() => query.refetch()}>{text.retry}</button>
      </>
    );
  if (!query.data?.length) return <p>{text.noResults}</p>;
  return null;
}
function ClaimLink({ profile, csrf, text }) {
  const client = useQueryClient();
  const [acknowledge, setAcknowledge] = useState(false);
  const [link, setLink] = useState(null);
  const action = useMutation({
    mutationFn: (method) =>
      request(`/api/admin/legacy-profiles/${profile.id}/claim-links`, {
        method,
        headers: { "X-CSRF-Token": csrf },
        body:
          method === "POST" ? JSON.stringify({ acknowledge: true }) : undefined,
      }),
    onSuccess: (result, method) => {
      setLink(method === "POST" ? result : null);
      setAcknowledge(false);
      void client.invalidateQueries({ queryKey: ["admin-claim-history"] });
    },
  });
  return (
    <article className="admin-account">
      <h3>{profile.display_name}</h3>
      <p>
        {text.reviewCount}: {profile.review_count} · {text.sessionCount}:{" "}
        {profile.session_count}
      </p>
      <p>{text.claimWarning}</p>
      <label className="check-option">
        <input
          type="checkbox"
          checked={acknowledge}
          onChange={(event) => setAcknowledge(event.target.checked)}
        />
        {text.claimAcknowledge}
      </label>
      <div className="form-actions">
        <button
          className="primary"
          disabled={!acknowledge || action.isPending}
          onClick={() => action.mutate("POST")}
        >
          {text.generateClaim}
        </button>
        <button
          className="secondary"
          disabled={action.isPending}
          onClick={() => action.mutate("DELETE")}
        >
          {text.revokeClaim}
        </button>
      </div>
      {link && (
        <label>
          {text.claimLink}
          <input
            aria-label={text.claimLink}
            readOnly
            value={link.claim_url}
            onFocus={(event) => event.target.select()}
          />
          <small>{new Date(link.expires_at).toLocaleString()}</small>
        </label>
      )}
      {action.isError && (
        <p role="alert" className="error">
          {text.actionFailed}
        </p>
      )}
    </article>
  );
}

function LegacyRequestRow({ item, profiles, text, csrf }) {
  const client = useQueryClient();
  const [profileId, setProfileId] = useState("");
  const [acknowledge, setAcknowledge] = useState(false);
  const [link, setLink] = useState(null);
  const action = useMutation({
    mutationFn: (status) =>
      request(`/api/admin/legacy-requests/${item.id}`, {
        method: "PATCH",
        headers: { "X-CSRF-Token": csrf },
        body: JSON.stringify({
          status,
          ...(status === "resolved" ? { profile_id: profileId } : {}),
        }),
      }),
    onSuccess: async (result) => {
      if (result?.claim_url) setLink(result);
      await client.invalidateQueries({ queryKey: ["admin-requests"] });
      await client.invalidateQueries({ queryKey: ["admin-claim-history"] });
    },
  });
  return (
    <article className="admin-account">
      <h3>{item.profile_name}</h3>
      <p>{item.note}</p>
      <p>
        <code>{item.account_id}</code> ·{" "}
        {text.requestStatuses[item.status] || text.requestStatuses.pending}
      </p>
      {item.status === "pending" && (
        <>
          <label>
            {text.profile}
            <select
              value={profileId}
              onChange={(event) => setProfileId(event.target.value)}
            >
              <option value="">{text.chooseProfile}</option>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.display_name}
                </option>
              ))}
            </select>
          </label>
          <p>{text.claimWarning}</p>
          <label className="check-option">
            <input
              type="checkbox"
              checked={acknowledge}
              onChange={(event) => setAcknowledge(event.target.checked)}
            />
            {text.claimAcknowledge}
          </label>
          <div className="form-actions">
            <button
              className="secondary"
              disabled={action.isPending}
              onClick={() => action.mutate("rejected")}
            >
              {text.reject}
            </button>
            <button
              className="primary"
              disabled={action.isPending || !profileId || !acknowledge}
              onClick={() => action.mutate("resolved")}
            >
              {text.resolve}
            </button>
          </div>
        </>
      )}
      {link && (
        <label>
          {text.claimLink}
          <input
            aria-label={text.claimLink}
            readOnly
            value={link.claim_url}
            onFocus={(event) => event.target.select()}
          />
        </label>
      )}
      {action.isError && (
        <p role="alert" className="error">
          {text.actionFailed}
        </p>
      )}
    </article>
  );
}
