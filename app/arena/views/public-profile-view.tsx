"use client";
import type { PlayerState } from "../arena";
import { ProfileDashboard } from "./profile-dashboard";

export function PublicProfileView({ name, player }: { name: string; player: PlayerState }) {
  return <ProfileDashboard name={name} player={player} />;
}
