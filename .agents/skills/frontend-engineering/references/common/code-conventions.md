# Frontend code conventions

Читайте эту справку всегда при создании или переименовании frontend-файлов.
Framework reference и подтверждённые соглашения репозитория имеют приоритет над
fallback-правилами ниже.

## Сначала определить соглашение

1. Проверь соседние файлы, lint/formatter config, generator templates и package
   exports целевого workspace.
2. Если устойчивое соглашение существует, продолжай его в изменяемом модуле.
3. Если соглашения смешаны, следуй ближайшему связному модулю и не выполняй
   массовое переименование вместе с продуктовой задачей.
4. Если соглашения нет, используй fallback из этой справки.

## Fallback для TypeScript и JavaScript

| Назначение | Файл | Экспортируемое имя |
| --- | --- | --- |
| Функция/утилита | `formatDate.ts` | `formatDate` |
| React-like component | `userCard.tsx` | `UserCard` |
| Hook/composable | `useUser.ts` | `useUser` |
| Client store с hook API | `userStore.ts` | `useUserStore` |
| API operation | `getUser.ts` | `getUser` |
| Test | `userCard.test.tsx` | — |

- Обычные source-файлы и папки называй `camelCase`; components/classes/types —
  `PascalCase`; functions/variables — `camelCase`; constants — в уже принятом
  проектом стиле.
- Для действия предпочитай `глагол + объект`: `createWorkout`, `loadProfile`,
  `formatDuration`. Для boolean используй читаемый predicate: `isReady`,
  `hasAccess`, `canSubmit`.
- Используй `.tsx` только когда файл содержит JSX; остальная логика остаётся в
  `.ts`. Не помещай React-independent code в `.tsx` без причины.
- Имя файла описывает основной concept. Допускаются связанные private types и
  маленькие helpers; разделяй файл при появлении независимого ownership,
  lifecycle, public contract или причины отдельного тестирования.
- Не создавай пустые `components`, `hooks`, `types`, `utils` или `index.ts` на
  будущее. Structure profile определяет допустимые границы каталогов.

## Components, hooks и данные

- Component name — существительное или предметное словосочетание. Суффикс
  `Page`, `Layout`, `Dialog`, `Provider` используй, когда он уточняет роль.
- Hook/composable начинается с `use` только если соблюдает lifecycle/reactivity
  contract framework. Обычная функция не получает `use` ради группировки.
- Store называется по владельцу состояния, а не по странице случайного первого
  потребителя.
- API function отражает operation. Один файл на operation — хороший вариант для
  независимых контрактов; тесно связанные маленькие operations можно группировать
  в resource client, если так проще находить и тестировать код.
- Generated contract types импортируй из канонического output. Не создавай
  параллельные ручные DTO только ради другого имени.

## Types, exports и imports

- Тип держи рядом с владельцем. Экспортируй его только при реальном внешнем
  потребителе; общие contract types получают отдельный подтверждённый boundary.
- Не заставляй функцию с одним естественным аргументом принимать объект. Object
  parameter полезен для нескольких именованных или расширяемых параметров.
- Destructuring props применяй там, где улучшает читаемость; не требуй отдельную
  строку механически для каждого компонента.
- `index.ts` создавай на публичной границе package/slice/module, а не в каждой
  папке. Он экспортирует минимальный поддерживаемый API и не раскрывает tests,
  styles или private helpers.
- Внутри модуля разрешены ясные относительные импорты. Для перехода через
  архитектурную границу используй public entrypoint/alias, если он настроен.
- Избегай циклических barrels и deep imports в чужой модуль.

## Tests и companion files

- Test повторяет basename и suffix test runner проекта: `name.test.ts(x)` или
  `name.spec.ts(x)`. Размещай рядом, если repository не задаёт отдельное дерево.
- Тестируй наблюдаемое поведение и риск, а не наличие теста для каждого файла.
  Types, constants, generated files и простые re-exports отдельного теста обычно
  не требуют.
- Styles, stories и fixtures повторяют basename только когда toolchain использует
  такую схему. Не создавай `*.styled.tsx`, если проект не использует CSS-in-JS.
