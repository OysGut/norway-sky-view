// Locale-aware formatting helpers for numeric and temporal readouts.
import i18n from "./index";
import { isLanguage, localeOf, type Language } from "./language";

const NBSP = "\u00A0";

export function currentLanguage(): Language {
  return isLanguage(i18n.language) ? i18n.language : "nb";
}

export function formatNumber(
  value: number,
  maximumFractionDigits = 0,
  language: Language = currentLanguage(),
): string {
  return new Intl.NumberFormat(localeOf(language), {
    useGrouping: true,
    maximumFractionDigits,
    minimumFractionDigits: 0,
  }).format(value);
}

export function formatMeters(meters: number, language: Language = currentLanguage()): string {
  return `${formatNumber(meters, 0, language)}${NBSP}m`;
}

export function formatCoordinate(
  lat: number,
  lon: number,
  language: Language = currentLanguage(),
): string {
  const decimals = new Intl.NumberFormat(localeOf(language), {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
    useGrouping: false,
  });

  const latLetter = lat >= 0 ? "N" : "S";
  const lonLetter = lon >= 0 ? (language === "nb" ? "Ø" : "E") : "W";

  return `${decimals.format(Math.abs(lat))}° ${latLetter}, ${decimals.format(Math.abs(lon))}° ${lonLetter}`;
}

export function formatLatitude(lat: number, language: Language = currentLanguage()): string {
  return formatCoordinate(lat, 0, language).split(", ")[0] ?? "";
}

export function formatTime(date: Date, language: Language = currentLanguage()): string {
  return new Intl.DateTimeFormat(localeOf(language), {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function formatDate(date: Date, language: Language = currentLanguage()): string {
  return new Intl.DateTimeFormat(localeOf(language), { dateStyle: "long" }).format(date);
}
