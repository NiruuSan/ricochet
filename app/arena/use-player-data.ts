"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Asset } from "@/lib/api-types";
import { EMPTY_PLAYER, loadPlayer, type PlayerData } from "./api";

const POLL_MS = 15_000;

/** The signed-in player's snapshot for the selected currency, kept fresh while they have a profile. */
export function usePlayerData() {
  // Devnet SOL comes first; players fall back to gems only where Solana is not configured.
  const [asset, setAssetState] = useState<Asset>("devnet");
  // Only the default choice falls back to gems; a tab the player picks stays picked.
  const chosenRef = useRef(false);
  const setAsset = useCallback((next: Asset) => {
    chosenRef.current = true;
    setAssetState(next);
  }, []);
  const [data, setData] = useState<PlayerData>(EMPTY_PLAYER);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const next = await loadPlayer(asset);
      setData({ ...EMPTY_PLAYER, ...next });
      if (asset === "devnet" && next.launch && !next.launch.configured && !chosenRef.current) setAssetState("gems");
      return next;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setLoaded(true);
    }
  }, [asset]);

  const hasPlayer = !!data.player;
  useEffect(() => {
    if (!hasPlayer) return;
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [hasPlayer, refresh]);

  return { asset, setAsset, data, setData, loaded, error, setError, refresh };
}
