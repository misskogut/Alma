"use client";

import type { CSSProperties, KeyboardEvent, PointerEvent } from "react";
import type { ZoneKey, ZoneValues } from "../lib/alma";
import { ZONE_META, feelingLabel } from "../lib/alma";

export default function BodyCheckin({
  values,
  activeZone,
  onSelect,
  onChange,
  onCommit,
}: {
  values: ZoneValues;
  activeZone: ZoneKey | null;
  onSelect: (zone: ZoneKey) => void;
  onChange: (zone: ZoneKey, value: number) => void;
  onCommit: () => void;
}) {
  function commitPointer(event: PointerEvent<HTMLInputElement>) {
    if (event.button === 0 || event.pointerType === "touch") onCommit();
  }

  function commitKey(event: KeyboardEvent<HTMLInputElement>) {
    if (["ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"].includes(event.key)) onCommit();
  }

  return <section className="body-card glass-card" aria-labelledby="body-title">
    <header className="section-header">
      <div><p className="eyebrow">5–10 секунд</p><h2 id="body-title">Уточнить состояние</h2></div>
      <p>Нажмите на светящуюся область</p>
    </header>

    <div className="body-stage">
      <div className="body-aura" />
      <svg className="body-figure" viewBox="0 0 360 330" role="img" aria-label="Человек в позе лотоса: интерактивные зоны мозга, сердца, тела и нижнего лотоса">
        <defs>
          <linearGradient id="figure-line" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#58b8ff" stopOpacity=".86" /><stop offset=".48" stopColor="#8c63ff" stopOpacity=".55" /><stop offset="1" stopColor="#ff597f" stopOpacity=".78" /></linearGradient>
          <filter id="figure-glow" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="4" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        </defs>
        <circle className="figure-outline" cx="180" cy="60" r="31" />
        <path className="figure-outline" d="M152 85 C139 100 139 124 134 154 C130 178 117 195 92 207" />
        <path className="figure-outline" d="M208 85 C221 100 221 124 226 154 C230 178 243 195 268 207" />
        <path className="figure-outline" d="M143 108 C119 116 107 139 96 166 C86 190 65 208 35 226" />
        <path className="figure-outline" d="M217 108 C241 116 253 139 264 166 C274 190 295 208 325 226" />
        <path className="figure-outline" d="M132 151 C143 199 141 220 117 241 C91 263 62 267 28 256 C67 297 125 299 180 269" />
        <path className="figure-outline" d="M228 151 C217 199 219 220 243 241 C269 263 298 267 332 256 C293 297 235 299 180 269" />
        <path className="figure-outline" d="M92 207 C115 220 134 225 154 232 M268 207 C245 220 226 225 206 232" />

        <g className={`figure-zone brain${activeZone === "cognitive" ? " is-active" : ""}`} filter="url(#figure-glow)">
          <circle className="zone-aura" cx="180" cy="59" r="43" />
          <path d="M162 54 C157 44 166 36 174 42 C178 33 190 36 190 45 C200 42 205 53 198 59 C205 67 196 76 187 71 C182 80 170 74 171 67 C161 70 155 61 162 54Z" />
          <path className="zone-detail" d="M180 42 V72 M163 53 C172 51 173 58 171 67 M197 52 C188 51 188 60 187 71" />
        </g>
        <g className={`figure-zone heart${activeZone === "emotional" ? " is-active" : ""}`} filter="url(#figure-glow)">
          <circle className="zone-aura" cx="180" cy="143" r="34" />
          <path d="M180 137 C161 119 145 143 180 170 C215 143 199 119 180 137Z" />
        </g>
        <g className={`figure-zone body${activeZone === "physical" ? " is-active" : ""}`} filter="url(#figure-glow)">
          <ellipse className="zone-aura" cx="180" cy="190" rx="54" ry="63" />
          <path d="M154 175 C165 183 173 188 180 188 C187 188 195 183 206 175 M157 194 C170 201 190 201 203 194 M164 214 C174 218 186 218 196 214" />
        </g>
        <g className={`figure-zone core${activeZone === "libido" ? " is-active" : ""}`} filter="url(#figure-glow)">
          <circle className="zone-aura" cx="180" cy="254" r="38" />
          <path d="M180 247 C168 233 156 235 149 247 C161 247 168 254 171 265 C158 258 145 263 140 276 C156 273 169 279 180 291 C191 279 204 273 220 276 C215 263 202 258 189 265 C192 254 199 247 211 247 C204 235 192 233 180 247Z" />
        </g>
      </svg>

      <button className="body-hotspot brain" type="button" aria-label="Мозг: когнитивное состояние" onClick={() => onSelect("cognitive")} />
      <button className="body-hotspot heart" type="button" aria-label="Сердце: эмоциональное состояние" onClick={() => onSelect("emotional")} />
      <button className="body-hotspot body" type="button" aria-label="Тело: физическое состояние" onClick={() => onSelect("physical")} />
      <button className="body-hotspot core" type="button" aria-label="Нижний лотос: либидо" onClick={() => onSelect("libido")} />

      <span className="body-label brain">мозг · фокус</span>
      <span className="body-label heart">сердце · эмоции</span>
      <span className="body-label body">тело · энергия</span>
      <span className="body-label core">лотос · либидо</span>
    </div>

    <button className={`social-control${activeZone === "social" ? " is-active" : ""}`} type="button" onClick={() => onSelect("social")}>
      <i><b /><b /><b /></i><span><small>социальный элемент</small>Контакт, поддержка, напряжение</span><strong>›</strong>
    </button>

    {activeZone && <div className="bipolar-editor" style={{ "--zone-color": ZONE_META[activeZone].color } as CSSProperties}>
      <div className="bipolar-title">
        <div><small>{ZONE_META[activeZone].label}</small><strong>{feelingLabel(values[activeZone])}</strong></div>
        <output>{values[activeZone] > 0 ? "+" : ""}{values[activeZone]}</output>
      </div>
      <div className="bipolar-track-wrap">
        <span className="center-tick" aria-hidden="true" />
        <input type="range" min="-100" max="100" step="1" value={values[activeZone]} aria-label={`${ZONE_META[activeZone].label}: от минус ста до плюс ста, ноль нейтрально`} onChange={(event) => onChange(activeZone, Number(event.target.value))} onPointerUp={commitPointer} onKeyUp={commitKey} />
      </div>
      <div className="bipolar-labels">
        <span><b>−100</b>сильно негативно</span>
        <span className="neutral"><b>0</b>нейтрально</span>
        <span><b>+100</b>сильно позитивно</span>
      </div>
      <div className="zone-extremes"><span>{ZONE_META[activeZone].negative}</span><button type="button" onClick={() => onChange(activeZone, 0)}>к нейтрали</button><span>{ZONE_META[activeZone].positive}</span></div>
    </div>}
  </section>;
}
