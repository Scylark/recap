// React Native bindings: <RecapProvider>, screen tracking hooks, scroll helper and press labels.

import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from 'react';
import {
  AppState,
  Dimensions,
  Platform,
  View,
  type GestureResponderEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { RecapCore } from './core';
import type { DeviceInfo, RecapConfig, RecapPlatform } from './types';

/** The shared Recap instance. You can also call it directly, e.g. recap.track('checkout_started'). */
export const recap = new RecapCore();

const RecapContext = createContext<RecapCore>(recap);

/** Minimal shape of a React Navigation container ref, so we don't depend on the library. */
export interface NavigationRefLike {
  getCurrentRoute(): { name: string } | undefined;
  addListener(event: 'state', cb: () => void): () => void;
  isReady?(): boolean;
}

export interface RecapProviderProps {
  config: RecapConfig;
  children?: ReactNode;
  /** Pass your React Navigation container ref to record screens automatically. */
  navigationRef?: NavigationRefLike;
  /** Extra device details, e.g. model and OS from expo-device. */
  device?: Partial<DeviceInfo>;
}

const TAP_MAX_MOVE = 12; // points
const TAP_MAX_MS = 600;

function detectDevice(extra: Partial<DeviceInfo>): Partial<DeviceInfo> {
  const { width, height } = Dimensions.get('window');
  const known: RecapPlatform[] = ['ios', 'android', 'web', 'windows', 'macos'];
  const platform = (known as string[]).includes(Platform.OS) ? (Platform.OS as RecapPlatform) : 'other';
  let locale: string | null = null;
  try {
    locale = Intl.DateTimeFormat().resolvedOptions().locale ?? null;
  } catch {
    locale = null;
  }
  return {
    platform,
    osVersion: String(Platform.Version ?? ''),
    screenWidth: Math.round(width),
    screenHeight: Math.round(height),
    locale,
    ...extra,
  };
}

/**
 * Wrap your app once, near the root. Records taps anywhere in the app, app foreground and
 * background, and screens if you pass a navigationRef.
 */
export function RecapProvider({ config, children, navigationRef, device }: RecapProviderProps) {
  const touch = useRef<{ x: number; y: number; at: number } | null>(null);

  useEffect(() => {
    void recap.init(config, detectDevice(device ?? {}));
    const sub = AppState.addEventListener('change', (s) => recap.appState(s));
    return () => {
      sub.remove();
      void recap.shutdown();
    };
    // Recap is configured once per app launch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!navigationRef) return;
    const record = () => {
      const route = navigationRef.getCurrentRoute();
      if (route?.name) recap.screen(route.name);
    };
    if (navigationRef.isReady?.() !== false) record();
    return navigationRef.addListener('state', record);
  }, [navigationRef]);

  // Touch events bubble to this root View without taking the responder, so app gestures are untouched.
  const onTouchStart = useCallback((e: GestureResponderEvent) => {
    if (e.nativeEvent.touches.length > 1) {
      touch.current = null;
      return;
    }
    touch.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY, at: Date.now() };
  }, []);

  const onTouchEnd = useCallback((e: GestureResponderEvent) => {
    const start = touch.current;
    touch.current = null;
    if (!start) return;
    const { pageX, pageY } = e.nativeEvent;
    const moved = Math.hypot(pageX - start.x, pageY - start.y);
    if (moved <= TAP_MAX_MOVE && Date.now() - start.at <= TAP_MAX_MS) {
      recap.tap({ x: pageX, y: pageY });
    }
  }, []);

  return (
    <RecapContext.Provider value={recap}>
      <View style={{ flex: 1 }} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} collapsable={false}>
        {children}
      </View>
    </RecapContext.Provider>
  );
}

export function useRecap(): RecapCore {
  return useContext(RecapContext);
}

/**
 * Record a screen view whenever `name` changes. Handy with Expo Router:
 *   const pathname = usePathname(); useRecapScreen(pathname);
 */
export function useRecapScreen(name: string | null | undefined, props?: Record<string, unknown>): void {
  useEffect(() => {
    if (name) recap.screen(name, props);
    // props are recorded with the first view of each screen only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);
}

/** Returns an onScroll handler for ScrollView, FlatList or SectionList that records scroll depth. */
export function useRecapScroll(onScroll?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void) {
  return useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
      if (contentSize.height > 0) {
        recap.scroll(((contentOffset.y + layoutMeasurement.height) / contentSize.height) * 100);
      }
      onScroll?.(e);
    },
    [onScroll],
  );
}

/**
 * Give a button a readable name in the dashboard:
 *   <Pressable onPress={recapPress('Add to basket', addToBasket)} />
 */
export function recapPress<A extends unknown[]>(label: string, handler?: (...args: A) => void) {
  return (...args: A) => {
    recap.labelTap(label);
    handler?.(...args);
  };
}
