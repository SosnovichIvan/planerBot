# PostgreSQL

Применяй к подтверждённой версии PostgreSQL; проверь версии расширений и runner.

- CREATE INDEX CONCURRENTLY нельзя включать в обычный transaction block.
  Неудачный запуск может оставить invalid index; проверь его состояние до retry.
  У concurrent build остаются ожидания, нагрузка и ограничения, это не zero-cost DDL.
- Перед добавлением constraint к большой таблице проверь поддерживаемые способы
  отделить создание от validation, lock и совместимость writers в этой версии.
- EXPLAIN ANALYZE исполняет statement. Для writes/функций с эффектами используй
  изолированную среду; BEGIN/ROLLBACK не гарантирует отсутствия всех побочных эффектов.
- Для уникальности проверь NULL semantics, partial predicate и tenant columns.
  Для конкурентного обновления проверь affected rows и scope блокировки.
- RLS оценивай с фактической application role: owner/superuser и специальные
  привилегии могут менять результат проверки. Не тестируй isolation только админом.

Первоисточники (сверяй с версией проекта):
[CREATE INDEX](https://www.postgresql.org/docs/18/sql-createindex.html),
[EXPLAIN](https://www.postgresql.org/docs/18/sql-explain.html).

## Обязательные вопросы плана и миграции

План: сравни estimated и actual rows, loops и buffers. EXPLAIN ANALYZE
исполняет запрос: даже обёртка ROLLBACK не отменяет все внешние эффекты.
Используй безопасную среду. Большая ошибка оценки требует проверить статистику
и распределение, а не сразу принудительно выбирать индекс.

CREATE INDEX CONCURRENTLY не выполняется внутри transaction block; операция
требует дополнительных проходов и ожиданий и может оставить INVALID индекс.
Проверь состояние каталога после ошибки, запланируй cleanup/retry. Обычный
CREATE INDEX блокирует запись. Выбор CONCURRENTLY зависит от нагрузки,
а не только от размера SQL. Не обещай отсутствие любых блокировок.

Источники: [EXPLAIN](https://www.postgresql.org/docs/current/using-explain.html),
[CREATE INDEX](https://www.postgresql.org/docs/current/sql-createindex.html).

Проверено 2026-09-14. Для другой версии сначала проверь возможности движка.
