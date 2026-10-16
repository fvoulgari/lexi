import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { Link } from "react-router-dom";
import PropTypes from "prop-types";
import { request } from "./api.js";

export default function EnablePracticeUnit({ unitId, text, csrf, onLocked }) {
  const client = useQueryClient();
  const profiles = useQuery({
    queryKey: ["profiles"],
    queryFn: () => request("/api/profiles"),
    retry: false,
  });
  let remembered = "";
  try {
    remembered = localStorage.getItem("notebook-profile") || "";
  } catch {
    /* Device storage is optional. */
  }
  const profile = profiles.data?.find((item) => item.id === remembered);
  const enable = useMutation({
    mutationFn: () =>
      request(`/api/profiles/${profile.id}/practice-units/${unitId}`, {
        method: "PUT",
        headers: { "X-CSRF-Token": csrf },
      }),
    onSuccess: (result) => {
      client.setQueryData(["profiles"], (current) =>
        current.map((item) => (item.id === result.id ? result : item)),
      );
      for (const key of ["progress", "difficult-entries", "progress-difficult"])
        client.invalidateQueries({ queryKey: [key] });
    },
  });
  useEffect(() => {
    if (profiles.error?.status === 401 || enable.error?.status === 401)
      onLocked();
  }, [profiles.error, enable.error, onLocked]);
  if (profiles.isPending) return <p role="status">{text.loading}</p>;
  if (profiles.isError)
    return (
      <div>
        <p className="error" role="alert">
          {text.errors[profiles.error.code] || text.errors.request_failed}
        </p>
        <button type="button" onClick={() => profiles.refetch()}>
          {text.retry}
        </button>
      </div>
    );
  if (!profile)
    return (
      <Link to="/settings#practice-units">{text.choosePracticeProfile}</Link>
    );
  if (profile.practice_unit_ids?.includes(unitId))
    return (
      <p className="settings-helper" role="status">
        {text.unitEnabled.replace("{name}", profile.display_name)}
      </p>
    );
  return (
    <div className="enable-practice-unit">
      <button
        type="button"
        className="secondary"
        disabled={enable.isPending}
        onClick={() => enable.mutate()}
      >
        {enable.isPending
          ? text.saving
          : text.enablePracticeUnit.replace("{name}", profile.display_name)}
      </button>
      {enable.isError && (
        <p className="error" role="alert">
          {text.errors[enable.error.code] || text.errors.request_failed}
        </p>
      )}
    </div>
  );
}
EnablePracticeUnit.propTypes = {
  unitId: PropTypes.string.isRequired,
  text: PropTypes.object.isRequired,
  csrf: PropTypes.string.isRequired,
  onLocked: PropTypes.func.isRequired,
};
