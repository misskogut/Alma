# Scientific, Population и Safety Knowledge

## Текущее состояние

В этом Work run созданы только interfaces/adapters. Проверенная Scientific KB, production Population Engine и clinically validated Safety KB не подключены.

Каждый adapter обязан вернуть явный `available/unavailable` с version и reason. При unavailable Core возвращает пустой набор, а не выдумывает evidence, population prior или медицинское правило.

## Scientific KB

Может в будущем предложить starting hypotheses: target, factor, direction, possible lag, modifiers, evidence level и sources. Научная связь не заменяет персональное подтверждение.

## Population

Работает только после отдельного opt-in, с coarse context и агрегированными данными. Population prior не становится personal evidence.

## Safety

Rule допускается только с version, reviewedAt, reviewer reference, urgency и русским user message. До появления проверенного набора ALMA не создаёт red-flag trigger rules самостоятельно.

ALMA остаётся инструментом наблюдения, а не диагностики или лечения.
