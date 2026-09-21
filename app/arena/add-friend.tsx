"use client";
import { useState } from "react";
import Link from "next/link";
import { Check, MessageSquare, UserCheck, UserPlus } from "lucide-react";
import type { Friendship } from "@/lib/api-types";
import { request } from "./api";

/**
 * What this player is to you, and the one thing worth doing about it. The
 * profile already knows where you stand with them, so the button never offers
 * something that would only come back refused.
 */
export function AddFriend({ name, standing }: { name: string; standing: Friendship | null }) {
  const [state, setState] = useState<"" | "sending" | "sent" | "accepted">("");
  const [error, setError] = useState("");

  const act = async (action: "request" | "accept", done: "sent" | "accepted") => {
    setState("sending");
    setError("");
    try {
      await request("/api/friends", { action, name });
      setState(done);
    } catch (e) {
      setError((e as Error).message);
      setState("");
    }
  };

  // Blocked either way: nothing here would go through, and saying which side
  // blocked whom is not ours to say.
  if (standing === null || standing === "blocked") return null;

  const friends = standing === "friends" || state === "accepted";
  if (friends) {
    return (
      <Link className="btn" href="/friends">
        <MessageSquare size={15} /> Message {name}
      </Link>
    );
  }
  if (standing === "sent" || state === "sent") {
    return (
      <button className="btn" disabled>
        <Check size={15} /> Request sent
      </button>
    );
  }

  const incoming = standing === "incoming";
  return (
    <>
      <button className="btn" disabled={state === "sending"} onClick={() => void act(incoming ? "accept" : "request", incoming ? "accepted" : "sent")}>
        {incoming ? <UserCheck size={15} /> : <UserPlus size={15} />}
        {state === "sending" ? "Sending…" : incoming ? `Accept ${name}` : "Add friend"}
      </button>
      {error && (
        <span className="fine" role="alert" style={{ color: "#ffb2bf" }}>
          {error}
        </span>
      )}
    </>
  );
}
