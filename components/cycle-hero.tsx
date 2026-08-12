import type { AlmaProfile, CyclePhase, DayModel } from "../lib/alma";
import { getCycleMarker, phaseHint, phaseLabel, relativeDayLabel } from "../lib/alma";

const PHASE_COLOR: Record<CyclePhase, string> = {
  menstruation: "#ff4f73",
  follicular: "#856cff",
  fertile: "#c95cff",
  ovulation: "#ff5ad7",
  luteal: "#8b6cdb",
};

function orbitPoint(index: number, total: number) {
  const progress = total <= 1 ? 0.5 : index / (total - 1);
  return {
    x: 24 + progress * 332,
    y: 91 - Math.sin(progress * Math.PI) * 67,
  };
}

export default function CycleHero({ profile, day, onOpenSettings }: { profile: AlmaProfile; day: DayModel; onOpenSettings: () => void }) {
  const color = PHASE_COLOR[day.phase];
  const orbit = Array.from({ length: profile.cycleLength }, (_, index) => {
    const cycleDay = index + 1;
    return { cycleDay, marker: getCycleMarker(cycleDay, profile), ...orbitPoint(index, profile.cycleLength) };
  });
  const active = orbit[day.cycleDay - 1];

  return <section className={`cycle-hero phase-${day.phase}`} style={{ "--cycle-color": color } as React.CSSProperties} aria-labelledby="cycle-title">
    <div className="cosmic-dust" aria-hidden="true">{Array.from({ length: 34 }, (_, index) => <i key={index} />)}</div>
    <button className="cycle-settings-button" type="button" onClick={onOpenSettings} aria-label="Настроить цикл">
      <span>цикл {profile.cycleLength} дн.</span><i>⌁</i>
    </button>

    <svg className="cycle-orbit" viewBox="0 0 380 120" aria-label={`Цикл: день ${day.cycleDay} из ${profile.cycleLength}`}>
      <defs>
        <linearGradient id="orbit-gradient" x1="0" x2="1"><stop stopColor="#ff526d" /><stop offset=".4" stopColor="#9e62ff" /><stop offset=".54" stopColor="#ff60d8" /><stop offset="1" stopColor="#62529a" /></linearGradient>
        <filter id="orbit-glow" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="4" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
      </defs>
      <path className="orbit-track" d="M24 91 C89 -1 291 -1 356 91" />
      <path className="orbit-progress" d={`M24 91 C89 -1 291 -1 356 91`} pathLength="100" style={{ strokeDasharray: `${((day.cycleDay - 1) / Math.max(1, profile.cycleLength - 1)) * 100} 100` }} />
      {orbit.map((item) => <g key={item.cycleDay} transform={`translate(${item.x} ${item.y})`}>
        {item.marker === "menstruation" && <circle className="orbit-marker period" r="3.1" />}
        {item.marker === "fertile" && <circle className="orbit-marker fertile" r="2.7" />}
        {item.marker === "ovulation" && <path className="orbit-marker ovulation" d="M0 -5 C4 -2 5 2 0 6 C-5 2 -4 -2 0 -5Z" />}
        {!item.marker && <circle className="orbit-tick" r="1.25" />}
      </g>)}
      {active && <g className="active-cycle-orb" transform={`translate(${active.x} ${active.y})`} filter="url(#orbit-glow)">
        <circle r="16" /><circle r="6" /><text y="-22" textAnchor="middle">{day.isToday ? "сегодня" : relativeDayLabel(day.iso).toLowerCase()}</text>
      </g>}
    </svg>

    <div className="phase-badge"><span>{relativeDayLabel(day.iso)}</span><strong>{phaseLabel(day.phase)}</strong></div>

    <svg className="cycle-lotus" viewBox="0 0 380 230" role="img" aria-labelledby="cycle-title cycle-description">
      <defs>
        <radialGradient id="lotus-fill"><stop offset="0" stopColor="#ec8fff" stopOpacity=".34" /><stop offset=".62" stopColor={color} stopOpacity=".13" /><stop offset="1" stopColor="#030107" stopOpacity="0" /></radialGradient>
        <filter id="lotus-glow" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="5" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
      </defs>
      <ellipse className="lotus-aura" cx="190" cy="137" rx="146" ry="105" />
      <g className="lotus-petals rear" filter="url(#lotus-glow)">
        <path d="M190 179 C150 164 128 124 141 78 C176 91 191 124 190 179Z" />
        <path d="M190 179 C230 164 252 124 239 78 C204 91 189 124 190 179Z" />
        <path d="M166 182 C120 178 83 153 78 112 C118 112 153 136 166 182Z" />
        <path d="M214 182 C260 178 297 153 302 112 C262 112 227 136 214 182Z" />
      </g>
      <g className="lotus-petals front" filter="url(#lotus-glow)">
        <path d="M190 181 C154 156 151 101 190 58 C229 101 226 156 190 181Z" />
        <path d="M187 184 C142 188 101 176 73 145 C111 132 155 145 187 184Z" />
        <path d="M193 184 C238 188 279 176 307 145 C269 132 225 145 193 184Z" />
        <path d="M190 187 C142 205 98 202 58 175 C100 158 150 163 190 187Z" />
        <path d="M190 187 C238 205 282 202 322 175 C280 158 230 163 190 187Z" />
      </g>
      <text className="lotus-day" x="190" y="137" textAnchor="middle">{day.cycleDay}</text>
      <text className="lotus-day-label" x="190" y="155" textAnchor="middle">день цикла</text>
    </svg>

    <div className="cycle-copy">
      <h1 id="cycle-title">{day.isToday ? `Сегодня — ${phaseLabel(day.phase).toLowerCase()}` : `${relativeDayLabel(day.iso)} · ${phaseLabel(day.phase).toLowerCase()}`}</h1>
      <p id="cycle-description">{phaseHint(day.phase)}. Это календарный ориентир, не медицинское заключение.</p>
    </div>

    <div className="cycle-marker-legend" aria-label="Маркеры цикла">
      <span><i className="period" />менструация</span>
      <span><i className="fertile" />фертильное окно</span>
      <span><i className="ovulation" />овуляция</span>
    </div>
  </section>;
}
