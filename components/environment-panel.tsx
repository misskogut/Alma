"use client";

import { useState } from "react";
import type { CSSProperties } from "react";
import type { ContextKey, EnvironmentPayload } from "../lib/alma";
import { CONTEXT_META, pressureMmHg, weatherLabel } from "../lib/alma";

function valueOrDash(value: number | null | undefined, suffix = "") {
  return value == null ? "—" : `${Math.round(value)}${suffix}`;
}

function daylightLabel(minutes: number | null) {
  if (minutes == null) return "—";
  return `${Math.floor(minutes / 60)} ч ${minutes % 60} мин`;
}

export default function EnvironmentPanel({
  environment,
  loading,
  error,
  onReload,
  onLocation,
}: {
  environment: EnvironmentPayload | null;
  loading: boolean;
  error: string | null;
  onReload: () => void;
  onLocation: (latitude: number, longitude: number, name: string) => void;
}) {
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const current = environment?.current;
  const pressure = pressureMmHg(current?.pressureHpa ?? null);

  function locate() {
    if (!navigator.geolocation) {
      setLocationError("Геопозиция не поддерживается браузером");
      return;
    }
    setLocating(true);
    setLocationError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        onLocation(position.coords.latitude, position.coords.longitude, "Моя геопозиция");
      },
      () => {
        setLocating(false);
        setLocationError("Доступ не дан — оставили Энгельс");
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 900_000 },
    );
  }

  return <section className="environment-card glass-card" aria-labelledby="environment-title">
    <header className="section-header environment-header">
      <div><p className="eyebrow">реальный внешний фон</p><h2 id="environment-title">{environment?.location.name ?? "Энгельс"}</h2></div>
      <div className="environment-actions"><button type="button" onClick={locate} disabled={locating}>{locating ? "…" : "⌖"}<span className="sr-only">Определить геопозицию</span></button><button type="button" onClick={onReload} disabled={loading}>{loading ? "…" : "↻"}<span className="sr-only">Обновить данные</span></button></div>
    </header>

    {error && <div className="source-error"><span>Источник не ответил</span><button type="button" onClick={onReload}>повторить</button></div>}
    {locationError && <p className="location-note">{locationError}</p>}

    <div className={`environment-metrics${loading && !environment ? " is-loading" : ""}`}>
      <article><i className="metric-icon temperature">°</i><small>Температура</small><strong>{valueOrDash(current?.temperatureC, "°")}</strong><em>{weatherLabel(current?.weatherCode ?? null)}</em></article>
      <article><i className="metric-icon pressure">↕</i><small>Давление</small><strong>{valueOrDash(pressure, " мм")}</strong><em>{valueOrDash(current?.pressureHpa, " гПа")}</em></article>
      <article><i className="metric-icon humidity">◌</i><small>Влажность</small><strong>{valueOrDash(current?.humidityPct, "%")}</strong><em>относительная</em></article>
      <article><i className="metric-icon geomagnetic">✦</i><small>Геомагнитный фон</small><strong>{environment?.geomagnetic ? `Kp ${environment.geomagnetic.kp.toFixed(1)}` : "—"}</strong><em>{environment?.geomagnetic && environment.geomagnetic.kp >= 5 ? "повышенный" : "спокойный"}</em></article>
      <article><i className="metric-icon daylight">☼</i><small>Световой день</small><strong>{daylightLabel(current?.daylightMinutes ?? null)}</strong><em>восход → закат</em></article>
      <article><i className="metric-icon wind">∿</i><small>Ветер</small><strong>{valueOrDash(current?.windKph, " км/ч")}</strong><em>текущая скорость</em></article>
    </div>

    <footer className="environment-source-row">
      <span>{environment ? `обновлено ${new Date(environment.generatedAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}` : "ожидаем данные"}</span>
      <div>{environment?.sources.map((source) => <a key={source.name} href={source.url} target="_blank" rel="noreferrer">{source.name}</a>)}</div>
    </footer>
  </section>;
}

export function ContextStrip({ environment, activeContexts, onToggle }: { environment: EnvironmentPayload | null; activeContexts: Set<ContextKey>; onToggle: (key: ContextKey) => void }) {
  return <div className="context-strip-wrap">
    <div className="context-scroller" aria-label="Слои контекста">
      {(Object.keys(CONTEXT_META) as ContextKey[]).map((key) => {
        const unavailable = key !== "cycle" && !environment;
        return <button key={key} type="button" disabled={unavailable} className={`context-chip${activeContexts.has(key) ? " is-active" : ""}`} style={{ "--chip-color": CONTEXT_META[key].color } as CSSProperties} onClick={() => onToggle(key)} aria-pressed={activeContexts.has(key)}><i />{CONTEXT_META[key].label}</button>;
      })}
    </div>
    <p className="context-explainer">Среды накладываются как контекст и не формируют субъективную волну.</p>
  </div>;
}
