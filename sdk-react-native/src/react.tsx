// React Native bindings: <RecapProvider>, screen tracking hooks, scroll helper and press labels.

import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode, type RefObject } from 'react';
import {
  AppState,
  Dimensions,
  Keyboard,
  Modal,
  PixelRatio,
  Platform,
  View,
  type GestureResponderEvent,
  type ModalProps,
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
  /**
   * For screen pictures behind heatmaps: pass `captureRef` from react-native-view-shot and set
   * `screenshots` in the config. `import { captureRef } from 'react-native-view-shot'`
   */
  captureRef?: CaptureRefLike;
}

/** The shape of react-native-view-shot's captureRef, so we don't depend on the library. */
export type CaptureRefLike = (
  view: unknown,
  options: { format: 'jpg'; quality: number; width: number; height: number; result: 'base64' },
) => Promise<string>;

const TAP_MAX_MOVE = 12; // points
const TAP_MAX_MS = 600;

type TouchLike = { pageX?: number; pageY?: number };

/** Position of a touch. On touchend some platforms (e.g. web) only fill in changedTouches. */
function point(ne: GestureResponderEvent['nativeEvent']): { x: number; y: number } | null {
  const candidates: (TouchLike | undefined)[] = [
    ne as TouchLike,
    (ne.changedTouches as TouchLike[] | undefined)?.[0],
    (ne.touches as TouchLike[] | undefined)?.[0],
  ];
  for (const c of candidates) {
    if (c && Number.isFinite(c.pageX) && Number.isFinite(c.pageY)) return { x: c.pageX!, y: c.pageY! };
  }
  return null;
}

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
/**
 * Touch handlers that record taps. Touch events bubble to the View that has them without it taking the
 * responder, so app gestures are untouched.
 */
function useTapRecorder() {
  const touch = useRef<{ x: number; y: number; at: number } | null>(null);
  const onTouchStart = useCallback((e: GestureResponderEvent) => {
    const ne = e.nativeEvent;
    if ((ne.touches?.length ?? 1) > 1) {
      touch.current = null;
      return;
    }
    const p = point(ne);
    touch.current = p ? { ...p, at: Date.now() } : null;
  }, []);

  const onTouchEnd = useCallback((e: GestureResponderEvent) => {
    const start = touch.current;
    touch.current = null;
    const end = point(e.nativeEvent);
    if (!start || !end) return;
    const moved = Math.hypot(end.x - start.x, end.y - start.y);
    if (moved <= TAP_MAX_MOVE && Date.now() - start.at <= TAP_MAX_MS) {
      recap.tap(end);
    }
  }, []);

  const onTouchCancel = useCallback(() => {
    touch.current = null;
  }, []);

  return { onTouchStart, onTouchEnd, onTouchCancel };
}

const openModals: RefObject<View | null>[] = [];

/**
 * A drop-in replacement for React Native's <Modal> that shows up in session replays. A plain <Modal>
 * (dropdowns, bottom sheets, dialogs) draws in its own window, which the recorder can't see.
 * `import { RecapModal as Modal } from '@recap-ux/react-native'` is usually all it takes.
 */
export function RecapModal({ children, visible = true, ...props }: ModalProps) {
  const ref = useRef<View>(null);
  // Touches inside a modal never reach the provider's root view, so record them here.
  const taps = useTapRecorder();
  useEffect(() => {
    if (!visible) return;
    openModals.push(ref);
    return () => {
      const i = openModals.indexOf(ref);
      if (i >= 0) openModals.splice(i, 1);
    };
  }, [visible]);
  return (
    <Modal visible={visible} {...props}>
      <View ref={ref} collapsable={false} style={{ flex: 1 }} {...taps}>
        {children}
      </View>
    </Modal>
  );
}

export function RecapProvider({ config, children, navigationRef, device, captureRef }: RecapProviderProps) {
  const root = useRef<View>(null);

  useEffect(() => {
    if (!captureRef || (!config.screenshots && !config.recordings)) return;
    recap.setScreenCapture(async (opts) => {
      // A React Native <Modal> draws in its own window, outside the app's root view, so replay frames
      // capture the newest open <RecapModal> instead. Heatmap screen pictures always use the screen.
      const modal = opts?.recording ? [...openModals].reverse().find((m) => m.current)?.current : null;
      const target = modal ?? root.current;
      if (!target) return null;
      // view-shot only shrinks the picture when it gets both a width and a height; with a width alone
      // it captures at full phone resolution, which is several times bigger and slower to take.
      // On iOS view-shot treats the size as points and renders at the screen's scale (3x on most
      // iPhones), so divide by the pixel ratio there to get the same pixel size as Android.
      const width = opts?.width ?? 360;
      const win = Dimensions.get('window');
      const height = Math.round(width * (win.width > 0 ? win.height / win.width : 2.16));
      const scale = Platform.OS === 'ios' ? Math.max(1, PixelRatio.get()) : 1;
      return captureRef(target, {
        format: 'jpg',
        quality: opts?.quality ?? 0.6,
        width: width / scale,
        height: height / scale,
        result: 'base64',
      });
    });
    return () => recap.setScreenCapture(null);
  }, [captureRef, config.screenshots, config.recordings]);

  // Recordings pause while the keyboard is open, so nothing being typed is ever captured.
  useEffect(() => {
    if (!config.recordings) return;
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () =>
      recap.setKeyboardOpen(true),
    );
    const hide = Keyboard.addListener('keyboardDidHide', () => recap.setKeyboardOpen(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, [config.recordings]);

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
    const unsubscribe = navigationRef.addListener('state', record);
    // The container mounts after this provider, so wait for it to be ready to catch the first screen.
    let tries = 0;
    const poll = setInterval(() => {
      if (navigationRef.isReady?.() !== false || ++tries > 100) {
        clearInterval(poll);
        record();
      }
    }, 50);
    return () => {
      clearInterval(poll);
      unsubscribe();
    };
  }, [navigationRef]);

  const taps = useTapRecorder();

  return (
    <RecapContext.Provider value={recap}>
      <View
        ref={root}
        style={{ flex: 1 }}
        {...taps}
        collapsable={false}
      >
        {children}
      </View>
    </RecapContext.Provider>
  );
}

/**
 * Recording pauses while this is on screen. Wrap anything that shows personal details:
 *   <RecapPrivate><CheckoutForm /></RecapPrivate>
 * It renders its children unchanged.
 */
export function RecapPrivate({ children }: { children?: ReactNode }) {
  useRecapPrivate();
  return <>{children}</>;
}

/** Hook form of <RecapPrivate>: recording pauses while the calling component is mounted. */
export function useRecapPrivate(active = true): void {
  useEffect(() => (active ? recap.holdPrivacy() : undefined), [active]);
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
