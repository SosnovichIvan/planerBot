import { activeDialog, bounds, button, meeting, scenario, visit } from '../support/scenario';

describe('список непроголосовавших', () => {
  for (const width of [390, 1280]) {
    it(`RSVP-04 opens an accessible separate drawer before the administrator votes at ${width}px`, () => {
      cy.viewport(width, 844);
      const state = scenario({ events: [meeting] });
      cy.intercept('GET', '**/unanswered?after=*', { participants: [{ user_id: '43', name: 'Мария' }], next_cursor: null }).as('unanswered');
      visit(state); button('Открыть событие').click();
      button('Список непроголосовавших').click();
      cy.wait('@unanswered');
      activeDialog().should('contain.text', 'Мария').and('contain.text', 'не полный состав Telegram-чата');
      activeDialog().find('ul[aria-label="Не проголосовавшие участники"]').should($list => {
        const list = $list[0].getBoundingClientRect();
        const intro = $list[0].parentElement!.querySelector('p')!.getBoundingClientRect();
        expect(list.top).to.be.at.least(intro.bottom + 8);
        expect(list.width).to.be.at.least(intro.width - 1);
      });
      bounds('dialog[open]:last');
      cy.screenshot(`unanswered-${width}`, { capture: 'viewport' });
      activeDialog().find('button[aria-label="Закрыть список участников"]').click();
      cy.get('dialog[open]').should('have.length', 1);
    });
  }
  it('RSVP-05 does not expose the list action to ordinary participants', () => {
    const state = scenario({ events: [{ ...meeting, can_manage: false }] });
    visit(state); button('Открыть событие').click();
    activeDialog().should('contain.text', 'Нужен ваш ответ');
    cy.contains('button', 'Список непроголосовавших').should('not.exist');
    cy.then(() => expect(state.calls.filter(call => call.path.includes('/unanswered'))).to.have.length(0));
  });
});
