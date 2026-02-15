export class MockTokenManager {
  accessToken = "mock-token";
  fleetApiBaseUrl = "https://fleet-api.prd.na.vn.cloud.tesla.com";

  getAccessToken(): Promise<string> {
    return Promise.resolve(this.accessToken);
  }

  getFleetApiBaseUrl(): Promise<string> {
    return Promise.resolve(this.fleetApiBaseUrl);
  }

  refreshTokens(): Promise<void> {
    // no-op for tests
    return Promise.resolve();
  }
}
