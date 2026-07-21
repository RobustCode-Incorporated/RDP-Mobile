import { jest } from '@jest/globals';

jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn(),
  getItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

jest.mock('expo-location', () => ({
  Accuracy: {
    Balanced: 3,
  },
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  watchPositionAsync: jest.fn(async (_options: unknown, callback: any) => {
    callback({
      coords: {
        latitude: 48.8566,
        longitude: 2.3522,
      },
    });

    return {
      remove: jest.fn(),
    };
  }),
  geocodeAsync: jest.fn(async () => []),
}));