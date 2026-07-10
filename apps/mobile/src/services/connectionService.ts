import { BehaviorSubject } from 'rxjs';
import NetInfo from '@react-native-community/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface ConnectionState {
  isConnected: boolean;
  isOnlineMode: boolean;
}

class ConnectionService {
  private stateSubject: BehaviorSubject<ConnectionState>;
  private isInitialized = false;

  constructor() {
    // Start with safe defaults before async fetch resolves
    this.stateSubject = new BehaviorSubject<ConnectionState>({
      isConnected: true,
      isOnlineMode: true,
    });
    this.init();
  }

  // Expose the observable
  public get state$() {
    return this.stateSubject.asObservable();
  }

  // Get current state value synchronously
  public get currentState(): ConnectionState {
    return this.stateSubject.value;
  }

  private async init() {
    if (this.isInitialized) return;

    try {
      // 1. Fetch initial network connection state
      const netState = await NetInfo.fetch();
      const isConnected = netState.isConnected ?? true;

      // 2. Get initial cached online/offline mode from AsyncStorage
      const cachedOnlineStr = await AsyncStorage.getItem('pijin.is_online');
      
      // If we don't have a cached value, default to true
      const initialOnlineMode = cachedOnlineStr !== 'false';

      // If device is offline, force onlineMode to false
      const finalOnlineMode = isConnected ? initialOnlineMode : false;

      this.stateSubject.next({
        isConnected,
        isOnlineMode: finalOnlineMode,
      });

      this.isInitialized = true;

      // 3. Subscribe to NetInfo network changes
      NetInfo.addEventListener((state) => {
        const current = this.stateSubject.value;
        const nextConnected = state.isConnected ?? true;

        let nextOnlineMode = current.isOnlineMode;

        if (!nextConnected) {
          // Force to offline mode when connection is lost
          nextOnlineMode = false;
        } else if (!current.isConnected && nextConnected) {
          // Connection restored:
          // Check what was stored in AsyncStorage. If user hadn't manually opted for offline mode,
          // restore to online mode automatically.
          AsyncStorage.getItem('pijin.is_online').then((val) => {
            const desiredOnline = val !== 'false';
            if (desiredOnline) {
              this.setOnlineState(true);
            }
          });
        }

        if (nextOnlineMode !== current.isOnlineMode) {
          AsyncStorage.setItem('pijin.is_online', nextOnlineMode ? 'true' : 'false');
        }

        this.stateSubject.next({
          isConnected: nextConnected,
          isOnlineMode: nextOnlineMode,
        });
      });
    } catch (err) {
      console.error('Failed to initialize ConnectionService:', err);
    }
  }

  // Set manual online/offline mode
  public async setOnlineState(online: boolean) {
    const current = this.stateSubject.value;
    if (!current.isConnected && online) {
      // Cannot enable online mode if device is physically disconnected
      return;
    }

    await AsyncStorage.setItem('pijin.is_online', online ? 'true' : 'false');
    this.stateSubject.next({
      ...current,
      isOnlineMode: online,
    });
  }
}

export const connectionService = new ConnectionService();
