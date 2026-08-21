# Домены и таксономия

## Принцип

Название на кнопке не определяет тип хранения. Таксономия задаётся registry и data form. Это предотвращает прежнюю ошибку, когда тренировка, кофе или секс сохранялись как «симптом».

| Домен | Примеры | Типичные формы |
|---|---|---|
| Internal | самочувствие, ясность, тревога, либидо | state rating, symptom episode |
| Activity | тренировка, прогулка, йога, физическая нагрузка | event, load intensity/response |
| Social | конфликт, поддержка, социальная нагрузка | event, context, load intensity/response |
| Cycle | менструация, тест, секс, расчётная овуляция | factual event/interval либо явно inferred event |
| Nutrition | кофе, вода, еда, алкоголь, препарат | intake event с количеством/единицей |
| Physiology | сон и будущие wearable signals | interval или continuous metric |
| Natural environment | давление, температура, влажность, ветер, Kp | measured continuous metric |
| Digital environment | screen time, night phone use | continuous metric; adapter пока unavailable |
| Life context | работа, переезд, отношения, главы жизни | context period |

## Нагрузки

Когнитивная, эмоциональная, физическая и социальная нагрузка состоят из двух независимых измерений:

- `*_load_intensity`: сколько нагрузки было, диапазон `0…1`;
- `*_load_response`: как она субъективно переносилась, диапазон `−1…+1`.

Низкая интенсивность может переноситься тяжело, а высокая — позитивно. Legacy signed value мигрируется только как response; intensity остаётся неизвестной.

Либидо — отдельное состояние, а не нагрузка.

## Симптомы

`SymptomEpisode` хранит presence и при наличии — intensity, location, duration и character. Интенсивность не придумывается, если человек её не указал. Несколько эпизодов в один день допустимы.

## Пользовательские сущности

Неизвестная безопасная метка создаётся как отдельная custom entity с сохранённым user label. Неоднозначные legacy rows попадают в `legacy_unclassified` и не участвуют в evidence, пока смысл не подтверждён.
