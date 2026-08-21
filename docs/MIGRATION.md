# Migration и compatibility strategy

## Безопасный checkpoint

- исходный local working commit: `56b7c285ee4ef2abc8c03c8d14b2836ba9d12302`;
- исходный GitHub main: `694b83c46c7ffb7e52bbfa48e7888ab7fdf7e8e8`;
- backup branch: `checkpoint/pre-master-v1.2-20260821`;
- рабочая ветка: `refactor/alma-master-v1.2`;
- production deployment не продвигается автоматически.

## Supabase migrations

Каноническая schema добавлена рядом с legacy tables append-only migrations:

1. `20260821090000_alma_master_v1_2_foundation.sql`;
2. `20260821093000_alma_master_v1_2_covering_indexes.sql`;
3. `20260821094500_alma_master_v1_2_event_status_constraint.sql`.

Для foundation и последующих изменений сохранены rollback companions. Production schema не должна правиться вручную вне migration history.

## Legacy mapping

- известный state → canonical observation;
- известный symptom → symptom episode;
- явно известное action label → canonical event;
- signed load → subjective response, intensity остаётся unknown;
- planned item → planned event, не факт;
- неоднозначная строка → `legacy_unclassified`;
- source `seed`/demo → не personal evidence.

Local snapshot migrator использует stable IDs и marker, поэтому повторный запуск не создаёт дублей. Compatibility projection продолжает обслуживать утверждённый UI поверх новой модели.

## Rollout

1. Проверить migrations и локальную миграцию на копии данных.
2. Развернуть отдельный Vercel Preview из точного commit.
3. Проверить UI, offline edit/delete и sync.
4. Только после ручного принятия решать вопрос о production promotion.
