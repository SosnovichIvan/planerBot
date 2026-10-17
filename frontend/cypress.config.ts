import { defineConfig } from 'cypress';

export default defineConfig({
  viewportWidth: 1280,
  viewportHeight: 900,
  video: false,
  screenshotOnRunFailure: true,
  retries: 0,
  allowCypressEnv: false,
  defaultCommandTimeout: 8000,
  scrollBehavior: 'center',
  e2e: {
    baseUrl: 'http://127.0.0.1:4173',
    specPattern: 'cypress/e2e/**/*.cy.ts',
    supportFile: false,
    testIsolation: true,
    setupNodeEvents(on, config) {
      if (config.baseUrl !== 'http://127.0.0.1:4173') {
        throw new Error('Cypress may run only against the isolated local frontend on port 4173');
      }
      // Keep viewport screenshots unscaled/unclipped at the largest audit size.
      on('before:browser:launch', (browser, launchOptions) => {
        if (browser.name === 'electron') {
          launchOptions.preferences.width = 1600;
          launchOptions.preferences.height = 1200;
        }
        return launchOptions;
      });
      return config;
    },
  },
});
