import AsyncStorage from '@react-native-async-storage/async-storage';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Platform, Pressable, ScrollView, Text, View, StyleSheet } from 'react-native';
import { RecapProvider, recap, recapPress, useRecapScroll } from '@recap-ux/react-native';
import { captureRef } from 'react-native-view-shot';

const navigationRef = createNavigationContainerRef();
const Stack = createNativeStackNavigator();
// The end-to-end test injects these; in your own app use env vars as shown in AGENTS.md.
const cfg = globalThis.__RECAP_E2E__ || {
  url: process.env.EXPO_PUBLIC_RECAP_SUPABASE_URL,
  anonKey: process.env.EXPO_PUBLIC_RECAP_SUPABASE_ANON_KEY,
};

function Button({ label, onPress, testID }) {
  return (
    <Pressable testID={testID} accessibilityRole="button" onPress={recapPress(label, onPress)} style={s.btn}>
      <Text style={s.btnText}>{label}</Text>
    </Pressable>
  );
}

function Home({ navigation }) {
  return (
    <View style={s.screen}>
      <Text style={s.h1}>Test Shop</Text>
      <Button testID="shop-now" label="Shop now" onPress={() => navigation.navigate('Product')} />
    </View>
  );
}

function Product({ navigation }) {
  const onScroll = useRecapScroll();
  return (
    <ScrollView testID="product-scroll" onScroll={onScroll} scrollEventThrottle={50} contentContainerStyle={{ padding: 24 }}>
      <Text style={s.h1}>Trail Shoe</Text>
      {Array.from({ length: 30 }, (_, i) => <Text key={i} style={s.p}>Feature line {i + 1}. Grippy, light and comfy.</Text>)}
      <Button testID="add" label="Add to basket" onPress={() => { recap.track('added_to_basket', { sku: 'TRAIL-1' }); navigation.navigate('Basket'); }} />
    </ScrollView>
  );
}

function Basket() {
  return (
    <View style={s.screen}>
      <Text style={s.h1}>Basket</Text>
      <Button testID="checkout" label="Checkout" onPress={() => {}} />
    </View>
  );
}

// Screen pictures come from react-native-view-shot on a real phone. In the browser build (used only by
// the automated end-to-end test) view-shot can't capture, so we send a tiny placeholder picture instead.
const TEST_PICTURE = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const capture = Platform.OS === 'web' ? async () => `data:image/png;base64,${TEST_PICTURE}` : captureRef;

export default function App() {
  return (
    <RecapProvider
      navigationRef={navigationRef}
      captureRef={capture}
      device={{ model: 'Playwright phone' }}
      config={{ appId: 'test-shop', supabase: { url: cfg.url, anonKey: cfg.anonKey }, storage: AsyncStorage, appVersion: '1.0.0', flushIntervalMs: 2000, debug: true, screenshots: true }}
    >
      <NavigationContainer ref={navigationRef}>
        <Stack.Navigator>
          <Stack.Screen name="Home" component={Home} />
          <Stack.Screen name="Product" component={Product} />
          <Stack.Screen name="Basket" component={Basket} />
        </Stack.Navigator>
      </NavigationContainer>
    </RecapProvider>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, padding: 24, gap: 16 },
  h1: { fontSize: 28, fontWeight: '700', marginBottom: 12 },
  p: { fontSize: 16, marginVertical: 6 },
  btn: { backgroundColor: '#0891b2', padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 16 },
  btnText: { color: '#fff', fontSize: 18, fontWeight: '600' },
});
