"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, MessageSquare, Send, Swords, UserPlus, UserRound, X } from "lucide-react";
import { Form } from "@/components/ui/form";
import { Select } from "@/components/ui/select";
import { MESSAGE_MAX, STAKES, type Asset, type Friend, type FriendList, type FriendMessage } from "@/lib/api-types";
import { Avatar } from "../avatar";
import { PlayerActions } from "../player-actions";
import { request } from "../api";
import { units, timeAgo } from "../format";
import type { PlayerState } from "../arena";
import styles from "./friends.module.css";

const REFRESH_MS = 10_000;

/** Every way a friendly game can be entered: for nothing, for gems, for devnet SOL. */
const ENTRIES = [
  { value: "free", label: "Friendly · no entry" },
  ...STAKES.gems.map((stake) => ({ value: `gems:${stake}`, label: `${units(stake, "gems")} gems` })),
  ...STAKES.devnet.map((stake) => ({ value: `devnet:${stake}`, label: `${units(stake, "devnet")} SOL` })),
];

/**
 * Friends: who they are, what they said, and the fastest way to put a board
 * between you. A challenge from here is the private match the arena already
 * knows how to play — for nothing, for gems, or for devnet SOL.
 */
export function FriendsView({ player }: { player: PlayerState }) {
  const router = useRouter();
  const [list, setList] = useState<FriendList | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [messages, setMessages] = useState<FriendMessage[] | null>(null);
  const [draft, setDraft] = useState("");
  const [name, setName] = useState("");
  const [entry, setEntry] = useState("free");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(
    () =>
      request<FriendList>("/api/friends").then(
        (next) => (setList(next), setError("")),
        (e: Error) => setError(e.message),
      ),
    [],
  );
  const loadThread = useCallback((who: string) => request<{ messages: FriendMessage[] }>(`/api/friends?with=${encodeURIComponent(who)}`).then(({ messages: m }) => setMessages(m), () => {}), []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      if (document.hidden) return;
      void load();
      if (open) void loadThread(open);
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load, loadThread, open]);

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

  const openThread = async (who: string) => {
    setOpen(who);
    setMessages(null);
    setDraft("");
    await loadThread(who);
    await player.refresh();
    await load();
  };

  const say = async () => {
    if (!open || !draft.trim()) return;
    const body = draft.trim();
    setDraft("");
    if (await act({ action: "message", name: open, body }, open)) await loadThread(open);
  };

  /** Opens a private match for this friend and goes to the board. */
  const challenge = async (who: string) => {
    const [kind, amount] = entry === "free" ? ["gems", "0"] : entry.split(":");
    setBusy(who);
    setError("");
    try {
      await request("/api/game", { action: "challenge", stake: Number(amount), asset: kind as Asset, opponent: who });
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

  const row = (f: Friend, kind: "friend" | "incoming" | "outgoing") => (
    <div key={f.name} className={`${styles.row} ${open === f.name ? styles.rowOpen : ""}`}>
      <button type="button" className={styles.who} onClick={() => kind === "friend" && void openThread(f.name)} disabled={kind !== "friend"}>
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
            <button className="btn" disabled={busy === f.name} onClick={() => void challenge(f.name)}>
              <Swords size={15} /> Challenge
            </button>
            <button className="btn" disabled={busy === f.name} onClick={() => void openThread(f.name)}>
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
            <label className="field">
              Add a friend
              <input className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder="Their player name" autoComplete="off" />
            </label>
            <button className="btn btn-primary" disabled={!name.trim() || !!busy}>
              <UserPlus size={15} /> Send request
            </button>
          </Form>

          <div className={styles.entry}>
            <span>Challenge entry</span>
            <Select label="Entry for a friendly challenge" value={entry} onValueChange={setEntry} options={ENTRIES} />
          </div>

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
            <div className={styles.messages}>
              {!messages ? (
                <p className="muted">Loading…</p>
              ) : messages.length ? (
                messages.map((m) => (
                  <div key={m.id} className={m.mine ? styles.mine : styles.theirs}>
                    <p>{m.body}</p>
                    <small>{timeAgo(m.created)}</small>
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
