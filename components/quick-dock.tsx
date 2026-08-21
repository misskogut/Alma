"use client";

import { useEffect, useMemo, useState } from "react";
import { metricDefinition } from "../lib/alma-core";
import type { InputRequestRecord, OutputFeedRecord } from "../lib/alma-core";

type InputAnswer = {
  requestId: string;
  present?: boolean;
  value?: number;
  quantity?: number;
};

export default function QuickDock({
  requests,
  outputFeed,
  onAnswer,
  onMarkRead,
  onVoice,
}: {
  requests: InputRequestRecord[];
  outputFeed: OutputFeedRecord[];
  onAnswer: (answer: InputAnswer) => void;
  onMarkRead: (id: string) => void;
  onVoice: () => void;
}) {
  const [open, setOpen] = useState<"input" | "output" | null>(null);
  const [sliderValue, setSliderValue] = useState(0);
  const [answered, setAnswered] = useState(false);
  const request = requests[0];
  const output = outputFeed[0];
  const unreadCount = outputFeed.filter((item) => !item.readAt).length;
  const definition = request ? metricDefinition(request.targetDefinitionId) : undefined;
  const answerKind = request ? requestAnswerKind(request.targetDefinitionId, definition?.kind) : "binary";
  const slider = useMemo(() => sliderConfig(request?.targetDefinitionId, answerKind), [request?.targetDefinitionId, answerKind]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  useEffect(() => {
    setSliderValue(slider.initial);
  }, [request?.id, slider.initial]);

  function submit(answer: Omit<InputAnswer, "requestId">) {
    if (!request) return;
    onAnswer({ requestId: request.id, ...answer });
    setAnswered(true);
  }

  function close() {
    setOpen(null);
    setAnswered(false);
  }

  return <>
    <nav className="quick-dock" aria-label="Быстрый ввод и результаты">
      <button type="button" className="quick-dock-input" onClick={() => setOpen("input")} aria-label={request ? "Ответить на один короткий вопрос" : "Открыть быстрый ввод"}>
        <i>＋</i><span>Ввод</span>{requests.length > 0 && <b>{requests.length}</b>}
      </button>
      <button className="quick-dock-voice" type="button" onClick={onVoice} aria-label="Рассказать о дне голосом">
        <svg viewBox="0 0 48 48" aria-hidden="true"><defs><linearGradient id="quick-voice-rainbow" x1="8" y1="8" x2="40" y2="40"><stop stopColor="#6ce8ff"/><stop offset=".34" stopColor="#a979ff"/><stop offset=".68" stopColor="#ff83c9"/><stop offset="1" stopColor="#ffd176"/></linearGradient></defs><rect x="17" y="7" width="14" height="23" rx="7"/><path d="M12 24a12 12 0 0 0 24 0M24 36v6M17 42h14"/></svg>
        <span>рассказать</span>
      </button>
      <button type="button" className="quick-dock-output" onClick={() => setOpen("output")} aria-label="Посмотреть новые наблюдения ALMA">
        <i>✦</i><span>Новое</span>{unreadCount > 0 && <b>{unreadCount}</b>}
      </button>
    </nav>

    {open === "input" && <div className="quick-sheet-layer" role="presentation" onPointerDown={(event) => event.target === event.currentTarget && close()}>
      <section className="quick-sheet quick-input-sheet" role="dialog" aria-modal="true" aria-labelledby="quick-input-title">
        <header><div><p className="eyebrow">одно полезное уточнение</p><h2 id="quick-input-title">{request ? questionFor(request.targetDefinitionId) : "Можно рассказать о дне"}</h2></div><button type="button" aria-label="Закрыть" onClick={close}>×</button></header>
        {!request ? <div className="quick-sheet-empty"><p>Сейчас ALMA не нужен дополнительный ответ. Если хочется что-то отметить, можно воспользоваться голосовым вводом.</p><button type="button" onClick={() => { close(); onVoice(); }}>рассказать голосом</button></div> : answered ? <div className="quick-answer-success"><i>✓</i><strong>Готово</strong><p>Ответ сохранён и поможет сравнить этот день с другими. Никаких дополнительных форм заполнять не нужно.</p><button type="button" onClick={close}>закрыть</button></div> : <>
          <p className="quick-question-reason">{request.explanation}</p>
          {answerKind === "intake" && <div className="quick-answer-options">
            <button type="button" onClick={() => submit({ present: false })}>не было</button>
            <button type="button" onClick={() => submit({ present: true, quantity: 1 })}>было</button>
            <label><span>Количество — если важно</span><input type="number" min="0" max="20" step="0.5" value={sliderValue || ""} placeholder="—" onChange={(event) => setSliderValue(Number(event.target.value))} /></label>
            <button type="button" disabled={sliderValue <= 0} onClick={() => submit({ present: true, quantity: sliderValue })}>сохранить количество</button>
          </div>}
          {answerKind === "binary" && <div className="quick-answer-options binary"><button type="button" onClick={() => submit({ present: false })}>нет</button><button type="button" onClick={() => submit({ present: true })}>да</button></div>}
          {answerKind === "scale" && <div className="quick-scale-answer">
            <div><span>{slider.minimumLabel}</span><b>{sliderValue > 0 ? "+" : ""}{sliderValue}</b><span>{slider.maximumLabel}</span></div>
            <input type="range" min={slider.minimum} max={slider.maximum} value={sliderValue} onChange={(event) => setSliderValue(Number(event.target.value))} />
            <button type="button" onClick={() => submit({ present: true, value: sliderValue / 100 })}>сохранить</button>
          </div>}
          <details><summary>Почему ALMA спрашивает?</summary><p>Этот ответ имеет высокую ценность для текущего личного вопроса и занимает меньше минуты. Если не отвечать, ничего не сломается — запрос просто не станет фактом.</p></details>
        </>}
      </section>
    </div>}

    {open === "output" && <div className="quick-sheet-layer" role="presentation" onPointerDown={(event) => event.target === event.currentTarget && close()}>
      <section className="quick-sheet quick-output-sheet" role="dialog" aria-modal="true" aria-labelledby="quick-output-title">
        <header><div><p className="eyebrow">самое важное сейчас</p><h2 id="quick-output-title">Что заметила ALMA</h2></div><button type="button" aria-label="Закрыть" onClick={close}>×</button></header>
        {!output ? <div className="quick-sheet-empty"><i>∿</i><strong>Новых личных наблюдений пока нет</strong><p>ALMA не будет придумывать выводы. Они появятся, когда в истории накопятся повторения и полезные сравнения.</p></div> : <article className={output.readAt ? "is-read" : "is-unread"}>
          <span>{output.readAt ? "прочитано" : "новое наблюдение"}</span><h3>{output.title}</h3><p>{output.body}</p>
          <small>Это закономерность в ваших наблюдениях, а не медицинское заключение.</small>
          {!output.readAt && <button type="button" onClick={() => onMarkRead(output.id)}>понятно, отметить прочитанным</button>}
        </article>}
      </section>
    </div>}
  </>;
}

function requestAnswerKind(definitionId: string, kind?: string): "intake" | "binary" | "scale" {
  if (kind === "intake") return "intake";
  if (kind === "symptom" || kind === "activity" || kind === "social_event" || kind === "cycle_event" || kind === "physiology_signal") return "binary";
  if (definitionId.includes("load") || kind === "state" || kind === "metric") return "scale";
  return "binary";
}

function questionFor(definitionId: string) {
  const label = metricDefinition(definitionId)?.label ?? "это наблюдение";
  if (definitionId.endsWith("_load_intensity")) return `Сколько было: ${label.toLocaleLowerCase("ru-RU")}?`;
  if (definitionId.endsWith("_load_response")) return `Как ощущалась ${label.replace(/^Отклик на /u, "").toLocaleLowerCase("ru-RU")}?`;
  if (definitionId === "overall_wellbeing") return "Как ваше общее самочувствие сегодня?";
  if (metricDefinition(definitionId)?.kind === "intake") return `Сегодня был ${label.toLocaleLowerCase("ru-RU")}?`;
  return `Сегодня было: ${label.toLocaleLowerCase("ru-RU")}?`;
}

function sliderConfig(definitionId: string | undefined, kind: "intake" | "binary" | "scale") {
  if (kind !== "scale") return { minimum: 0, maximum: 20, initial: 0, minimumLabel: "", maximumLabel: "" };
  if (definitionId?.endsWith("_load_intensity")) return { minimum: 0, maximum: 100, initial: 50, minimumLabel: "мало", maximumLabel: "много" };
  if (definitionId?.endsWith("_load_response")) return { minimum: -100, maximum: 100, initial: 0, minimumLabel: "тяжело", maximumLabel: "поддерживала" };
  if (definitionId === "overall_wellbeing") return { minimum: -100, maximum: 100, initial: 0, minimumLabel: "плохо", maximumLabel: "хорошо" };
  if (definitionId === "libido") return { minimum: -100, maximum: 100, initial: 0, minimumLabel: "ниже обычного", maximumLabel: "выше обычного" };
  return { minimum: 0, maximum: 100, initial: 50, minimumLabel: "почти нет", maximumLabel: "очень заметно" };
}
