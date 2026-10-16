import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import * as Location from 'expo-location';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { useI18n } from '../i18n/I18nProvider';
import { palette } from '../theme/palette';
import type { Delivery } from '../types/api';

type Coordinates = {
  latitude: number;
  longitude: number;
};

type RouteSummary = {
  coordinates: Coordinates[];
  distanceKm: number;
  durationMinutes: number;
  refreshedAt: string;
};

function pair(latitude: number | null, longitude: number | null): Coordinates | null {
  return typeof latitude === 'number' && typeof longitude === 'number' ? { latitude, longitude } : null;
}

function haversineDistanceKm(start: Coordinates, end: Coordinates) {
  const earthRadiusKm = 6371;
  const toRadians = (value: number) => value * (Math.PI / 180);
  const deltaLatitude = toRadians(end.latitude - start.latitude);
  const deltaLongitude = toRadians(end.longitude - start.longitude);
  const a = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(toRadians(start.latitude)) * Math.cos(toRadians(end.latitude)) * Math.sin(deltaLongitude / 2) ** 2;

  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function fetchDrivingRoute(origin: Coordinates, destination: Coordinates): Promise<RouteSummary | null> {
  const url = [
    'https://router.project-osrm.org/route/v1/driving/',
    `${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}`,
    '?overview=full&geometries=geojson',
  ].join('');

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error('route unavailable');
  }

  const payload = await response.json() as {
    routes?: Array<{ distance: number; duration: number; geometry?: { coordinates?: number[][] } }>;
  };
  const firstRoute = payload.routes?.[0];

  if (!firstRoute) {
    return null;
  }

  return {
    coordinates: (firstRoute.geometry?.coordinates ?? [])
      .filter((point) => point.length >= 2)
      .map((point) => ({ latitude: point[1], longitude: point[0] })),
    distanceKm: firstRoute.distance / 1000,
    durationMinutes: Math.max(1, Math.round(firstRoute.duration / 60)),
    refreshedAt: new Date().toISOString(),
  };
}

async function geocode(address: string): Promise<Coordinates | null> {
  try {
    const result = await Location.geocodeAsync(address);
    return result.length > 0 ? { latitude: result[0].latitude, longitude: result[0].longitude } : null;
  } catch {
    return null;
  }
}

interface DeliveryMapCardProps {
  delivery: Delivery;
  currentLocation: Coordinates | null;
}

/** Map with pickup/destination pins (contract coordinates, geocoding fallback) and a live ETA. */
export function DeliveryMapCard({ delivery, currentLocation }: DeliveryMapCardProps) {
  const { strings } = useI18n();
  const contractPickup = pair(delivery.pickupLatitude, delivery.pickupLongitude);
  const contractDestination = pair(delivery.deliveryLatitude, delivery.deliveryLongitude);
  const [pickupCoordinates, setPickupCoordinates] = useState<Coordinates | null>(contractPickup);
  const [destinationCoordinates, setDestinationCoordinates] = useState<Coordinates | null>(contractDestination);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [routeSummary, setRouteSummary] = useState<RouteSummary | null>(null);
  const [isRouting, setIsRouting] = useState(false);
  const [routingError, setRoutingError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    setPickupCoordinates(contractPickup);
    setDestinationCoordinates(contractDestination);

    if (contractPickup && contractDestination) {
      return () => {
        isMounted = false;
      };
    }

    const run = async () => {
      setIsGeocoding(true);
      const [pickup, destination] = await Promise.all([
        contractPickup ? Promise.resolve(contractPickup) : geocode(delivery.pickupAddress),
        contractDestination ? Promise.resolve(contractDestination) : geocode(delivery.deliveryAddress),
      ]);

      if (isMounted) {
        setPickupCoordinates(pickup);
        setDestinationCoordinates(destination);
        setIsGeocoding(false);
      }
    };

    void run();

    return () => {
      isMounted = false;
    };
  }, [
    delivery.pickupAddress,
    delivery.deliveryAddress,
    delivery.pickupLatitude,
    delivery.pickupLongitude,
    delivery.deliveryLatitude,
    delivery.deliveryLongitude,
  ]);

  // Before pickup the next stop is the restaurant, afterwards the customer.
  const activeTarget = delivery.status === 'ASSIGNED' ? pickupCoordinates : destinationCoordinates;

  useEffect(() => {
    let isMounted = true;

    if (!currentLocation || !activeTarget) {
      setRouteSummary(null);
      setRoutingError(null);
      return () => {
        isMounted = false;
      };
    }

    const syncRoute = async () => {
      setIsRouting(true);

      try {
        const nextRoute = await fetchDrivingRoute(currentLocation, activeTarget);

        if (isMounted) {
          setRouteSummary(nextRoute);
          setRoutingError(null);
        }
      } catch {
        if (isMounted) {
          setRoutingError(strings.detail.routingFallbackError);
          setRouteSummary(null);
        }
      } finally {
        if (isMounted) {
          setIsRouting(false);
        }
      }
    };

    void syncRoute();
    const interval = setInterval(() => {
      void syncRoute();
    }, 30000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [currentLocation, activeTarget]);

  const mapRegion = useMemo(() => {
    const points = [currentLocation, pickupCoordinates, destinationCoordinates, ...(routeSummary?.coordinates ?? [])]
      .filter((point): point is Coordinates => Boolean(point));

    if (points.length === 0) {
      return null;
    }

    const latitudes = points.map((point) => point.latitude);
    const longitudes = points.map((point) => point.longitude);
    const minLatitude = Math.min(...latitudes);
    const maxLatitude = Math.max(...latitudes);
    const minLongitude = Math.min(...longitudes);
    const maxLongitude = Math.max(...longitudes);

    return {
      latitude: (minLatitude + maxLatitude) / 2,
      longitude: (minLongitude + maxLongitude) / 2,
      latitudeDelta: Math.max(0.01, (maxLatitude - minLatitude) * 1.8),
      longitudeDelta: Math.max(0.01, (maxLongitude - minLongitude) * 1.8),
    };
  }, [currentLocation, pickupCoordinates, destinationCoordinates, routeSummary]);

  const distanceToTargetKm = routeSummary
    ? routeSummary.distanceKm
    : currentLocation && activeTarget ? haversineDistanceKm(currentLocation, activeTarget) : null;
  const estimatedEtaMinutes = routeSummary
    ? routeSummary.durationMinutes
    : distanceToTargetKm === null ? null : Math.max(1, Math.round((distanceToTargetKm / 35) * 60));

  return (
    <View style={styles.mapCard}>
      <Text style={styles.mapTitle}>{strings.detail.mapTitle}</Text>
      {isGeocoding ? <Text style={styles.mapHint}>{strings.detail.geocoding}</Text> : null}
      {!mapRegion ? <Text style={styles.mapHint}>{strings.detail.noMapCoordinates}</Text> : null}

      {mapRegion ? (
        <MapView style={styles.mapView} initialRegion={mapRegion} region={mapRegion}>
          {currentLocation ? (
            <Marker
              coordinate={currentLocation}
              title={strings.detail.markerDriverTitle}
              description={strings.detail.markerDriverDescription}
              pinColor="#2563EB"
            />
          ) : null}
          {pickupCoordinates ? (
            <Marker
              coordinate={pickupCoordinates}
              title={strings.detail.markerPickupTitle}
              description={delivery.pickupAddress}
              pinColor="#D97706"
            />
          ) : null}
          {destinationCoordinates ? (
            <Marker
              coordinate={destinationCoordinates}
              title={strings.detail.markerDestinationTitle}
              description={delivery.deliveryAddress}
              pinColor="#059669"
            />
          ) : null}
          {routeSummary && routeSummary.coordinates.length > 1 ? (
            <Polyline coordinates={routeSummary.coordinates} strokeColor="#7C3AED" strokeWidth={4} />
          ) : pickupCoordinates && destinationCoordinates ? (
            <Polyline coordinates={[pickupCoordinates, destinationCoordinates]} strokeColor="#111827" strokeWidth={3} />
          ) : null}
        </MapView>
      ) : null}

      {isRouting ? <Text style={styles.mapHint}>{strings.detail.routingLoading}</Text> : null}
      {routingError ? <Text style={styles.errorText}>{routingError}</Text> : null}

      {distanceToTargetKm !== null ? (
        <Text style={styles.mapMetric}>
          {strings.detail.distanceLabel(Boolean(routeSummary), distanceToTargetKm, estimatedEtaMinutes)}
        </Text>
      ) : (
        <Text style={styles.mapHint}>{strings.detail.etaUnavailable}</Text>
      )}

      {routeSummary?.refreshedAt ? (
        <Text style={styles.mapHint}>{strings.detail.lastEtaRefresh(new Date(routeSummary.refreshedAt).toLocaleTimeString())}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  mapCard: {
    borderRadius: 22,
    backgroundColor: palette.card,
    padding: 14,
    gap: 10,
  },
  mapTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: palette.textStrong,
  },
  mapHint: {
    color: palette.textMuted,
    fontSize: 12,
    lineHeight: 18,
  },
  mapMetric: {
    color: palette.textSubtle,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  mapView: {
    width: '100%',
    height: 220,
    borderRadius: 14,
  },
  errorText: {
    color: palette.dangerText,
    fontSize: 13,
    lineHeight: 18,
  },
});
