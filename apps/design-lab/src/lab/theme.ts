/**
 * The appearance a lab page renders in, from `?theme=`. Dark is the default, so every URL written
 * before themes existed still shows what it showed. A direction lists the themes it draws in its
 * meta.ts; the ones that draw only dark ignore the parameter.
 */
export type LabTheme = "dark" | "light";

export const LAB_THEMES: readonly LabTheme[] = ["dark", "light"];

export const DEFAULT_THEME: LabTheme = "dark";

export function isLabTheme(value: string): value is LabTheme {
  return (LAB_THEMES as readonly string[]).includes(value);
}
