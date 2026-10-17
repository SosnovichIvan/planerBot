import { activeDialog, bounds, button, chatA, escape, meeting, mutations, scenario, second, visit } from '../support/scenario';

describe('Удаление и мобильные состояния', () => {
  afterEach(() => cy.then(() => Cypress.automation('remote:debugger:protocol', { command: 'Emulation.setEmulatedMedia', params: { features: [] } })));
  it('REMOVE-01 удаление убирает событие из повестки и сетки, оставляя отдельную очередь администратора', () => {
    const state = scenario({ events: [meeting] }); visit(state);
    button('Удалить событие').click();
    cy.get('#events-title').parent().find('ul').first().should('not.contain.text', meeting.data.title);
    cy.get('[aria-label="20, событий: 1"]').should('not.exist');
    cy.get('[aria-label="Удаление сообщений в Telegram"]').should('contain.text', 'Удаление сообщения в очереди');
    cy.then(() => { expect(mutations(state, '/cancel')).to.have.length(1); state.events[0].publication_status = 'published'; });
    cy.get('[aria-label="Обновить события"]').click(); cy.get('[aria-label="Удаление сообщений в Telegram"]').should('not.exist');
    cy.contains(meeting.data.title).should('not.exist'); cy.reload(); cy.contains(meeting.data.title).should('not.exist');
  });
  it('REMOVE-02 ошибка удаления сообщения видна только администратору и допускает отдельный повтор', () => {
    const state = scenario({ events: [{ ...meeting, status: 'cancelled', publication_status: 'failed' }] }); visit(state);
    cy.contains('48 часов').should('be.visible'); button('Повторить удаление сообщения').click();
    cy.get('[aria-label="Удаление сообщений в Telegram"]').should('not.exist');
    cy.then(() => { expect(mutations(state, '/retry')[0].body).to.deep.eq({ ack_duplicate_risk: false }); expect(mutations(state, '/events')).to.have.length(0); });
  });
  it('REMOVE-03 отказ API сохраняет событие, отмена подтверждения не вызывает мутацию', () => {
    const state = scenario({ events: [meeting] }); const confirm = cy.stub().returns(false); cy.on('window:confirm', confirm); visit(state);
    button('Удалить событие').click(); cy.then(() => { expect(mutations(state, '/cancel')).to.have.length(0); confirm.returns(true); });
    cy.intercept('POST', '**/cancel', { statusCode: 403 }); button('Удалить событие').click(); cy.contains('Нет прав на это действие').should('be.visible');
    cy.get('[aria-label="20, событий: 1"]').should('exist'); button('Открыть событие').should('be.visible');
  });
  it('REMOVE-04 удаление из карточки закрывает только её и обновляет список выбранного дня', () => {
    const state = scenario({ events: [meeting, { ...meeting, id: '00000000-0000-4000-8000-000000000004', data: { ...meeting.data, title: 'Вторая встреча' } }] }); visit(state);
    cy.get('[aria-label="20, событий: 2"]').click(); activeDialog().contains('button', meeting.data.title).click(); button('Удалить событие').click();
    cy.get('dialog[open]').should('have.length', 1); activeDialog().should('contain.text', 'Вторая встреча').and('not.contain.text', meeting.data.title);
  });
  for (const [width, height] of [[320, 568], [375, 667], [812, 375], [1440, 900]]) {
    it(`UI-05 первый и последний пункты селекта видны без прокрутки шапки (${width}x${height})`, () => {
      cy.viewport(width, height);
      const state = scenario({ chats: Array.from({ length: 18 }, (_, i) => ({ ...chatA, id: `-100${i + 1}`, title: `Чат ${i + 1} — длинное название без сокращения` })), events: [] }); visit(state);
      cy.get('[role="combobox"]').click();
      activeDialog().find('[role="option"]').first().should(($first) => {
        const body = $first[0].closest('.modal-body')!.getBoundingClientRect();
        expect($first[0].getBoundingClientRect().top).to.be.at.least(body.top + 6);
      });
      bounds('.modal-header'); cy.realPress(Cypress.Keyboard.Keys.END);
      cy.focused().should('contain.text', 'Чат 18').should(($option) => {
        const body = $option[0].closest('.modal-body')!.getBoundingClientRect(); const item = $option[0].getBoundingClientRect();
        expect(item.top).to.be.at.least(body.top); expect(item.bottom).to.be.at.most(body.bottom);
      });
      bounds('.modal-header'); cy.realPress(Cypress.Keyboard.Keys.HOME); activeDialog().find('[role="option"]').first().should('have.focus');
      activeDialog().should(($modal) => expect($modal[0].scrollTop).to.eq(0));
      cy.get('.modal-header h2').should(($heading) => expect(getComputedStyle($heading[0]).outlineStyle).to.eq('none'));
    });
  }
  for (const [width, height] of [[320, 568], [375, 667], [812, 375], [1440, 900]]) {
    for (const theme of ['dark', 'light']) it(`UI-06 компоненты и действия доступны в теме ${theme} (${width}x${height})`, () => {
      cy.viewport(width, height); const state = scenario({ events: [{ ...meeting, my_response: 'yes' }] }); visit(state);
      if (theme === 'light') cy.get('[aria-label="Включить светлую тему"]').click();
      const shot = (name: string) => cy.screenshot(`audit/${width}-${height}-${theme}-${name}`, { capture: 'viewport' });
      const noOverflow = () => cy.get('html').should(($html) => expect($html[0].scrollWidth).to.be.at.most(width));
      noOverflow(); shot('calendar'); button('Создать событие').click(); bounds('.event-form-footer'); shot('create');
      cy.get('[role="combobox"][aria-label="Чат"]').last().click(); bounds('.modal-header'); shot('select'); escape();
      cy.get('[aria-label="Дата начала"]').click(); bounds('.modal-footer'); shot('date'); escape();
      cy.get('[aria-label="Время начала"]').click(); bounds('.modal-header'); bounds('.modal-footer'); shot('time');
      activeDialog().find('.time-column [aria-pressed="true"]').should(($buttons) => {
        const body = $buttons[0].closest('.modal-body')!.getBoundingClientRect();
        $buttons.each((_, el) => { const rect = el.getBoundingClientRect(); expect(rect.top).to.be.at.least(body.top); expect(rect.bottom).to.be.at.most(body.bottom); });
      });
      activeDialog().should(($modal) => expect($modal[0].scrollTop).to.eq(0)); escape();
      cy.get('.event-form-body').scrollTo('bottom'); bounds('.event-form-footer'); cy.get('input[name="tags"]').should('be.visible'); shot('create-bottom');
      cy.get('[aria-label="Закрыть форму"]').click(); button('Открыть событие').click(); noOverflow(); shot('card');
      button('Редактировать').click(); bounds('.event-form-footer'); shot('edit');
      cy.get('.event-form-body').scrollTo('bottom'); bounds('.event-form-footer'); shot('edit-bottom'); cy.get('[aria-label="Закрыть форму"]').click();
      cy.contains('button', /^Не проголосовали:/).click(); bounds('.event-form-footer'); shot('broadcast'); escape(); escape();
      cy.then(() => { state.events.push(second); }); cy.get('[aria-label="Обновить события"]').click();
      cy.get('[aria-label="20, событий: 2"]').click(); noOverflow(); shot('day-drawer'); escape();
      button('Настройки').click(); cy.contains('summary', 'Настройки чата').first().click(); noOverflow(); shot('settings'); escape();
      noOverflow();
    });
  }
  it('UI-07 увеличенный текст и reduced motion не прячут действия и не растягивают крестик', () => {
    cy.viewport(375, 667); const state = scenario({ events: [meeting] }); visit(state);
    cy.then(() => Cypress.automation('remote:debugger:protocol', { command: 'Emulation.setEmulatedMedia', params: { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] } }));
    cy.document().then(doc => { doc.documentElement.style.fontSize = '20px'; });
    button('Создать событие').click(); bounds('.event-form-footer');
    cy.get('.modal-header .icon-button').should(($button) => { expect($button.outerWidth()).to.eq(44); expect($button.outerHeight()).to.eq(44); expect(getComputedStyle($button[0]).transitionDuration).to.eq('0s'); });
    cy.window().then(win => expect(win.matchMedia('(prefers-reduced-motion: reduce)').matches).to.eq(true));
    cy.get('.event-form-body').scrollTo('bottom'); cy.get('input[name="tags"]').should('be.visible');
    cy.get('html').should(($html) => expect($html[0].scrollWidth).to.be.at.most(375));
  });
  for (const [width, height] of [[320, 568], [375, 667], [812, 375], [1440, 900]]) it(`UI-08 последняя дата и 23:59 доступны с видимыми действиями (${width}x${height})`, () => {
    cy.viewport(width, height); const state = scenario({ events: [] }); visit(state); button('Создать событие').click();
    cy.get('[aria-label="Дата начала"]').click(); activeDialog().find('.modal-body').then($body => {
      if ($body[0].scrollHeight > $body[0].clientHeight) cy.wrap($body).scrollTo('bottom');
    });
    activeDialog().find('[aria-label="31 октября 2026 г."]').should('be.visible').click();
    cy.get('input[name="start_date"]').should('have.value', '2026-10-31');
    cy.get('[aria-label="Время начала"]').click();
    activeDialog().find('.time-column').first().scrollTo('bottom'); activeDialog().find('[aria-label="Часы: 23"]').should('be.visible').click();
    activeDialog().find('.time-column').last().scrollTo('bottom'); activeDialog().find('[aria-label="Минуты: 59"]').should('be.visible').click();
    bounds('.modal-header'); bounds('.modal-footer'); button('Подтвердить').click(); cy.get('input[name="start_time"]').should('have.value', '23:59');
  });
});
