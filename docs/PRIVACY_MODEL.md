# Privacy model

## Local-first

Ввод сначала сохраняется локально и доступен без сети. Outbox синхронизирует изменения идемпотентно после подключения. Stable IDs и base server version защищают от дублей и тихого перезаписывания offline correction.

Текущий browser adapter использует `localStorage`; repository contract позволяет заменить его на IndexedDB. Это техническое ограничение prototype, а не обещание полной offline durability мобильного native-приложения.

## Supabase

Канонические ALMA-таблицы имеют ownership по `user_id`, RLS policies и user-oriented indexes. Service role key не используется клиентом. Миграции не меняют чужие таблицы того же проекта.

## Чувствительность источников

Source Registry присваивает privacy class. Точная геолокация, health/wearable и voice data считаются чувствительными. Профиль хранит `locationPrivacy: off | approximate | precise`; подключение sensor/native adapter требует явного разрешения.

## Удаление

Удаление факта — soft delete с пересчётом текущей модели. Уже показанный insight остаётся исторической копией, а новая запись сообщает об изменении evidence. Это сохраняет объяснимость, не возвращая удалённый факт в текущий анализ.

## Не реализовано

Нет production population aggregation, native health permissions, native push и server-side background analysis. Их отсутствие отображается честно и не компенсируется synthetic data.
