import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { request } from "./api.js";

export default function Admin({ text, csrf, onSessionChanged }) {
  const client = useQueryClient();
  const accounts = useQuery({
    queryKey: ["admin-accounts"],
    queryFn: () => request("/api/admin/accounts"),
  });
  const action = useMutation({
    mutationFn: ({ id, role }) =>
      request(`/api/admin/accounts/${id}`, {
        method: "PATCH",
        headers: { "X-CSRF-Token": csrf },
        body: JSON.stringify({ role }),
      }),
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: ["admin-accounts"] }),
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
        {accounts.isPending && <p role="status">{text.loading}</p>}
        {accounts.isError && <p role="alert">{text.actionFailed}</p>}
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
                  action.mutate({ id: account.id, role: event.target.value })
                }
              >
                <option value="learner">{text.learner}</option>
                <option value="editor">{text.editor}</option>
                <option value="admin">{text.adminRole}</option>
              </select>
            </label>
          </div>
        ))}
      </section>
    </section>
  );
}
