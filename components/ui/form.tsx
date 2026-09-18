"use client";
import { useEffect, useId, useRef, useState, type ComponentProps } from "react";
import { CircleAlert } from "lucide-react";
import styles from "./overlays.module.css";

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
type FieldError = { field: Field; id: string; label: string; message: string };
const isField = (element: Element): element is Field => element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement;

function message(field: Field) {
  const validity = field.validity;
  if (validity.valueMissing) return field instanceof HTMLInputElement && field.type === "checkbox" ? "Please check this box to continue." : "Please fill in this field.";
  if (validity.typeMismatch) return field instanceof HTMLInputElement && field.type === "email" ? "Enter a valid email address." : "Enter a valid value.";
  if (validity.tooShort) return `Use at least ${(field as HTMLInputElement).minLength} characters.`;
  if (validity.tooLong) return `Use no more than ${(field as HTMLInputElement).maxLength} characters.`;
  if (validity.rangeUnderflow) return `Enter ${ (field as HTMLInputElement).min } or more.`;
  if (validity.rangeOverflow) return `Enter ${ (field as HTMLInputElement).max } or less.`;
  if (validity.patternMismatch) return field.dataset.formatHint ?? "Use the format described for this field.";
  if (validity.stepMismatch) return `Use increments of ${(field as HTMLInputElement).step || "1"}.`;
  if (validity.badInput) return "Enter a valid number.";
  return field.validationMessage || "Please check this field.";
}

/** Keep HTML constraints and submission handlers, with accessible, branded errors. */
export function Form({ children, onSubmitCapture, onInputCapture, onReset, ...props }: ComponentProps<"form">) {
  const prefix = useId();
  const [errors, setErrors] = useState<FieldError[]>([]);
  const original = useRef(new Map<Field, { invalid: string | null; description: string | null }>());
  const clear = (field: Field) => {
    const attributes = original.current.get(field);
    if (!attributes) return;
    for (const [name, value] of [["aria-invalid", attributes.invalid], ["aria-describedby", attributes.description]]) {
      if (value === null) field.removeAttribute(name!); else field.setAttribute(name!, value!);
    }
    original.current.delete(field);
  };
  useEffect(() => {
    const attributes = original.current;
    return () => {
      for (const [field, previous] of attributes) {
        if (previous.invalid === null) field.removeAttribute("aria-invalid"); else field.setAttribute("aria-invalid", previous.invalid);
        if (previous.description === null) field.removeAttribute("aria-describedby"); else field.setAttribute("aria-describedby", previous.description);
      }
    };
  }, []);

  return <form {...props} noValidate onInvalidCapture={(event) => event.preventDefault()} onSubmitCapture={(event) => {
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const skip = submitter instanceof HTMLButtonElement || submitter instanceof HTMLInputElement ? submitter.formNoValidate : false;
    const next: FieldError[] = [];
    for (const [index, element] of Array.from(event.currentTarget.elements).entries()) {
      if (!isField(element)) continue;
      clear(element);
      if (skip || !element.willValidate || element.validity.valid) continue;
      const id = `${prefix}-error-${index}`;
      const description = element.getAttribute("aria-describedby");
      original.current.set(element, { invalid: element.getAttribute("aria-invalid"), description });
      element.setAttribute("aria-invalid", "true");
      element.setAttribute("aria-describedby", [description, id].filter(Boolean).join(" "));
      const label = element.getAttribute("aria-label") || element.labels?.[0]?.textContent?.trim() || element.getAttribute("placeholder") || "Field";
      next.push({ field: element, id, label, message: message(element) });
    }
    setErrors(next);
    if (next.length) {
      event.preventDefault();
      event.stopPropagation();
      next[0].field.focus();
      return;
    }
    onSubmitCapture?.(event);
  }} onInputCapture={(event) => {
    const field = event.target;
    if (field instanceof Element && isField(field) && original.current.has(field)) {
      if (field.validity.valid) {
        clear(field);
        setErrors((current) => current.filter((error) => error.field !== field));
      } else setErrors((current) => current.map((error) => error.field === field ? { ...error, message: message(field) } : error));
    }
    onInputCapture?.(event);
  }} onReset={(event) => {
    for (const field of original.current.keys()) clear(field);
    setErrors([]);
    onReset?.(event);
  }}>
    {children}
    {errors.length > 0 && <div className={styles.validation} role="alert"><CircleAlert size={17} aria-hidden="true" /><div><strong>Check {errors.length === 1 ? "this field" : "these fields"}</strong><ul>{errors.map((error) => <li key={error.id} id={error.id}><button type="button" onClick={() => error.field.focus()}><b>{error.label}</b><span>{error.message}</span></button></li>)}</ul></div></div>}
  </form>;
}
