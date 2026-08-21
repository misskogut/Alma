# Metric и Source Registry

## Зачем нужен registry

Registry превращает подключение нового источника или метрики в декларативное расширение, а не в переписывание UI, storage и Pattern Engine.

Каждая `MetricDefinition` задаёт:

- стабильный id и русскую пользовательскую подпись;
- entity kind, domain и data form;
- value type, unit и допустимые attributes;
- normalization и baseline strategy;
- eligibility для pattern/forecast;
- display metadata;
- source priority;
- availability и честную причину недоступности;
- registry version.

## Нормализация

Raw value и unit сохраняются. Нормализованная feature создаётся отдельно. Поддерживаются signed unit, unit interval, personal baseline ratio/z-score и category encoding. Это позволяет сравнивать динамику без уничтожения исходной величины.

## Арбитраж источников

`SourceRegistry` описывает type, availability, default epistemic meaning, priority и privacy class. Ручное подтверждение имеет приоритет над inference. Альтернативная запись не исчезает: canonical arbitration выбирает одно текущее значение, сохраняя provenance.

## Как добавить метрику

1. Выбрать существующий domain/entity kind/data form.
2. Добавить versioned definition и unit.
3. Указать normalization/baseline strategy и source priority.
4. Подключить adapter к canonical repository.
5. Добавить migration только при изменении schema, а не для каждого нового definition.
6. Добавить тест классификации, нормализации и absence semantics.

Если новый источник требует native permission, definition остаётся `available: false` до реального adapter. Пустой или выдуманный сигнал не создаётся.
