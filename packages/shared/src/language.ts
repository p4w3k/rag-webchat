/**
 * Cheap Polish/English guess for short texts, without dependencies so the widget
 * can import it. Used for fallback messages and to pick the reading voice.
 */
export function guessLanguage(text: string): "pl" | "en" {
  return /[ąćęłńóśźż]|\b(czy|jak|ile|jest|nie|dla|się|pompa|cena|koszt)\b/i.test(text) ? "pl" : "en";
}
