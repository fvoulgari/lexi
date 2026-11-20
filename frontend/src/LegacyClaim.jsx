import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { request } from "./api.js";
export { captureLegacyClaim } from "./claim-capture.js";

export function claimMessage(text, code) {
  return (
    text[
      {
        claim_expired: "claimExpired",
        claim_revoked: "claimRevoked",
        claim_used: "claimUsed",
        profile_claimed: "profileClaimed",
        claim_conflict: "claimConflict",
      }[code]
    ] || text.claimInvalid
  );
}
export default function LegacyClaim({ text, csrf, onSessionChanged }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const preview = useQuery({
    queryKey: ["claim-preview"],
    queryFn: () => request("/api/legacy-claims/preview"),
    retry: false,
  });
  const claim = useMutation({
    mutationFn: () =>
      request("/api/legacy-claims/redeem", {
        method: "POST",
        headers: { "X-CSRF-Token": csrf },
        body: "{}",
      }),
    onSuccess: async () => {
      client.removeQueries({
        predicate: (query) =>
          !["session", "claim-preview", "claim-capture"].includes(
            query.queryKey[0],
          ),
      });
      navigate("/", { replace: true, state: { claimCompleted: true } });
      await onSessionChanged?.();
    },
  });
  const [cancelled, setCancelled] = useState(false);
  const cancel = useMutation({
    mutationFn: () =>
      request("/api/legacy-claims/capture", {
        method: "DELETE",
        headers: { "X-CSRF-Token": csrf },
      }),
    onSuccess: () => setCancelled(true),
  });
  if (cancelled)
    return (
      <p className="status">
        <Link to="/">{text.home}</Link>
      </p>
    );
  return (
    <section className="settings-page">
      <h1>{text.claimTitle}</h1>
      <div className="settings-card">
        {preview.isPending ? (
          <p role="status">{text.loading}</p>
        ) : preview.isError ? (
          <p role="alert">{claimMessage(text, preview.error.code)}</p>
        ) : claim.isSuccess ? (
          <p role="status">{text.claimDone}</p>
        ) : (
          <>
            <h2>{preview.data.profile.display_name}</h2>
            <p>
              {text.reviewCount}: {preview.data.profile.review_count} ·{" "}
              {text.sessionCount}: {preview.data.profile.session_count}
            </p>
            <p>{text.claimHint}</p>
            {claim.isError && (
              <p role="alert" className="error">
                {claimMessage(text, claim.error.code)}
              </p>
            )}
            <button
              className="primary"
              disabled={
                claim.isPending || claim.error?.code === "claim_conflict"
              }
              onClick={() => claim.mutate()}
            >
              {claim.isPending ? text.saving : text.claimConfirm}
            </button>
          </>
        )}
        <button
          className="secondary"
          disabled={claim.isPending || cancel.isPending}
          onClick={() => cancel.mutate()}
        >
          {text.cancel}
        </button>
        {cancel.isError && <p role="alert">{text.actionFailed}</p>}
      </div>
    </section>
  );
}

export function LegacyRequest({ text, csrf }) {
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const send = useMutation({
    mutationFn: () =>
      request("/api/legacy-requests", {
        method: "POST",
        headers: { "X-CSRF-Token": csrf },
        body: JSON.stringify({
          profile_name: name.trim(),
          note: note.trim() || undefined,
        }),
      }),
  });
  return (
    <section className="settings-card">
      <h2>{text.legacyRequest}</h2>
      <p>{text.legacyRequestHint}</p>
      {send.isSuccess ? (
        <p role="status">{text.requestSent}</p>
      ) : (
        <form
          className="profile-form"
          onSubmit={(event) => {
            event.preventDefault();
            send.mutate();
          }}
        >
          <label>
            {text.legacyName}
            <input
              required
              maxLength={80}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            {text.legacyNote}
            <textarea
              maxLength={1000}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          <button className="secondary" disabled={send.isPending}>
            {text.legacySubmit}
          </button>
          {send.isError && (
            <p role="alert" className="error">
              {text.actionFailed}
            </p>
          )}
        </form>
      )}
    </section>
  );
}
