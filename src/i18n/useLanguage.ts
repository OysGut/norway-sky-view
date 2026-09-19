import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import i18n from "./index";
import { isLanguage, persistLanguage, resolveLanguage, type Language } from "./language";

function currentI18nLanguage(): Language {
  return isLanguage(i18n.language) ? i18n.language : "nb";
}

export function useLanguage(): {
  language: Language;
  setLanguage: (language: Language) => void;
} {
  const { i18n: instance } = useTranslation();
  const [language, setLanguageState] = useState<Language>(currentI18nLanguage);

  useEffect(() => {
    const resolved = resolveLanguage();
    setLanguageState(resolved);
    if (instance.language !== resolved) {
      void instance.changeLanguage(resolved);
    }
    document.documentElement.lang = resolved;
    // Persist so the next server render starts in the same language.
    persistLanguage(resolved);
  }, [instance]);

  useEffect(() => {
    const onChange = (next: string) => {
      if (isLanguage(next)) setLanguageState(next);
    };
    instance.on("languageChanged", onChange);
    return () => {
      instance.off("languageChanged", onChange);
    };
  }, [instance]);

  const setLanguage = useCallback(
    (next: Language) => {
      setLanguageState(next);
      void instance.changeLanguage(next);
      persistLanguage(next);
      if (typeof document !== "undefined") document.documentElement.lang = next;
    },
    [instance],
  );

  return { language, setLanguage };
}
