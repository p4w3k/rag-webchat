export type Lang = "pl" | "en";

export const strings = {
  pl: {
    open: "Otwórz czat",
    close: "Zamknij czat",
    title: "Asystent",
    subtitle: "Odpowiadam na podstawie naszych materiałów",
    greeting: "Dzień dobry! W czym mogę pomóc? Zapytaj o produkty, ceny lub usługi.",
    placeholder: "Napisz wiadomość…",
    send: "Wyślij",
    sources: "Źródła",
    page: "s.",
    thinking: "Szukam odpowiedzi…",
    errorNetwork: "Nie udało się połączyć. Spróbuj ponownie za chwilę.",
    errorRateLimited: "Wysłano zbyt wiele wiadomości. Spróbuj ponownie później.",
    errorGeneric: "Coś poszło nie tak. Spróbuj ponownie.",
    privacy: "Nie podawaj danych osobowych. Rozmowy przechowujemy przez 30 dni.",
    demoNotice: "Tryb demo: odpowiedzi są przykładowe.",
    newChat: "Nowa rozmowa",
    micStart: "Mów (mikrofon)",
    micStop: "Zakończ i wyślij",
    listening: "Słucham… mów po polsku lub po angielsku",
    connecting: "Włączam mikrofon…",
    voiceOn: "Odczytuj odpowiedzi na głos",
    voiceOff: "Nie odczytuj odpowiedzi",
    stopSpeaking: "Zatrzymaj odczyt",
    errorMic: "Brak dostępu do mikrofonu. Zezwól na mikrofon w przeglądarce lub napisz wiadomość.",
    errorVoice: "Nie udało się włączyć rozmowy głosowej. Spróbuj ponownie lub napisz wiadomość.",
    notHeard: "Nic nie usłyszałem. Spróbuj jeszcze raz.",
  },
  en: {
    open: "Open chat",
    close: "Close chat",
    title: "Assistant",
    subtitle: "Answers based on our documents",
    greeting: "Hello! How can I help? Ask about our products, prices or services.",
    placeholder: "Type a message…",
    send: "Send",
    sources: "Sources",
    page: "p.",
    thinking: "Looking that up…",
    errorNetwork: "Couldn't connect. Please try again in a moment.",
    errorRateLimited: "Too many messages. Please try again later.",
    errorGeneric: "Something went wrong. Please try again.",
    privacy: "Please don't share personal data. Conversations are kept for 30 days.",
    demoNotice: "Demo mode: answers are examples.",
    newChat: "New chat",
    micStart: "Speak (microphone)",
    micStop: "Stop and send",
    listening: "Listening… speak Polish or English",
    connecting: "Starting the microphone…",
    voiceOn: "Read answers aloud",
    voiceOff: "Don't read answers aloud",
    stopSpeaking: "Stop reading",
    errorMic: "No microphone access. Allow the microphone in your browser, or type a message.",
    errorVoice: "Couldn't start voice. Please try again, or type a message.",
    notHeard: "I didn't catch anything. Please try again.",
  },
} satisfies Record<Lang, Record<string, string>>;

export type Strings = (typeof strings)["pl"];

/** Explicit setting first, then the page's lang attribute, then the browser. */
export function pickLang(explicit: string | null | undefined, pageLang: string, browserLang: string): Lang {
  for (const candidate of [explicit, pageLang, browserLang]) {
    const code = candidate?.trim().toLowerCase().slice(0, 2);
    if (code === "pl" || code === "en") return code;
  }
  return "en";
}
