import { activeDialog, button, chatA, escape, meeting, mutations, scenario, visit } from '../support/scenario';

describe('Ответы, изменения и личные сообщения', () => {
  for (const admin of [true, false]) {
    it(`RSVP-01 количества скрыты до ответа и после сброса (admin=${admin})`, () => {
      const state = scenario({ chats: [{ ...chatA, can_manage: admin }], events: [{ ...meeting, can_manage: admin }] }); visit(state);
      cy.get('[aria-label="20, событий: 1"]').should('have.attr', 'aria-description', 'Нужен ваш ответ').click();
      cy.contains('Результаты станут доступны после вашего ответа').should('be.visible'); cy.get('[aria-label="Ответы участников календаря"]').should('not.exist');
      cy.get('[aria-label="Ваш ответ"]').contains('button', /^Приду$/).click(); cy.contains('Ваш ответ: Приду').should('be.visible');
      cy.get('[aria-label="Ответы участников календаря"]').should('be.visible');
      cy.get('[aria-label="Ваш ответ"]').contains('button', /^Не приду$/).click(); cy.contains('Ваш ответ: Не приду').should('be.visible');
      button('Сбросить ответ').click(); cy.get('[aria-label="Ответы участников календаря"]').should('not.exist');
      cy.then(() => expect(mutations(state, '/response').map((call) => call.body)).to.deep.eq([{ answer: 'yes' }, { answer: 'no' }, { answer: 'unanswered' }]));
    });
  }
  it('RSVP-02 отменённое событие недоступно для голосования', () => {
    const state = scenario({ events: [{ ...meeting, status: 'cancelled' }] }); visit(state, { raw: `start_param=event_${meeting.chat_id}_${meeting.id.replaceAll('-', '')}` });
    cy.contains('Событие отменено').should('be.visible'); cy.get('[aria-label="Ваш ответ"]').should('not.exist');
  });
  it('RSVP-03 ошибка ответа не показывает результаты, повтор остаётся доступен', () => {
    const state = scenario({ events: [meeting] }); visit(state); button('Открыть событие').click();
    cy.intercept({ method: 'PUT', url: '**/response', times: 1 }, { statusCode: 409, body: { detail: 'Событие изменилось' } });
    cy.get('[aria-label="Ваш ответ"]').contains('button', /^Приду$/).click(); cy.contains('[role="alert"]', 'Событие изменилось').should('be.visible');
    cy.get('[aria-label="Ответы участников календаря"]').should('not.exist');
    cy.get('[aria-label="Ваш ответ"]').contains('button', /^Приду$/).click(); cy.contains('Ваш ответ: Приду').should('be.visible');
  });
  for (const [audience, label] of [['yes', 'Приду'], ['no', 'Не приду'], ['unanswered', 'Не проголосовали']] as const) {
    it(`MSG-01 администратор отправляет сообщение выбранной группе (${audience})`, () => {
      const state = scenario({ events: [{ ...meeting, my_response: 'yes' }] }); visit(state); button('Открыть событие').click();
      cy.get('[aria-label="Ответы участников календаря"]').contains('button', new RegExp(`^${label}:`)).click();
      cy.get('dialog[open]').should('have.length', 2); activeDialog().find('h2').should('have.text', `Сообщение: ${label}`);
      cy.get('textarea').type('Пожалуйста, проверьте планы'); button('Отправить группе').click(); cy.get('dialog[open]').should('have.length', 1);
      cy.contains('Рассылка поставлена в очередь. Это ещё не подтверждение доставки.').should('be.visible');
      cy.then(() => expect(mutations(state, '/campaigns')[0].body).to.deep.eq({ audience, text: 'Пожалуйста, проверьте планы' }));
    });
  }
  it('MSG-02 неизвестный исход рассылки повторяется с исходным ключом и текстом', () => {
    const state = scenario({ events: [{ ...meeting, my_response: 'yes' }] }); const attempts: { body: unknown; key: unknown }[] = []; let offline = true;
    cy.intercept('POST', '**/campaigns', (req) => {
      attempts.push({ body: structuredClone(req.body), key: req.headers['idempotency-key'] });
      if (offline) req.destroy(); else req.reply({ id: '00000000-0000-4000-8000-000000000009', statuses: {} });
    });
    visit(state); button('Открыть событие').click(); cy.contains('button', /^Не проголосовали:/).click();
    cy.get('textarea').type('Ответьте на приглашение'); button('Отправить группе').click(); cy.contains('Результат запроса неизвестен').should('be.visible');
    cy.get('textarea').should('be.disabled').and('have.value', 'Ответьте на приглашение'); cy.then(() => { offline = false; }); button('Повторить тот же запрос').click();
    cy.contains('Рассылка поставлена в очередь').should('be.visible'); cy.then(() => { expect(attempts.length).to.be.greaterThan(1); attempts.forEach((attempt) => expect(attempt).to.deep.eq(attempts[0])); });
  });
  it('MSG-03 Escape закрывает только верхнюю форму, несохранённый текст требует подтверждения', () => {
    const state = scenario({ events: [{ ...meeting, my_response: 'yes' }] }); visit(state); button('Открыть событие').focus(); cy.realPress(Cypress.Keyboard.Keys.ENTER); cy.contains('button', /^Приду:/).focus(); cy.realPress(Cypress.Keyboard.Keys.ENTER);
    escape(); cy.get('dialog[open]').should('have.length', 1); cy.focused().should('contain.text', 'Приду:');
    cy.contains('button', /^Приду:/).focus(); cy.realPress(Cypress.Keyboard.Keys.ENTER); cy.get('textarea').type('Черновик'); const confirm = cy.stub().returns(false); cy.on('window:confirm', confirm);
    cy.get('[aria-label="Закрыть форму отправки"]').click(); cy.get('textarea').should('have.value', 'Черновик');
    cy.then(() => confirm.returns(true)); cy.get('[aria-label="Закрыть форму отправки"]').click(); cy.get('dialog[open]').should('have.length', 1);
    cy.then(() => expect(mutations(state, '/campaigns')).to.have.length(0));
  });
  it('MSG-04 разрешение Telegram не приравнивается к серверному, обновление и отключение явные', () => {
    const state = scenario({ events: [meeting] }); visit(state); button('Открыть событие').click(); button('Разрешить сообщения').click();
    cy.contains('Разрешение принято Telegram').should('be.visible'); button('Отключить уведомления').should('not.exist');
    cy.then(() => { expect(state.writeRequests).to.eq(1); state.contact = true; });
    button('Обновить разрешение').click(); cy.contains('Личные уведомления включены').should('be.visible');
    button('Отключить уведомления').click(); button('Разрешить сообщения').should('be.visible'); cy.then(() => expect(state.contact).to.eq(false));
  });
  for (const noWriteMethod of [true, false]) it(`MSG-05 отказ Telegram / старый клиент без ложного разрешения (missing=${noWriteMethod})`, () => {
    const state = scenario({ events: [meeting], allowWrite: false }); visit(state, { noWriteMethod }); button('Открыть событие').click(); button('Разрешить сообщения').click();
    cy.contains('Разрешение не получено. Можно отправить /start боту в личке.').should('be.visible'); button('Отключить уведомления').should('not.exist');
  });
  it('MSG-06 статус очереди различает доставленные, пропущенные и неизвестные сообщения', () => {
    const state = scenario({ events: [{ ...meeting, my_response: 'yes' }] }); visit(state); button('Открыть событие').click(); cy.contains('button', /^Не приду:/).click();
    cy.get('textarea').type('Обновление'); button('Отправить группе').click(); button('Проверить доставку').click();
    cy.get('[aria-label="Доставка рассылки"]').should('contain.text', 'Отправлено: 1').and('contain.text', 'Пропущено: 1').and('contain.text', 'Доставка неизвестна: 1');
  });
  it('UPD-01 отметка обновления и diff не сбрасывают RSVP, открытие обновляет маркеры', () => {
    const state = scenario({ events: [{ ...meeting, has_updates: true, my_response: 'yes', changes: [{ field: 'place', before: 'Парк', after: 'Кафе' }] }] }); visit(state);
    cy.get('[aria-label="20, событий: 1"]').should('have.attr', 'aria-description', 'Обновлено').click();
    cy.get('[aria-label="Что изменилось"]').should('contain.text', 'Парк').and('contain.text', 'Кафе'); cy.contains('Ваш ответ: Приду').should('be.visible');
    escape(); cy.get('[aria-label="20, событий: 1"]').should('not.have.attr', 'aria-description');
    cy.then(() => expect(state.events[0].my_response).to.eq('yes'));
  });
});
