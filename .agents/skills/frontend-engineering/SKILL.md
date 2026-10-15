---
name: frontend-engineering
description: "Реализует и изменяет frontend-приложения на TypeScript/JavaScript: компоненты, страницы, состояние, API-интеграции, дизайн-системы и микрофронтенды. Применять для написания frontend-кода; для одного только ревью использовать профильный review skill, если он доступен."
---

# Frontend engineering

Реализуй минимальный законченный пользовательский сценарий в рамках архитектуры
и toolchain целевого репозитория. Не навязывай проекту FSD, React, конкретный
package manager, CSS framework или state library, если они не подтверждены
кодом и документацией проекта.

## Перед изменением

1. Прочитай ближайшие agent instructions, README, архитектуру и команды проекта.
2. Определи framework, package manager, структуру модулей, дизайн-систему,
   правила импортов, генерацию API-клиента и тестовый стек по lockfile/config.
3. Найди существующий аналог компонента или сценария и следуй его устойчивым
   соглашениям. Не копируй случайную локальную аномалию как стандарт.
4. Если задача ссылается на дизайн, спецификацию или API contract, считай их
   источниками требований. При конфликте не угадывай — остановись и обозначь
   расхождение.

Всегда прочитай
[architecture.md](references/common/architecture.md) и при создании или
переименовании файлов —
[code-conventions.md](references/common/code-conventions.md). Установщик добавляет
выбранные language, framework и structure profiles в `references/options/` и
перечисляет их ниже. Structure profile обязателен: это FSD, гибкая логическая
структура или пользовательский файл. Все references являются частью этого skill
и не применяются самостоятельно.

<!-- agent-skills-lab:references:start -->
Установленный профиль. Обязательно прочитай все выбранные references:

- [TypeScript](references/options/typescript.md) — Строгая типизация, generated contracts и безопасное сужение данных.
- [React](references/options/react.md) — Components, hooks, state ownership, routing и async UI.
- [Feature-Sliced Design](references/options/structure-fsd.md) — Актуальные layers, slices, segments, import rule и public API FSD.
<!-- agent-skills-lab:references:end -->

Если monorepo содержит несколько стеков, применяй профиль только к приложению,
которое меняется. Зависимость в корневом lockfile без использования в целевом
workspace не считается сигналом. Перед handoff прочитай
[delivery.md](references/common/delivery.md).

## Реализация

Для формы, route, async UI или SSR прочитай
[scenario-contract.md](references/common/scenario-contract.md).

- Сохраняй существующее направление зависимостей и публичные границы модулей.
- Размещай server state в принятом query/cache слое, локальное UI state — рядом
  с владельцем, а действительно разделяемое client state — в принятом store.
- Отделяй transport-функцию от framework hook/component. Контрактные типы бери
  из существующего генератора; generated-файлы вручную не редактируй.
- Переиспользуй дизайн-систему и токены. Не создавай локальный дубль базового
  компонента, если его можно расширить в общем пакете без нарушения scope.
- Реализуй loading, empty, error, disabled и success states, которые достижимы
  в изменяемом сценарии. Не скрывай ошибки пустым экраном.
- Сохраняй keyboard navigation, focus management, semantic HTML, accessible
  names и существующие responsive breakpoints.
- Для microfrontend используй уже выбранный host/remote contract и loader. Не
  добавляй второй механизм композиции ради одной задачи.
- Не помещай секреты в browser bundle, storage, URL или логи. Не считай
  отображаемую роль достаточным доказательством authorization.
- Изменяй только относящиеся к задаче файлы и не переформатируй соседний код без
  необходимости.

## Проверка

Начни с самых узких релевантных тестов, затем выполни доступные lint, typecheck,
unit/component tests и build. E2E запускай для изменённого пользовательского
пути, если harness доступен и стоимость оправдана риском.

В результате перечисли изменённое поведение, ключевые файлы, выполненные
команды и непроверенные риски. Не заявляй визуальное соответствие без проверки
рендера на требуемых состояниях и viewport.

## Профиль правил проекта

Применяй [профильные правила](references/project-rules.md) только при явном согласии
на правила этого скилла в инструкциях проекта. При наличии approved snapshot
используй его; наличие файла само по себе не активирует правила. Они не запускают другие скиллы автоматически.
