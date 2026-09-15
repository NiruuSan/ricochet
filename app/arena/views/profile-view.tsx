"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Camera, Trash2, UserRound } from "lucide-react";
import { signOutToLogin } from "../../auth-actions";
import { request } from "../api";
import { Avatar } from "../avatar";
import { amount, matchStats } from "../format";
import type { PlayerState } from "../arena";

const AVATAR_PX = 256;

/** Center-crops and scales a picture in the browser, so only a small square image is uploaded. */
async function resizePicture(file: File) {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = AVATAR_PX;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Your browser could not process this picture.");
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, AVATAR_PX, AVATAR_PX);
  bitmap.close();
  const webp = canvas.toDataURL("image/webp", 0.85);
  // Browsers without WebP encoding silently return PNG; JPEG is smaller then.
  return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/jpeg", 0.85);
}

export function ProfileView({ player }: { player: PlayerState }) {
  const { data, loaded, refresh, asset } = player;
  const profile = data.player;
  const [name, setName] = useState<string | null>(null);
  const [saving, setSaving] = useState<"" | "name" | "avatar">("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const save = async (kind: "name" | "avatar", body: Record<string, unknown>, done: string) => {
    setSaving(kind);
    setError("");
    setNotice("");
    try {
      await request("/api/profile", body);
      await refresh();
      setNotice(done);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setSaving("");
    }
  };

  const pickPicture = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return setError("Choose an image file.");
    try {
      const image = await resizePicture(file);
      await save("avatar", { action: "avatar", image }, "Profile picture updated.");
    } catch {
      setError("This picture could not be read. Try a JPEG, PNG or WebP file.");
      setSaving("");
    }
  };

  if (!profile) {
    return (
      <section className="panel auth-card">
        <UserRound style={{ marginBottom: 20 }} />
        <h1>{loaded ? "No player profile yet." : "Loading your profile…"}</h1>
        {loaded && (
          <Link href={data.authenticated ? "/signup" : "/login"} className="btn btn-primary full" style={{ marginTop: 25 }}>
            {data.authenticated ? "Create your profile" : "Sign in"} <ArrowRight />
          </Link>
        )}
      </section>
    );
  }

  const { wins } = matchStats(data.matches);
  const settled = data.matches.filter((m) => m.settled).length;
  const draftName = name ?? profile.name;

  return (
    <section className="subpage">
      <div className="tag lime" style={{ marginBottom: 12 }}>
        YOUR PROFILE
      </div>
      <h1>This is you.</h1>
      <p className="muted">Your name and picture are visible to other players on the leaderboard and in matches.</p>
      {error && (
        <div className="error" role="alert">
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <p className="success" role="status" style={{ marginBottom: 18 }}>
          {notice}
        </p>
      )}
      <div className="wallet-grid">
        <div className="panel profile-card">
          <div className="profile-picture">
            <Avatar name={profile.name} src={profile.avatar} size={112} />
            <div>
              <h2>{profile.name}</h2>
              <Link className="lime" href={`/players/${encodeURIComponent(profile.name)}`}>View public profile and all-time PNL</Link>
              <p className="fine">Member since {new Date(profile.created).toLocaleDateString(undefined, { month: "long", year: "numeric" })}</p>
              <div className="row-actions" style={{ marginTop: 14 }}>
                <button className="btn" disabled={!!saving} onClick={() => fileInput.current?.click()}>
                  <Camera />
                  {saving === "avatar" ? "Uploading…" : profile.avatar ? "Change picture" : "Add a picture"}
                </button>
                {profile.avatar && (
                  <button className="btn" disabled={!!saving} onClick={() => void save("avatar", { action: "remove_avatar" }, "Profile picture removed.")}>
                    <Trash2 />
                    Remove
                  </button>
                )}
              </div>
              <input
                ref={fileInput}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                hidden
                onChange={(e) => {
                  void pickPicture(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </div>
          </div>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (await save("name", { action: "rename", name: draftName }, "Player name updated.")) setName(null);
            }}
          >
            <label className="field">
              Player name
              <input
                className="input"
                value={draftName}
                onChange={(e) => setName(e.target.value)}
                minLength={3}
                maxLength={20}
                pattern="[a-zA-Z0-9_]{3,20}"
                autoComplete="nickname"
                required
              />
            </label>
            <p className="fine">3–20 letters, numbers or underscores. Names are unique, regardless of capitals.</p>
            <button className="btn btn-primary" style={{ marginTop: 14 }} disabled={!!saving || draftName.trim() === profile.name}>
              {saving === "name" ? "Saving…" : "Save name"}
            </button>
          </form>
        </div>
        <div className="panel">
          <h3>At a glance</h3>
          <div className="math-line" style={{ marginTop: 20 }}>
            <span>Gems</span>
            <strong className="lime">{amount(profile.balance, "gems")}</strong>
          </div>
          {data.launch?.configured && (
            <div className="math-line">
              <span>Devnet wallet</span>
              <strong>{amount(data.cashBalance ?? 0, "devnet")}</strong>
            </div>
          )}
          <div className="math-line">
            <span>Settled {asset === "gems" ? "gem" : "devnet"} matches</span>
            <strong>{settled}</strong>
          </div>
          <div className="math-line">
            <span>Victories</span>
            <strong>{wins}</strong>
          </div>
          <div className="row-actions" style={{ marginTop: 20 }}>
            <Link className="btn" href="/wallet">
              Balances & wallet
            </Link>
            <form action={signOutToLogin}>
              <button className="btn">Sign out</button>
            </form>
          </div>
        </div>
      </div>
    </section>
  );
}
