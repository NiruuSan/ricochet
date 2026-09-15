"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Camera, LogOut, Trash2, UserRound } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { signOutToLogin } from "../../auth-actions";
import { request } from "../api";
import { Avatar } from "../avatar";
import type { PlayerState } from "../arena";
import { ProfileDashboard } from "./profile-dashboard";

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

/** The signed-in player's own profile: the public dashboard layout, with editing in a dialog. */
export function ProfileView({ player }: { player: PlayerState }) {
  const { data, loaded, refresh } = player;
  const profile = data.player;
  const [editing, setEditing] = useState(false);
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

  const draftName = name ?? profile.name;
  const openEditor = () => {
    setName(null);
    setError("");
    setNotice("");
    setEditing(true);
  };

  return (
    <>
      <ProfileDashboard key={profile.name} name={profile.name} player={player} privateView onEdit={openEditor} />
      <Dialog open={editing} onOpenChange={(open) => !saving && setEditing(open)}>
        <DialogContent className="dialog-dark">
          <DialogTitle>Edit profile</DialogTitle>
          <DialogDescription>Your name and picture are visible to other players on the leaderboard, in matches and on your public profile.</DialogDescription>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="success" role="status">
              {notice}
            </p>
          )}
          <div className="profile-picture" style={{ marginTop: 6 }}>
            <Avatar name={profile.name} src={profile.avatar} size={84} />
            <div className="row-actions">
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
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (await save("name", { action: "rename", name: draftName }, "Player name updated.")) setName(null);
            }}
          >
            <label className="field" style={{ marginBottom: 8 }}>
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
            <p className="fine">3–20 letters, numbers or underscores. Names are unique, regardless of capitals. Your public profile link follows your name.</p>
            <div className="row-actions" style={{ marginTop: 16, justifyContent: "space-between" }}>
              <button className="btn btn-primary" disabled={!!saving || draftName.trim() === profile.name}>
                {saving === "name" ? "Saving…" : "Save name"}
              </button>
              <button className="btn" type="submit" form="sign-out-form">
                <LogOut />
                Sign out
              </button>
            </div>
          </form>
          <form id="sign-out-form" action={signOutToLogin} hidden />
        </DialogContent>
      </Dialog>
    </>
  );
}
