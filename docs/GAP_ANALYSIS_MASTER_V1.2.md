# ALMA Master Architecture V1.2 — итоговый gap analysis

Дата обновления: 2026-08-21
Source of truth: `ALMA_MASTER_ARCHITECTURE_V1.2` → Companion → transcript

## Сохранённая точка и переход

- исходный working commit: `56b7c285ee4ef2abc8c03c8d14b2836ba9d12302`;
- исходный GitHub `main`: `694b83c46c7ffb7e52bbfa48e7888ab7fdf7e8e8`;
- backup: `checkpoint/pre-master-v1.2-20260821`;
- refactor branch: `refactor/alma-master-v1.2`;
- последний Core commit на момент этого отчёта: `adde56b`;
- production Vercel не заменён.

Статусы: **IMPLEMENTED** — выполнено в текущем scope; **PARTIAL** — фундамент есть, production-grade часть ещё требуется; **MISSING** — обязательная часть отсутствует; **CONFLICTING** — осталось поведение, противоречащее Master.

## Фазы Master

| Фаза | Статус | Фактический результат |
|---|---|---|
| A — Audit/checkpoint | IMPLEMENTED | Repo, Supabase и Vercel проаудированы; commit и backup branch сохранены; крупные этапы разделены на commits. |
| B — Domain model | IMPLEMENTED | Canonical types, registries, repositories, epistemic/presence/source semantics. |
| C — Migration | IMPLEMENTED | Reversible append-only migrations, local snapshot migrator и compatibility projection; legacy не уничтожается. |
| D — Deterministic Core | IMPLEMENTED | Baseline history, dynamic features, Pattern/Hypothesis/Research/Forecast orchestration без LLM. |
| E — Narrative/Contact | IMPLEMENTED | ru-RU templates, minimal Input Request, immutable Output Feed, attention ranking. |
| F — UI integration | IMPLEMENTED | Существующий prototype пишет и читает canonical records через compatibility store. |
| G — Wave/event UX | IMPLEMENTED | Factual/planned/forecast beads, evidence density, selection filter и intraday range при наличии evidence. |
| H — Foundational blocks | IMPLEMENTED | Basic nutrition, research entry/feed и постоянно доступный быстрый contact control. |
| I — Sync | PARTIAL | Local outbox, idempotent Supabase sync, base-version conflict protection и derived sync работают; browser adapter пока localStorage, аналитика пересчитывается клиентом, не отдельным server worker. |
| J — Tests/docs/deploy | PARTIAL | TypeScript, 58 unit/integration tests и production webpack build проходят; обязательные docs созданы. Отдельный Preview и его commit verification выполняются последним шагом. |

## Definition of Done

| Требование | Статус | Проверка/ограничение |
|---|---|---|
| Activities/events не хранятся как symptoms | IMPLEMENTED | `CanonicalEvent` и event repository; compatibility test защищает классификацию. |
| Чистые data entity types | IMPLEMENTED | Observation/Event/Symptom/Context/Planned/Derived разделены. |
| Measured/confirmed/inferred/predicted/planned различимы | IMPLEMENTED | Epistemic types и отдельные forecast/planned records. |
| Seed/demo не personal evidence | IMPLEMENTED | Migrator и orchestrator исключают source/metadata synthetic; тесты проходят. |
| Load intensity + subjective response | IMPLEMENTED | Отдельные definitions и observations для четырёх нагрузок; libido остаётся state. |
| Overall well-being factual anchor | IMPLEMENTED | Отдельный `overall_wellbeing`; main wave не усредняет load axes. |
| Baseline-relative features с raw units | IMPLEMENTED | Raw observations не меняются; dynamic features и versioned baseline history отдельны. |
| Event beads и relevant filtering | IMPLEMENTED | Factual/planned/forecast variants и фильтрация в текущем wave UI. |
| Lag/inverse/cumulative/interaction | IMPLEMENTED | Deterministic engines и unit coverage. |
| Counterexamples/hysteresis/refinement | IMPLEMENTED | Supports/contradicts/unknown, lifecycle и parent refinement. |
| Multiple hypotheses и Research lifecycle | IMPLEMENTED | Quest, hypotheses, progress, dossier, tools/experiment links. |
| Minimal Input Request | IMPLEMENTED | Ranking, dedup, expiry и progressive batch. |
| Immutable Output Feed | IMPLEMENTED | Read state, refinement link и material-update gate. |
| Deterministic Narrative ru-RU | IMPLEMENTED | Versioned observational templates без причинных/медицинских утверждений. |
| Forecast calibration | IMPLEMENTED | Outcome resolution и Brier score; unknown не считается промахом. |
| Planned events vs facts | IMPLEMENTED | Plan не evidence; confirmation создаёт actual event. |
| Non-medical recommendations/tools/experiments | IMPLEMENTED | Только safe controllable personal actions; medication/food/alcohol intervention исключены. |
| Recalculate after edit/delete | IMPLEMENTED | Dirty ranges, failure restore, pattern/baseline/tool lifecycle и correction feed. |
| Offline input и duplicate-safe sync | IMPLEMENTED/PARTIAL | Работает в browser localStorage + outbox; IndexedDB и background server recompute ещё не реализованы. |
| Registry/adapter extensibility | IMPLEMENTED | Metric/Source registries и unavailable adapters для будущих источников. |
| Recognizable current UI | IMPLEMENTED | Полный redesign не делался; лотос, дуга, волны и approved interactions сохранены. |
| Required tests/docs | IMPLEMENTED | 58 tests и 12 обязательных architecture docs. Некоторые полные browser E2E требуют Preview verification. |

## Оставшиеся PARTIAL/MISSING области

| Область | Статус | Почему не имитируется и следующий шаг |
|---|---|---|
| IndexedDB/mobile durable local store | PARTIAL | Storage contract готов; заменить browser adapter и прогнать offline recovery/E2E. |
| Server-side background recompute | MISSING | Сейчас после pull Core пересчитывается локально и derived records синхронизируются. Нужен отдельный worker/queue без изменения engine contracts. |
| Multi-year incremental performance | PARTIAL | Dirty ranges и derived cache есть, но local orchestrator пока перечитывает eligible history. Добавить windowed dependency graph/background jobs. |
| Exception analysis после forecast/pattern miss | PARTIAL | Counterexample и forecast miss сохраняются; отдельный user-facing exception quest ещё не автоматизирован. |
| Life chapters/context transition narrative | PARTIAL | `ContextPeriod` и modifiers есть; отдельная глава и фраза «паттерн изменился после перехода» требуют UI/narrative сценария. |
| Pregnancy biological mode | MISSING/OUT OF CURRENT RUN | Full tracker явно out of scope; mode interface и подтверждённый переход следует добавить отдельной фазой, не выдумывая медицинские расчёты. |
| Sleep/physiology UI | PARTIAL | Canonical definitions/rails есть; реальный HealthKit/Oura adapter отсутствует. |
| Digital context | INTERFACE ONLY | Android Usage требует native permission; UI не показывает выдуманные данные. |
| Scientific/Population/Safety knowledge | INTERFACE ONLY | Adapters возвращают unavailable; нужны проверенные versioned базы и отдельный opt-in. |
| Runtime voice/LLM interpretation | PARTIAL/PROTOTYPE | Голосовой UX существует, но LLM не является Core dependency; production parser требует отдельного privacy/accuracy этапа. |
| Visual browser E2E | PENDING | Выполнить на отдельном Vercel Preview из точного commit; production не продвигать. |

## Известные внешние границы

- В общем Supabase project обнаружена таблица `device_daily_draws` без RLS; она не относится к ALMA и не изменялась.
- Open-Meteo/NOAA остаются реальными adapters, но точная геолокация должна следовать profile privacy setting.
- HealthKit, Oura, Android Usage, native push, food photo recognition, production population и medical rules не представлены synthetic/demo данными.

## Вывод

Архитектурный фундамент Master V1.2 реализован поверх существующего prototype без переписывания UI с нуля. Оставшиеся разрывы находятся в production rails и отдельных будущих продуктовых сценариях, а не возвращают ALMA к модели symptom tracker. Финальная точка текущего Work run — проверенный Preview из точного GitHub commit без изменения production.
