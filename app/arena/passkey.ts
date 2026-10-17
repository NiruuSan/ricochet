"use client";
import { browserSupportsWebAuthn, startAuthentication, startRegistration, type PublicKeyCredentialCreationOptionsJSON, type PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import type { AdminPasskey } from "@/lib/admin-passkeys";
import { request } from "./api";

// The administrator's passkeys in the browser (lib/admin-passkeys.ts has the
// rest): the device is asked to sign the server's challenge, and its answer is
// sent back. Nothing secret leaves the device.

export type PasskeySnapshot = { passkeys: AdminPasskey[]; passkeyOnly: boolean; max: number };

export const passkeysSupported = () => typeof window !== "undefined" && browserSupportsWebAuthn();

/** Opens the admin with a passkey: the challenge, the device's answer, the window. */
export async function unlockWithPasskey() {
  const optionsJSON = await request<PublicKeyCredentialRequestOptionsJSON>("/api/admin/elevate", { action: "passkey-options" });
  const response = await startAuthentication({ optionsJSON });
  return request<{ until: number; viewingUntil: number }>("/api/admin/elevate", { passkey: response });
}

/** Makes a new passkey on this device and registers it, under an optional name. */
export async function addPasskey(name: string) {
  const optionsJSON = await request<PublicKeyCredentialCreationOptionsJSON>("/api/admin/passkeys", { action: "options" });
  const response = await startRegistration({ optionsJSON });
  return request<PasskeySnapshot>("/api/admin/passkeys", { action: "register", response, name });
}

/** What a closed or refused device prompt means, in words. */
export function passkeyMessage(e: unknown) {
  const name = (e as Error)?.name;
  if (name === "NotAllowedError" || name === "AbortError") return "The passkey prompt was closed before it finished.";
  if (name === "InvalidStateError") return "This device already holds a passkey for the admin.";
  return (e as Error)?.message || "The passkey did not work. Try again.";
}
