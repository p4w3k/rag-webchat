import type { ChatStreamEvent } from "@rag-webchat/shared";
import type { Lang } from "./i18n.js";

/**
 * Offline stand-in for the chat API, used with ?chatdemo=1 or data-demo="true".
 * It lets you try the widget before Bedrock is enabled; answers are canned.
 */
export async function* demoStream(message: string, lang: Lang): AsyncGenerator<ChatStreamEvent> {
  const m = message.toLowerCase();
  const pl = lang === "pl";
  let text: string;
  let citations = [{ title: "cieplolux-oferta-2026.pdf", page: 1 }];
  if (/komfort|cen|koszt|price|cost/.test(m)) {
    text = pl
      ? "Pompa ciepła Ciepłolux Komfort 9 (9 kW, dla domów 120–200 m²) kosztuje 38 500 zł brutto, z montażem i uruchomieniem. [1]"
      : "The Ciepłolux Komfort 9 heat pump (9 kW, for 120–200 m² homes) costs PLN 38,500 including VAT, installation and start-up. [1]";
  } else if (/gwaranc|warrant/.test(m)) {
    text = pl
      ? "Na pompy ciepła udzielamy 5 lat gwarancji, a na sprężarkę 10 lat. Warunkiem jest coroczny przegląd. [1]"
      : "Heat pumps come with a 5-year warranty and the compressor with 10 years, provided there is an annual service. [1]";
    citations = [{ title: "cieplolux-oferta-2026.pdf", page: 2 }];
  } else {
    text = pl
      ? "To odpowiedź przykładowa z trybu demo. Po włączeniu Bedrock asystent odpowie na podstawie dokumentów firmy."
      : "This is an example answer from demo mode. Once Bedrock is enabled, the assistant answers from the company's documents.";
    citations = [];
  }
  await sleep(500);
  for (const word of text.split(/(?<= )/)) {
    yield { type: "token", text: word };
    await sleep(35);
  }
  if (citations.length > 0) yield { type: "citations", citations };
  yield { type: "done", messageId: `demo-${Date.now()}` };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
