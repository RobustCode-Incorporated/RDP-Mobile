import { jest } from '@jest/globals';

jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn(),
  getItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

jest.mock('@react-native-async-storage/async-storage', () => (
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
));

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
jest.mock('react-native-maps', () => {
  const React = require('react');
  const { View } = require('react-native');
  const MockMapView = (props: any) => React.createElement(View, { testID: 'mock-map-view' }, props.children);
  const MockMarker = (props: any) => React.createElement(View, { testID: 'mock-map-marker' }, props.children);
  const MockPolyline = (props: any) => React.createElement(View, { testID: 'mock-map-polyline' }, props.children);

  return {
    __esModule: true,
    default: MockMapView,
    Marker: MockMarker,
    Polyline: MockPolyline,
  };
});
