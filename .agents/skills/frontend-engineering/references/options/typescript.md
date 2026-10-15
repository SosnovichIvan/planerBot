# TypeScript frontend

Читайте эту справку, когда изменяемый workspace использует TypeScript.

- Следуй строгости существующего `tsconfig`; не ослабляй её для обхода ошибки.
- Сужай `unknown` через guards/schema validation. Не заменяй неизвестные данные
  на `any` и не используй assertion как валидацию runtime payload.
- Выводи типы из канонических schemas/generated contracts, если они доступны.
- Различай отсутствующее, `null` и пустое значение согласно API contract.
- Для union состояний предпочитай discriminant и exhaustive checking.
- Не экспортируй внутренние utility-типы без реального потребителя.
- Сохраняй project references, path aliases и границы package exports.
- Проверяй `typecheck` отдельно от transpilation, если так устроен toolchain.

JavaScript-проект не мигрируй на TypeScript в рамках несвязанной задачи.
