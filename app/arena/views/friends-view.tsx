"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, MessageSquare, Send, UserPlus, UserRound, X } from "lucide-react";
import { Form } from "@/components/ui/form";
import { PlayerNameInput } from "@/components/ui/player-name-input";
import { MESSAGE_MAX, type Asset, type Friend, type FriendList, type FriendMessage } from "@/lib/api-types";
import { Avatar } from "../avatar";
import { ChallengeFriend, type Entry } from "../challenge-friend";
import { PlayerActions } from "../player-actions";
import { request } from "../api";
import { timeAgo } from "../format";
import type { PlayerState } from "../arena";
import styles from "./friends.module.css";

/** How often the list behind the conversation is refreshed. */
const LIST_MS = 10_000;
/** An open thread, while the tab is in front and the talk is alive. */
const LIVE_MS = 1_500;
/** The same thread once nothing has been said for a while. */
const CALM_MS = 5_000;
/** Silence that turns a live thread calm. */
const CALM_AFTER = 60_000;
/** A thread behind a hidden tab: slow enough to cost nothing, fast enough to catch up. */
const HIDDEN_MS = 30_000;

/** A message on screen, including one the server has not confirmed yet. */
type Shown = FriendMessage & { pending?: boolean };

/**
 * Friends: who they are, what they said, and the fastest way to put a board
 * between you. A challenge from here is the private match the arena already
 * knows how to play — for nothing, for gems, or for devnet SOL.
 *
 * The conversation is meant to feel immediate: what you write is on screen
 * before the request leaves, and the thread asks the server only for what it
 * does not already have, often enough that an answer lands while you are still
 * reading the last one.
 */
export function FriendsView({ player }: { player: PlayerState }) {
  const router = useRouter();
  const [list, setList] = useState<FriendList | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [messages, setMessages] = useState<Shown[] | null>(null);
  const [draft, setDraft] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // The thread poller outlives any one render: what it needs lives in refs.
  const openRef = useRef<string | null>(null);
  const cursorRef = useRef(0);
  const refreshRef = useRef(player.refresh);
  const scroller = useRef<HTMLDivElement>(null);

  const load = useCallback(
    () =>
      request<FriendList>("/api/friends").then(
        (next) => (setList(next), setError("")),
        (e: Error) => setError(e.message),
      ),
    [],
  );

  useEffect(() => {
    refreshRef.current = player.refresh;
  });

  useEffect(() => {
    void load();
    const timer = setInterval(() => !document.hidden && void load(), LIST_MS);
    return () => clearInterval(timer);
  }, [load]);

  /**
   * Pulls what the open thread does not have yet. Returns true when the other
   * player said something, which is what keeps the poll quick.
   */
  const pull = useCallback(async (who: string, first: boolean) => {
    const after = first ? 0 : cursorRef.current;
    let fresh: FriendMessage[];
    try {
      const query = `/api/friends?with=${encodeURIComponent(who)}${after ? `&after=${after}` : ""}`;
      fresh = (await request<{ messages: FriendMessage[] }>(query)).messages;
    } catch (e) {
      if (first) setError((e as Error).message);
      return false;
    }
    if (openRef.current !== who) return false;
    for (const m of fresh) if (m.created > cursorRef.current) cursorRef.current = m.created;
    let theirs = false;
    setMessages((current) => {
      // A first read replaces the thread; a delta is merged into it. Either way
      // a message still in flight stays on screen until its own reply lands.
      const base = after && current ? current : (current ?? []).filter((m) => m.pending);
      const known = new Set(base.map((m) => m.id));
      const added = fresh.filter((m) => !known.has(m.id));
      theirs = added.some((m) => !m.mine);
      if (!added.length) return base === current ? current : base;
      return [...base, ...added].sort((a, b) => a.created - b.created);
    });
    return theirs;
  }, []);

  // One chain of timers per open thread: quick while it is alive, cheap when it
  // is not. Coming back to the tab always asks straight away.
  useEffect(() => {
    openRef.current = open;
    if (!open) return;
    let live = true;
    let chain = 0;
    let quiet = Date.now();
    let timer: ReturnType<typeof setTimeout>;

    const tick = async (token: number, first = false) => {
      if (!live || token !== chain) return;
      if (!document.hidden && (await pull(open, first))) quiet = Date.now();
      if (first) {
        // The badges this thread just cleared are on the list and in the navbar.
        void load();
        void refreshRef.current();
      }
      if (!live || token !== chain) return;
      const delay = document.hidden ? HIDDEN_MS : Date.now() - quiet < CALM_AFTER ? LIVE_MS : CALM_MS;
      timer = setTimeout(() => void tick(token), delay);
    };
    const start = (first = false) => {
      chain += 1;
      clearTimeout(timer);
      void tick(chain, first);
    };

    start(true);
    const wake = () => {
      if (document.hidden) return;
      quiet = Date.now();
      start();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    return () => {
      live = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
    };
  }, [open, pull, load]);

  // Whatever arrives, the newest line is the one you are looking at. The
  // conversation scrolls itself, never the page behind it.
  useEffect(() => {
    const box = scroller.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [messages?.length]);

  const act = async (body: Record<string, unknown>, who: string, done?: string) => {
    setBusy(who);
    setError("");
    setNotice("");
    try {
      await request("/api/friends", body);
      await Promise.all([load(), player.refresh()]);
      if (done) setNotice(done);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy("");
    }
  };

  // Opening a thread empties the one before it: the poller that follows reads
  // the whole conversation, not a delta against somebody else's messages.
  const openThread = (who: string) => {
    cursorRef.current = 0;
    setMessages(null);
    setDraft("");
    setError("");
    setNotice("");
    setOpen(who);
  };

  /** Says it on screen first, then to the server. A refusal hands the words back. */
  const say = async () => {
    const body = draft.trim();
    if (!open || !body) return;
    const placeholder = `pending:${crypto.randomUUID()}`;
    setDraft("");
    setMessages((current) => [...(current ?? []), { id: placeholder, mine: true, body, created: Date.now(), pending: true }]);
    try {
      const sent = await request<{ id: string; created: number }>("/api/friends", { action: "message", name: open, body });
      if (sent.created > cursorRef.current) cursorRef.current = sent.created;
      setMessages((current) => (current ?? []).map((m) => (m.id === placeholder ? { id: sent.id, mine: true, body, created: sent.created } : m)));
      void load();
    } catch (e) {
      setError((e as Error).message);
      setMessages((current) => (current ?? []).filter((m) => m.id !== placeholder));
      setDraft((current) => current || body);
    }
  };

  /** Opens a private match at the entry they chose, and goes to the board. */
  const challenge = async (who: string, entry: Entry) => {
    setBusy(who);
    setError("");
    try {
      await request("/api/game", { action: "challenge", stake: entry.stake, asset: entry.asset, opponent: who });
      router.push("/");
    } catch (e) {
      setError((e as Error).message);
      setBusy("");
    }
  };

  if (!player.loaded) return <section className="subpage"><p className="muted">Loading…</p></section>;
  if (!player.data.player) {
    return (
      <section className={`subpage ${styles.empty}`}>
        <UserRound size={30} />
        <h1>Friends need a player name.</h1>
        <p>Create your profile to add friends, challenge them and talk.</p>
        <Link className="btn btn-primary" href={player.data.authenticated ? "/signup" : "/login"}>
          {player.data.authenticated ? "Create your profile" : "Sign in"}
        </Link>
      </section>
    );
  }

  const friend = list?.friends.find((f) => f.name === open) ?? null;
  const balance = (asset: Asset) => (asset === "gems" ? (player.data.player?.balance ?? 0) : (player.data.cashBalance ?? 0));
  const solConfigured = !!player.data.launch?.configured;

  const row = (f: Friend, kind: "friend" | "incoming" | "outgoing") => (
    <div key={f.name} className={`${styles.row} ${open === f.name ? styles.rowOpen : ""}`}>
      <button type="button" className={styles.who} onClick={() => kind === "friend" && openThread(f.name)} disabled={kind !== "friend"}>
        <span className={styles.face}>
          <Avatar name={f.name} src={f.avatar} size={40} />
          {f.online && <i className={styles.online} aria-label="online" />}
        </span>
        <span className={styles.whoText}>
          <b>
            {f.name}
            {f.unread > 0 && <span className={styles.unread}>{f.unread}</span>}
          </b>
          <small>
            {kind === "incoming"
              ? `Asked to be friends ${timeAgo(f.since)}`
              : kind === "outgoing"
                ? `Waiting since ${timeAgo(f.since)}`
                : f.lastMessage
                  ? f.lastMessage.slice(0, 60)
                  : f.online
                    ? "Online now"
                    : `Seen ${timeAgo(f.since)}`}
          </small>
        </span>
      </button>
      <div className={styles.actions}>
        {kind === "friend" && (
          <>
            <ChallengeFriend name={f.name} balance={balance} solConfigured={solConfigured} busy={busy === f.name} onChallenge={(entry) => challenge(f.name, entry)} />
            <button className="btn" disabled={busy === f.name} onClick={() => openThread(f.name)}>
              <MessageSquare size={15} /> Message
            </button>
          </>
        )}
        {kind === "incoming" && (
          <button className="btn btn-primary" disabled={busy === f.name} onClick={() => void act({ action: "accept", name: f.name }, f.name, `${f.name} is now your friend.`)}>
            <Check size={15} /> Accept
          </button>
        )}
        <button
          className={`btn ${styles.dismiss}`}
          disabled={busy === f.name}
          aria-label={kind === "friend" ? `Remove ${f.name}` : `Decline ${f.name}`}
          onClick={() =>
            void act(
              { action: kind === "incoming" ? "decline" : "remove", name: f.name },
              f.name,
              kind === "friend" ? `${f.name} removed.` : "Request dismissed.",
            ).then((ok) => ok && open === f.name && setOpen(null))
          }
        >
          <X size={15} />
        </button>
      </div>
    </div>
  );

  return (
    <section className="subpage">
      <div className="page-intro">
        <div>
          <div className="tag lime">YOUR PEOPLE</div>
          <h1>Friends.</h1>
          <p>Add a player by name, put a board between you — for nothing, for gems or for devnet SOL — and talk about it afterwards.</p>
        </div>
      </div>

      {error && (
        <div className="error" role="alert">
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <p className="success" role="status">
          {notice}
        </p>
      )}

      <div className={styles.layout}>
        <div className={open ? styles.listHidden : styles.list}>
          <Form
            className="field-row"
            style={{ gridTemplateColumns: "minmax(0, 1fr) auto" }}
            onSubmit={(event) => {
              event.preventDefault();
              if (name.trim()) void act({ action: "request", name: name.trim() }, name.trim(), `Request sent to ${name.trim()}.`).then((ok) => ok && setName(""));
            }}
          >
            <div className="field">
              <label htmlFor="friend-name">Add a friend</label>
              <PlayerNameInput id="friend-name" value={name} onValueChange={setName} placeholder="Their player name" />
            </div>
            <button className="btn btn-primary" disabled={!name.trim() || !!busy}>
              <UserPlus size={15} /> Send request
            </button>
          </Form>

          {!list ? (
            <p className="muted">Loading your friends…</p>
          ) : (
            <>
              {list.incoming.length > 0 && (
                <div className={styles.group}>
                  <h2>Waiting for you</h2>
                  {list.incoming.map((f) => row(f, "incoming"))}
                </div>
              )}
              <div className={styles.group}>
                <h2>{list.friends.length} {list.friends.length === 1 ? "friend" : "friends"}</h2>
                {list.friends.length ? list.friends.map((f) => row(f, "friend")) : <p className={styles.none}>Nobody yet. Add a player by their name above.</p>}
              </div>
              {list.outgoing.length > 0 && (
                <div className={styles.group}>
                  <h2>Asked</h2>
                  {list.outgoing.map((f) => row(f, "outgoing"))}
                </div>
              )}
              {list.blocked.length > 0 && (
                <div className={styles.group}>
                  <h2>Blocked</h2>
                  {list.blocked.map((b) => (
                    <div key={b.name} className={styles.row}>
                      <span className={styles.who}>
                        <span className={styles.face}>
                          <Avatar name={b.name} src={b.avatar} size={40} />
                        </span>
                        <span className={styles.whoText}>
                          <b>{b.name}</b>
                          <small>Blocked {timeAgo(b.since)} · they cannot reach you, and you cannot reach them</small>
                        </span>
                      </span>
                      <div className={styles.actions}>
                        <button className="btn" disabled={busy === b.name} onClick={() => void act({ action: "unblock", name: b.name }, b.name, `${b.name} unblocked.`)}>
                          Unblock
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {open && (
          <div className={styles.thread}>
            <div className={styles.threadHead}>
              <button className={styles.back} onClick={() => setOpen(null)} aria-label="Back to friends">
                <ArrowLeft size={16} />
              </button>
              <Avatar name={open} src={friend?.avatar ?? null} size={34} />
              <div>
                <b>{open}</b>
                <small>{friend?.online ? "Online now" : "Offline"}</small>
              </div>
              <div className={styles.threadActions}>
                <ChallengeFriend name={open} balance={balance} solConfigured={solConfigured} busy={busy === open} onChallenge={(entry) => challenge(open, entry)} />
                <Link className={styles.profileLink} href={`/players/${encodeURIComponent(open)}`}>
                  Profile
                </Link>
                <PlayerActions
                  name={open}
                  onBlocked={() => {
                    setOpen(null);
                    void load();
                    void player.refresh();
                  }}
                />
              </div>
            </div>
            <div className={styles.messages} ref={scroller}>
              {!messages ? (
                <p className="muted">Loading…</p>
              ) : messages.length ? (
                messages.map((m) => (
                  <div key={m.id} className={`${m.mine ? styles.mine : styles.theirs} ${m.pending ? styles.pending : ""}`}>
                    <p>{m.body}</p>
                    <small>{m.pending ? "Sending…" : timeAgo(m.created)}</small>
                  </div>
                ))
              ) : (
                <p className={styles.none}>No messages yet. Say something.</p>
              )}
            </div>
            <Form
              className={styles.composer}
              onSubmit={(event) => {
                event.preventDefault();
                void say();
              }}
            >
              <input
                className="input"
                value={draft}
                onChange={(event) => setDraft(event.target.value.slice(0, MESSAGE_MAX))}
                placeholder={`Message ${open}`}
                aria-label={`Message ${open}`}
                autoComplete="off"
              />
              <button className="btn btn-primary" disabled={!draft.trim()} aria-label="Send">
                <Send size={15} />
              </button>
            </Form>
          </div>
        )}
      </div>
    </section>
  );
}
