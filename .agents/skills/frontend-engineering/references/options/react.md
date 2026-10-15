# React

Читайте эту справку при подтверждённой зависимости `react`.

## Components и state

- Сохраняй выбранный router и data-fetching слой; не добавляй параллельный.
- Если проект не задаёт другое соглашение, используй `userCard.tsx` для файла,
  `UserCard` для component export, `useUser.ts` для hook и совпадающий basename
  `userCard.test.tsx` для теста. Не переименовывай существующую PascalCase или
  kebab-case систему попутно.
- Компонент отвечает за один UI concern. Разделяй его, когда части имеют
  независимый lifecycle, ownership данных или повторное использование, а не по
  произвольному лимиту строк.
- Компонентные props описывают минимальный контракт; не передавай большой store
  object, если потребителю нужны отдельные значения и callbacks.
- Controlled/uncontrolled модель input выбирается явно и не меняется после mount.
- Держи state у ближайшего общего владельца; context/store добавляй только при
  нескольких независимых потребителях. Context разделяй по частоте обновления и
  области ответственности, если общий provider вызывает широкие rerenders.
- Не копируй props в state без определённой политики синхронизации.
- Сохраняй стабильные semantic keys; index допустим только для неизменяемого
  списка без reorder/insert/delete и локального item state.

## Effects, данные и ошибки

- Render должен оставаться чистым. Effects используй для синхронизации с
  внешней системой, а не для вычисления derived state.
- Effect объявляет реальные dependencies, имеет cleanup и выдерживает повторный
  setup в development. Не подавляй lint dependency rule без объяснимого contract.
- Async result не должен перезаписывать более новый request; используй cancellation
  или механизм query/router слоя проекта.
- Server state не дублируй в component/store. Mutation определяет pending,
  optimistic/rollback при необходимости, error и точную invalidation policy.
- Error boundary дополняет, но не заменяет inline recoverable error state.

## Производительность и проверка

- Memoization добавляй по измеренной причине или подтверждённому project pattern.
- Hooks вызывай безусловно и только из React component/custom hook.
- Для формы и async action обеспечь pending, repeated-submit protection, error
  и success feedback.
- В SPA с Vite/React Router следуй существующим route loaders, lazy boundaries
  и cache/query conventions.
- Проверяй пользовательское поведение через accessible queries, а не внутреннее
  state или implementation hooks. Для изменённого route проверь direct URL,
  navigation, loading/error и восстановление после ошибки.

Для Next.js дополнительно прочитай `nextjs.md`.
