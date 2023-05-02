/// <reference types="cypress" />

context('User profile', () => {
  const USER_PROFILE_URL =
    '/wiki/spaces/KONVIW/pages/763101592/konviw+-+demo+macro+user+profile';
  it('checks for the profile image and matches the whole page', () => {
    cy.visit(USER_PROFILE_URL);

    // Chain the commands without using an additional callback function
    cy.get('img.userLogo', { timeout: 2000 })
      .should('be.visible')
      .then(() => {
        cy.document().toMatchImageSnapshot();
      });
  });
});
