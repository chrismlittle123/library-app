import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CloseIcon } from "../icons";
import { prettify } from "../library";
import { createGitHub, type RepoConfig } from "../sync/github";
import { publishSession } from "./api";
import { parseMarkdown, type Line } from "./markdown";
import { isFirstAnswer, progressLabel, requeue } from "./session";
import { grade, isDue, newState, yearMonth } from "./sr";
import { loadDeck, loadStates, removePending, saveDeck, saveStates, upsertPending } from "./storage";
import { syncReview } from "./sync";
import type { Card, CardState, Grade, Rating, SessionRecord } from "./types";

type Phase = "start" | "review" | "done";
type SyncStatus = "loading" | "online" | "offline";
type Tally = { graded: number; again: number; good: number };

function shuffle<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** `tabs` is hidden during a session, so one can't be left by accident: the × logs it first. */
export function Review({ config, tabs }: { config: RepoConfig; tabs: ReactNode }) {
  const [cards, setCards] = useState<Card[]>(() => loadDeck() ?? []);
  const [states, setStates] = useState<Record<string, CardState>>(() => loadStates());
  const [sync, setSync] = useState<SyncStatus>("loading");
  const [grades, setGrades] = useState<Grade[]>([]);
  const [phase, setPhase] = useState<Phase>("start");
  const [queue, setQueue] = useState<Card[]>([]);
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [startedAt, setStartedAt] = useState(0);
  const [tally, setTally] = useState<Tally>({ graded: 0, again: 0, good: 0 });
  const [summary, setSummary] = useState<{ rec: SessionRecord; synced: boolean | null } | null>(null);

  // Start is held until this settles, so a review never begins on stale state
  // that the server's answer would then overwrite.
  useEffect(() => {
    let live = true;
    void syncReview((path) => createGitHub(config).readFile(path)).then((r) => {
      if (!live) return;
      if (r.deck) {
        saveDeck(r.deck);
        setCards(r.deck);
      }
      if (r.states) {
        saveStates(r.states);
        setStates(r.states);
      }
      setSync(r.online ? "online" : "offline");
    });
    return () => {
      live = false;
    };
  }, [config]);

  const now = yearMonth();
  const stateFor = (c: Card): CardState => states[c.id] ?? newState(c.id, now);

  const dueCards = useMemo(
    () => cards.filter((c) => isDue(states[c.id] ?? newState(c.id, now), now)),
    [cards, states, now],
  );

  const topics = useMemo(() => {
    const byTopic = new Map<string, { all: Card[]; due: Card[] }>();
    for (const card of cards) {
      const entry = byTopic.get(card.topic) ?? { all: [], due: [] };
      entry.all.push(card);
      byTopic.set(card.topic, entry);
    }
    for (const card of dueCards) byTopic.get(card.topic)?.due.push(card);
    return [...byTopic.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [cards, dueCards]);

  function begin(chosen: Card[]) {
    if (chosen.length === 0) return;
    setQueue(shuffle(chosen));
    setIdx(0);
    setRevealed(false);
    setTally({ graded: 0, again: 0, good: 0 });
    setGrades([]);
    setSessionId(crypto.randomUUID());
    setStartedAt(Date.now());
    setPhase("review");
  }

  function record(t: Tally, g: Grade[]): SessionRecord {
    return {
      session_id: sessionId,
      ts: new Date().toISOString(),
      // Each card is graded once, on its first answer, so this is right for a session left early too.
      cards_reviewed: g.length,
      graded: t.graded,
      again: t.again,
      good: t.good,
      duration_s: Math.round((Date.now() - startedAt) / 1000),
      grades: g,
    };
  }

  async function finish(rec: SessionRecord) {
    setPhase("done");
    setSummary({ rec, synced: null });
    const synced = await publishSession(rec);
    if (synced) removePending(rec.session_id);
    setSummary({ rec, synced });
  }

  /** Leave mid-session. Anything already answered counts, so it's logged now. */
  function exit() {
    if (grades.length > 0) void finish(record(tally, grades));
    else setPhase("start");
  }

  function answer(rating: Rating) {
    const card = queue[idx];
    let t = tally;
    let g = grades;
    if (isFirstAnswer(grades, card.id)) {
      const nextStates = { ...states, [card.id]: grade(stateFor(card), rating, now) };
      setStates(nextStates);
      saveStates(nextStates);
      t = {
        graded: tally.graded + 1,
        again: tally.again + (rating === "again" ? 1 : 0),
        good: tally.good + (rating === "good" ? 1 : 0),
      };
      setTally(t);
      g = [...grades, { id: card.id, rating }];
      setGrades(g);
    }
    const nextQueue = requeue(queue, idx, rating);
    setQueue(nextQueue);
    // Queued after every grade, not just at the end: a session abandoned halfway
    // still uploads on the next open, so its grades aren't lost when that open
    // replaces local state with the server's.
    const rec = record(t, g);
    upsertPending(rec);
    if (idx + 1 < nextQueue.length) {
      setIdx(idx + 1);
      setRevealed(false);
    } else {
      void finish(rec);
    }
  }

  if (phase === "review") {
    const reveal = () => setRevealed(true);
    return (
      <main className="review">
        <header className="review-bar">
          <button type="button" className="tool" aria-label="Exit review" onClick={exit}>
            <CloseIcon />
          </button>
          <span className="review-progress">{progressLabel(queue, idx, grades)}</span>
        </header>
        <section
          className="review-card"
          role="button"
          tabIndex={revealed ? -1 : 0}
          aria-disabled={revealed}
          onClick={reveal}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              reveal();
            }
          }}
        >
          <span className="review-topic">{prettify(queue[idx].topic)}</span>
          <div className="review-face">
            <p className="review-question">{queue[idx].question}</p>
            {revealed && <Answer text={queue[idx].answer} />}
          </div>
        </section>
        {revealed ? (
          <div className="review-grades">
            <button type="button" className="danger" onClick={() => answer("again")}>
              Again
            </button>
            <button type="button" className="primary" onClick={() => answer("good")}>
              Good
            </button>
          </div>
        ) : (
          <button type="button" className="secondary" onClick={reveal}>
            Show answer
          </button>
        )}
      </main>
    );
  }

  const bar = (
    <header className="bar">
      <h1 className="bar-title">Flashcards</h1>
      {cards.length > 0 && <span className="status">{plural(cards.length, "card")}</span>}
    </header>
  );

  if (phase === "done" && summary) {
    const { rec, synced } = summary;
    return (
      <>
        {bar}
        <main className="list">
          <div className="review-hero">
            <p className="review-eyebrow">Session done</p>
            <p className="review-big">
              {rec.good} / {rec.graded} recalled
            </p>
            <p className="hint">
              {plural(rec.graded, "card")} · {minutes(rec.duration_s)}
              {rec.again > 0 && ` · ${rec.again} to revisit`}
            </p>
            <p className="hint" role="status">
              {syncMessage(synced)}
            </p>
          </div>
          <div className="actions">
            <button type="button" className="secondary" onClick={() => setPhase("start")}>
              Back
            </button>
          </div>
        </main>
        {tabs}
      </>
    );
  }

  return (
    <>
      {bar}
      <main className="list">
        <div className="review-hero">
          {sync === "loading" ? (
            <p className="hint breathe">Getting your cards…</p>
          ) : cards.length === 0 ? (
            <p className="hint">Couldn't load your cards. Check your connection and open this again.</p>
          ) : dueCards.length > 0 ? (
            <>
              <p className="review-eyebrow">This month</p>
              <p className="review-big">{dueCards.length} due</p>
              <button type="button" className="primary" onClick={() => begin(dueCards)}>
                Start review
              </button>
            </>
          ) : (
            <>
              <p className="review-eyebrow">This month</p>
              <p className="review-big">All caught up</p>
              <button type="button" className="secondary" onClick={() => begin(cards)}>
                Review all anyway
              </button>
            </>
          )}
          {sync === "offline" && cards.length > 0 && (
            <p className="hint">Offline: showing the copy saved on this phone.</p>
          )}
        </div>
        {sync !== "loading" && topics.length > 0 && (
          <section aria-label="Topics">
            <h2>Topics</h2>
            <ul className="rows">
              {topics.map(([topic, { all, due }]) => (
                <li key={topic}>
                  <button
                    type="button"
                    className="row folder"
                    onClick={() => begin(due.length > 0 ? due : all)}
                  >
                    <span className="row-title">{prettify(topic)}</span>
                    <span className="row-count" data-due={due.length > 0 || undefined}>
                      {due.length > 0 ? `${due.length} of ${all.length}` : all.length}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
      {tabs}
    </>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function minutes(seconds: number): string {
  const mins = Math.round(seconds / 60);
  return mins < 1 ? "under a minute" : `${mins} min`;
}

function syncMessage(synced: boolean | null): string {
  if (synced === null) return "Saving…";
  if (synced) return "Saved and logged for Sumi";
  return "Saved on this phone. It'll upload next time you open Flashcards.";
}

function Spans({ line }: { line: Line }) {
  return line.map((s, i) => (s.bold ? <strong key={i}>{s.text}</strong> : s.italic ? <em key={i}>{s.text}</em> : s.text));
}

/** A card's answer, its Markdown shown as paragraphs, lists, bold and italic. */
function Answer({ text }: { text: string }) {
  return (
    <div className="review-answer">
      {parseMarkdown(text).map((b, i) => {
        if (b.kind === "p") {
          return (
            <p key={i}>
              {b.lines.map((line, j) => (
                <span key={j}>
                  {j > 0 && <br />}
                  <Spans line={line} />
                </span>
              ))}
            </p>
          );
        }
        const items = b.items.map((line, j) => (
          <li key={j}>
            <Spans line={line} />
          </li>
        ));
        return b.kind === "ul" ? <ul key={i}>{items}</ul> : <ol key={i} start={b.start}>{items}</ol>;
      })}
    </div>
  );
}
