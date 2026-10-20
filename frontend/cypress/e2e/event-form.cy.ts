import { activeDialog, button, chatA, chatB, choose, date, escape, fill, meeting, mutations, scenario, visit } from '../support/scenario';

describe('Создание и редактирование', () => {
  it('FORM-01 создаёт событие с местом без обязательной ссылки подключения', () => {
    const state = scenario(); visit(state); button('Создать событие').click(); fill();
    button('Создать и опубликовать').click(); cy.get('dialog[open]').should('not.exist'); cy.contains('Новая встреча').should('be.visible');
    cy.then(() => {
      const [call] = mutations(state, '/events'); expect(call.key).to.match(/^[a-f0-9-]{36}$/);
      expect(call.body).to.include({ topic_id: 10, title: 'Новая встреча', start_date: '2026-10-20', place: 'Парк', online_url: '', notify_members: true });
      expect(mutations(state, '/events')).to.have.length(1);
    });
  });
  it('FORM-10 invitation is checked for each new form and can be disabled for one event', () => {
    const state = scenario(); visit(state); button('Создать событие').click();
    cy.get('input[name="notify_members"]').should('be.checked').uncheck();
    fill(); button('Создать и опубликовать').click();
    cy.then(() => expect(mutations(state, '/events')[0].body).to.include({ notify_members: false }));
    button('Создать событие').click();
    cy.get('input[name="notify_members"]').should('be.checked');
  });
  it('FORM-02 валидирует обязательные поля и сохраняет черновик после серверной ошибки', () => {
    const state = scenario(); visit(state); button('Создать событие').click();
    button('Создать и опубликовать').click(); cy.get('input[name="title"]:invalid').should('exist');
    cy.get('input[name="title"]').type('Черновик'); button('Создать и опубликовать').click(); cy.contains('Выберите дату начала').scrollIntoView().should('be.visible');
    date(); button('Создать и опубликовать').click(); cy.contains('Укажите место встречи или ссылку подключения').scrollIntoView().should('be.visible');
    cy.get('input[name="online_url"]').type('https://example.test/meeting');
    cy.intercept('POST', '**/events', { statusCode: 422, body: { detail: 'Окончание должно быть позже начала' } });
    button('Создать и опубликовать').click(); cy.contains('Окончание должно быть позже начала').scrollIntoView().should('be.visible');
    cy.get('input[name="title"]').should('have.value', 'Черновик'); cy.get('input[name="online_url"]').should('have.value', 'https://example.test/meeting');
  });
  it('FORM-03 потеря прав не превращается в успешное сохранение', () => {
    const state = scenario(); visit(state); button('Создать событие').click(); fill();
    cy.intercept('POST', '**/events', { statusCode: 403 }); button('Создать и опубликовать').click();
    cy.contains('Нет прав на это действие').scrollIntoView().should('be.visible'); cy.get('input[name="title"]').should('have.value', 'Новая встреча');
  });
  it('FORM-04 неизвестный исход замораживает черновик и повторяет исходный ключ и тело', () => {
    const state = scenario(); const attempts: { body: unknown; key: unknown }[] = []; let offline = true;
    cy.intercept('POST', '**/events', (req) => {
      attempts.push({ body: structuredClone(req.body), key: req.headers['idempotency-key'] });
      if (offline) req.destroy(); else req.reply({ ...meeting, data: req.body });
    });
    visit(state); button('Создать событие').click(); fill(); button('Создать и опубликовать').click();
    cy.contains('Результат запроса неизвестен').scrollIntoView().should('be.visible'); cy.get('input[name="title"]').should('be.disabled');
    cy.then(() => { offline = false; }); button('Создать и опубликовать').click(); cy.get('dialog[open]').should('not.exist');
    cy.then(() => { expect(attempts.length).to.be.greaterThan(1); attempts.forEach((attempt) => expect(attempt).to.deep.eq(attempts[0])); });
  });
  it('FORM-05 закрытие грязной формы требует подтверждения и не отправляет событие', () => {
    const state = scenario(); visit(state); button('Создать событие').click(); cy.get('input[name="title"]').type('Не сохранено');
    const confirm = cy.stub().returns(false); cy.on('window:confirm', confirm);
    cy.get('[aria-label="Закрыть форму"]').click(); cy.get('input[name="title"]').should('have.value', 'Не сохранено');
    cy.then(() => confirm.returns(true)); button('Отмена').click(); cy.get('dialog[open]').should('not.exist');
    cy.then(() => expect(mutations(state, '/events')).to.have.length(0));
  });
  it('FORM-06 дата и время выбираются в оформленных окнах, Весь день исключает время', () => {
    const state = scenario(); visit(state); button('Создать событие').click(); fill();
    cy.get('button[aria-label="Время начала"]').click(); activeDialog().find('[aria-label="Часы: 22"]').click(); activeDialog().find('[aria-label="Минуты: 30"]').click();
    button('Подтвердить').click(); cy.get('input[name="start_time"]').should('have.value', '22:30');
    cy.get('button[aria-label="Дата окончания"]').click(); button('Отмена').click(); cy.get('input[name="end_date"]').should('have.value', '');
    cy.contains('label', 'Весь день').find('input').check(); cy.get('button[aria-label="Время начала"]').should('be.disabled');
    button('Создать и опубликовать').click(); cy.then(() => expect(mutations(state, '/events')[0].body).to.include({ start_time: null, end_time: null }));
  });
  it('FORM-07 редактирование без изменений не отправляется, уведомление по умолчанию выключено', () => {
    const state = scenario({ events: [{ ...meeting, my_response: 'yes', data: { ...meeting.data, notify_members: true } }] }); visit(state);
    button('Изменить').click(); cy.get('input[name="notify_members"]').should('not.be.checked');
    button('Сохранить изменения').click(); cy.contains('Нет изменений.').scrollIntoView().should('be.visible');
    cy.then(() => expect(mutations(state, `/${meeting.id}`)).to.have.length(0));
    cy.get('input[name="place"]').clear().type('Парк'); button('Сохранить изменения').click(); cy.contains('Уведомления не отправлялись').should('be.visible');
    cy.then(() => { expect(mutations(state, `/${meeting.id}`)[0].body).to.include({ version: 1, notify_members: false, place: 'Парк' }); expect(state.events[0].my_response).to.eq('yes'); });
  });
  it('FORM-08 явное уведомление об изменениях требует отдельного подтверждения', () => {
    const state = scenario({ events: [meeting] }); visit(state); button('Изменить').click(); cy.get('input[name="place"]').clear().type('Парк'); cy.get('input[name="notify_members"]').check();
    button('Сохранить изменения').click(); cy.get('dialog[open]').should('have.length', 2); activeDialog().contains('button', 'Отмена').click();
    cy.then(() => expect(mutations(state, `/${meeting.id}`)).to.have.length(0));
    button('Сохранить изменения').click(); button('Сохранить и уведомить').click(); cy.contains('Уведомления поставлены в очередь').should('be.visible');
    cy.then(() => expect(mutations(state, `/${meeting.id}`)[0].body).to.include({ notify_members: true }));
  });
  it('FORM-09 назначение ограничено управляемыми чатами и включёнными темами', () => {
    const state = scenario({ chats: [chatA, chatB] }); visit(state); button('Создать событие').focus(); cy.realPress(Cypress.Keyboard.Keys.ENTER);
    cy.get('[role="combobox"][aria-label="Чат"]').last().focus(); cy.realPress(Cypress.Keyboard.Keys.SPACE); cy.get('[role="option"]').should('have.length', 1); cy.contains('[role="option"]', 'Клуб').should('not.exist');
    escape(); choose('Тема', 'Встречи');
    cy.get('[role="combobox"][aria-label="Тема"]').focus(); cy.realPress(Cypress.Keyboard.Keys.SPACE); cy.get('[role="listbox"]').should('be.visible'); cy.contains('[role="option"]', 'Архив').should('not.exist'); escape();
  });
});
