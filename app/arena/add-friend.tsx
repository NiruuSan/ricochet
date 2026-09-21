"use client";
import { useState } from "react";
import { Check, UserPlus } from "lucide-react";
import { request } from "./api";

/** Asks a player to be friends, from their profile. */
export function AddFriend({ name }: { name: string }) {
  const [state, setState] = useState<"" | "sending" | "sent">("");
  const [error, setError] = useState("");
  return (
    <>
      <button
        className="btn"
        disabled={state !== ""}
        onClick={async () => {
          setState("sending");
          setError("");
          try {
            await request("/api/friends", { action: "request", name });
            setState("sent");
          } catch (e) {
            setError((e as Error).message);
            setState("");
          }
        }}
      >
        {state === "sent" ? <Check size={15} /> : <UserPlus size={15} />}
        {state === "sent" ? "Request sent" : state === "sending" ? "Sending…" : "Add friend"}
      </button>
      {error && (
        <span className="fine" role="alert" style={{ color: "#ffb2bf" }}>
          {error}
        </span>
      )}
    </>
  );
}
