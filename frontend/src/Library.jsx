import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, ChevronLeft, ChevronRight, Leaf } from "lucide-react";
import PropTypes from "prop-types";
import { request } from "./api.js";

export default function Library({ text, onLocked }) {
  const [page, setPage] = useState(1);
  const library = useQuery({
    queryKey: ["vocabulary", page],
    queryFn: () => request(`/api/vocabulary?page=${page}&page_size=6`),
  });
  useEffect(() => {
    if (library.error?.status === 401) onLocked();
  }, [library.error, onLocked]);
  const pages = Math.max(1, Math.ceil((library.data?.total || 0) / 6));

  return (
    <section className="library-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">
            <Leaf size={15} aria-hidden="true" />
            {text.vocabulary}
          </span>
          <h1>{text.libraryTitle}</h1>
          <p>{text.libraryIntro}</p>
        </div>
        <span className="library-count">
          {library.data?.total ?? "—"}{" "}
          <small>{library.data?.total === 1 ? text.entry : text.entries}</small>
        </span>
      </div>
      <div className="library-caption">
        <span>
          {text.italian} <span aria-hidden="true">↔</span> {text.greek}
        </span>
        <span>{text.libraryNote}</span>
      </div>
      {library.isPending ? (
        <p className="status" role="status">
          {text.loading}
        </p>
      ) : library.isError ? (
        <div className="status">
          <p role="alert">
            {text.errors[library.error.code] || text.errors.request_failed}
          </p>
          <button className="primary" onClick={() => library.refetch()}>
            {text.retry}
          </button>
        </div>
      ) : library.data.items.length === 0 ? (
        <div className="empty-state">
          <BookOpen size={32} aria-hidden="true" />
          <h2>{text.empty}</h2>
          <p>{text.emptyText}</p>
        </div>
      ) : (
        <>
          <ul className="entry-grid">
            {library.data.items.map((entry) => (
              <li
                className={`entry-card type-${entry.word_type}`}
                key={entry.id}
              >
                <div className="entry-meta">
                  <span className="type-badge">
                    {text[entry.word_type] || text.other}
                  </span>
                  <span>
                    {entry.unit
                      ? `${text.unit} ${entry.unit.code}`
                      : text.noUnit}
                  </span>
                </div>
                <h2 lang="it">{entry.italian}</h2>
                <p lang="el">{entry.greek}</p>
                {entry.unit && (
                  <div className="entry-footer">
                    <span className="entry-dot" aria-hidden="true" />
                    {entry.unit.title}
                  </div>
                )}
              </li>
            ))}
          </ul>
          <nav
            className="pagination"
            aria-label={`${text.library} — ${text.page}`}
          >
            <button
              aria-label={text.previous}
              disabled={page === 1}
              onClick={() => setPage((value) => value - 1)}
            >
              <ChevronLeft size={18} aria-hidden="true" />
              <span>{text.previous}</span>
            </button>
            <p aria-live="polite">
              {text.page} {page} {text.of} {pages}
            </p>
            <button
              aria-label={text.next}
              disabled={page >= pages}
              onClick={() => setPage((value) => value + 1)}
            >
              <span>{text.next}</span>
              <ChevronRight size={18} aria-hidden="true" />
            </button>
          </nav>
        </>
      )}
    </section>
  );
}

Library.propTypes = {
  text: PropTypes.object.isRequired,
  onLocked: PropTypes.func.isRequired,
};
