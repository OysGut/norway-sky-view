// i18next setup: Norwegian bokmål (nb) is the default language, English (en) is the fallback.
import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import en from "./en.json";
import nb from "./nb.json";

export const defaultLanguage = "nb";

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources: {
      nb: { translation: nb },
      en: { translation: en },
    },
    lng: defaultLanguage,
    fallbackLng: "en",
    interpolation: { escapeValue: false },
  });
}

export default i18n;
