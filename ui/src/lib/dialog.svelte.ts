/* Dialogs, as promises.
 *
 * `const name = await prompt(...)` rather than a pile of callbacks. Each resolves with a
 * value when confirmed and null when dismissed. The host component (ui/SheetHost.svelte)
 * draws whatever is on this stack; nothing here touches the page.
 */
import type { Component } from "svelte";

export interface Field {
  name: string;
  label: string;
  type?: "text" | "textarea" | "number" | "password" | "checkbox" | "select" | "date" | "time" | "color";
  value?: string | number | boolean;
  placeholder?: string;
  required?: boolean;
  maxlength?: number;
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
  options?: { value: string; label: string }[];
  autocomplete?: string;
}

export interface SheetSpec {
  title: string;
  sub?: string;
  confirm?: string;        // "" hides the confirm button
  cancel?: string;
  danger?: boolean;
  wide?: boolean;
  fields?: Field[];
  /** A component for anything a list of fields cannot say. It receives `close(value)`
   *  and whatever is in `props`. */
  body?: Component<any>;
  props?: Record<string, unknown>;
}

export interface OpenSheet extends SheetSpec {
  id: number;
  resolve: (value: any) => void;
}

export const sheets = $state<{ stack: OpenSheet[] }>({ stack: [] });
let next = 1;

export function sheet<T = Record<string, any>>(spec: SheetSpec): Promise<T | null> {
  return new Promise((resolve) => {
    const id = next++;
    sheets.stack = [...sheets.stack, {
      ...spec, id,
      resolve: (value: any) => {
        sheets.stack = sheets.stack.filter((s) => s.id !== id);
        resolve(value);
      },
    }];
  });
}

/** A yes or no about something that cannot be taken back. */
export function confirm(title: string, sub?: string, yes = "Yes, do it", no = "Keep it"): Promise<boolean> {
  return sheet({ title, sub, confirm: yes, cancel: no, danger: true }).then((v) => v !== null);
}

/** One line of text. Resolves with the trimmed text, or null. */
export async function prompt(opts: {
  title: string; sub?: string; label?: string; value?: string; placeholder?: string;
  confirm?: string; maxlength?: number; multiline?: boolean;
}): Promise<string | null> {
  const said = await sheet<{ value: string }>({
    title: opts.title, sub: opts.sub, confirm: opts.confirm || "Save",
    fields: [{
      name: "value", label: opts.label || "", type: opts.multiline ? "textarea" : "text",
      value: opts.value || "", placeholder: opts.placeholder, maxlength: opts.maxlength,
    }],
  });
  if (!said) return null;
  return String(said.value || "").trim();
}

export const anySheetOpen = () => sheets.stack.length > 0;
