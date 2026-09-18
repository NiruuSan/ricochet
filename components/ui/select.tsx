"use client";
import { Select as Primitive } from "radix-ui";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import styles from "./overlays.module.css";

export function Select({ value, onValueChange, label, options }: { value: string; onValueChange: (value: string) => void; label: string; options: { value: string; label: string }[] }) {
  return <Primitive.Root value={value} onValueChange={onValueChange}>
    <Primitive.Trigger className={styles.selectTrigger} aria-label={label}><Primitive.Value /><Primitive.Icon><ChevronDown size={14} /></Primitive.Icon></Primitive.Trigger>
    <Primitive.Portal><Primitive.Content className={styles.selectContent} position="popper" sideOffset={8} collisionPadding={12}>
      <Primitive.ScrollUpButton className={styles.selectScroll}><ChevronUp size={15} /></Primitive.ScrollUpButton>
      <Primitive.Viewport>{options.map((option) => <Primitive.Item key={option.value} value={option.value} className={styles.selectItem}><Primitive.ItemText>{option.label}</Primitive.ItemText><Primitive.ItemIndicator><Check size={15} /></Primitive.ItemIndicator></Primitive.Item>)}</Primitive.Viewport>
      <Primitive.ScrollDownButton className={styles.selectScroll}><ChevronDown size={15} /></Primitive.ScrollDownButton>
    </Primitive.Content></Primitive.Portal>
  </Primitive.Root>;
}
