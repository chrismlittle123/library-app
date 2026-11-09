import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createGitHub, type RepoConfig } from "../sync/github";
import { hasBackend, publishSession } from "./api";
import { parseMarkdown, type Line } from "./markdown";
import { isFirstAnswer, progressLabel, requeue, uniqueCards } from "./session";
import { grade, isDue, newState, yearMonth } from "./sr";
import { loadDeck, loadStates, removePending, saveDeck, saveStates, upsertPending } from "./storage";
import { DECK_PATH, syncReview } from "./sync";
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

/** `tabs` shows on the start screen only, so a session can't be left by accident. */
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
    void syncReview(() => createGitHub(config).readFile(DECK_PATH)).then((r) => {
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
      cards_reviewed: uniqueCards(queue),
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
          <span>{progressLabel(queue, idx, grades)}</span>
          <span>{queue[idx].topic}</span>
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
          <p className="review-question">{queue[idx].question}</p>
          {revealed && <Answer text={queue[idx].answer} />}
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

  if (phase === "done" && summary) {
    const { rec, synced } = summary;
    return (
      <main className="review center">
        <h1 className="review-title">Done</h1>
        <p className="review-big">
          {rec.good} / {rec.graded} recalled
        </p>
        <p className="hint">
          {rec.graded} cards · {Math.round(rec.duration_s / 60)} min · {rec.again} to revisit
        </p>
        <p className="hint" role="status">
          {syncMessage(synced)}
        </p>
        <button type="button" className="secondary" onClick={() => setPhase("start")}>
          Back
        </button>
      </main>
    );
  }

  return (
    <>
      <main className="review center">
        <h1 className="review-title">Flashcards</h1>
        {sync === "loading" ? (
          <p className="hint">Getting your cards…</p>
        ) : cards.length === 0 ? (
          <p className="hint">Couldn't load your cards. Check your connection and open this again.</p>
        ) : dueCards.length > 0 ? (
          <>
            <p className="review-big">{dueCards.length} due</p>
            <p className="hint">this month · {cards.length} cards total</p>
            <button type="button" className="primary" onClick={() => begin(dueCards)}>
              Start review
            </button>
          </>
        ) : (
          <>
            <p className="review-big">All caught up</p>
            <p className="hint">nothing due this month · {cards.length} cards total</p>
            <button type="button" className="secondary" onClick={() => begin(cards)}>
              Review all anyway
            </button>
          </>
        )}
        {sync === "offline" && cards.length > 0 && (
          <p className="hint">Offline: showing the copy saved on this phone.</p>
        )}
      </main>
      {tabs}
    </>
  );
}

function syncMessage(synced: boolean | null): string {
  if (synced === null) return "Saving…";
  if (synced) return "Saved and logged for Sumi";
  return hasBackend
    ? "Saved on this phone. It'll upload next time you open Flashcards."
    : "Saved on this phone only.";
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
