import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import {
  Shuffle,
  ListFilter,
  RotateCcw,
  Layers,
  ArrowRight,
  ChevronDown,
} from "lucide-react";
import PropTypes from "prop-types";
import { request } from "./api.js";
import Choices from "./Choices.jsx";
import PairPicker from "./PairPicker.jsx";
import PracticeCardView from "./PracticeCardView.jsx";
import { cardLanguageIds, practiceSides } from "./card-sides.js";
import {
  directionLabel,
  isRegisteredDirection,
  languageLabel,
  languageTextProps,
  pairKey,
  parsePairKey,
  safeDirectionKey,
  safeDirectionLanguages,
  safePairDirections,
} from "./languages.js";
import {
  firstDirectionForLanguages,
  practicePairForDirection,
} from "./practice-links.js";

import {
  collectionCopy,
  collectionLabel,
  isMyCollection,
} from "./collection-copy.js";

const PRACTICE_SELECTION_KEY = "lexi-practice-selection";
const LEGACY_PAIR = ["el", "it"];

function storedPracticeSelection() {
  try {
    const value = JSON.parse(localStorage.getItem(PRACTICE_SELECTION_KEY) || "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function rememberPracticeSelection(pair, direction) {
  if (!pair || !direction) return;
  try {
    localStorage.setItem(
      PRACTICE_SELECTION_KEY,
      JSON.stringify({ pair, direction }),
    );
  } catch {
    // A private browser can reject storage; the current selection still works.
  }
}

function collectionPair(collection) {
  if (!collection) return null;
  // Older collections predate pair metadata and describe the original course.
  const languages =
    collection.source_language && collection.target_language
      ? [collection.source_language, collection.target_language]
      : LEGACY_PAIR;
  const key = pairKey(...languages);
  return parsePairKey(key) ? key : null;
}

function directionForPair(pair, candidates = []) {
  const languages = parsePairKey(pair);
  if (!languages) return null;
  const directions = safePairDirections(...languages);
  return (
    candidates.find(
      (candidate) =>
        isRegisteredDirection(candidate) && directions.includes(candidate),
    ) || directions[0] || null
  );
}

/** Declared Base→Learning direction for a collection, when registered. */
function collectionDirection(collection) {
  const direction = safeDirectionKey(
    collection?.source_language,
    collection?.target_language,
  );
  return isRegisteredDirection(direction) ? direction : null;
}

/** Resolve one pair/direction without ever inventing a Base/Learning order. */
function initialPracticeSelection(searchParams, profile, collections = []) {
  const stored = storedPracticeSelection();
  const requestedDirection = searchParams.get("direction");
  if (isRegisteredDirection(requestedDirection)) {
    return {
      pair: practicePairForDirection(requestedDirection),
      direction: requestedDirection,
      explicit: true,
    };
  }
  const requestedPair = parsePairKey(searchParams.get("pair"));
  if (requestedPair) {
    const pair = pairKey(...requestedPair);
    return {
      pair,
      direction: directionForPair(pair, [
        profile?.preferred_direction,
        stored.direction,
      ]),
      explicit: true,
    };
  }
  const requestedCollection = searchParams
    .get("collection")
    ?.split(",")
    .find(Boolean);
  const requested = collections.find(
    (collection) => collection.id === requestedCollection,
  );
  const requestedCollectionPair = collectionPair(requested);
  if (requestedCollectionPair) {
    return {
      pair: requestedCollectionPair,
      direction: directionForPair(requestedCollectionPair, [
        profile?.preferred_direction,
        collectionDirection(requested),
        stored.direction,
      ]),
      explicit: true,
    };
  }
  const storedPair = parsePairKey(stored.pair);
  if (
    storedPair &&
    isRegisteredDirection(stored.direction) &&
    practicePairForDirection(stored.direction) === pairKey(...storedPair)
  ) {
    return {
      pair: pairKey(...storedPair),
      direction: stored.direction,
      explicit: true,
    };
  }
  const linked = collections.find((collection) => collectionPair(collection));
  const linkedPair = collectionPair(linked);
  if (linkedPair) {
    return {
      pair: linkedPair,
      direction: directionForPair(linkedPair, [
        profile?.preferred_direction,
        collectionDirection(linked),
        stored.direction,
      ]),
      explicit: false,
    };
  }
  const preferred = profile?.preferred_direction;
  if (isRegisteredDirection(preferred)) {
    return {
      pair: practicePairForDirection(preferred),
      direction: preferred,
      explicit: true,
    };
  }
  return {
    pair: pairKey(...LEGACY_PAIR),
    direction: firstDirectionForLanguages(...LEGACY_PAIR),
    explicit: false,
  };
}

export default function Practice({ text, csrf, onLocked, language = "en" }) {
  const profiles = useQuery({
    queryKey: ["profiles"],
    queryFn: () => request("/api/profiles"),
    retry: false,
  });
  const [session, setSession] = useState(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [unavailableId, setUnavailableId] = useState(null);
  const starting = useRef(false);
  const profile =
    profiles.data?.[0]?.id !== unavailableId ? profiles.data?.[0] : undefined;
  const profileId = profile?.id;

  function profileUnavailable() {
    setUnavailableId(profileId);
    setSession(null);
    setError(null);
    void profiles.refetch();
  }
  useEffect(() => {
    if (profiles.error?.status === 401) onLocked();
  }, [profiles.error, onLocked]);
  async function post(path, body) {
    // The server independently checks account and profile on every mutation.
    try {
      return await request(path, {
        method: "POST",
        headers: { "X-CSRF-Token": csrf },
        body: JSON.stringify(body),
      });
    } catch (error) {
      if (error.code === "profile_not_found") profileUnavailable();
      throw error;
    }
  }
  function showError(error) {
    if (error.status === 401) onLocked();
    else if (error.code !== "profile_not_found") setError(error);
  }
  async function start(direction, size, type, filters) {
    if (!profile || starting.current) return;
    starting.current = true;
    setPending(true);
    setError(null);
    try {
      const body = {
        profile_id: profile.id,
        direction,
        size,
      };
      if (type === "category") Object.assign(body, filters);
      else if (filters.collection_ids?.length)
        body.collection_ids = filters.collection_ids;
      if (["difficult", "mixed"].includes(type)) body.mode = type;
      const result = await post("/api/sessions", body);
      setSession({ ...result, profile_id: profile.id, direction, type });
    } catch (error) {
      showError(error);
    } finally {
      starting.current = false;
      setPending(false);
    }
  }
  if (profiles.isPending) return <p role="status">{text.loadingCards}</p>;
  if (profiles.isError)
    return (
      <div className="status">
        <p role="alert">
          {text.errors[profiles.error.code] || text.errors.request_failed}
        </p>
        <button onClick={() => profiles.refetch()}>{text.retry}</button>
      </div>
    );
  if (!profile)
    return (
      <section className="status">
        <h1>{text.practice}</h1>
        <p role="alert">{text.requestProfile}</p>
        <button onClick={() => profiles.refetch()}>{text.retry}</button>
      </section>
    );
  if (session && session.profile_id === profile.id)
    return (
      <ActivePractice
        text={text}
        session={session}
        profile={profile}
        post={post}
        onProfileUnavailable={profileUnavailable}
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
            <span>{profile.display_name}</span>
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
          language={language}
          profile={profile}
          pending={pending}
          onStart={start}
          onLocked={onLocked}
          error={error}
          onProfileUnavailable={profileUnavailable}
        />
      </div>
    </section>
  );
}
function Direction({ text, value, languages, onChange, disabled = false }) {
  const options = safePairDirections(...languages);
  const choices = options.length
    ? options
    : isRegisteredDirection(value)
      ? [value]
      : [];
  return (
    <>
      <label htmlFor="practice-direction">{text.direction}</label>
      <select
        id="practice-direction"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        {choices.map((key) => (
          <option key={key} value={key}>
            {directionLabel(key, languageLabel)}
          </option>
        ))}
      </select>
    </>
  );
}
function Setup({
  text,
  language,
  profile,
  pending,
  onStart,
  onLocked,
  error,
  onProfileUnavailable,
}) {
  const [searchParams] = useSearchParams();
  const initial = useMemo(
    () => initialPracticeSelection(searchParams, profile),
    [searchParams, profile],
  );
  const [pair, setPair] = useState(initial.pair);
  const [direction, setDirection] = useState(
    initial.direction || firstDirectionForLanguages(...LEGACY_PAIR),
  );
  const [selectionLocked, setSelectionLocked] = useState(initial.explicit);
  const [type, setType] = useState(
    searchParams.get("mode") === "difficult" ? "difficult" : "random",
  );
  const linkedCollectionIds = useMemo(
    () => (searchParams.get("collection") || "").split(",").filter(Boolean),
    [searchParams],
  );
  const emptyFilters = {
    collection_ids: linkedCollectionIds,
    word_types: [],
  };
  const [filters, setFilters] = useState(emptyFilters);

  const availablePairs = useQuery({
    queryKey: ["practice-available-pairs"],
    queryFn: () => request("/api/practice/available-pairs"),
    retry: false,
  });
  const collections = useQuery({
    queryKey: ["collections"],
    queryFn: () => request("/api/collections"),
    refetchOnWindowFocus: "always",
  });
  useEffect(() => {
    if (availablePairs.error?.status === 401 || collections.error?.status === 401)
      onLocked();
  }, [availablePairs.error, collections.error, onLocked]);

  const pairs = useMemo(
    () =>
      (availablePairs.data?.pairs || []).filter(
        (candidate) =>
          parsePairKey(candidate.key) &&
          candidate.directions?.length === 2 &&
          candidate.directions.every(isRegisteredDirection),
      ),
    [availablePairs.data],
  );
  const selectedLanguages = parsePairKey(pair) || LEGACY_PAIR;
  const registeredDirections = safePairDirections(...selectedLanguages);
  const selectedPair = pairs.find((candidate) => candidate.key === pair);
  const availableCollections = (collections.data || []).filter(
    (collection) => isMyCollection(collection) && collectionPair(collection) === pair,
  );
  const selectedCollections = filters.collection_ids.filter((id) =>
    availableCollections.some((collection) => collection.id === id),
  );
  const collectionSelectionUnavailable =
    (type === "category" || linkedCollectionIds.length > 0) &&
    filters.collection_ids.length > 0 &&
    selectedCollections.length === 0;
  const filterError = type === "category" && collections.isError;
  const filterLoading = type === "category" && collections.isPending;
  const changeFilter = (key, value) =>
    setFilters((current) => ({ ...current, [key]: value }));

  function selectPair(nextPair) {
    if (!parsePairKey(nextPair)) return;
    const nextDirection =
      directionForPair(nextPair, [direction]) ||
      firstDirectionForLanguages(...parsePairKey(nextPair));
    setPair(nextPair);
    setDirection(nextDirection);
    setSelectionLocked(true);
    rememberPracticeSelection(nextPair, nextDirection);
    setFilters((current) => ({
      ...current,
      collection_ids: current.collection_ids.filter((id) =>
        (collections.data || []).some(
          (collection) => collection.id === id && collectionPair(collection) === nextPair,
        ),
      ),
    }));
  }

  function selectDirection(nextDirection) {
    if (!isRegisteredDirection(nextDirection)) return;
    const nextPair = practicePairForDirection(nextDirection);
    setDirection(nextDirection);
    if (nextPair) setPair(nextPair);
    setSelectionLocked(true);
    rememberPracticeSelection(nextPair || pair, nextDirection);
    setFilters((current) => ({
      ...current,
      collection_ids: current.collection_ids.filter((id) =>
        (collections.data || []).some(
          (collection) => collection.id === id && collectionPair(collection) === nextPair,
        ),
      ),
    }));
  }

  // An explicit URL or stored choice wins. Only an unresolved selection may be
  // oriented by a linked or first accessible collection once those arrive.
  useEffect(() => {
    if (selectionLocked || !collections.data) return;
    const requested = collections.data.find(
      (collection) => collection.id === linkedCollectionIds[0],
    );
    const linked =
      requested || collections.data.find((collection) => collectionPair(collection));
    const nextPair = collectionPair(linked);
    if (!nextPair) return;
    const nextDirection =
      directionForPair(nextPair, [
        profile?.preferred_direction,
        collectionDirection(linked),
        storedPracticeSelection().direction,
        direction,
      ]) || firstDirectionForLanguages(...parsePairKey(nextPair));
    setPair(nextPair);
    setDirection(nextDirection);
    rememberPracticeSelection(nextPair, nextDirection);
    if (requested || linkedCollectionIds.length) setSelectionLocked(true);
  }, [
    collections.data,
    direction,
    linkedCollectionIds,
    profile?.preferred_direction,
    selectionLocked,
  ]);

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
    else if (difficult.error?.status === 404) onProfileUnavailable();
  }, [difficult.error, onLocked, onProfileUnavailable]);
  const [size, setSize] = useState(
    String(profile ? (profile.default_session_size ?? "all") : 25),
  );
  const noEligiblePairs = availablePairs.isSuccess && pairs.length === 0;
  const selectedPairUnavailable =
    availablePairs.isSuccess && pairs.length > 0 && !selectedPair;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (collectionSelectionUnavailable) return;
        rememberPracticeSelection(pair, direction);
        onStart(direction, size === "all" ? null : Number(size), type, {
          ...filters,
          collection_ids: selectedCollections,
        });
      }}
    >
      <div className="setup-pair">
        <PairPicker
          pairs={pairs}
          value={pair}
          onChange={selectPair}
          label={text.setupLanguagePair}
          emptyMessage={text.setupNoPairs}
          errorMessage={text.setupPairsError}
          loadingMessage={text.setupLoadingPairs}
          clearLabel={text.setupClearSearch}
          recentHeading={text.setupRecentPairs}
          popularHeading={text.setupPopularPairs}
          loading={availablePairs.isPending}
          error={availablePairs.isError}
          empty={availablePairs.isSuccess && pairs.length === 0}
          disabled={pending}
        />
        {(noEligiblePairs || selectedPairUnavailable) && (
          <p role="status" className="setup-pair-hint">
            {text.setupNoPairs}
          </p>
        )}
      </div>
      <SetupOptions
        legend={text.setupDirection}
        name="setup-direction"
        value={direction}
        onChange={selectDirection}
        disabled={pending}
        className="setup-direction-options"
        options={registeredDirections.map((key) => ({
          value: key,
          label: directionLabel(key, languageLabel),
        }))}
      />
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
          {filterLoading && <p role="status">{text.loadingCards}</p>}
          {filterError && (
            <div>
              <p role="alert">{text.errors.request_failed}</p>
              <button type="button" onClick={() => collections.refetch()}>
                {text.retry}
              </button>
            </div>
          )}
          <Choices
            legend={text.practiceCollections}
            disabled={pending || filterLoading || filterError}
            options={availableCollections.map((collection) => ({
              id: collection.id,
              label: collectionLabel(collection, collectionCopy[language]),
            }))}
            selected={selectedCollections}
            onChange={(values) => changeFilter("collection_ids", values)}
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
      {type === "difficult" && profile && (
        <section
          className="setup-difficult-info"
          aria-label={text.setupDifficultPractice}
        >
          <p>{text.difficultyExplanation}</p>
          {difficult.isPending ? (
            <p role="status">{text.loadingCards}</p>
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
        disabled={
          !profile ||
          pending ||
          filterLoading ||
          filterError ||
          noEligiblePairs ||
          collectionSelectionUnavailable
        }
      >
        {pending ? text.loadingCards : text.startPractice}
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
function ActivePractice({
  text,
  session,
  profile,
  post,
  onLocked,
  onAgain,
  onProfileUnavailable,
}) {
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
            onDirection={(nextDirection) => {
              setDirection(nextDirection);
              rememberPracticeSelection(
                practicePairForDirection(nextDirection),
                nextDirection,
              );
            }}
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
          direction={session.direction}
          onProfileUnavailable={onProfileUnavailable}
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
        languages={cardLanguageIds(entry)}
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
            {pending ? text.revealingAnswer : text.revealAnswer}
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
      {pending && rating && <p role="status">{text.savingAnswer}</p>}
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
function Summary({
  text,
  sessionId,
  direction,
  onAgain,
  onLocked,
  onProfileUnavailable,
}) {
  const summary = useQuery({
    queryKey: ["practice-summary", sessionId],
    queryFn: () => request(`/api/sessions/${sessionId}/summary`),
    retry: false,
  });
  useEffect(() => {
    if (summary.error?.status === 401) onLocked();
    else if (summary.error?.code === "profile_not_found")
      onProfileUnavailable();
  }, [summary.error, onLocked, onProfileUnavailable]);
  const title = useRef(null);
  useEffect(() => {
    title.current?.focus();
  }, []);
  return (
    <div className="session-summary">
      <header className="summary-heading">
        <h1 ref={title} tabIndex={-1}>
          {text.sessionSummary}
        </h1>
        {summary.isSuccess && (
          <p className="summary-review-total">
            {(summary.data.total === 1
              ? text.summaryReviewOne
              : text.summaryReviews
            ).replace("{count}", summary.data.total)}
          </p>
        )}
      </header>
      {summary.isPending ? (
        <p role="status">{text.loadingSummary}</p>
      ) : summary.isError ? (
        <>
          <p role="alert">
            {text.errors[summary.error.code] || text.errors.request_failed}
          </p>
          <button onClick={() => summary.refetch()}>{text.retry}</button>
        </>
      ) : (
        <>
          <dl className="summary-counts">
            {["again", "hard", "easy"].map((value) => (
              <div key={value}>
                <dt>{text[value]}</dt>
                <dd>{summary.data.counts[value]}</dd>
              </div>
            ))}
          </dl>
          <div className="summary-recall">
            {summary.data.total > 0 ? (
              <>
                <p className="summary-recall-value">
                  {text.summaryRecall.replace(
                    "{percent}",
                    Math.round(summary.data.remembered),
                  )}
                </p>
                <p className="summary-recall-hint">
                  {text.summaryRecallHint
                    .replace("{easy}", text.easy)
                    .replace("{hard}", text.hard)}
                </p>
              </>
            ) : (
              <p className="summary-recall-hint">{text.noReviews}</p>
            )}
          </div>
          {!!summary.data.needs_practice.length && (
            <details className="summary-practice">
              <summary>
                <span>
                  {(summary.data.needs_practice.length === 1
                    ? text.summaryPracticeOne
                    : text.summaryPractice
                  ).replace("{count}", summary.data.needs_practice.length)}
                </span>
                <ChevronDown size={18} aria-hidden="true" />
              </summary>
              <ul>
                {summary.data.needs_practice.map((e) => {
                  const reviewDirection = isRegisteredDirection(e.direction)
                    ? e.direction
                    : direction;
                  const [promptLanguage, answerLanguage] =
                    safeDirectionLanguages(reviewDirection);
                  const sides = practiceSides(e.snapshot, reviewDirection);
                  return (
                    <li key={e.id}>
                      <div className="summary-card-words">
                        <span {...languageTextProps(promptLanguage)}>
                          {sides.prompt}
                        </span>
                        <span aria-hidden="true"> → </span>
                        <span {...languageTextProps(answerLanguage)}>
                          {sides.answer}
                        </span>
                      </div>
                      <span className="summary-direction">
                        {directionLabel(reviewDirection, languageLabel)}
                      </span>
                      <span className="summary-rating" data-rating={e.rating}>
                        {text[e.rating]}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </details>
          )}
        </>
      )}
      <div className="summary-actions">
        <button className="primary" onClick={onAgain}>
          {text.practiceAgain}
        </button>
        <Link to="/" className="secondary">
          {text.returnHome}
        </Link>
      </div>
    </div>
  );
}
Practice.propTypes = {
  text: PropTypes.object.isRequired,
  csrf: PropTypes.string.isRequired,
  onLocked: PropTypes.func.isRequired,
};
