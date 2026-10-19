import { activeDialog, button, chatA, chatB, choose, escape, meeting, scenario, second, visit } from '../support/scenario';

describe('Вход, календарь и область данных', () => {
  it('AUTH-01 обычный браузер не получает календарь без Telegram', () => {
    const state = scenario(); visit(state, { noTelegram: true });
    cy.contains('Откройте календарь через Telegram').should('be.visible');
    cy.get('table').should('not.exist');
    cy.then(() => expect(state.calls).to.have.length(0));
  });
  it('AUTH-02 истёкшая сессия скрывает данные и предлагает вход заново', () => {
    const state = scenario(); cy.intercept('GET', '**/api/chats*', { statusCode: 401, body: { detail: 'expired' } }); visit(state);
    cy.contains('Сессия истекла. Вернитесь в чат').should('be.visible');
    cy.get('table').should('not.exist'); button('Попробовать снова').should('not.exist');
  });
  it('AUTH-03 сбой проверки доступа не раскрывает данные и допускает повтор', () => {
    const state = scenario(); cy.intercept({ method: 'GET', url: '**/api/chats*', times: 1 }, { statusCode: 503 }); visit(state);
    cy.contains('Данные чатов скрыты').should('be.visible'); cy.get('table').should('not.exist');
    button('Попробовать снова').click(); cy.get('table').should('be.visible');
  });
  it('AUTH-04 права управления ограничены чатом, участник не видит административных действий', () => {
    const state = scenario({ chats: [chatB], events: [second] }); visit(state);
    cy.contains('Встреча клуба').should('be.visible');
    button('Создать событие').should('not.exist'); button('Настройки').should('not.exist'); button('Изменить').should('not.exist');
    choose('Чат', 'Клуб'); cy.contains('Встреча команды').should('not.exist');
  });
  it('AUTH-05 пустой список чатов отличается от ошибки', () => {
    const state = scenario({ chats: [], events: [] }); visit(state);
    cy.contains('Доступных чатов пока нет').should('be.visible'); cy.get('[role="combobox"]').should('be.disabled');
    cy.get('[role="alert"]').should('not.exist'); button('Создать событие').should('not.exist');
  });
  it('AUTH-06 загружает все страницы доступных чатов перед календарём', () => {
    const state = scenario({ pages: [[chatA], [chatB]] }); visit(state);
    cy.get('table').should('be.visible');
    cy.then(() => expect(state.calls.filter((call) => call.path === '/api/chats')).to.have.length(2));
    cy.get('[role="combobox"]').click(); cy.get('[role="option"]').should('have.length', 3);
  });
  it('CAL-01 тема по умолчанию тёмная, ручной выбор сохраняется при перезагрузке', () => {
    const state = scenario(); visit(state);
    cy.get('html').should('have.attr', 'data-theme', 'dark');
    cy.get('[aria-label="Включить светлую тему"]').click(); cy.reload();
    cy.get('html').should('have.attr', 'data-theme', 'light');
    cy.get('[aria-label="Включить тёмную тему"]').click();
    cy.then(() => { expect(state.ready).to.be.greaterThan(0); expect(state.expanded).to.be.greaterThan(0); });
  });
  it('CAL-02 селект чата меняет query и исключает чужую повестку, Все чаты возвращает обе', () => {
    const state = scenario(); visit(state);
    cy.contains('Встреча команды').should('be.visible'); cy.contains('Встреча клуба').should('be.visible');
    cy.intercept('GET', '**/api/events*').as('events');
    choose('Чат', 'Команда'); cy.wait('@events').its('request.query.chat_id').should('eq', chatA.id);
    cy.contains('Встреча клуба').should('not.exist');
    choose('Чат', 'Все чаты'); cy.contains('Встреча клуба').should('be.visible');
  });
  it('CAL-03 навигация месяца меняет диапазон и очищает старые события', () => {
    const state = scenario();
    // The grid renders before its initial events request. Match each range so
    // waiting for navigation cannot consume the still-starting October request.
    cy.intercept({ method: 'GET', pathname: '/api/events', query: { start: '2026-10-01', end: '2026-11-01' } }).as('october');
    cy.intercept({ method: 'GET', pathname: '/api/events', query: { start: '2026-11-01', end: '2026-12-01' } }).as('november');
    visit(state); cy.wait('@october');
    cy.get('table').should('have.attr', 'aria-label', 'октябрь 2026 г.'); cy.contains('Встреча команды').should('be.visible');
    cy.get('[aria-label="Следующий месяц"]').click(); cy.wait('@november').its('request.query').should('include', { start: '2026-11-01', end: '2026-12-01' });
    cy.get('table').should('have.attr', 'aria-label', 'ноябрь 2026 г.');
    cy.contains('В выбранном периоде событий нет').should('be.visible'); cy.contains('Встреча команды').should('not.exist');
    cy.get('[aria-label="Предыдущий месяц"]').click(); cy.wait('@october');
    cy.get('table').should('have.attr', 'aria-label', 'октябрь 2026 г.'); cy.contains('Встреча команды').should('be.visible');
  });
  it('CAL-04 один день с одной встречей сразу открывает карточку и ссылку сообщения через SDK', () => {
    const state = scenario({ events: [meeting] }); visit(state);
    cy.get('button[aria-label="20, событий: 1"]').click(); activeDialog().find('h2').should('have.text', meeting.data.title);
    cy.contains('a', 'Сообщение в Telegram').click(); cy.then(() => expect(state.links).to.deep.eq([meeting.message_url]));
    cy.location('pathname').should('eq', '/');
  });
  it('CAL-05 несколько встреч открывают список, карточка поверх него, Escape возвращает фокус', () => {
    const state = scenario(); visit(state);
    cy.get('button[aria-label="20, событий: 2"]').focus(); cy.realPress(Cypress.Keyboard.Keys.ENTER); activeDialog().find('h2').should('contain', 'События 20 октября');
    activeDialog().contains('button', 'Встреча команды').focus(); cy.realPress(Cypress.Keyboard.Keys.ENTER); cy.get('dialog[open]').should('have.length', 2);
    activeDialog().find('h2').should('have.text', meeting.data.title);
    escape(); cy.get('dialog[open]').should('have.length', 1);
    cy.focused().should('contain.text', 'Встреча команды');
    escape(); cy.get('dialog[open]').should('not.exist'); cy.get('body').should('not.have.css', 'overflow', 'hidden');
  });
  it('CAL-06 события и длинные названия не расширяют клетки календаря', () => {
    const state = scenario({ events: [] }); visit(state); cy.get('table tbody td').first().invoke('outerHeight').then((height) => {
      cy.then(() => { state.events = [{ ...meeting, data: { ...meeting.data, title: 'Очень длинное название '.repeat(5) } }]; });
      cy.get('[aria-label="Обновить события"]').click(); cy.get('button[aria-label="20, событий: 1"]').should('be.visible');
      cy.get('table tbody td').each(($cell) => expect($cell.outerHeight()).to.eq(height));
    });
  });
  it('CAL-07 неполный список предупреждает о лимите и не обещает полную повестку дня', () => {
    const state = scenario({ events: [meeting], more: true }); visit(state);
    cy.contains('Показаны первые 200 событий').should('be.visible'); cy.get('button[aria-label="20, событий: 1"]').click();
    activeDialog().find('h2').should('contain', 'События 20 октября'); cy.contains('Загружены не все события месяца').should('be.visible');
  });
  it('CAL-08 ошибка событий допускает обновление без потери выбранного чата', () => {
    const state = scenario(); cy.intercept({ method: 'GET', url: '**/api/events*', times: 1 }, { statusCode: 503, body: { detail: 'Временно недоступно' } }); visit(state);
    cy.contains('Временно недоступно').should('be.visible'); cy.get('[aria-label="Обновить события"]').click(); cy.contains('Встреча команды').should('be.visible');
  });
  it('CAL-09 многодневные встречи отмечены только в день старта, включая начало в прошлом месяце', () => {
    const state = scenario({ events: [
      { ...meeting, data: { ...meeting.data, end_date: '2026-10-23' } },
      { ...meeting, id: second.id, data: { ...meeting.data, title: 'Старт 21 октября', start_date: '2026-10-21', end_date: '2026-10-24' } },
      { ...meeting, id: '00000000-0000-4000-8000-000000000003', data: { ...meeting.data, start_date: '2026-09-30', end_date: '2026-10-03' } },
    ] });
    // API may return overlapping events for the agenda; grid markers still use start_date only.
    cy.intercept('GET', '**/api/events*', { body: { events: state.events, has_more: false, removals: [], has_more_removals: false } });
    visit(state);
    cy.get('[aria-label="20, событий: 1"]').should('exist'); cy.get('[aria-label="21, событий: 1"]').should('exist');
    cy.get('[aria-label="Календарь месяца"] button[aria-label*="событий:"]').should('have.length', 2);
    cy.get('[aria-label="21, событий: 1"]').click(); activeDialog().should('contain.text', 'Старт 21 октября').and('not.contain.text', meeting.data.title);
  });
  for (const [width, height] of [[320, 568], [375, 667], [812, 375], [1440, 900]]) {
    for (const theme of ['dark', 'light']) it(`CAL-10 сегодня выделено в календаре и date picker (${width}x${height}, ${theme})`, () => {
      cy.viewport(width, height); const state = scenario({ events: [] }); visit(state);
      if (theme === 'light') cy.get('[aria-label="Включить светлую тему"]').click();
      const shot = (name: string) => cy.screenshot(`today/${width}-${height}-${theme}-${name}`, { capture: 'viewport' });
      const current = () => cy.get('[aria-label="Календарь месяца"] [aria-current="date"]');
      current().should('have.text', '17').and('have.attr', 'title', 'Сегодня').should($el => expect(getComputedStyle($el[0]).boxShadow).not.to.eq('none'));
      current().scrollIntoView(); shot('empty');
      cy.then(() => { state.events.push({ ...meeting, has_updates: true, data: { ...meeting.data, start_date: '2026-10-17', end_date: '2026-10-21' } }); });
      cy.get('[aria-label="Обновить события"]').click(); current().should('have.attr', 'aria-label', '17, событий: 1').and('have.attr', 'aria-description', 'Нужен ваш ответ. Обновлено'); current().scrollIntoView(); shot('event');
      button('Создать событие').click(); cy.get('[aria-label="Дата начала"]').click();
      const fullyVisible = ($el: JQuery<HTMLElement>) => { const rect = $el[0].getBoundingClientRect(); const body = $el[0].closest('.modal-body')!.getBoundingClientRect(); expect(rect.top).to.be.at.least(body.top); expect(rect.bottom).to.be.at.most(body.bottom); };
      activeDialog().find('[aria-current="date"]').should('have.attr', 'aria-pressed', 'false').should(fullyVisible); shot('picker');
      activeDialog().find('[aria-current="date"]').click(); cy.get('[aria-label="Дата начала"]').click();
      activeDialog().find('[aria-current="date"]').should('have.attr', 'aria-pressed', 'true').and('have.class', 'ring-white').should(fullyVisible); shot('selected');
      escape(); escape();
      cy.get('[aria-label="Следующий месяц"]').click(); cy.get('[aria-label="Календарь месяца"] [aria-current="date"]').should('not.exist');
    });
  }
});
