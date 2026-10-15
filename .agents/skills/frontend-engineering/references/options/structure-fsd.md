# Feature-Sliced Design structure

Этот structure profile следует актуальной FSD-модели. Не добавляй слой, slice
или segment, пока он не приносит понятную навигационную или dependency boundary.

Основа профиля — официальные разделы [Layers](https://feature-sliced.design/docs/reference/layers),
[Slices and segments](https://feature-sliced.design/docs/reference/slices-segments)
и [Public API](https://feature-sliced.design/docs/reference/public-api),
проверенные 2026-09-14. При изменении спецификации сначала обнови этот reference
и связанные installer tests.

## Слои и направление импортов

```text
app → pages → widgets → features → entities → shared
```

`processes` не используй: слой deprecated. Модуль внутри slice может импортировать
другие slices только со строго нижних слоёв. Внутри своего slice разрешены
связные импорты. `app` и `shared` являются исключениями: у них нет business
slices, только segments.

- `app`: entrypoints, providers, router, global styles/config и startup.
- `pages`: route/screen composition, page-specific loading/error и data flow.
- `widgets`: существующие блоки; текущая документация не рекомендует добавлять
  этот слой по умолчанию. Экранная композиция остаётся в pages, повторяемое
  действие с UI — в features.
- `features`: значимые пользовательские действия, особенно повторяемые в
  нескольких местах. Не превращай каждое действие или форму в feature.
- `entities`: переиспользуемые модели предметных сущностей и их UI/API/model.
- `shared`: инфраструктура без business ownership — UI kit, API foundation,
  focused libraries, config, routes и i18n.

Используй только нужные слои. Для небольшого приложения нормальна начальная
структура из `app`, `pages` и `shared`.

## Slices, segments и public API

- Называй slices языком продукта: `profile`, `training-plan`, `checkout`, а не
  техническими категориями.
- Slices одного слоя независимы и не используют общий код из группирующей папки.
- Стандартные segments: `ui`, `api`, `model`, `lib`, `config`. Не создавай
  безликие segments `components`, `hooks` или `types`.
- Каждый slice и segment в `app`/`shared` открывает минимальный public API.
  Внешние модули импортируют только его, не внутреннюю структуру.
- Cross-import между entities через `@x` допускай только для явной тесной связи;
  основной вариант — собрать взаимодействие на более высоком слое.
- Slice group только группирует навигацию и не становится новым слоем или местом
  для shared implementation.

## Размещение изменения

1. Код нужен только одному route — оставь его в соответствующем page slice.
2. Композиция относится к экрану — pages; layout всего приложения — app.
   Не создавай widget автоматически из-за размера компонента.
3. Пользовательское действие повторяется — рассмотри feature.
4. Переиспользуется модель бизнес-объекта — рассмотри entity.
5. Код не знает о бизнес-домене и имеет реальных потребителей — shared.

Не выполняй массовую FSD-миграцию вместе с продуктовым изменением.
