import AsyncStorage from '@react-native-async-storage/async-storage';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createContext, useContext, useEffect, useState } from 'react';
import { BackHandler, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { RecapPrivate, RecapProvider, recap, recapPress, useRecapScroll } from '@recap-ux/react-native';
import { captureRef } from 'react-native-view-shot';

const navigationRef = createNavigationContainerRef();
const Stack = createNativeStackNavigator();
// The end-to-end test injects these; in your own app use env vars as shown in AGENTS.md.
const cfg = globalThis.__RECAP_E2E__ || {
  url: process.env.EXPO_PUBLIC_RECAP_SUPABASE_URL,
  anonKey: process.env.EXPO_PUBLIC_RECAP_SUPABASE_ANON_KEY,
};

// ---------- Shop data ----------

const PRODUCTS = [
  { id: 'TRAIL-1', name: 'Trail Shoe', price: 95, colour: '#0e7490', tag: 'Bestseller', blurb: 'Grippy, light and comfy on muddy paths.' },
  { id: 'ROAD-2', name: 'Road Racer', price: 120, colour: '#b45309', tag: 'New', blurb: 'Springy foam for fast road miles.' },
  { id: 'HIKE-3', name: 'Hike Boot', price: 140, colour: '#4d7c0f', tag: null, blurb: 'Waterproof and tough for long days out.' },
];
const SIZES = ['UK 6', 'UK 7', 'UK 8', 'UK 9', 'UK 10', 'UK 11'];
const COLOURS = ['Teal', 'Sand', 'Black'];
const DELIVERY = [
  { id: 'standard', label: 'Standard (3 to 5 days)', price: 0 },
  { id: 'next', label: 'Next day', price: 6 },
  { id: 'collect', label: 'Click and collect', price: 0 },
];
const CATEGORIES = ['All', 'Trail', 'Road', 'Hiking'];

const BasketContext = createContext(null);
const useBasket = () => useContext(BasketContext);
const money = (n) => `£${n.toFixed(2)}`;

// ---------- Small building blocks ----------

function Button({ label, onPress, testID, variant = 'primary', disabled }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={recapPress(label, onPress)}
      style={[s.btn, variant === 'secondary' && s.btnSecondary, disabled && s.btnDisabled]}
    >
      <Text style={[s.btnText, variant === 'secondary' && s.btnTextSecondary]}>{label}</Text>
    </Pressable>
  );
}

/**
 * Dropdown sheets are drawn inside the app's own view rather than in a React Native <Modal>.
 * A Modal opens a separate native window, which screen recordings can't see, so the replay
 * would show the page underneath instead of the open menu.
 */
const SheetContext = createContext(() => {});

function SheetHost({ children }) {
  const [sheet, setSheet] = useState(null);
  const close = () => setSheet(null);
  useEffect(() => {
    if (!sheet) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      close();
      return true;
    });
    return () => sub.remove();
  }, [sheet]);
  return (
    <SheetContext.Provider value={setSheet}>
      <View style={{ flex: 1 }}>
        {children}
        {sheet ? (
          <Pressable style={[StyleSheet.absoluteFill, s.backdrop]} onPress={recapPress(`Close ${sheet.label}`, close)}>
            <Pressable style={s.sheet} onPress={() => {}}>
              <Text style={s.sheetTitle}>{sheet.label}</Text>
              {sheet.options.map((o) => (
                <Pressable
                  key={o.value}
                  testID={`${sheet.testID}-${o.value}`}
                  onPress={recapPress(`${sheet.label}: ${o.label}`, () => {
                    sheet.onChange(o.value);
                    close();
                  })}
                  style={[s.option, o.value === sheet.value && s.optionOn]}
                >
                  <Text style={s.optionText}>{o.label}</Text>
                  {o.value === sheet.value && <Text style={s.tick}>✓</Text>}
                </Pressable>
              ))}
            </Pressable>
          </Pressable>
        ) : null}
      </View>
    </SheetContext.Provider>
  );
}

/** A tap-to-open dropdown. Each option is a labelled tap, so the dashboard shows which ones people pick. */
function Dropdown({ label, value, options, onChange, testID, placeholder = 'Choose…' }) {
  const openSheet = useContext(SheetContext);
  const current = options.find((o) => o.value === value);
  return (
    <View style={{ marginTop: 12 }}>
      <Text style={s.label}>{label}</Text>
      <Pressable
        testID={testID}
        onPress={recapPress(`Open ${label}`, () => openSheet({ label, value, options, onChange, testID }))}
        style={s.select}
      >
        <Text style={current ? s.selectText : s.placeholder}>{current ? current.label : placeholder}</Text>
        <Text style={s.chevron}>▾</Text>
      </Pressable>
    </View>
  );
}

function Field({ label, testID, error, ...props }) {
  return (
    <View style={{ marginTop: 12 }}>
      <Text style={s.label}>{label}</Text>
      {/* Recap never records what people type, only that they tapped into the field. */}
      <TextInput testID={testID} style={[s.input, error && s.inputError]} placeholderTextColor="#94a3b8" {...props} />
      {error ? <Text style={s.error}>{error}</Text> : null}
    </View>
  );
}

function Stepper({ value, onChange, name }) {
  return (
    <View style={s.stepper}>
      <Pressable style={s.stepBtn} onPress={recapPress(`${name}: fewer`, () => onChange(Math.max(1, value - 1)))}>
        <Text style={s.stepText}>−</Text>
      </Pressable>
      <Text style={s.stepValue}>{value}</Text>
      <Pressable style={s.stepBtn} onPress={recapPress(`${name}: more`, () => onChange(Math.min(9, value + 1)))}>
        <Text style={s.stepText}>+</Text>
      </Pressable>
    </View>
  );
}

function Chip({ label, on, onPress, testID }) {
  return (
    <Pressable testID={testID} onPress={recapPress(label, onPress)} style={[s.chip, on && s.chipOn]}>
      <Text style={[s.chipText, on && s.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

function ShoeImage({ colour, tall }) {
  return (
    <View style={[s.image, { backgroundColor: colour, height: tall ? 220 : 120 }]}>
      <Text style={s.imageEmoji}>👟</Text>
    </View>
  );
}

// ---------- Screens ----------

function Home({ navigation }) {
  const onScroll = useRecapScroll();
  const [category, setCategory] = useState('All');
  const [sort, setSort] = useState('popular');
  const shown = PRODUCTS.filter(
    (p) => category === 'All' || (category === 'Trail' && p.id.startsWith('TRAIL')) || (category === 'Road' && p.id.startsWith('ROAD')) || (category === 'Hiking' && p.id.startsWith('HIKE')),
  ).sort((a, b) => (sort === 'low' ? a.price - b.price : sort === 'high' ? b.price - a.price : 0));
  return (
    <ScrollView onScroll={onScroll} scrollEventThrottle={50} contentContainerStyle={s.screen}>
      <View style={s.hero}>
        <Text style={s.heroTitle}>Winter sale</Text>
        <Text style={s.heroText}>Up to 30% off trail shoes this week</Text>
        <Button testID="shop-now" label="Shop now" onPress={() => navigation.navigate('Product', { id: 'TRAIL-1' })} />
      </View>
      <View style={s.row}>
        {CATEGORIES.map((c) => (
          <Chip key={c} testID={`cat-${c}`} label={c} on={c === category} onPress={() => setCategory(c)} />
        ))}
      </View>
      <Dropdown
        label="Sort by"
        testID="sort"
        value={sort}
        onChange={setSort}
        options={[
          { value: 'popular', label: 'Most popular' },
          { value: 'low', label: 'Price: low to high' },
          { value: 'high', label: 'Price: high to low' },
        ]}
      />
      {shown.map((p) => (
        <Pressable
          key={p.id}
          testID={`card-${p.id}`}
          onPress={recapPress(`Product card: ${p.name}`, () => navigation.navigate('Product', { id: p.id }))}
          style={s.card}
        >
          <ShoeImage colour={p.colour} />
          <View style={s.cardBody}>
            <Text style={s.cardTitle}>{p.name}</Text>
            {p.tag && <Text style={s.badge}>{p.tag}</Text>}
            <Text style={s.price}>{money(p.price)}</Text>
          </View>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function Product({ navigation, route }) {
  const product = PRODUCTS.find((p) => p.id === route.params?.id) ?? PRODUCTS[0];
  const onScroll = useRecapScroll();
  const basket = useBasket();
  const [size, setSize] = useState(null);
  const [colour, setColour] = useState(COLOURS[0]);
  const [qty, setQty] = useState(1);
  const [showReviews, setShowReviews] = useState(false);
  const [error, setError] = useState(null);

  function add() {
    if (!size) {
      setError('Please choose a size first');
      recap.track('add_blocked', { reason: 'no_size', sku: product.id });
      return;
    }
    basket.add({ ...product, size, colour, qty });
    recap.track('added_to_basket', { sku: product.id, size, colour, qty, value: product.price * qty });
    navigation.navigate('Basket');
  }

  return (
    <ScrollView testID="product-scroll" onScroll={onScroll} scrollEventThrottle={50} contentContainerStyle={s.screen}>
      <ShoeImage colour={product.colour} tall />
      <Text style={s.h1}>{product.name}</Text>
      <Text style={s.priceBig}>{money(product.price)}</Text>
      <Text style={s.p}>{product.blurb}</Text>

      <Dropdown
        label="Size"
        testID="size"
        value={size}
        placeholder="Choose your size"
        onChange={(v) => {
          setSize(v);
          setError(null);
          recap.track('size_selected', { sku: product.id, size: v });
        }}
        options={SIZES.map((x) => ({ value: x, label: x }))}
      />
      {error && <Text style={s.error}>{error}</Text>}

      <Text style={[s.label, { marginTop: 16 }]}>Colour</Text>
      <View style={s.row}>
        {COLOURS.map((c) => (
          <Chip key={c} label={`Colour: ${c}`} on={c === colour} onPress={() => setColour(c)} />
        ))}
      </View>

      <Text style={[s.label, { marginTop: 16 }]}>Quantity</Text>
      <Stepper name="Quantity" value={qty} onChange={setQty} />

      <Button testID="add" label="Add to basket" onPress={add} />

      <Pressable onPress={recapPress('Reviews', () => setShowReviews((v) => !v))} style={s.accordion}>
        <Text style={s.accordionTitle}>Reviews (4.6 ★, 128)</Text>
        <Text style={s.chevron}>{showReviews ? '▴' : '▾'}</Text>
      </Pressable>
      {showReviews &&
        ['Great grip in the wet.', 'Comes up a little small, size up.', 'Comfy straight out of the box.'].map((r) => (
          <Text key={r} style={s.review}>“{r}”</Text>
        ))}

      <Text style={[s.h2, { marginTop: 24 }]}>Details</Text>
      {Array.from({ length: 18 }, (_, i) => (
        <Text key={i} style={s.p}>
          • Feature {i + 1}: built for comfort over long distances.
        </Text>
      ))}
    </ScrollView>
  );
}

function Basket({ navigation }) {
  const onScroll = useRecapScroll();
  const basket = useBasket();
  const [promo, setPromo] = useState('');
  const [promoMsg, setPromoMsg] = useState(null);
  const subtotal = basket.items.reduce((n, i) => n + i.price * i.qty, 0);

  return (
    <ScrollView onScroll={onScroll} scrollEventThrottle={50} contentContainerStyle={s.screen}>
      <Text style={s.h1}>Basket</Text>
      {basket.items.length === 0 && <Text style={s.p}>Your basket is empty.</Text>}
      {basket.items.map((item, idx) => (
        <View key={idx} style={s.line}>
          <View style={[s.thumb, { backgroundColor: item.colour === 'Teal' ? '#0e7490' : item.colour === 'Sand' ? '#d6b98c' : '#1f2937' }]} />
          <View style={{ flex: 1 }}>
            <Text style={s.cardTitle}>{item.name}</Text>
            <Text style={s.muted}>
              {item.size} · {item.colour}
            </Text>
            <Stepper name="Basket quantity" value={item.qty} onChange={(q) => basket.setQty(idx, q)} />
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={s.cardTitle}>{money(item.price * item.qty)}</Text>
            <Pressable onPress={recapPress('Remove item', () => basket.remove(idx))}>
              <Text style={s.link}>Remove</Text>
            </Pressable>
          </View>
        </View>
      ))}

      <Field label="Promo code" testID="promo" value={promo} onChangeText={setPromo} placeholder="e.g. WINTER10" autoCapitalize="characters" />
      <Button
        label="Apply promo code"
        variant="secondary"
        testID="apply-promo"
        onPress={() => {
          // Every code fails here on purpose, so you can see frustrated repeat taps in the dashboard.
          setPromoMsg('That code isn’t valid');
          recap.track('promo_failed', { length: promo.length });
        }}
      />
      {promoMsg && <Text style={s.error}>{promoMsg}</Text>}

      <View style={s.totalRow}>
        <Text style={s.h2}>Subtotal</Text>
        <Text style={s.h2}>{money(subtotal)}</Text>
      </View>
      <Button testID="checkout" label="Checkout" disabled={basket.items.length === 0} onPress={() => basket.items.length && navigation.navigate('Checkout')} />
    </ScrollView>
  );
}

function Checkout({ navigation }) {
  const onScroll = useRecapScroll();
  const basket = useBasket();
  const [form, setForm] = useState({ name: '', email: '', postcode: '' });
  const [delivery, setDelivery] = useState(null);
  const [gift, setGift] = useState(false);
  const [news, setNews] = useState(false);
  const [errors, setErrors] = useState({});
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const subtotal = basket.items.reduce((n, i) => n + i.price * i.qty, 0);
  const deliveryPrice = DELIVERY.find((d) => d.id === delivery)?.price ?? 0;
  const total = subtotal + deliveryPrice + (gift ? 3 : 0);

  function pay() {
    const e = {};
    if (!form.name.trim()) e.name = 'Enter your name';
    if (!/^\S+@\S+\.\S+$/.test(form.email)) e.email = 'Enter a valid email';
    if (form.postcode.trim().length < 5) e.postcode = 'Enter your postcode';
    if (!delivery) e.delivery = 'Choose a delivery option';
    setErrors(e);
    if (Object.keys(e).length) {
      // Only which fields failed is sent, never what was typed.
      recap.track('checkout_error', { fields: Object.keys(e).join(',') });
      return;
    }
    recap.track('order_completed', { value: total, items: basket.items.length, delivery, gift_wrap: gift });
    basket.clear();
    navigation.navigate('Confirmation', { total });
  }

  return (
    <ScrollView onScroll={onScroll} scrollEventThrottle={50} contentContainerStyle={s.screen} keyboardShouldPersistTaps="handled">
      <Text style={s.h1}>Checkout</Text>
      {/* Recordings pause while this is on screen, so names and addresses are never captured. */}
      <RecapPrivate>
        <Field label="Full name" testID="name" value={form.name} onChangeText={set('name')} placeholder="Alex Smith" error={errors.name} />
        <Field label="Email" testID="email" value={form.email} onChangeText={set('email')} placeholder="you@example.com" keyboardType="email-address" autoCapitalize="none" error={errors.email} />
        <Field label="Postcode" testID="postcode" value={form.postcode} onChangeText={set('postcode')} placeholder="SW1A 1AA" autoCapitalize="characters" error={errors.postcode} />
        <Dropdown
          label="Delivery"
          testID="delivery"
          value={delivery}
          onChange={setDelivery}
          options={DELIVERY.map((d) => ({ value: d.id, label: `${d.label}${d.price ? ` (+${money(d.price)})` : ' (free)'}` }))}
        />
        {errors.delivery && <Text style={s.error}>{errors.delivery}</Text>}
      </RecapPrivate>

      <View style={s.toggleRow}>
        <Text style={s.p}>Gift wrap (+£3)</Text>
        <Switch testID="gift" value={gift} onValueChange={(v) => { setGift(v); recap.track('gift_wrap_toggled', { on: v }); }} />
      </View>
      <Pressable testID="news" style={s.toggleRow} onPress={recapPress('Newsletter checkbox', () => setNews((v) => !v))}>
        <Text style={s.p}>Send me offers by email</Text>
        <View style={[s.checkbox, news && s.checkboxOn]}>{news && <Text style={s.checkTick}>✓</Text>}</View>
      </Pressable>

      <View style={s.totalRow}>
        <Text style={s.h2}>Total</Text>
        <Text style={s.h2}>{money(total)}</Text>
      </View>
      <Button testID="pay" label="Pay now" onPress={pay} />
    </ScrollView>
  );
}

function Confirmation({ navigation, route }) {
  const [stars, setStars] = useState(0);
  return (
    <View style={[s.screen, { alignItems: 'center' }]}>
      <Text style={s.bigTick}>✓</Text>
      <Text style={s.h1}>Order placed</Text>
      <Text style={s.p}>Thanks! We’ve emailed your receipt. Total paid {money(route.params?.total ?? 0)}.</Text>
      <Text style={[s.label, { marginTop: 24 }]}>How was checkout?</Text>
      <View style={s.row}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable
            key={n}
            testID={`star-${n}`}
            onPress={recapPress(`Rate ${n} stars`, () => {
              setStars(n);
              recap.track('checkout_rated', { stars: n });
            })}
          >
            <Text style={[s.star, n <= stars && s.starOn]}>★</Text>
          </Pressable>
        ))}
      </View>
      <Button testID="done" label="Back to shop" onPress={() => navigation.popToTop()} />
    </View>
  );
}

// ---------- App ----------

// Screen pictures come from react-native-view-shot on a real phone. view-shot can't capture in a
// browser, so the web build takes no pictures at all, except in the automated end-to-end test, which
// sends a tiny placeholder to check the upload path (the dashboard ignores pictures that small).
const TEST_PICTURE = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const capture =
  Platform.OS !== 'web' ? captureRef : globalThis.__RECAP_E2E__ ? async () => `data:image/png;base64,${TEST_PICTURE}` : undefined;

export default function App() {
  const [items, setItems] = useState([]);
  const basket = {
    items,
    add: (item) => setItems((xs) => [...xs, item]),
    remove: (i) => setItems((xs) => xs.filter((_, j) => j !== i)),
    setQty: (i, qty) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, qty } : x))),
    clear: () => setItems([]),
  };
  return (
    <RecapProvider
      navigationRef={navigationRef}
      captureRef={capture}
      device={{ model: 'Playwright phone' }}
      config={{ appId: 'test-shop', supabase: { url: cfg.url, anonKey: cfg.anonKey }, storage: AsyncStorage, appVersion: '1.1.0', flushIntervalMs: 2000, debug: true, screenshots: true, recordings: true }}
    >
      <BasketContext.Provider value={basket}>
        <SheetHost>
          <NavigationContainer ref={navigationRef}>
            <Stack.Navigator screenOptions={{ headerTintColor: '#0e7490' }}>
              <Stack.Screen name="Home" component={Home} options={{ title: 'Test Shop' }} />
              <Stack.Screen name="Product" component={Product} />
              <Stack.Screen name="Basket" component={Basket} />
              <Stack.Screen name="Checkout" component={Checkout} />
              <Stack.Screen name="Confirmation" component={Confirmation} options={{ headerBackVisible: false }} />
            </Stack.Navigator>
          </NavigationContainer>
        </SheetHost>
      </BasketContext.Provider>
    </RecapProvider>
  );
}

const s = StyleSheet.create({
  screen: { padding: 20, paddingBottom: 48, backgroundColor: '#f8fafc', flexGrow: 1 },
  h1: { fontSize: 28, fontWeight: '700', marginTop: 12, marginBottom: 4, color: '#0f172a' },
  h2: { fontSize: 18, fontWeight: '700', color: '#0f172a' },
  p: { fontSize: 16, marginVertical: 4, color: '#334155' },
  muted: { fontSize: 14, color: '#64748b' },
  label: { fontSize: 14, fontWeight: '600', color: '#475569', marginBottom: 6 },
  error: { color: '#dc2626', marginTop: 6, fontSize: 14 },
  link: { color: '#0e7490', marginTop: 8, fontSize: 14 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },

  hero: { backgroundColor: '#0f172a', borderRadius: 16, padding: 20 },
  heroTitle: { color: '#fff', fontSize: 26, fontWeight: '800' },
  heroText: { color: '#cbd5e1', fontSize: 16, marginTop: 4 },

  card: { backgroundColor: '#fff', borderRadius: 16, marginTop: 16, overflow: 'hidden', borderWidth: 1, borderColor: '#e2e8f0' },
  cardBody: { padding: 14, flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#0f172a', flexShrink: 1 },
  badge: { backgroundColor: '#fef3c7', color: '#92400e', fontSize: 12, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 99 },
  price: { marginLeft: 'auto', fontSize: 16, fontWeight: '700', color: '#0e7490' },
  priceBig: { fontSize: 22, fontWeight: '700', color: '#0e7490' },
  image: { borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  imageEmoji: { fontSize: 56 },

  btn: { backgroundColor: '#0e7490', padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 16 },
  btnSecondary: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#0e7490', padding: 12 },
  btnDisabled: { opacity: 0.4 },
  btnText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  btnTextSecondary: { color: '#0e7490', fontSize: 16 },

  select: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 10, padding: 14 },
  selectText: { fontSize: 16, color: '#0f172a', flex: 1 },
  placeholder: { fontSize: 16, color: '#94a3b8', flex: 1 },
  chevron: { fontSize: 16, color: '#64748b' },
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, paddingBottom: 32 },
  sheetTitle: { fontSize: 18, fontWeight: '700', marginBottom: 8, color: '#0f172a' },
  option: { flexDirection: 'row', padding: 14, borderRadius: 10 },
  optionOn: { backgroundColor: '#ecfeff' },
  optionText: { fontSize: 16, flex: 1, color: '#0f172a' },
  tick: { color: '#0e7490', fontWeight: '700' },

  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 10, padding: 14, fontSize: 16, color: '#0f172a' },
  inputError: { borderColor: '#dc2626' },

  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 99, borderWidth: 1, borderColor: '#cbd5e1', backgroundColor: '#fff' },
  chipOn: { backgroundColor: '#0e7490', borderColor: '#0e7490' },
  chipText: { color: '#334155', fontSize: 14 },
  chipTextOn: { color: '#fff', fontWeight: '600' },

  stepper: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 6 },
  stepBtn: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: '#cbd5e1', alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  stepText: { fontSize: 20, color: '#0f172a' },
  stepValue: { fontSize: 16, fontWeight: '700', minWidth: 20, textAlign: 'center' },

  accordion: { flexDirection: 'row', marginTop: 20, paddingVertical: 14, borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#e2e8f0' },
  accordionTitle: { flex: 1, fontSize: 16, fontWeight: '600', color: '#0f172a' },
  review: { fontSize: 15, fontStyle: 'italic', color: '#475569', marginTop: 8 },

  line: { flexDirection: 'row', gap: 12, backgroundColor: '#fff', padding: 12, borderRadius: 12, marginTop: 12, borderWidth: 1, borderColor: '#e2e8f0' },
  thumb: { width: 56, height: 56, borderRadius: 10 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 24 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 },
  checkbox: { width: 26, height: 26, borderRadius: 6, borderWidth: 2, borderColor: '#94a3b8', alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: '#0e7490', borderColor: '#0e7490' },
  checkTick: { color: '#fff', fontWeight: '800' },

  bigTick: { fontSize: 64, color: '#16a34a', marginTop: 32 },
  star: { fontSize: 36, color: '#cbd5e1', paddingHorizontal: 4 },
  starOn: { color: '#f59e0b' },
});
