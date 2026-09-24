"use client";
import { useSyncExternalStore } from "react";
import Link from "next/link";
import { DropdownMenu as Primitive } from "radix-ui";
import { Check, ChevronDown, Wallet } from "lucide-react";
import { SolanaMark } from "./solana-mark";
import { units } from "./format";
import { DISPLAYS, moneySnapshot, setMoney, subscribeMoney, type Display } from "./money";
import styles from "./currency-menu.module.css";

// The balance in the top bar, and the two questions behind it: which network the
// money is on, and which money the player would rather read.

const SOL_SNAPSHOT = { choice: "sol" as Display, rate: null };

/** The display the page is written in. Subscribing here repaints every amount. */
export const useMoney = () => useSyncExternalStore(subscribeMoney, moneySnapshot, () => SOL_SNAPSHOT);

const NAMES: Record<Display, { short: string; long: string; sign: string }> = {
  sol: { short: "SOL", long: "Solana", sign: "◎" },
  usd: { short: "USD", long: "US dollar", sign: "$" },
  eur: { short: "EUR", long: "Euro", sign: "€" },
};

/** The networks a player can put money on. Only one so far, and it says so. */
const NETWORKS = [{ id: "solana", name: "Solana", note: "Devnet · test funds" }];

export function CurrencyMenu({ lamports }: { lamports: number }) {
  const { choice, rate } = useMoney();
  // Without a rate there is nothing to convert to, so the balance stays in SOL.
  const reading = choice === "sol" || !rate ? "sol" : choice;

  return (
    <Primitive.Root>
      <Primitive.Trigger className={styles.trigger} aria-label="Balance and currency">
        {reading === "sol" ? <SolanaMark size={17} /> : <span className={styles.sign}>{NAMES[reading].sign}</span>}
        <b>{units(lamports, "devnet")}</b>
        <ChevronDown size={14} className={styles.chevron} />
      </Primitive.Trigger>
      <Primitive.Portal>
        <Primitive.Content className={styles.menu} align="end" sideOffset={9} collisionPadding={12}>
          <Primitive.Label className={styles.group}>Playing with</Primitive.Label>
          {NETWORKS.map((network) => (
            <Primitive.Item key={network.id} className={`${styles.item} ${styles.network}`} onSelect={(event) => event.preventDefault()}>
              <SolanaMark size={18} />
              <span>
                <b>{network.name}</b>
                <small>{network.note}</small>
              </span>
              <Check size={15} className={styles.check} />
            </Primitive.Item>
          ))}
          <p className={styles.note}>More networks will appear here as they open.</p>

          <Primitive.Separator className={styles.separator} />
          <Primitive.Label className={styles.group}>Show amounts in</Primitive.Label>
          <Primitive.RadioGroup value={choice} onValueChange={(value) => setMoney(value as Display)}>
            {DISPLAYS.map((display) => (
              <Primitive.RadioItem key={display} className={styles.item} value={display}>
                {display === "sol" ? <SolanaMark size={16} /> : <span className={styles.sign}>{NAMES[display].sign}</span>}
                <span>
                  <b>{NAMES[display].long}</b>
                  <small>{display === "sol" ? "The currency you play in" : "Converted at the live rate"}</small>
                </span>
                {choice === display && <Check size={15} className={styles.check} />}
              </Primitive.RadioItem>
            ))}
          </Primitive.RadioGroup>
          {choice !== "sol" && !rate && <p className={styles.note}>The rate is unavailable, so amounts stay in SOL for now.</p>}

          <Primitive.Separator className={styles.separator} />
          <Primitive.Item className={styles.item} asChild>
            <Link href="/wallet">
              <Wallet size={16} />
              <span>
                <b>Open your wallet</b>
              </span>
            </Link>
          </Primitive.Item>
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}

/**
 * The same choice, for the screens too narrow to show the balance pill it
 * normally lives behind. The wallet renders it; wider screens hide it again.
 */
export function CurrencyPicker() {
  const { choice } = useMoney();
  return (
    <div className={styles.picker} role="group" aria-label="Show amounts in">
      <span>Show amounts in</span>
      <div>
        {DISPLAYS.map((display) => (
          <button key={display} aria-pressed={choice === display} onClick={() => setMoney(display)}>
            {NAMES[display].short}
          </button>
        ))}
      </div>
    </div>
  );
}
