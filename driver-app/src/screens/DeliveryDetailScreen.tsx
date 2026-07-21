import { useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Location from 'expo-location';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { LocaleSwitcher } from '../components/LocaleSwitcher';
import { useI18n } from '../i18n/I18nProvider';
import type { DriverDeliveryDto, PendingAction } from '../types/api';
import { palette, statusBadgeColors } from '../theme/palette';

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

interface DeliveryDetailScreenProps {
  delivery: DriverDeliveryDto;
  currentLocation: Coordinates | null;
  pendingActionCount: number;
  blockedAction: PendingAction | null;
  failureDraft: string;
  bannerMessage: string | null;
  errorMessage: string | null;
  isSaving: boolean;
  onBack: () => void;
  onRefreshServerState: () => void;
  onRetryBlockedAction: () => void;
  onDiscardBlockedAction: () => void;
  onFailureDraftChange: (value: string) => void;
  onPickup: () => void;
  onStart: () => void;
  onComplete: () => void;
  onFail: () => void;
}

const LAT_LNG_PATTERN = /(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/;

function parseCoordinatesFromAddress(address: string): Coordinates | null {
  const match = LAT_LNG_PATTERN.exec(address);

  if (!match) {
    return null;
  }

  const latitude = Number(match[1]);
  const longitude = Number(match[2]);

  if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
    return null;
  }

  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return null;
  }

  return { latitude, longitude };
}

function haversineDistanceKm(start: Coordinates, end: Coordinates) {
  const earthRadiusKm = 6371;
  const toRadians = (value: number) => value * (Math.PI / 180);
  const deltaLatitude = toRadians(end.latitude - start.latitude);
  const deltaLongitude = toRadians(end.longitude - start.longitude);

  const a =
    Math.sin(deltaLatitude / 2) * Math.sin(deltaLatitude / 2)
    + Math.cos(toRadians(start.latitude))
    * Math.cos(toRadians(end.latitude))
    * Math.sin(deltaLongitude / 2)
    * Math.sin(deltaLongitude / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

function buildExternalDirectionsUrl(origin: Coordinates | null, destination: Coordinates) {
  const destinationQuery = `${destination.latitude},${destination.longitude}`;

  if (!origin) {
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destinationQuery)}&travelmode=driving`;
  }

  const originQuery = `${origin.latitude},${origin.longitude}`;
  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(originQuery)}&destination=${encodeURIComponent(destinationQuery)}&travelmode=driving`;
}

async function fetchDrivingRoute(origin: Coordinates, destination: Coordinates): Promise<RouteSummary | null> {
  const url = [
    'https://router.project-osrm.org/route/v1/driving/',
    `${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}`,
    '?overview=full&geometries=geojson',
  ].join('');

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error('Impossible de recuperer un itineraire live.');
  }

  const payload = await response.json() as {
    routes?: Array<{
      distance: number;
      duration: number;
      geometry?: {
        coordinates?: number[][];
      };
    }>;
  };

  const firstRoute = payload.routes?.[0];

  if (!firstRoute) {
    return null;
  }

  const coordinates = (firstRoute.geometry?.coordinates ?? [])
    .filter((point) => point.length >= 2)
    .map((point) => ({ latitude: point[1], longitude: point[0] }));

  return {
    coordinates,
    distanceKm: firstRoute.distance / 1000,
    durationMinutes: Math.max(1, Math.round(firstRoute.duration / 60)),
    refreshedAt: new Date().toISOString(),
  };
}

export function DeliveryDetailScreen({
  delivery,
  currentLocation,
  pendingActionCount,
  blockedAction,
  failureDraft,
  bannerMessage,
  errorMessage,
  isSaving,
  onBack,
  onRefreshServerState,
  onRetryBlockedAction,
  onDiscardBlockedAction,
  onFailureDraftChange,
  onPickup,
  onStart,
  onComplete,
  onFail,
}: DeliveryDetailScreenProps) {
  const { strings } = useI18n();
  const quickFailureReasons = strings.detail.quickFailureReasons;
  const trimmedFailureDraft = failureDraft.trim();
  const isFailureDraftInvalid = !trimmedFailureDraft || trimmedFailureDraft.length > 180;
  const isBlockedByConflict = blockedAction?.state === 'conflicted';
  const isBlockedByFailure = blockedAction?.state === 'failed';
  const [pickupCoordinates, setPickupCoordinates] = useState<Coordinates | null>(parseCoordinatesFromAddress(delivery.pickupAddress));
  const [destinationCoordinates, setDestinationCoordinates] = useState<Coordinates | null>(parseCoordinatesFromAddress(delivery.deliveryAddress));
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [routeSummary, setRouteSummary] = useState<RouteSummary | null>(null);
  const [isRouting, setIsRouting] = useState(false);
  const [routingError, setRoutingError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const geocodeAddresses = async () => {
      const parsedPickup = parseCoordinatesFromAddress(delivery.pickupAddress);
      const parsedDestination = parseCoordinatesFromAddress(delivery.deliveryAddress);

      if (isMounted) {
        setPickupCoordinates(parsedPickup);
        setDestinationCoordinates(parsedDestination);
      }

      if (parsedPickup && parsedDestination) {
        return;
      }

      setIsGeocoding(true);

      try {
        if (!parsedPickup) {
          const pickupResult = await Location.geocodeAsync(delivery.pickupAddress);

          if (isMounted && pickupResult.length > 0) {
            setPickupCoordinates({
              latitude: pickupResult[0].latitude,
              longitude: pickupResult[0].longitude,
            });
          }
        }

        if (!parsedDestination) {
          const destinationResult = await Location.geocodeAsync(delivery.deliveryAddress);

          if (isMounted && destinationResult.length > 0) {
            setDestinationCoordinates({
              latitude: destinationResult[0].latitude,
              longitude: destinationResult[0].longitude,
            });
          }
        }
      } finally {
        if (isMounted) {
          setIsGeocoding(false);
        }
      }
    };

    void geocodeAddresses();

    return () => {
      isMounted = false;
    };
  }, [delivery.pickupAddress, delivery.deliveryAddress]);

  const activeTarget = useMemo(() => {
    if (delivery.status === 'ASSIGNED' || delivery.status === 'PICKED_UP') {
      return pickupCoordinates;
    }

    return destinationCoordinates;
  }, [delivery.status, pickupCoordinates, destinationCoordinates]);

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
    const points = [
      currentLocation,
      pickupCoordinates,
      destinationCoordinates,
      ...(routeSummary?.coordinates ?? []),
    ].filter((point): point is Coordinates => Boolean(point));

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

  const distanceToTargetKm = useMemo(() => {
    if (routeSummary) {
      return routeSummary.distanceKm;
    }

    if (!currentLocation || !activeTarget) {
      return null;
    }

    return haversineDistanceKm(currentLocation, activeTarget);
  }, [currentLocation, activeTarget, routeSummary]);

  const estimatedEtaMinutes = useMemo(() => {
    if (routeSummary) {
      return routeSummary.durationMinutes;
    }

    if (distanceToTargetKm === null) {
      return null;
    }

    const assumedCitySpeedKmh = 35;
    return Math.max(1, Math.round((distanceToTargetKm / assumedCitySpeedKmh) * 60));
  }, [distanceToTargetKm, routeSummary]);

  const openDirections = async (target: Coordinates | null) => {
    if (!target) {
      return;
    }

    const url = buildExternalDirectionsUrl(currentLocation, target);
    await Linking.openURL(url);
  };

  return (
    <ScrollView contentContainerStyle={styles.contentContainer}>
      <LocaleSwitcher />
      <Pressable accessibilityRole="button" style={styles.backButton} onPress={onBack}>
        <Text style={styles.backButtonText}>{strings.detail.back}</Text>
      </Pressable>

      <View style={styles.detailCard}>
        <Text style={styles.eyebrow}>{strings.detail.title}</Text>
        <View style={styles.headerRow}>
          <Text style={styles.title}>{strings.detail.deliveryTitle(delivery.id)}</Text>
          <Text style={[styles.statusBadge, statusBadgeColors[delivery.status]]}>{delivery.status}</Text>
        </View>

        <Text style={styles.metaLine}>{strings.detail.pickup(delivery.pickupAddress)}</Text>
        <Text style={styles.metaLine}>{strings.detail.destination(delivery.deliveryAddress)}</Text>
        {delivery.restaurant?.name ? <Text style={styles.metaLine}>{strings.detail.restaurant(delivery.restaurant.name)}</Text> : null}
        {delivery.restaurant?.address ? <Text style={styles.metaLine}>{strings.detail.restaurantAddress(delivery.restaurant.address)}</Text> : null}
        {delivery.customer?.email ? <Text style={styles.metaLine}>{strings.detail.customer(delivery.customer.email)}</Text> : null}
        {delivery.description ? <Text style={styles.metaLine}>{strings.detail.notes(delivery.description)}</Text> : null}
        <Text style={styles.metaLine}>{strings.detail.createdAt(delivery.createdAt)}</Text>
        {delivery.updatedAt ? <Text style={styles.metaLine}>{strings.detail.updatedAt(delivery.updatedAt)}</Text> : null}
        {pendingActionCount ? <Text style={styles.pendingText}>{strings.detail.pendingActions(pendingActionCount)}</Text> : null}
      </View>

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
            {pickupCoordinates && destinationCoordinates ? (
              <Polyline
                coordinates={[pickupCoordinates, destinationCoordinates]}
                strokeColor="#111827"
                strokeWidth={3}
              />
            ) : null}
            {currentLocation && pickupCoordinates ? (
              <Polyline
                coordinates={[currentLocation, pickupCoordinates]}
                strokeColor="#2563EB"
                strokeWidth={2}
              />
            ) : null}
            {routeSummary && routeSummary.coordinates.length > 1 ? (
              <Polyline
                coordinates={routeSummary.coordinates}
                strokeColor="#7C3AED"
                strokeWidth={4}
              />
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

        <View style={styles.mapActions}>
          <Pressable
            style={[styles.ghostButton, !pickupCoordinates && styles.buttonDisabled]}
            disabled={!pickupCoordinates}
            onPress={() => void openDirections(pickupCoordinates)}
          >
            <Text style={styles.ghostButtonText}>{strings.detail.routeToPickup}</Text>
          </Pressable>
          <Pressable
            style={[styles.ghostButton, !destinationCoordinates && styles.buttonDisabled]}
            disabled={!destinationCoordinates}
            onPress={() => void openDirections(destinationCoordinates)}
          >
            <Text style={styles.ghostButtonText}>{strings.detail.routeToDestination}</Text>
          </Pressable>
        </View>
      </View>

      {bannerMessage ? <Text style={styles.successText}>{bannerMessage}</Text> : null}
      {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}

      {blockedAction ? (
        <View style={[styles.recoveryPanel, isBlockedByConflict ? styles.recoveryConflict : styles.recoveryFailure]}>
          <Text style={styles.recoveryPanelTitle}>
            {isBlockedByConflict ? strings.detail.recoveryConflictTitle : strings.detail.recoveryFailedTitle}
          </Text>
          <Text style={styles.recoveryPanelText}>
            {isBlockedByConflict
              ? strings.detail.recoveryConflictText
              : strings.detail.recoveryFailedText}
          </Text>
          {blockedAction.lastError ? <Text style={styles.recoveryError}>{strings.detail.recoveryLastError(blockedAction.lastError)}</Text> : null}

          <View style={styles.recoveryActions}>
            <Pressable style={styles.ghostButton} onPress={onRefreshServerState}>
              <Text style={styles.ghostButtonText}>{strings.detail.refreshServerState}</Text>
            </Pressable>
            {isBlockedByFailure ? (
              <Pressable style={styles.secondaryButton} onPress={onRetryBlockedAction}>
                <Text style={styles.secondaryButtonText}>{strings.detail.rescheduleAction}</Text>
              </Pressable>
            ) : null}
            <Pressable style={styles.secondaryButton} onPress={onDiscardBlockedAction}>
              <Text style={styles.secondaryButtonText}>{strings.detail.removeLocalAction}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <View style={styles.actionGroup}>
        {delivery.status === 'ASSIGNED' ? (
          <Pressable style={[styles.primaryButton, isSaving && styles.buttonDisabled]} disabled={isSaving} onPress={onPickup}>
            <Text style={styles.primaryButtonText}>{strings.detail.markPickedUp}</Text>
          </Pressable>
        ) : null}

        {delivery.status === 'PICKED_UP' ? (
          <Pressable style={[styles.primaryButton, isSaving && styles.buttonDisabled]} disabled={isSaving} onPress={onStart}>
            <Text style={styles.primaryButtonText}>{strings.detail.startDelivery}</Text>
          </Pressable>
        ) : null}

        {delivery.status === 'IN_TRANSIT' ? (
          <Pressable style={[styles.primaryButton, isSaving && styles.buttonDisabled]} disabled={isSaving} onPress={onComplete}>
            <Text style={styles.primaryButtonText}>{strings.detail.markDelivered}</Text>
          </Pressable>
        ) : null}
      </View>

      {(delivery.status === 'ASSIGNED' || delivery.status === 'PICKED_UP' || delivery.status === 'IN_TRANSIT') ? (
        <View style={styles.failurePanel}>
          <Text style={styles.failureLabel}>{strings.detail.failureReason}</Text>
          <View style={styles.quickReasonRow}>
            {quickFailureReasons.map((reason) => (
              <Pressable
                key={reason}
                accessibilityRole="button"
                style={styles.quickReasonChip}
                onPress={() => onFailureDraftChange(reason)}
              >
                <Text style={styles.quickReasonChipText}>{reason}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            multiline
            placeholder={strings.detail.failurePlaceholder}
            placeholderTextColor="#64748b"
            style={styles.textArea}
            value={failureDraft}
            onChangeText={onFailureDraftChange}
          />
          <Text style={[styles.counterText, trimmedFailureDraft.length > 180 && styles.counterTextError]}>
            {strings.detail.failureCounter(trimmedFailureDraft.length)}
          </Text>
          <Pressable
            testID="fail-delivery-button"
            style={[styles.secondaryButton, (isSaving || isFailureDraftInvalid) && styles.buttonDisabled]}
            disabled={isSaving || isFailureDraftInvalid}
            onPress={onFail}
          >
            <Text style={styles.secondaryButtonText}>{strings.detail.submitFailure}</Text>
          </Pressable>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  contentContainer: {
    padding: 20,
    gap: 16,
    backgroundColor: palette.appBackground,
  },
  backButton: {
    alignSelf: 'flex-start',
  },
  backButtonText: {
    color: palette.primary,
    fontWeight: '700',
    fontSize: 14,
  },
  detailCard: {
    borderRadius: 24,
    backgroundColor: palette.card,
    padding: 20,
    gap: 10,
  },
  eyebrow: {
    fontSize: 12,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: palette.textMuted,
    fontWeight: '700',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: palette.textStrong,
    flex: 1,
  },
  statusBadge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    fontSize: 12,
    fontWeight: '700',
    overflow: 'hidden',
  },
  metaLine: {
    fontSize: 14,
    color: palette.textSubtle,
    lineHeight: 20,
  },
  pendingText: {
    fontSize: 13,
    color: palette.warningText,
    fontWeight: '600',
  },
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
  mapActions: {
    gap: 8,
  },
  successText: {
    color: palette.successText,
    fontSize: 14,
    lineHeight: 20,
  },
  errorText: {
    color: palette.dangerText,
    fontSize: 14,
    lineHeight: 20,
  },
  actionGroup: {
    gap: 10,
  },
  primaryButton: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    backgroundColor: palette.primary,
    paddingVertical: 14,
    paddingHorizontal: 18,
  },
  primaryButtonText: {
    color: palette.primaryText,
    fontWeight: '700',
    fontSize: 15,
  },
  secondaryButton: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    backgroundColor: palette.secondary,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  secondaryButtonText: {
    color: palette.secondaryText,
    fontWeight: '700',
    fontSize: 14,
  },
  ghostButton: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: palette.borderSoft,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  ghostButtonText: {
    color: palette.textSubtle,
    fontWeight: '600',
    fontSize: 14,
  },
  textArea: {
    minHeight: 88,
    textAlignVertical: 'top',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: palette.borderSoft,
    backgroundColor: palette.card,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: palette.textStrong,
  },
  quickReasonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  quickReasonChip: {
    borderRadius: 999,
    backgroundColor: palette.secondary,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  quickReasonChipText: {
    color: palette.secondaryText,
    fontSize: 13,
    fontWeight: '600',
  },
  counterText: {
    color: palette.textMuted,
    fontSize: 12,
    textAlign: 'right',
  },
  counterTextError: {
    color: palette.dangerText,
    fontWeight: '700',
  },
  failurePanel: {
    gap: 10,
    borderRadius: 22,
    backgroundColor: palette.card,
    padding: 18,
  },
  recoveryPanel: {
    borderRadius: 22,
    padding: 18,
    gap: 10,
  },
  recoveryConflict: {
    backgroundColor: palette.dangerBg,
  },
  recoveryFailure: {
    backgroundColor: palette.warningBg,
  },
  recoveryPanelTitle: {
    color: palette.dangerText,
    fontSize: 15,
    fontWeight: '700',
  },
  recoveryPanelText: {
    color: palette.textSubtle,
    fontSize: 13,
    lineHeight: 20,
  },
  recoveryError: {
    color: palette.dangerText,
    fontSize: 12,
    lineHeight: 18,
  },
  recoveryActions: {
    gap: 10,
  },
  failureLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: palette.textStrong,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});