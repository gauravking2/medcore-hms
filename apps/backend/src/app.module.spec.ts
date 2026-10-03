import { HealthController } from './health/health.controller';

describe('HealthController', () => {
  it('reports that the application is alive', () => {
    expect(new HealthController().health()).toEqual({ status: 'ok' });
  });
});
