import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, SafeAreaView, StyleSheet, Text } from 'react-native';
import { I18nProvider, useI18n } from './src/i18n/I18nProvider';
import { useDriverApp } from './src/app/useDriverApp';
import { DeliveryDetailScreen } from './src/screens/DeliveryDetailScreen';
import { DeliveryListScreen } from './src/screens/DeliveryListScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { palette } from './src/theme/palette';

export function App() {
  return (
    <I18nProvider>
      <AppContent />
    </I18nProvider>
  );
}

function AppContent() {
  const { strings } = useI18n();
  const app = useDriverApp();

  if (app.isRestoring) {
    return (
      <SafeAreaView style={styles.centeredScreen}>
        <ActivityIndicator size="large" color={palette.primary} />
        <Text style={styles.helperText}>{strings.app.restoringSession}</Text>
        <StatusBar style="dark" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />
      {!app.session ? (
        <LoginScreen
          email={app.email}
          password={app.password}
          errorMessage={app.errorMessage}
          isSubmitting={app.isSubmitting}
          onEmailChange={app.setEmail}
          onPasswordChange={app.setPassword}
          onSubmit={() => void app.handleLogin()}
        />
      ) : app.screen === 'detail' && app.selectedDelivery ? (
        <DeliveryDetailScreen
          delivery={app.selectedDelivery}
          currentLocation={app.currentLocation}
          pendingActionCount={app.pendingActionCountByDelivery[app.selectedDelivery.id] ?? 0}
          blockedAction={app.blockedActionByDelivery[app.selectedDelivery.id] ?? null}
          failureDraft={app.failureDrafts[app.selectedDelivery.id] ?? ''}
          bannerMessage={app.bannerMessage}
          errorMessage={app.errorMessage}
          isSaving={app.savingDeliveryId === app.selectedDelivery.id}
          onBack={app.closeDelivery}
          onRefreshServerState={() => void app.refreshDeliveries()}
          onRetryBlockedAction={() => void app.retryBlockedAction(app.blockedActionByDelivery[app.selectedDelivery!.id]?.actionId ?? '')}
          onDiscardBlockedAction={() => void app.discardBlockedAction(app.blockedActionByDelivery[app.selectedDelivery!.id]?.actionId ?? '')}
          onFailureDraftChange={(value) => app.setFailureDraft(app.selectedDelivery!.id, value)}
          onPickup={() => void app.actionHandlers.pickup(app.selectedDelivery!.id)}
          onStart={() => void app.actionHandlers.start(app.selectedDelivery!.id)}
          onComplete={() => void app.actionHandlers.complete(app.selectedDelivery!.id)}
          onFail={() => void app.handleFailDelivery(app.selectedDelivery!.id)}
        />
      ) : (
        <DeliveryListScreen
          session={app.session}
          deliveries={app.deliveries}
          pendingActionCountByDelivery={app.pendingActionCountByDelivery}
          blockedActionByDelivery={app.blockedActionByDelivery}
          blockedActionCount={app.blockedActions.length}
          lastSuccessfulSync={app.lastSuccessfulSync}
          bannerMessage={app.bannerMessage}
          errorMessage={app.errorMessage}
          isRefreshing={app.isRefreshing}
          onRefresh={() => void app.refreshDeliveries()}
          onRetryQueuedActions={() => void app.retryQueuedActions()}
          onDiscardBlockedActions={() => void app.discardBlockedQueuedActions()}
          onLogout={() => void app.handleLogout()}
          onOpenDelivery={app.openDelivery}
        />
      )}
    </SafeAreaView>
  );
}

export default App;

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: palette.appBackground,
  },
  centeredScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.appBackground,
    gap: 12,
  },
  helperText: {
    color: palette.textSubtle,
    fontSize: 15,
  },
});
