"use client";
import type { ReactNode } from "react";
import Link from "next/link";
import { DropdownMenu as Primitive } from "radix-ui";
import styles from "./overlays.module.css";

/** One line of a menu: a link somewhere, or something to do. */
export type MenuItem = {
  label: string;
  icon?: ReactNode;
  href?: string;
  onSelect?: () => void;
  /** Sets it apart from the rest: signing out, leaving, deleting. */
  danger?: boolean;
  /** Draws a line above this item. */
  separated?: boolean;
};

/** A small menu under a trigger: the account menu in the top bar, and anything like it. */
export function Menu({ label, trigger, items, triggerClassName }: { label: string; trigger: ReactNode; items: MenuItem[]; triggerClassName?: string }) {
  return (
    <Primitive.Root>
      <Primitive.Trigger className={triggerClassName} aria-label={label}>
        {trigger}
      </Primitive.Trigger>
      <Primitive.Portal>
        <Primitive.Content className={styles.menuContent} align="end" sideOffset={9} collisionPadding={12}>
          {items.map((item) => (
            <div key={item.label}>
              {item.separated && <Primitive.Separator className={styles.menuSeparator} />}
              <Primitive.Item className={`${styles.menuItem} ${item.danger ? styles.menuItemDanger : ""}`} onSelect={item.onSelect} asChild={!!item.href}>
                {item.href ? (
                  <Link href={item.href}>
                    {item.icon}
                    {item.label}
                  </Link>
                ) : (
                  <>
                    {item.icon}
                    {item.label}
                  </>
                )}
              </Primitive.Item>
            </div>
          ))}
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}
