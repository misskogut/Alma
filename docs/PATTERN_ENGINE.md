# Pattern Engine

## Цель

Pattern Engine ищет повторяющиеся персональные закономерности, а не объявляет причинность. Формулировка для человека: «В ваших наблюдениях Y чаще появлялся при X», а не «X вызывает Y».

## Eligibility

В анализ входят только canonical, non-synthetic, measured/user-confirmed точки. `unknown` исключается; `confirmed_absent` становится контрольным примером. Predicted/planned/inferred не обучают модель.

## Семейства кандидатов

- lagged relationship;
- inverse direction;
- cumulative/streak window;
- contextual modifier/interaction;
- same-day association как частный, но не единственный случай.

Для каждого кандидата сохраняются opportunities, supports, contradicts, unknown, quality, lag и исходные observation ids.

## Консервативная эволюция

Три совпадения сами по себе не создают паттерн. Stage проходит `observation → possible_link → repeating_pattern → established_personal_pattern`. Раздельные пороги появления и исчезновения дают hysteresis. При ослаблении pattern сначала получает lifecycle `weakening`; при исчезновении — `no_longer_observed` с закрытием validity.

Усиление связи при modifier создаёт refined child с `parentPatternId`, не переписывая старую модель.

## Incremental lifecycle

Изменение или удаление факта создаёт dirty date range. Оркестратор пересчитывает текущую модель и сохраняет прошлую историю. Derived feature cache и индексы предусмотрены schema; текущий браузерный prototype при запуске orchestration перечитывает eligible history, поэтому настоящий multi-year background incremental worker остаётся дальнейшим performance шагом.
