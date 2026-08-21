# ALMA Master Architecture V1.2 — gap analysis

Дата аудита: 2026-08-21  
Канонический источник: `ALMA_MASTER_ARCHITECTURE_V1.2`  
Пояснение решений: `ALMA_ARCHITECTURE_INTERVIEW_COMPANION_V1.2`  
Уточнение смысла: соответствующие фрагменты стенограммы архитектурного интервью

## Зафиксированное состояние до рефакторинга

- Локальный working commit: `56b7c285ee4ef2abc8c03c8d14b2836ba9d12302`.
- Актуальный GitHub `main`: `694b83c46c7ffb7e52bbfa48e7888ab7fdf7e8e8`.
- Сохранён checkpoint: `checkpoint/pre-master-v1.2-20260821`.
- Рабочая ветка: `refactor/alma-master-v1.2`.
- Текущий production Vercel собран из более раннего commit `a675c7f…`; он не заменяется этим рефакторингом.
- Supabase project `cneioixtqjncjzgtyhdk` восстановлен и проаудирован. Во всех ALMA-таблицах 0 строк на момент аудита.
- В браузере прототип также хранит локальные данные; они требуют compatibility migration независимо от пустой серверной базы.

## Обозначения

- **IMPLEMENTED** — требование уже выполнено по смыслу Master.
- **PARTIAL** — есть полезная реализация, но модель или поведение неполны.
- **MISSING** — обязательная часть отсутствует.
- **CONFLICTING** — текущая реализация противоречит канонической архитектуре и должна быть заменена либо изолирована compatibility layer.

## Сводная матрица

| Область Master | Статус | Что есть сейчас | Разрыв и действие |
|---|---|---|---|
| Визуальный язык и основной вертикальный экран | IMPLEMENTED | Тёмный неоновый интерфейс, лотос, дуга дат, волна, блоки цикла/активности/состояния, мобильные взаимодействия | Сохранить. Подключить к каноническим view models, не делать redesign. |
| Наблюдение внешней среды | PARTIAL | Реальные Open-Meteo/NOAA данные через route handler; внешняя среда хранится отдельно от субъективной | Добавить source registry, raw/normalized values, baseline-relative features, data quality и one-value arbitration. |
| Канонический Observation envelope | MISSING | Разрозненные day-state, symptom и cycle row shapes | Ввести единый envelope: identity, time/precision/timezone, value, source, epistemic status, presence, confidence, version. |
| Факты / inference / forecast / plans | CONFLICTING | В UI и `alma_insights` предложения, выводы и прогнозы смешиваются; `system_generated` не выражает эпистемический статус | Ввести `measured`, `user_confirmed`, `inferred`, `predicted`, `planned`; исключить predicted/planned из исторического evidence. |
| Presence semantics | CONFLICTING | Отсутствие часто представлено нулём или отсутствием строки | Ввести `present`, `confirmed_absent`, `unknown`. Не трактовать unknown как false/0. |
| Источник и приоритет источников | PARTIAL | Есть строковые `source`, но нет registry/арбитража | Ввести source registry, source priority, manual override и хранение raw alternatives. |
| Declarative Metric / Entity Registry | MISSING | Метрики и категории захардкожены в компонентах и каталогах | Создать versioned registry для metric/entity/domain/source/data form/normalization/adapters. |
| Таксономия data forms | CONFLICTING | Большинство сущностей сводится к signed daily value либо symptom entry | Разделить continuous, binary, count, category, event/interval, state rating, symptom episode, context period, planned event, derived metric, forecast. |
| События и действия | CONFLICTING | Действия сохраняются как `SymptomEntry` с `zone: general` | Ввести canonical events/intervals. Старые ambiguous rows переносить в `legacy_unclassified`, не угадывать автоматически. |
| Симптомы и эпизоды | PARTIAL | Каталог, подтверждение, intensity, быстрый поиск/добавление | Убрать default intensity как факт, поддержать episode time/duration/presence/intensity unknown/attributes/aliases и несколько эпизодов в день. |
| Alias / canonical entity resolution | MISSING | Label и key фактически считаются одной сущностью | Добавить alias registry и proposal flow без автоматического опасного merge. |
| Нагрузки | CONFLICTING | Cognitive/emotional/physical/social хранятся одним signed значением `-100…100` | Для каждой нагрузки хранить независимо `loadIntensity 0…1` и `subjectiveResponse -1…+1`. Старое значение мигрировать как response с unknown intensity. |
| Либидо | CONFLICTING | Либидо обрабатывается как ещё одна нагрузка | Оставить отдельным state metric; не давать ему двухосевую load semantics. |
| Overall well-being anchor | MISSING | «Интегральная» оценка вычисляется простым средним нескольких зон | Добавить пользовательский factual anchor. Он не должен быть наивным средним. |
| Main personal wave | CONFLICTING | Волна строится из synthetic seeded history и простого average; forecast визуально продолжает его | Строить factual anchor wave, intraday range, contributors/context separately; forecast только из Forecast Engine и визуально отличать. |
| Baseline Engine и baseline history | MISSING | Физические контексты нормализуются по жёстким абсолютным порогам | Персональные rolling baselines, тип baseline, версия/история и raw units. |
| Feature Engine | MISSING | Нет dynamics, rolling windows, streaks, transitions, lags, thresholds | Реализовать versioned deterministic dynamic feature pipeline с dirty ranges/cache. |
| Pattern Engine | CONFLICTING | Повтор симптома три раза объявляется паттерном | Заменить на deterministic evidence engine с eligibility, multiple hypotheses, effect size, evidence quality и conservative thresholds. |
| Lag / inverse / cumulative / interaction | MISSING | Анализ в основном same-day | Добавить lag windows, inverse direction, cumulative/streak, modifiers/interactions. |
| Counterexamples / hysteresis / refinement | MISSING | Нет отрицательных примеров, раздельных порогов появления/исчезновения, эволюции модели | Хранить supports/contradicts/unknown, hysteresis state, parent/refined pattern и immutable change insight. |
| Hypothesis Engine | MISSING | Нет явного жизненного цикла гипотез | Ввести несколько конкурирующих hypotheses и structured evidence. |
| Research Quest | MISSING | Нет исследования по пользовательскому вопросу | Ввести multiple active quests, target, hypotheses, dossier, lifecycle и background/active separation. |
| Minimal necessary input | MISSING | Прототип предлагает большой ручной каталог; запросы не ранжируются по information gain | Input Request Engine: value, effort, reason, expiry, one small ask, confirmed yes/no. |
| Immediate reward after input | PARTIAL | После ручного ввода UI меняется, но не объясняет, что нового поняла ALMA | Создавать deterministic update/insight после информативного ответа. |
| Output Feed | MISSING | Есть временные report sheets, но нет immutable personal news stream | Добавить immutable feed items, unread persistence, createdAt stability, dynamic priority и contextual input. |
| Narrative Engine ru-RU | CONFLICTING | Технический и местами причинный язык, ручные строки внутри компонентов | Structured InsightObject → versioned ru-RU templates с наблюдательным языком и morphology dictionary. Core без LLM. |
| Forecast Engine и calibration | CONFLICTING | Будущая линия генерируется визуально без outcome tracking | Forecast records, horizon/probability/uncertainty/model version, outcome confirmation, Brier/calibration update. |
| Planned events | MISSING | Плановые события не отделены от фактов | Planned event влияет только на сценарий/forecast; после подтверждения создаётся actual event. |
| Recommendations / tools / experiments | MISSING | Нет evidence-bound recommendation lifecycle | Отдельные non-medical recommendation, personal tool и experiment entities, основанные только на personal evidence. |
| Scientific KB / Population / Safety | MISSING (interface only) | Production knowledge bases отсутствуют | Создать интерфейсы и explicit unavailable states. Не изобретать medical triggers/clinical claims. |
| Контекст жизни / chapters | MISSING | Профиль — mutable snapshot | Context periods, life transitions и chapters как timeline; progressive profile. |
| Cycle facts vs estimates | PARTIAL | Цикл визуализируется, есть события, но facts/calculations смешаны | Сохранить лотос; отдельно хранить confirmed bleeding, inferred phases/forecast, versioned cycle calculations. |
| Sleep / physiology / digital context adapters | MISSING (rails only) | Native phone/wearable data недоступны | Registry/adapters/hooks и truthful unavailable UX; не создавать fake HealthKit/Oura/Usage data. |
| Nutrition | MISSING | Основного блока нет | Базовый intake/event блок и quick input; без food photo recognition. |
| Event beads и evidence-density date axis | MISSING | События не представлены beads; даты не показывают плотность evidence | Добавить factual/planned/forecast bead variants, selection filter, density cues. |
| Event-focused wave filtering | MISSING | Выбор события не фильтрует релевантные relationships | Bead selection должен показывать связанные waves/patterns и скрывать нерелевантный шум. |
| Local-first repository abstraction | CONFLICTING | Компонент напрямую пишет localStorage и затем opportunistic Supabase | Repository interfaces, local outbox, stable UUID/version, idempotent sync, conflict policy, server recompute. |
| Delete/edit recalculation | MISSING | Изменение строки не инвалидирует dependent analytics | Dependency/dirty range tracking; current model recompute, immutable past feed plus correction/update. |
| Algorithm/data versioning | PARTIAL | Версия схемы implicit в migration filenames | Явно version data schema, metric definitions, pattern algorithm, narrative templates и KB. |
| Synthetic/demo evidence | CONFLICTING | `seededZones` и default state создают фиктивную персональную историю | Удалить из normal mode. Допускать только явный `DEMO_MODE`; исключать из evidence pipeline. |
| Privacy | PARTIAL | RLS ownership на ALMA legacy tables | RLS на каждой canonical table, user indexes, location precision/privacy, deletion semantics, никакого service key в клиенте. |
| Tests | MISSING | Нет test runner и покрытия | Добавить unit/integration scenarios из §127–128, migration/offline/sync/demo exclusion. |
| Документация | MISSING | Только README | Создать весь обязательный набор docs §129 с причинами архитектурных решений. |

## Что можно сохранить без изменения смысла

1. Лотос, дугу дат и существующий цикл interaction.
2. Общий тёмный неоновый visual language и mobile-first layout.
3. Силуэт и жесты выбора как presentation layer, после разделения intensity/response.
4. Open-Meteo/NOAA route handler как один из source adapters после добавления registry/provenance.
5. Поиск, пользовательское добавление и переключение симптомов — после подключения к canonical symptom episodes.
6. Быстрые действия — после перевода из symptom storage в event repository.
7. Wave scrubbing и раскрытие подробностей — после замены synthetic series на canonical view model.
8. Supabase auth/RLS ownership pattern legacy-таблиц — как ориентир для новых таблиц.

## Compatibility strategy

1. Legacy tables не удаляются в первой миграции.
2. Новый canonical schema добавляется рядом; переход выполняется append-only migration.
3. Legacy daily signed load преобразуется только в `subjectiveResponse`; `loadIntensity` остаётся `unknown`.
4. Legacy `symptom_entries.zone = general` не переклассифицируется автоматически: `legacy_unclassified` до пользовательского подтверждения или безопасного явного mapping.
5. Явно известные action labels переносятся в event entities, при этом source legacy row ID сохраняется в provenance.
6. `source = seed` никогда не попадает в personal evidence.
7. Local-storage payload проходит тот же idempotent migrator со stable IDs.
8. Старые UI components временно получают view models из canonical repositories; затем заменяются по фазам без big-bang rewrite.
9. Для каждого migration file существует проверяемый rollback companion; production schema меняется только через migration history.

## Риски и границы

- Supabase используется также другим проектом. Таблицы не с префиксом ALMA не входят в scope и не изменяются.
- В `public.device_daily_draws` обнаружен выключенный RLS. Это отдельный security risk другого продукта; автоматическое включение без его policy contract может заблокировать или изменить работу, поэтому ALMA migration его не затрагивает.
- Production Vercel остаётся неизменным до ручной проверки Preview пользователем.
- Реальные HealthKit/Watch/Oura/Android Usage/native push/LLM/Population/Safety knowledge не имитируются.
- Текущая пустая серверная ALMA-база не отменяет обязательную migration logic: пользовательские записи могут существовать локально и появиться между аудитом и rollout.

## Решение по последовательности

Работа продолжается строго по фазам Master B→J. Каждый этап получает собственный commit и проверку; UI подключается только после создания канонической модели, compatibility layer и deterministic Core.
