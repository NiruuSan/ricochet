"use client";
import { cloneElement, type ReactElement } from "react";
import { Tooltip as Primitive } from "radix-ui";
import styles from "./overlays.module.css";

export function Tooltip({ content, children }: { content?: string | null; children: ReactElement<{ tabIndex?: number }> }) {
  if (!content) return children;
  return <Primitive.Provider delayDuration={400}><Primitive.Root><Primitive.Trigger asChild>{cloneElement(children, { tabIndex: children.props.tabIndex ?? 0 })}</Primitive.Trigger><Primitive.Portal><Primitive.Content className={styles.tooltip} sideOffset={8} collisionPadding={12}>{content}<Primitive.Arrow className={styles.tooltipArrow} /></Primitive.Content></Primitive.Portal></Primitive.Root></Primitive.Provider>;
}
