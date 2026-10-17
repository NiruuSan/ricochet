"use client";
import { useCallback, useEffect, useState } from "react";
import { KeyRound, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { useActionDialog } from "@/components/ui/action-dialog";
import { request } from "../api";
import { addPasskey, passkeyMessage, passkeysSupported, type PasskeySnapshot } from "../passkey";
import { toast } from "../feedback";
import styles from "./admin.module.css";

const when = (at: number | null) => (at === null ? "Never" : new Date(at).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" }));

/**
 * The administrator's own passkeys: open the admin with Face ID, Windows Hello
 * or a security key instead of a code, and, once there is one, stop the app
 * code from opening it at all (lib/admin-passkeys.ts).
 */
export function AdminPasskeys() {
  const dialog = useActionDialog();
  const [data, setData] = useState<PasskeySnapshot | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const supported = passkeysSupported();

  const load = useCallback(
    () =>
      request<PasskeySnapshot>("/api/admin/passkeys").then(
        (next) => (setData(next), setError("")),
        (e: Error) => setError(e.message),
      ),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const run = async (key: string, work: () => Promise<PasskeySnapshot>, said: string) => {
    setBusy(key);
    setError("");
    try {
      setData(await work());
      toast(said);
    } catch (e) {
      setError(passkeyMessage(e));
    } finally {
      setBusy("");
    }
  };

  const add = () =>
    run(
      "add",
      async () => {
        const next = await addPasskey(name.trim());
        setName("");
        return next;
      },
      "Passkey added. It can open the admin from now on.",
    );
  const remove = async (id: string, label: string) => {
    if (!(await dialog.confirm(`Remove “${label}”? It will no longer open the admin.`, { title: "Remove passkey", confirmLabel: "Remove", danger: true }))) return;
    void run(id, () => request<PasskeySnapshot>("/api/admin/passkeys", { action: "remove", id }), "Passkey removed.");
  };
  const only = (on: boolean) =>
    run("only", () => request<PasskeySnapshot>("/api/admin/passkeys", { action: "only", on }), on ? "Only a passkey opens the admin now." : "An app code opens the admin again.");

  const full = !!data && data.passkeys.length >= data.max;
  return (
    <div className={styles.panel}>
      <div className={styles.panelHead}>
        <h3>
          <KeyRound size={16} /> Your passkeys
        </h3>
        {data && (
          <button
            className="btn"
            role="switch"
            aria-checked={data.passkeyOnly}
            aria-label="Passkey only"
            disabled={!!busy || (!data.passkeyOnly && !data.passkeys.length)}
            style={data.passkeyOnly ? { borderColor: "#c6f564", color: "#c6f564" } : undefined}
            onClick={() => void only(!data.passkeyOnly)}
          >
            <ShieldCheck size={15} /> {data.passkeyOnly ? "Passkey only" : "Passkey or code"}
          </button>
        )}
      </div>
      <p className={styles.fine}>
        Open the admin with Face ID, Windows Hello or a security key instead of a code. A passkey signs for this site only, so a look-alike page cannot use it the way it
        could use a code typed into it. With <b>passkey only</b> on, an app code no longer opens the admin; your recovery codes still do, if every passkey is lost.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!data ? (
        <p className={styles.loading}>Loading passkeys…</p>
      ) : (
        <>
          {data.passkeys.length ? (
            <ul className={styles.passkeys}>
              {data.passkeys.map((key) => (
                <li key={key.id}>
                  <KeyRound size={16} />
                  <div>
                    <b>{key.name}</b>
                    <span>
                      Added {when(key.created)} · last used {when(key.lastUsed)}
                    </span>
                  </div>
                  <button className="btn btn-danger" disabled={!!busy} onClick={() => void remove(key.id, key.name)} aria-label={`Remove ${key.name}`}>
                    <Trash2 size={14} /> {busy === key.id ? "Removing…" : "Remove"}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.empty}>No passkey yet. Add one on each device you open the admin from.</p>
          )}
          {supported ? (
            <div className={styles.passkeyAdd}>
              <label className="field">
                Name
                <input className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="This laptop" disabled={full} />
              </label>
              <button className="btn btn-primary" disabled={!!busy || full} onClick={() => void add()}>
                <Plus size={15} /> {busy === "add" ? "Waiting for your device…" : full ? `${data.max} passkeys at most` : "Add a passkey"}
              </button>
            </div>
          ) : (
            <p className={styles.fine}>This browser cannot make passkeys. Add one from a browser that can, such as a current Chrome, Safari, Edge or Firefox.</p>
          )}
        </>
      )}
    </div>
  );
}
