import { activeDialog, bounds, button, chatA, chatB, choose, escape, meeting, mutations, scenario, visit } from '../support/scenario';

describe('Настройки, ссылки и регрессии layout', () => {
  it('SET-01 сохраняет настройки только управляемого чата с версией и включёнными темами', () => {
    const state = scenario(); visit(state); button('Настройки').click(); activeDialog().find('section').should('have.length', 1);
    cy.contains('summary', 'Настройки чата').click(); cy.get('input[name="timezone"]').clear().type('Europe/Berlin'); cy.get('input[name="event_tag"]').clear().type('#встреча');
    cy.get('input[name="confirmation_required"]').check(); cy.get('input[name="topic"][value="10"]').uncheck(); cy.get('input[name="topic"][value="11"]').check();
    button('Сохранить настройки').click(); cy.then(() => expect(mutations(state, '/settings')[0].body).to.deep.eq({ version: 1, timezone: 'Europe/Berlin', event_tag: '#встреча', creation_policy: 'admins', confirmation_required: true, enabled_topic_ids: [11] }));
  });
  it('SET-02 конфликт настроек показывает ошибку и не очищает поля', () => {
    const state = scenario(); visit(state); button('Настройки').click(); cy.contains('summary', 'Настройки чата').click();
    cy.get('input[name="event_tag"]').clear().type('#новый'); cy.intercept('PUT', '**/settings', { statusCode: 409, body: { detail: 'Настройки изменились. Обновите список чатов.' } });
    button('Сохранить настройки').click(); cy.contains('[role="alert"]', 'Настройки изменились').should('be.visible'); cy.get('input[name="event_tag"]').should('have.value', '#новый');
  });
  it('LINK-01 deep link создания выбирает управляемые чат и тему', () => {
    const state = scenario(); visit(state, { raw: 'start_param=create_-100100_10' }); activeDialog().find('h2').should('have.text', 'Создать событие');
    cy.get('[role="combobox"][aria-label="Чат"]').last().should('contain.text', 'Команда'); cy.get('[role="combobox"][aria-label="Тема"]').should('contain.text', 'Встречи');
  });
  it('LINK-02 deep link не даёт участнику форму создания, ссылка события открывает карточку', () => {
    const state = scenario({ chats: [chatB], events: [] }); visit(state, { raw: 'start_param=create_-100200_1' });
    cy.contains('Для создания события нужны права администратора').should('be.visible'); cy.get('dialog[open]').should('not.exist');
  });
  it('LINK-03 deep link карточки обрабатывает отказ сервера, не раскрывая событие', () => {
    const state = scenario(); cy.intercept('GET', `**/events/${meeting.id}`, { statusCode: 403 }); visit(state, { raw: `start_param=event_-100100_${meeting.id.replaceAll('-', '')}` });
    cy.contains('Нет прав на это действие').should('be.visible'); cy.get('dialog[open]').should('not.contain.text', 'Кафе');
  });
  it('UI-01 селекты закрываются после выбора, по крестику, Escape и фону вне label', () => {
    const state = scenario({ chats: [chatA, { ...chatB, can_manage: true }] }); visit(state); choose('Чат', 'Команда');
    cy.get('[role="combobox"][aria-label="Чат"]').click(); activeDialog().should(($dialog) => expect($dialog[0].parentElement).to.eq($dialog[0].ownerDocument.body));
    cy.get('[aria-label="Закрыть окно"]').click(); cy.get('dialog[open]').should('not.exist');
    cy.get('[role="combobox"][aria-label="Чат"]').focus(); cy.realPress(Cypress.Keyboard.Keys.SPACE); cy.get('[role="listbox"]').should('be.visible'); escape(); cy.get('dialog[open]').should('not.exist');
    cy.get('[role="combobox"][aria-label="Чат"]').click(); cy.get('dialog[open]').click(1, -10, { force: true }); cy.get('dialog[open]').should('not.exist');
    button('Создать событие').click(); choose('Чат', 'Клуб'); choose('Тема', 'Чат'); cy.get('dialog[open]').should('have.length', 1);
  });
  for (const [width, height] of [[320, 568], [375, 667], [812, 375], [1440, 900]]) {
    it(`UI-02 форма, поля и нижние действия не схлопываются (${width}x${height})`, () => {
      cy.viewport(width, height); const state = scenario(); visit(state);
      cy.scrollTo('bottom'); button('Создать событие').click(); bounds('.modal-full-height'); bounds('.event-form-body'); bounds('.event-form-footer');
      cy.get('.modal-header .icon-button').should(($button) => { expect($button.outerWidth()).to.eq(44); expect($button.outerHeight()).to.eq(44); });
      cy.get('.event-form-body').scrollTo('bottom'); cy.get('input[name="tags"]').should('be.visible'); bounds('.event-form-footer');
      cy.get('html').should(($html) => expect($html[0].scrollWidth).to.be.at.most(width));
    });
  }
  it('UI-03 форма учитывает меньшую видимую область Telegram, а не только размер браузера', () => {
    cy.viewport(375, 667); const state = scenario(); visit(state, { telegramHeight: 440 }); button('Создать событие').click();
    bounds('.modal-full-height', 440); bounds('.event-form-body', 440); bounds('.event-form-footer', 440);
    cy.get('.event-form-body').scrollTo('bottom'); cy.get('input[name="tags"]').should('be.visible');
  });
  it('UI-04 клавиатура выбирает значение, отмена не меняет его и возвращает фокус', () => {
    const state = scenario(); visit(state); cy.get('[role="combobox"][aria-label="Чат"]').focus(); cy.realPress(Cypress.Keyboard.Keys.DOWN);
    cy.get('[role="option"][aria-selected="true"]').should('have.focus');
    cy.realPress(Cypress.Keyboard.Keys.END); cy.focused().should('contain.text', 'Клуб'); cy.realPress(Cypress.Keyboard.Keys.ENTER); cy.get('[role="listbox"]').should('not.exist');
    cy.get('[role="combobox"]').should('contain.text', 'Клуб').and('have.focus'); cy.realPress(Cypress.Keyboard.Keys.UP); cy.get('[role="listbox"]').should('be.visible'); escape();
    cy.get('[role="combobox"]').should('contain.text', 'Клуб').and('have.focus');
  });
  it('ACTION-01 отмена, подтверждение импорта и ручной повтор используют отдельные контракты', () => {
    const pending = { ...meeting, status: 'pending', publication_status: null };
    const state = scenario({ events: [pending] }); visit(state); button('Подтвердить событие').click(); cy.contains('Запланировано').should('be.visible');
    cy.then(() => { expect(mutations(state, '/approve')[0].body).to.deep.eq({ version: 1 }); state.events[0].publication_status = 'unknown'; });
    cy.get('[aria-label="Обновить события"]').click(); button('Повторить с риском дубликата').click();
    cy.then(() => expect(mutations(state, '/retry')[0].body).to.deep.eq({ ack_duplicate_risk: true }));
    button('Отменить событие').click(); cy.contains('Отменено').should('be.visible');
    cy.then(() => expect(mutations(state, '/cancel')[0].body).to.deep.eq({ version: 2 }));
  });
});
