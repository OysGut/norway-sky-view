// Shared language constants and resolution helpers for client and server.
import { createIsomorphicFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";

export type Language = "nb" | "en";

export const LANGUAGE_STORAGE_KEY = "himinrond.lang";
export const LANGUAGE_COOKIE_NAME = "himinrond_lang";
export const LANGUAGE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isLanguage(value: string | undefined | null): value is Language {
  return value === "nb" || value === "en";
}

export function languageFromBrowserTag(tag: string | undefined): Language {
  const normalized = (tag ?? "").toLowerCase();
  return normalized.startsWith("nb") || normalized.startsWith("nn") || normalized.startsWith("no")
    ? "nb"
    : "en";
}

export function localeOf(language: Language): string {
  return language === "nb" ? "nb-NO" : "en-GB";
}

function readClientCookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  const match = document.cookie
    .split("; ")
    .find((entry) => entry.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : undefined;
}

/** Client: stored value → browser language → nb. Server: cookie → nb. */
export const resolveLanguage = createIsomorphicFn()
  .server((): Language => {
    const cookie = getCookie(LANGUAGE_COOKIE_NAME);
    return isLanguage(cookie) ? cookie : "nb";
  })
  .client((): Language => {
    try {
      const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
      if (isLanguage(stored)) return stored;
    } catch {
      // Storage may be unavailable; fall through to the cookie.
    }

    const cookie = readClientCookie(LANGUAGE_COOKIE_NAME);
    if (isLanguage(cookie)) return cookie;

    if (typeof navigator !== "undefined" && navigator.language) {
      return languageFromBrowserTag(navigator.language);
    }

    return "nb";
  });

export function persistLanguage(language: Language): void {
  if (typeof document === "undefined") return;

  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // The chosen language still applies for this session.
  }

  document.cookie = `${LANGUAGE_COOKIE_NAME}=${language}; path=/; max-age=${LANGUAGE_COOKIE_MAX_AGE}; SameSite=Lax`;
}
