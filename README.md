# ALMA

Мобильный web-прототип персональной системы наблюдения и интерпретации состояния во времени. Архитектура следует `ALMA_MASTER_ARCHITECTURE_V1.2`: ввод — это уточнение, а не обязанность; факты, inference, forecasts и plans разделены; deterministic Core работает без LLM.

## Локальный запуск

```bash
npm install
npm run dev
```

Откройте `http://localhost:3000`.

## Проверка

```bash
npm run typecheck
npm test
./node_modules/.bin/next build --webpack
```

Webpack указан явно из-за workspace symlink `node_modules`; это не ошибка приложения.

## Реализованный фундамент

- канонические observations, events, symptom episodes, contexts и planned events;
- epistemic/presence/source semantics и declarative registries;
- reversible Supabase migrations, RLS, local outbox и conflict-safe sync;
- compatibility migration прежнего local snapshot без synthetic evidence;
- baselines с историей, dynamic features и deterministic Pattern Engine;
- lag, inverse, cumulative/streak, interactions, counterexamples, hysteresis и refinement;
- Research Quests, минимальный Input Request, immutable Output Feed и ru-RU Narrative;
- calibratable forecasts, non-medical recommendations, personal tools и experiments;
- утверждённый тёмный UI, лотос, волны, event beads, питание и research block.

## Честные границы

HealthKit, Watch/Oura, Android Usage, native push, runtime LLM, production Population Engine, заполненная Scientific KB, validated Safety KB и food photo recognition не симулируются. Для них существуют interfaces с явным unavailable state.

Архитектурные решения и причины описаны в [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). ALMA наблюдает персональные закономерности, но не ставит диагнозы и не назначает лечение.
