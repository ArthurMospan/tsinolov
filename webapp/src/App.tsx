import { useCallback, useEffect, useMemo, useRef, useState, type TouchEvent } from 'react';
import {
  ArrowLeft,
  Bell,
  Check,
  ChevronDown,
  ChevronRight,
  Heart,
  Link2,
  LogOut,
  MapPin,
  Package,
  Plus,
  Search,
  Send,
  Settings as SettingsIcon,
  ShoppingCart,
  ShieldCheck,
  Sparkles,
  Star,
  Store,
  Tag,
  TrendingDown,
  UserRound,
  X,
} from 'lucide-react';

const API_URL = '';
const SILPO_HEADER_LOGO_URL = 'https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/eb/99/68/eb9968ce-3c3b-be25-ecb3-4903ba0b7b7d/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/512x512bb.jpg';
const SILPO_LOADER_LOGO_URL = '/Silpo_outline_logo.svg';
const SILPO_ACCOUNT_URL = 'https://my.silpo.ua/';
const SILPO_BASKET_URL = 'https://silpo.ua/basket';
const SILPO_APP_LINK = 'https://link.silpo.ua/bc29f9776abb';
const SILPO_BASKET_APP_LINK = `${SILPO_APP_LINK}?deep_link_value=basket`;
const TG_ID_STORAGE_KEY = 'tsinolov_tg_id';
const ACTIVE_STORE_STORAGE_KEY = 'tsinolov_active_store';

function getTgId(): number {
  try {
    const telegram = (window as any).Telegram?.WebApp;
    const telegramId = Number(telegram?.initDataUnsafe?.user?.id || 0);
    if (telegramId) {
      window.localStorage.setItem(TG_ID_STORAGE_KEY, String(telegramId));
      return telegramId;
    }
    return Number(window.localStorage.getItem(TG_ID_STORAGE_KEY) || import.meta.env.VITE_TEST_TG_ID || 0);
  } catch {
    return Number(import.meta.env.VITE_TEST_TG_ID || 0);
  }
}

function telegramInitData(): string {
  return String((window as any).Telegram?.WebApp?.initData || '');
}

function telegramContext(): { id: number; initData: string } {
  return { id: getTgId(), initData: telegramInitData() };
}

function telegramUser(): { name: string; avatar: string } {
  const user = (window as any).Telegram?.WebApp?.initDataUnsafe?.user;
  const name = [user?.first_name, user?.last_name].filter(Boolean).join(' ').trim();
  return { name, avatar: String(user?.photo_url || '') };
}

function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const initData = telegramInitData();
  if (initData) headers.set('X-Telegram-Init-Data', initData);
  return fetch(input, { ...init, headers, credentials: init.credentials || 'same-origin' });
}

type SettingKey =
  | 'price_drop'
  | 'price_target'
  | 'promo_new'
  | 'promo_personal'
  | 'in_stock'
  | 'delivery_available'
  | 'alt_cheaper'
  | 'smart_buy';

interface Product {
  product_id: string;
  external_product_id?: number;
  name: string;
  current_price: number;
  old_price: number;
  added_price: number;
  image_url: string;
  has_promo: boolean;
  target_price: number;
  slug?: string;
  available: boolean | null;
  availability_note?: string;
  stock: number;
  displayWeight?: string;
  price_unit?: string;
  company_id?: string;
  special_price: number;
  special_price_count: number;
  special_price_type: string;
  effective_price: number;
  reference_price: number;
  is_favorite?: boolean;
}

type Settings = Record<SettingKey, boolean> & { onboarding_completed: boolean };

interface UserProfile {
  name: string;
  avatar: string;
  branchId: string;
  deliveryType: string;
  city: string;
  address: string;
  storeLabel: string;
  isOpen: boolean | null;
  checkedAt?: string;
  orderMinimum: number | null;
  deliveryPrice: number | null;
  deliveryTemporarilyUnavailable: boolean | null;
}

interface StoreOption {
  branchId: string;
  deliveryType: string;
  storeLabel: string;
  city?: string;
  address?: string;
  addressLabel?: string;
}

interface StoreOptions {
  current: StoreOption;
  accountDefault: StoreOption;
  recent: StoreOption[];
  addresses: StoreOption[];
}

interface CatalogCategory {
  id: string;
  name: string;
  slug: string;
  productCount: number | null;
  children: CatalogCategory[];
}

const DEFAULT_SETTINGS: Settings = {
  price_drop: false,
  price_target: false,
  promo_new: false,
  promo_personal: false,
  in_stock: false,
  delivery_available: false,
  alt_cheaper: false,
  smart_buy: false,
  onboarding_completed: false,
};

const RECOMMENDED_SETTINGS: Settings = {
  ...DEFAULT_SETTINGS,
  price_target: true,
  price_drop: true,
  promo_personal: true,
};

const SETTING_DEFINITIONS: Array<{
  key: SettingKey;
  icon: typeof Sparkles;
  title: string;
  description: string;
}> = [
  { key: 'price_target', icon: Sparkles, title: 'Бажана ціна', description: 'Коли товар коштує не дорожче за бажану ціну' },
  { key: 'price_drop', icon: TrendingDown, title: 'Помітне зниження ціни', description: 'Від 5% і щонайменше 2 ₴ — без дрібного шуму' },
  { key: 'promo_new', icon: Tag, title: 'Нові акції', description: 'Коли на товар зʼявилася акція' },
  { key: 'promo_personal', icon: Star, title: 'Нові персональні пропозиції', description: 'Коли в акаунті Сільпо з’являється нова пропозиція' },
  { key: 'in_stock', icon: Package, title: 'Повернення в наявність', description: 'Коли недоступний товар знову можна купити' },
  { key: 'alt_cheaper', icon: Search, title: 'Точні дешевші варіанти', description: 'Лише той самий бренд, тип і сумісна фасовка' },
  { key: 'smart_buy', icon: Bell, title: 'Велика знижка', description: 'Коли ціна щонайменше на 20% нижча за звичайну' },
];

function SwipeHandle({ onClose }: { onClose: () => void }) {
  const startY = useRef<number | null>(null);
  const distance = useRef(0);

  const sheetFor = (target: HTMLDivElement): HTMLElement | null =>
    target.closest('[data-swipe-sheet]');

  const resetSheet = (sheet: HTMLElement) => {
    sheet.style.transition = 'transform 180ms cubic-bezier(.2,.8,.2,1)';
    sheet.style.transform = 'translate3d(0, 0, 0)';
    window.setTimeout(() => {
      sheet.style.removeProperty('transition');
      sheet.style.removeProperty('transform');
      sheet.style.removeProperty('will-change');
    }, 180);
  };

  const finishSwipe = (target: HTMLDivElement) => {
    const sheet = sheetFor(target);
    const shouldClose = distance.current >= 72;
    startY.current = null;
    distance.current = 0;
    if (!sheet) return;

    if (!shouldClose) {
      resetSheet(sheet);
      return;
    }

    sheet.style.transition = 'transform 180ms cubic-bezier(.4,0,1,1)';
    sheet.style.transform = 'translate3d(0, 100%, 0)';
    window.setTimeout(onClose, 180);
  };

  return (
    <div
      className="sheet-handle"
      aria-hidden="true"
      onTouchStart={event => {
        startY.current = event.touches[0]?.clientY ?? null;
        distance.current = 0;
        const sheet = sheetFor(event.currentTarget);
        if (sheet) {
          sheet.style.animation = 'none';
          sheet.style.willChange = 'transform';
        }
      }}
      onTouchMove={event => {
        if (startY.current === null) return;
        const nextDistance = Math.max(0, (event.touches[0]?.clientY ?? startY.current) - startY.current);
        distance.current = nextDistance;
        const sheet = sheetFor(event.currentTarget);
        if (sheet) sheet.style.transform = `translate3d(0, ${nextDistance}px, 0)`;
        if (event.cancelable) event.preventDefault();
      }}
      onTouchEnd={event => finishSwipe(event.currentTarget)}
      onTouchCancel={event => {
        const sheet = sheetFor(event.currentTarget);
        startY.current = null;
        distance.current = 0;
        if (sheet) resetSheet(sheet);
      }}
    />
  );
}

function numberValue(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function booleanValue(value: unknown, fallback = false): boolean {
  if (value === undefined || value === null) return fallback;
  return value === true || value === 1 || value === '1' || value === 'true';
}

function nestedFieldValues(root: any, fieldNames: string[], maxDepth = 5): unknown[] {
  const names = new Set(fieldNames.map(name => name.toLowerCase()));
  const values: unknown[] = [];
  const visited = new Set<any>();
  const visit = (value: any, depth: number) => {
    if (!value || typeof value !== 'object' || depth > maxDepth || visited.has(value)) return;
    visited.add(value);
    if (Array.isArray(value)) {
      value.forEach(item => visit(item, depth + 1));
      return;
    }
    Object.entries(value).forEach(([key, nested]) => {
      if (names.has(key.toLowerCase()) && nested !== undefined && nested !== null) values.push(nested);
      if (nested && typeof nested === 'object') visit(nested, depth + 1);
    });
  };
  visit(root, 0);
  return values;
}

function scalarText(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  if (!value || typeof value !== 'object') return '';
  const object = value as Record<string, unknown>;
  for (const key of ['shortName', 'short_name', 'abbreviation', 'symbol', 'name', 'label', 'title', 'text', 'value', 'code']) {
    if (typeof object[key] === 'string' || typeof object[key] === 'number') return String(object[key]).trim();
  }
  return '';
}

function productAvailabilityNote(item: any): string | undefined {
  const statuses = nestedFieldValues(item, [
    'availabilityStatus', 'availability_status', 'stockStatus', 'stock_status',
    'productStatus', 'product_status', 'status', 'availabilityMessage', 'availability_message',
  ]).map(scalarText).join(' ').toLowerCase();
  if (/очіку|expected|awaiting|coming[_\s-]?soon/.test(statuses)) return 'Очікується';

  const onlineValues = nestedFieldValues(item, [
    'onlineOnly', 'online_only', 'isOnlineOnly', 'is_online_only', 'onlyOnline', 'only_online',
    'priceOnlyOnline', 'price_only_online', 'isOnlinePrice', 'is_online_price', 'priceType', 'price_type',
  ]);
  const onlineOnly = onlineValues.some(value => booleanValue(value)
    || /online|онлайн/.test(scalarText(value).toLowerCase()));
  if (onlineOnly || /only[_\s-]?online|лише онлайн|тільки онлайн/.test(statuses)) return 'Лише онлайн';
  return undefined;
}

function productAvailabilityValue(item: any): boolean | null {
  for (const field of ['storeAvailability', 'store_availability', 'in_stock']) {
    if (!Object.prototype.hasOwnProperty.call(item || {}, field)) continue;
    if (item[field] === null) return null;
    return booleanValue(item[field]);
  }

  const note = productAvailabilityNote(item);
  if (note === 'Очікується') return false;
  if (note === 'Лише онлайн') return null;
  const statuses = nestedFieldValues(item, [
    'availabilityStatus', 'availability_status', 'stockStatus', 'stock_status',
    'productStatus', 'product_status', 'status', 'availabilityMessage', 'availability_message',
  ]).map(scalarText).join(' ').toLowerCase();
  if (/out[_\s-]?of[_\s-]?stock|unavailable|not[_\s-]?available|sold[_\s-]?out|немає|відсут/.test(statuses)) return false;
  for (const field of ['out_of_stock', 'outOfStock', 'is_out_of_stock', 'isOutOfStock']) {
    if (booleanValue(item?.[field])) return false;
  }
  if (item?.stock !== undefined && item?.stock !== null && item?.stock !== '') {
    if (typeof item.stock === 'string') {
      const normalized = item.stock.trim().toLowerCase();
      if (['out_of_stock', 'out-of-stock', 'unavailable', 'sold_out', 'sold-out', 'none', 'false'].includes(normalized)) return false;
      if (['in_stock', 'in-stock', 'available', 'true'].includes(normalized)) return true;
    }
    const stock = Number(item.stock);
    if (Number.isFinite(stock)) return stock > 0;
  }
  for (const field of ['stockQuantity', 'stock_quantity', 'availableQuantity', 'available_quantity', 'quantityAvailable', 'quantity_available']) {
    if (item?.[field] !== undefined && item?.[field] !== null && item?.[field] !== '') {
      const quantity = Number(item[field]);
      if (Number.isFinite(quantity)) return quantity > 0;
    }
  }
  for (const field of ['inStock', 'is_in_stock', 'isInStock']) {
    if (item?.[field] !== undefined && item?.[field] !== null) return booleanValue(item[field]);
  }
  for (const field of ['available', 'isAvailable', 'is_available']) {
    if (item?.[field] !== undefined && item?.[field] !== null && !booleanValue(item[field])) return false;
  }
  return null;
}

function productPriceUnit(item: any): string | undefined {
  const raw = item?.ratio ?? item?.priceRatio ?? item?.price_ratio
    ?? item?.priceUnit ?? item?.price_unit ?? item?.sellingUnit ?? item?.selling_unit
    ?? item?.displayRatio ?? item?.display_ratio;
  const value = scalarText(raw).toLowerCase().replace(/\s+/g, '');
  if (!value) return undefined;
  const match = value.match(/^(\d+(?:[.,]\d+)?)?(кг|kg|кілограм(?:ів)?|г|gr|g|грам(?:ів)?|л|l|літр(?:ів)?|мл|ml|мілілітр(?:ів)?|шт|pcs?|piece|pieces|од)$/i);
  if (!match) return scalarText(raw) || undefined;
  const amount = match[1]?.replace('.', ',');
  const sourceUnit = match[2].toLowerCase();
  const unit = /^(кг|kg|кілограм)/.test(sourceUnit) ? 'кг'
    : /^(г|gr|g|грам)/.test(sourceUnit) ? 'г'
      : /^(мл|ml|мілілітр)/.test(sourceUnit) ? 'мл'
        : /^(л|l|літр)/.test(sourceUnit) ? 'л'
          : 'шт';
  return amount ? `${amount} ${unit}` : unit;
}

function productDisplayWeight(item: any): string | undefined {
  const direct = nestedFieldValues(item, [
    'displayWeight', 'display_weight', 'weightText', 'weight_text', 'netWeightText', 'net_weight_text',
    'volumeText', 'volume_text', 'displayUnit', 'display_unit', 'sellingUnitText', 'selling_unit_text',
  ]).map(scalarText).find(Boolean);
  if (direct) return direct;

  const attributeMeasurement = nestedFieldValues(item, ['attributes', 'characteristics', 'properties'])
    .flatMap(value => Array.isArray(value) ? value : [value])
    .map((attribute: any) => ({
      label: scalarText(attribute?.name ?? attribute?.label ?? attribute?.title).toLowerCase(),
      value: scalarText(attribute?.value ?? attribute?.text ?? attribute?.displayValue ?? attribute?.display_value),
    }))
    .find(attribute => /вага|маса|об.?єм|фасов|кількість|одиниц|weight|volume|unit|pack/.test(attribute.label) && attribute.value);
  if (attributeMeasurement) return attributeMeasurement.value;

  const unitText = nestedFieldValues(item, [
    'unitOfMeasure', 'unit_of_measure', 'measurementUnit', 'measurement_unit', 'measureUnit', 'measure_unit',
    'priceUnit', 'price_unit', 'baseUnit', 'base_unit', 'sellingUnit', 'selling_unit', 'unitName', 'unit_name', 'uom', 'unit',
  ]).map(scalarText).find(Boolean) || '';
  const normalizedUnit = unitText.toLowerCase().replace(/[.\s_-]+/g, '');
  let unit: string | undefined;
  if (/^(kg|kilogram|kilograms|кілограм|кілограмів|кг)$/.test(normalizedUnit)) unit = 'кг';
  else if (/^(g|gr|gram|grams|грам|грамів|г)$/.test(normalizedUnit)) unit = 'г';
  else if (/^(l|liter|litre|liters|litres|літр|літрів|л)$/.test(normalizedUnit)) unit = 'л';
  else if (/^(ml|milliliter|millilitre|milliliters|millilitres|мілілітр|мілілітрів|мл)$/.test(normalizedUnit)) unit = 'мл';
  else if (/^(pcs|pc|piece|pieces|item|unit|од|одиниця|штука|штук|шт)$/.test(normalizedUnit)) unit = 'шт';

  const amountValue = nestedFieldValues(item, [
    'netWeight', 'net_weight', 'packageWeight', 'package_weight', 'weight', 'volume', 'amount', 'quantity',
  ]).find(value => Number.isFinite(Number(value)) && Number(value) > 0);
  const amount = numberValue(amountValue);
  if (unit && amount > 0) return `${Number(amount.toFixed(3)).toLocaleString('uk-UA')} ${unit}`;
  if (unit === 'кг' || unit === 'л') return `ціна за 1 ${unit}`;
  if (unit) return `1 ${unit}`;
  if (unitText && unitText !== '[object Object]') {
    return amount > 0 ? `${Number(amount.toFixed(3)).toLocaleString('uk-UA')} ${unitText}` : unitText;
  }
  const productName = String(item?.title ?? item?.name ?? item?.productName ?? '').trim();
  const nameMeasurement = productName.match(/(?:^|\s)(\d+(?:[.,]\d+)?)\s*(кг|г|л|мл|шт)\b/i);
  if (nameMeasurement) return `${nameMeasurement[1].replace('.', ',')} ${nameMeasurement[2].toLowerCase()}`;
  if (/вагов|на вагу|weight product/i.test(productName)) return 'ціна за 1 кг';
  return undefined;
}

function normalizeProduct(item: any, availabilityReliable = true): Product {
  const currentPrice = numberValue(item.price ?? item.current_price ?? item.currentPrice ?? item.salePrice);
  const oldPrice = numberValue(item.oldPrice ?? item.old_price ?? item.originalPrice, currentPrice);
  const id = String(item.id ?? item.product_id ?? item.productId ?? item.slug ?? '');
  const specialPrices = item.specialPrices;
  const hasExplicitPromo = item.hasPromo ?? item.has_promo ?? item.isPromo;
  const specialOffer = Array.isArray(specialPrices)
    ? specialPrices
      .map((offer: any) => ({ price: numberValue(offer?.price), count: numberValue(offer?.count), type: String(offer?.type || '') }))
      .filter((offer: { price: number; count: number; type: string }) => offer.price > 0 && offer.price < currentPrice && (offer.count <= 1 || offer.type === 'from'))
      .sort((left: { price: number }, right: { price: number }) => left.price - right.price)[0]
    : undefined;
  const specialPrice = specialOffer?.price || 0;
  const effectivePrice = specialPrice || currentPrice;
  const referencePrice = oldPrice > effectivePrice ? oldPrice : specialPrice ? currentPrice : currentPrice;
  const availabilityNote = productAvailabilityNote(item);

  return {
    product_id: id,
    external_product_id: numberValue(item.externalProductId ?? item.external_product_id) || undefined,
    name: String(item.title ?? item.name ?? item.productName ?? 'Товар'),
    current_price: currentPrice,
    old_price: oldPrice,
    added_price: numberValue(item.added_price ?? item.addedPrice, oldPrice),
    image_url: String(item.image ?? item.imageUrl ?? item.image_url ?? ''),
    has_promo: booleanValue(hasExplicitPromo) || Boolean(specialPrice) || oldPrice > currentPrice,
    target_price: numberValue(item.target_price ?? item.targetPrice),
    slug: item.slug ? String(item.slug) : undefined,
    available: !availabilityReliable ? null : productAvailabilityValue(item),
    availability_note: availabilityNote,
    stock: numberValue(item.stock),
    displayWeight: productDisplayWeight(item),
    price_unit: productPriceUnit(item),
    company_id: item.companyId ? String(item.companyId) : undefined,
    special_price: specialPrice,
    special_price_count: specialOffer?.count || 0,
    special_price_type: specialOffer?.type || '',
    effective_price: effectivePrice,
    reference_price: referencePrice,
    is_favorite: booleanValue(item.isFavorite ?? item.is_favorite),
  };
}

function formatPrice(value: number): string {
  return `${value.toFixed(2).replace('.', ',')} ₴`;
}

function discountPercent(current: number, old: number): number {
  if (!old || old <= current) return 0;
  return Math.round(((old - current) / old) * 100);
}

function productUrl(product: Product): string | undefined {
  return product.slug ? `https://silpo.ua/product/${product.slug}` : undefined;
}

function deliveryLabel(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized.includes('pickup') || normalized.includes('самовив')) return 'Самовивіз';
  if (normalized.includes('delivery') || normalized.includes('достав')) return 'Доставка';
  return value || 'Сільпо';
}

function updatedLabel(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Оновлено щойно';
  return `Оновлено о ${date.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })}`;
}

function App() {
  const [tgId, setTgId] = useState<number>(() => getTgId());
  const [activeTab, setActiveTab] = useState<'favorites' | 'settings'>('favorites');
  const [favorites, setFavorites] = useState<Product[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [modalProduct, setModalProduct] = useState<Product | null>(null);
  const [targetDraft, setTargetDraft] = useState('');
  const [savingTargetId, setSavingTargetId] = useState<string | null>(null);
  const [busyProductId, setBusyProductId] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState('');
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [availabilityBasis, setAvailabilityBasis] = useState<'current_slot' | 'next_day_reference' | 'unverified'>('current_slot');
  const [onboardingStep, setOnboardingStep] = useState<0 | 1>(0);
  const [onboardingDraft, setOnboardingDraft] = useState<Settings>(RECOMMENDED_SETTINGS);
  const [savingOnboarding, setSavingOnboarding] = useState(false);
  const [storePickerOpen, setStorePickerOpen] = useState(false);
  const [storeOptions, setStoreOptions] = useState<StoreOptions | null>(null);
  const [storeSearch, setStoreSearch] = useState('');
  const [storeSearchResults, setStoreSearchResults] = useState<StoreOption[]>([]);
  const [storeLoading, setStoreLoading] = useState(false);
  const [addingDealBasket, setAddingDealBasket] = useState(false);
  const [productSearchOpen, setProductSearchOpen] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [productSearchResults, setProductSearchResults] = useState<Product[]>([]);
  const [productSearchLoading, setProductSearchLoading] = useState(false);
  const [productSearchError, setProductSearchError] = useState(false);
  const [catalogCategories, setCatalogCategories] = useState<CatalogCategory[]>([]);
  const [catalogPath, setCatalogPath] = useState<CatalogCategory[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState(false);
  const [productResultsMode, setProductResultsMode] = useState<'search' | 'category' | null>(null);
  const [productResultsOffset, setProductResultsOffset] = useState(0);
  const [productResultsHasMore, setProductResultsHasMore] = useState(false);
  const [addingFavoriteId, setAddingFavoriteId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const pullStartY = useRef<number | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2600);
  }, []);

  const loadData = useCallback(async (showLoader = true) => {
    if (!tgId) {
      setIsAuthenticated(false);
      setIsLoading(false);
      return;
    }

    if (showLoader) setIsLoading(true);
    let authenticatedSession = false;
    try {
      const statusResponse = await apiFetch(`${API_URL}/api/auth/status?tg_id=${tgId}`);
      if (statusResponse.status === 401) {
        throw new Error(telegramInitData() ? 'Telegram identity rejected' : 'Telegram context missing');
      }
      if (!statusResponse.ok) throw new Error('Auth status unavailable');
      const status = await statusResponse.json();
      authenticatedSession = Boolean(status.authenticated);
      setIsAuthenticated(authenticatedSession);

      if (!status.authenticated) {
        setFavorites([]);
        setUserProfile(null);
        return;
      }

      const [profileResponse, settingsResponse] = await Promise.all([
        apiFetch(`${API_URL}/api/user/profile?tg_id=${tgId}`),
        apiFetch(`${API_URL}/api/settings?tg_id=${tgId}`),
      ]);
      if (!profileResponse.ok || !settingsResponse.ok) throw new Error('User data unavailable');

      const profile = await profileResponse.json();
      const telegram = telegramUser();
      const normalizedProfile: UserProfile = {
        ...profile,
        name: String(telegram.name || profile.name || 'Мій акаунт'),
        avatar: String(profile.avatar || telegram.avatar || ''),
        city: String(profile.city || ''),
        address: String(profile.address || ''),
        storeLabel: String(profile.storeLabel || 'Магазин Сільпо за замовчуванням'),
        isOpen: typeof profile.isOpen === 'boolean' ? profile.isOpen : null,
        orderMinimum: numberValue(profile.orderMinimum) || null,
        deliveryPrice: numberValue(profile.deliveryPrice) || null,
        deliveryTemporarilyUnavailable: typeof profile.deliveryTemporarilyUnavailable === 'boolean'
          ? profile.deliveryTemporarilyUnavailable
          : null,
      };
      const savedSettings = await settingsResponse.json();
      const normalizedSettings = Object.fromEntries(
        [...Object.keys(DEFAULT_SETTINGS)].map(key => [key, booleanValue(savedSettings[key], DEFAULT_SETTINGS[key as keyof Settings])])
      ) as unknown as Settings;
      setUserProfile(normalizedProfile);
      setSettings(normalizedSettings);
      if (!normalizedSettings.onboarding_completed) {
        setOnboardingStep(0);
        setOnboardingDraft(RECOMMENDED_SETTINGS);
      }

      const storeStorageKey = `${ACTIVE_STORE_STORAGE_KEY}_${tgId}`;
      const previousStore = window.localStorage.getItem(storeStorageKey);
      if (previousStore && previousStore !== normalizedProfile.branchId) {
        window.setTimeout(() => showToast('Магазин змінився — ціни перебазовано без хибних сповіщень'), 150);
      }
      window.localStorage.setItem(storeStorageKey, normalizedProfile.branchId);

      const favoritesResponse = await apiFetch(`${API_URL}/api/favorites?tg_id=${tgId}`);
      if (!favoritesResponse.ok) throw new Error('Favorites unavailable');
      const favoritesData = await favoritesResponse.json();
      const availabilityReliable = booleanValue(favoritesData.availabilityReliable, true);
      setFavorites(Array.isArray(favoritesData.favorites)
        ? favoritesData.favorites.map((item: any) => normalizeProduct(item, availabilityReliable))
        : []);
      setAvailabilityBasis(favoritesData.availabilityBasis || 'current_slot');
      if (favoritesData.store) {
        setUserProfile(previous => previous ? {
          ...previous,
          ...favoritesData.store,
          name: previous.name,
          avatar: previous.avatar,
        } : previous);
      }
      setLastUpdated(String(favoritesData.checkedAt || profile.checkedAt || new Date().toISOString()));
    } catch (error) {
      console.error('[Mini App] Failed to load data:', error);
      setIsAuthenticated(authenticatedSession);
      if (!authenticatedSession) setFavorites([]);
      const message = error instanceof Error ? error.message : '';
      if (message === 'Telegram context missing') {
        showToast('Відкрийте застосунок через Telegram');
      } else if (message === 'Telegram identity rejected') {
        showToast('Telegram-підпис відхилено. Перезапустіть застосунок через бота');
      } else {
        showToast('Не вдалося завантажити дані');
      }
    } finally {
      if (showLoader) setIsLoading(false);
    }
  }, [showToast, tgId]);

  const refreshPage = useCallback(async () => {
    if (isRefreshing) return;
    setActiveTab('favorites');
    setProfileMenuOpen(false);
    setIsRefreshing(true);
    try {
      await loadData(false);
      showToast('Дані оновлено');
    } finally {
      setIsRefreshing(false);
    }
  }, [isRefreshing, loadData, showToast]);

  const handlePullStart = (event: TouchEvent<HTMLDivElement>) => {
    if (window.scrollY <= 0 && event.touches.length === 1) pullStartY.current = event.touches[0].clientY;
  };

  const handlePullMove = (event: TouchEvent<HTMLDivElement>) => {
    if (pullStartY.current === null || window.scrollY > 0) return;
    const distance = Math.max(0, event.touches[0].clientY - pullStartY.current);
    setPullDistance(Math.min(68, distance * 0.42));
  };

  const handlePullEnd = () => {
    const shouldRefresh = pullDistance >= 48;
    pullStartY.current = null;
    setPullDistance(0);
    if (shouldRefresh) void refreshPage();
  };

  useEffect(() => {
    const telegram = (window as any).Telegram?.WebApp;
    const root = document.documentElement;
    const syncTelegramInsets = () => {
      const safeTop = Number(telegram?.safeAreaInset?.top || 0);
      const contentTop = Number(telegram?.contentSafeAreaInset?.top || 0);
      const safeBottom = Number(telegram?.safeAreaInset?.bottom || 0);
      const contentBottom = Number(telegram?.contentSafeAreaInset?.bottom || 0);
      // iOS fullscreen places Telegram's Close / More controls over the page.
      // Some clients report zero insets briefly, so reserve that space until
      // Telegram supplies the final content-safe values.
      const top = Math.max(safeTop, contentTop, telegram?.isFullscreen ? 76 : 0);
      root.style.setProperty('--tg-runtime-content-safe-top', `${top}px`);
      root.style.setProperty('--tg-runtime-content-safe-bottom', `${Math.max(safeBottom, contentBottom)}px`);
    };
    try {
      telegram?.ready();
      telegram?.expand();
      telegram?.disableVerticalSwipes?.();
      telegram?.requestFullscreen?.();
      telegram?.setHeaderColor?.('#e85d0b');
      telegram?.setBackgroundColor?.('#f7f7f5');
      telegram?.setBottomBarColor?.('#ffffff');
    } catch {
      // The app can still render in a regular browser for development.
    }
    syncTelegramInsets();
    const events = ['safeAreaChanged', 'contentSafeAreaChanged', 'fullscreenChanged'];
    events.forEach(event => telegram?.onEvent?.(event, syncTelegramInsets));
    const insetTimers = [120, 500, 1200].map(delay => window.setTimeout(syncTelegramInsets, delay));
    let cancelled = false;
    const initialize = async () => {
      // Telegram can expose the WebApp context a few frames after the bundle.
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const context = telegramContext();
        if (context.id && context.initData) break;
        await new Promise((resolve) => window.setTimeout(resolve, 100));
      }
      if (cancelled) return;

      const context = telegramContext();
      setTgId(context.id);
      if (context.id === tgId) void loadData();
    };
    void initialize();
    return () => {
      cancelled = true;
      insetTimers.forEach(timer => window.clearTimeout(timer));
      events.forEach(event => telegram?.offEvent?.(event, syncTelegramInsets));
      root.style.removeProperty('--tg-runtime-content-safe-top');
      root.style.removeProperty('--tg-runtime-content-safe-bottom');
    };
  }, [loadData, tgId]);

  useEffect(() => {
    if (!storePickerOpen || storeSearch.trim().length < 2) {
      setStoreSearchResults([]);
      return;
    }
    let cancelled = false;
    const timeout = window.setTimeout(async () => {
      try {
        const response = await apiFetch(`${API_URL}/api/stores/search?tg_id=${tgId}&q=${encodeURIComponent(storeSearch.trim())}`);
        if (!response.ok) throw new Error('Store search failed');
        const result = await response.json();
        if (!cancelled) setStoreSearchResults(Array.isArray(result.stores) ? result.stores : []);
      } catch (error) {
        console.error('[Mini App] Store search failed:', error);
        if (!cancelled) setStoreSearchResults([]);
      }
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [storePickerOpen, storeSearch, tgId]);

  useEffect(() => {
    const query = productSearch.trim();
    if (!productSearchOpen || query.length < 2) {
      setProductSearchResults([]);
      setProductResultsMode(null);
      setProductResultsOffset(0);
      setProductResultsHasMore(false);
      setProductSearchLoading(false);
      setProductSearchError(false);
      return;
    }

    let cancelled = false;
    setCatalogPath([]);
    setProductResultsMode('search');
    setProductSearchLoading(true);
    setProductSearchError(false);
    const timeout = window.setTimeout(async () => {
      try {
        const response = await apiFetch(`${API_URL}/api/products/search?tg_id=${tgId}&q=${encodeURIComponent(query)}&limit=30&offset=0`);
        if (!response.ok) throw new Error('Product search failed');
        const result = await response.json();
        const availabilityReliable = booleanValue(result.availabilityReliable, true);
        if (!cancelled) {
          setProductSearchResults(Array.isArray(result.products)
            ? result.products.map((item: any) => normalizeProduct(item, availabilityReliable))
            : []);
          setProductResultsOffset(numberValue(result.nextOffset));
          setProductResultsHasMore(booleanValue(result.hasMore));
        }
      } catch (error) {
        console.error('[Mini App] Product search failed:', error);
        if (!cancelled) {
          setProductSearchResults([]);
          setProductSearchError(true);
        }
      } finally {
        if (!cancelled) setProductSearchLoading(false);
      }
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [productSearchOpen, productSearch, tgId]);

  const connectSilpo = () => {
    if (!tgId) {
      showToast('Відкрийте застосунок через Telegram');
      return;
    }
    const initData = telegramInitData();
    if (!initData) {
      showToast('Telegram не передав підпис. Закрийте й відкрийте Mini App знову');
      return;
    }
    window.localStorage.setItem(TG_ID_STORAGE_KEY, String(tgId));
    window.location.assign(`${API_URL}/auth/start?tg_id=${tgId}&init_data=${encodeURIComponent(initData)}`);
  };

  const logout = async () => {
    setProfileMenuOpen(false);
    try {
      await apiFetch(`${API_URL}/api/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tg_id: tgId }),
      });
      setIsAuthenticated(false);
      setUserProfile(null);
      setFavorites([]);
      setLastUpdated('');
      showToast('Акаунт відʼєднано');
    } catch {
      showToast('Не вдалося відʼєднати акаунт');
    }
  };

  const openExternalUrl = (url: string) => {
    setProfileMenuOpen(false);
    const telegram = (window as any).Telegram?.WebApp;
    if (telegram?.openLink) {
      telegram.openLink(url);
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const openSilpoDestination = (webUrl: string, appUrl = SILPO_APP_LINK) => {
    const telegram = (window as any).Telegram?.WebApp;
    const platform = String(telegram?.platform || '').toLowerCase();
    const isMobile = platform.includes('android') || platform === 'ios'
      || /android|iphone|ipad|ipod/i.test(window.navigator.userAgent);
    openExternalUrl(isMobile ? appUrl : webUrl);
  };

  const openSilpoAccount = () => openSilpoDestination(SILPO_ACCOUNT_URL);
  const openSilpoBasket = () => openSilpoDestination(SILPO_BASKET_URL, SILPO_BASKET_APP_LINK);

  const openFavorites = () => {
    setActiveTab('favorites');
    setProfileMenuOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const openSettings = () => {
    setProfileMenuOpen(false);
    setActiveTab('settings');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const saveOnboarding = async (draft: Settings) => {
    setSavingOnboarding(true);
    try {
      const payload = { ...draft, onboarding_completed: true };
      const response = await apiFetch(`${API_URL}/api/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tg_id: tgId, ...payload }),
      });
      if (!response.ok) throw new Error('Onboarding save failed');
      setSettings(payload);
      setOnboardingDraft(payload);
      showToast(Object.values(draft).some(Boolean)
        ? 'Готово — сповіщення приходитимуть у чат із ботом'
        : 'Сповіщення вимкнені. Їх можна увімкнути в налаштуваннях');
    } catch (error) {
      console.error('[Mini App] Failed to save onboarding:', error);
      showToast('Не вдалося зберегти вибір');
    } finally {
      setSavingOnboarding(false);
    }
  };

  const openStorePicker = async () => {
    setStorePickerOpen(true);
    setStoreSearch('');
    setStoreSearchResults([]);
    setStoreLoading(true);
    try {
      const response = await apiFetch(`${API_URL}/api/stores/options?tg_id=${tgId}`);
      if (!response.ok) throw new Error('Store options failed');
      setStoreOptions(await response.json());
    } catch (error) {
      console.error('[Mini App] Failed to load store options:', error);
      showToast('Не вдалося завантажити магазини');
    } finally {
      setStoreLoading(false);
    }
  };

  const selectStore = async (store: StoreOption) => {
    setStoreLoading(true);
    try {
      const response = await apiFetch(`${API_URL}/api/stores/select`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tg_id: tgId, branchId: store.branchId, deliveryType: store.deliveryType }),
      });
      if (!response.ok) throw new Error('Store selection failed');
      setStorePickerOpen(false);
      setProductSearchOpen(false);
      setStoreOptions(null);
      setActiveTab('favorites');
      showToast('Магазин змінено — ціни перераховуються');
      await loadData();
    } catch (error) {
      console.error('[Mini App] Failed to select store:', error);
      showToast('Не вдалося змінити магазин');
    } finally {
      setStoreLoading(false);
    }
  };

  const openProductSearch = async () => {
    setProductSearch('');
    setProductSearchResults([]);
    setProductSearchError(false);
    setCatalogPath([]);
    setProductResultsMode(null);
    setProductResultsOffset(0);
    setProductResultsHasMore(false);
    setProductSearchOpen(true);
    if (catalogCategories.length) return;

    setCatalogLoading(true);
    setCatalogError(false);
    try {
      const response = await apiFetch(`${API_URL}/api/catalog/categories?tg_id=${tgId}`);
      if (!response.ok) throw new Error('Category catalog failed');
      const result = await response.json();
      setCatalogCategories(Array.isArray(result.categories) ? result.categories : []);
    } catch (error) {
      console.error('[Mini App] Category catalog failed:', error);
      setCatalogError(true);
    } finally {
      setCatalogLoading(false);
    }
  };

  const loadCategoryProducts = async (category: CatalogCategory, append = false) => {
    const offset = append ? productResultsOffset : 0;
    setProductResultsMode('category');
    setProductSearchLoading(true);
    setProductSearchError(false);
    try {
      const params = new URLSearchParams({
        tg_id: String(tgId),
        category_id: category.id,
        category_slug: category.slug,
        category_name: category.name,
        limit: '30',
        offset: String(offset),
      });
      const response = await apiFetch(`${API_URL}/api/catalog/products?${params}`);
      if (!response.ok) throw new Error('Category products failed');
      const result = await response.json();
      const availabilityReliable = booleanValue(result.availabilityReliable, true);
      const products = Array.isArray(result.products)
        ? result.products.map((item: any) => normalizeProduct(item, availabilityReliable))
        : [];
      setProductSearchResults(current => append
        ? [...current, ...products.filter((product: Product) => !current.some(item => item.product_id === product.product_id))]
        : products);
      setProductResultsOffset(numberValue(result.nextOffset));
      setProductResultsHasMore(booleanValue(result.hasMore));
    } catch (error) {
      console.error('[Mini App] Category products failed:', error);
      if (!append) setProductSearchResults([]);
      setProductSearchError(true);
    } finally {
      setProductSearchLoading(false);
    }
  };

  const openCatalogCategory = (category: CatalogCategory) => {
    setProductSearch('');
    setProductSearchResults([]);
    setProductResultsMode(null);
    setProductResultsOffset(0);
    setProductResultsHasMore(false);
    setCatalogPath(path => [...path, category]);
    if (!category.children.length) void loadCategoryProducts(category);
  };

  const goBackCatalogCategory = () => {
    setProductSearchResults([]);
    setProductResultsMode(null);
    setProductResultsOffset(0);
    setProductResultsHasMore(false);
    setCatalogPath(path => path.slice(0, -1));
  };

  const loadMoreProducts = async () => {
    if (productSearchLoading || !productResultsHasMore) return;
    if (productResultsMode === 'category') {
      const category = catalogPath[catalogPath.length - 1];
      if (category) await loadCategoryProducts(category, true);
      return;
    }

    const query = productSearch.trim();
    if (productResultsMode !== 'search' || query.length < 2) return;
    setProductSearchLoading(true);
    try {
      const response = await apiFetch(`${API_URL}/api/products/search?tg_id=${tgId}&q=${encodeURIComponent(query)}&limit=30&offset=${productResultsOffset}`);
      if (!response.ok) throw new Error('More search products failed');
      const result = await response.json();
      const availabilityReliable = booleanValue(result.availabilityReliable, true);
      const products = Array.isArray(result.products)
        ? result.products.map((item: any) => normalizeProduct(item, availabilityReliable))
        : [];
      setProductSearchResults(current => [
        ...current,
        ...products.filter((product: Product) => !current.some(item => item.product_id === product.product_id)),
      ]);
      setProductResultsOffset(numberValue(result.nextOffset));
      setProductResultsHasMore(booleanValue(result.hasMore));
    } catch (error) {
      console.error('[Mini App] More search products failed:', error);
      showToast('Не вдалося завантажити більше товарів');
    } finally {
      setProductSearchLoading(false);
    }
  };

  const refreshFavorites = async (expectedProductId?: string): Promise<boolean> => {
    try {
      const response = await apiFetch(`${API_URL}/api/favorites?tg_id=${tgId}`);
      if (!response.ok) return false;
      const result = await response.json();
      const availabilityReliable = booleanValue(result.availabilityReliable, true);
      const products = Array.isArray(result.favorites)
        ? result.favorites.map((item: any) => normalizeProduct(item, availabilityReliable))
        : [];
      if (expectedProductId && !products.some((item: Product) => item.product_id === expectedProductId)) return false;
      setFavorites(products);
      setAvailabilityBasis(result.availabilityBasis || 'current_slot');
      setLastUpdated(String(result.checkedAt || new Date().toISOString()));
      return true;
    } catch (error) {
      console.warn('[Mini App] Favorites refresh delayed:', error);
      return false;
    }
  };

  const addToFavorites = async (product: Product) => {
    if (!product.external_product_id) {
      showToast('Сільпо не повернув артикул цього товару');
      return;
    }
    const alreadyFavorite = product.is_favorite || favorites.some(item =>
      item.product_id === product.product_id
      || (item.external_product_id && item.external_product_id === product.external_product_id));
    if (alreadyFavorite) return;

    setAddingFavoriteId(product.product_id);
    try {
      const response = await apiFetch(`${API_URL}/api/favorites/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tg_id: tgId,
          product_id: product.product_id,
          externalProductId: product.external_product_id,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.success || !result.synced) throw new Error(result.error || 'Favorite add failed');

      const favoriteProduct = { ...product, is_favorite: true, target_price: 0 };
      setProductSearchResults(items => items.map(item => item.product_id === product.product_id ? favoriteProduct : item));
      setFavorites(items => items.some(item => item.product_id === product.product_id) ? items : [favoriteProduct, ...items]);
      showToast(result.alreadyFavorite
        ? 'Товар уже є в Улюблених Сільпо'
        : 'Додано в Улюблені — синхронізовано із Сільпо');

      void (async () => {
        for (const delay of [700, 1800, 4000]) {
          await new Promise(resolve => window.setTimeout(resolve, delay));
          if (await refreshFavorites(product.product_id)) break;
        }
      })();
    } catch (error) {
      console.error('[Mini App] Failed to add favorite:', error);
      showToast('Не вдалося додати в Улюблені Сільпо');
    } finally {
      setAddingFavoriteId(null);
    }
  };

  const saveTargetPrice = async (product: Product, rawValue: string) => {
    const targetPrice = numberValue(rawValue, -1);
    if (targetPrice < 0) {
      showToast('Введіть коректну ціну');
      return;
    }

    setSavingTargetId(product.product_id);
    try {
      const response = await apiFetch(`${API_URL}/api/favorites/target`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tg_id: tgId,
          product_id: product.product_id,
          target_price: targetPrice,
          name: product.name,
          current_price: product.effective_price,
          old_price: product.old_price,
          added_price: product.added_price,
          image_url: product.image_url,
          has_promo: product.has_promo,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.success) throw new Error(result.error || 'Target save failed');

      setFavorites(items => items.map(item => item.product_id === product.product_id
        ? { ...item, target_price: targetPrice }
        : item));
      setModalProduct(null);
      showToast(result.notificationSent
        ? 'Бажана ціна вже досягнута — сповіщення надіслано'
        : targetPrice > 0 ? 'Бажану ціну збережено' : 'Бажану ціну скинуто');
    } catch (error) {
      console.error('[Mini App] Failed to save target:', error);
      showToast('Не вдалося зберегти бажану ціну');
    } finally {
      setSavingTargetId(null);
    }
  };

  const toggleSetting = async (key: SettingKey) => {
    const nextValue = !settings[key];
    setSettings(previous => ({ ...previous, [key]: nextValue }));
    try {
      const response = await apiFetch(`${API_URL}/api/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tg_id: tgId, [key]: nextValue }),
      });
      if (!response.ok) throw new Error('Setting update failed');
      showToast(nextValue ? 'Сповіщення увімкнено' : 'Сповіщення вимкнено');
    } catch (error) {
      console.error('[Mini App] Failed to update setting:', error);
      setSettings(previous => ({ ...previous, [key]: !nextValue }));
      showToast('Не вдалося зберегти налаштування');
    }
  };

  const addToCart = async (product: Product) => {
    if (!userProfile?.branchId) {
      showToast('Спочатку оберіть магазин у Сільпо');
      return;
    }
    setBusyProductId(product.product_id);
    try {
      const response = await apiFetch(`${API_URL}/api/cart/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tg_id: tgId,
          product_id: product.product_id,
          slug: product.slug,
          companyId: product.company_id,
          branchId: userProfile.branchId,
          deliveryType: userProfile.deliveryType,
          quantity: product.special_price_count > 1 ? product.special_price_count : 1,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.success) throw new Error(result.error || 'Cart update failed');
      showToast(product.special_price_count > 1
        ? `Додано ${product.special_price_count} шт — умову акції виконано`
        : 'Додано в кошик');
    } catch (error) {
      console.error('[Mini App] Failed to add to cart:', error);
      showToast('Не вдалося додати в кошик');
    } finally {
      setBusyProductId(null);
    }
  };

  const removeFromFavorites = async (product: Product) => {
    const previous = favorites;
    setFavorites(items => items.filter(item => item.product_id !== product.product_id));
    setBusyProductId(product.product_id);
    try {
      const response = await apiFetch(`${API_URL}/api/favorites/remove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tg_id: tgId,
          product_id: product.product_id,
          externalProductId: product.external_product_id,
          slug: product.slug,
        }),
      });
      if (!response.ok) throw new Error('Favorite removal failed');
      showToast('Товар прибрано з Улюблених');
    } catch (error) {
      console.error('[Mini App] Failed to remove favorite:', error);
      setFavorites(previous);
      showToast('Не вдалося видалити товар');
    } finally {
      setBusyProductId(null);
    }
  };

  const targetHint = useMemo(() => {
    if (!modalProduct) return 'Сповіщення прийде, коли поточна ціна буде не більшою за цю суму.';
    if (!targetDraft) return modalProduct.special_price_count > 1
      ? `Враховуємо акційну ціну за одиницю. Умову «від ${modalProduct.special_price_count} шт» завжди вкажемо у сповіщенні.`
      : 'Сповіщення прийде, коли поточна ціна буде не більшою за цю суму.';
    const target = numberValue(targetDraft);
    return modalProduct.effective_price <= target
      ? `Ціна вже відповідає бажаній — перевіримо її одразу${modalProduct.special_price_count > 1 ? ` та вкажемо умову «від ${modalProduct.special_price_count} шт»` : ''}.`
      : 'Бот перевірятиме ціну автоматично та напише, коли вона стане бажаною.';
  }, [modalProduct, targetDraft]);

  const dealBasket = useMemo(() => {
    const minimum = userProfile?.orderMinimum || 0;
    const items = favorites
      .filter(product => product.available !== false && product.company_id && (
        product.has_promo
        || discountPercent(product.effective_price, product.reference_price) >= 10
        || (product.target_price > 0 && product.effective_price <= product.target_price)
      ))
      .map(product => ({
        product,
        quantity: product.special_price_count > 1 ? product.special_price_count : 1,
      }));
    const total = items.reduce((sum, item) => sum + item.product.effective_price * item.quantity, 0);
    return { minimum, items, total, ready: minimum > 0 && items.length > 0 && total >= minimum };
  }, [favorites, userProfile?.orderMinimum]);

  const favoriteInsights = useMemo(() => {
    const targetCount = favorites.filter(product => product.target_price > 0).length;
    const promoCount = favorites.filter(product => product.has_promo).length;
    const unavailableCount = favorites.filter(product => product.available === false).length;
    const parts = [
      `${targetCount} ${targetCount === 1 ? 'бажана ціна' : 'бажаних цін'}`,
      `${promoCount} ${promoCount === 1 ? 'товар з акцією' : 'товарів з акціями'}`,
    ];
    if (unavailableCount > 0) parts.push(`${unavailableCount} зараз немає`);
    return parts.join(' · ');
  }, [favorites]);

  const addDealBasket = async () => {
    if (!dealBasket.ready) return;
    setAddingDealBasket(true);
    try {
      const response = await apiFetch(`${API_URL}/api/cart/add-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tg_id: tgId,
          products: dealBasket.items.map(item => ({
            product_id: item.product.product_id,
            companyId: item.product.company_id,
            quantity: item.quantity,
          })),
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.success) throw new Error(result.error || 'Deal basket failed');
      showToast(`Додано ${result.added} вигідних товарів у кошик`);
    } catch (error) {
      console.error('[Mini App] Failed to add deal basket:', error);
      showToast('Не вдалося додати добірку в кошик');
    } finally {
      setAddingDealBasket(false);
    }
  };

  const openTargetModal = (product: Product) => {
    setModalProduct(product);
    setTargetDraft(product.target_price > 0 ? String(product.target_price) : '');
  };

  const activeCatalogCategory = catalogPath[catalogPath.length - 1];
  const visibleCatalogCategories = activeCatalogCategory?.children || catalogCategories;

  if (isLoading) {
    return (
      <div className="loading-screen">
        <span className="loading-logo-wrap"><img src={SILPO_LOADER_LOGO_URL} alt="Сільпо" /></span>
        <p>Завантажуємо улюблені товари<span className="loading-dots" aria-hidden="true"><span>.</span><span>.</span><span>.</span></span></p>
      </div>
    );
  }

  return (
    <div
      className="app-shell"
      onTouchStart={handlePullStart}
      onTouchMove={handlePullMove}
      onTouchEnd={handlePullEnd}
      onTouchCancel={handlePullEnd}
    >
      {toast && <div className="toast" role="status">{toast}</div>}

      <header className="app-header">
        <button className="brand-lockup brand-home-button" type="button" onClick={() => void refreshPage()} aria-label="Оновити улюблені товари">
          <div className="brand-mark">
            <img className="brand-logo" src={SILPO_HEADER_LOGO_URL} alt="Сільпо" />
          </div>
          <div>
            <h1>Цінолов</h1>
          </div>
        </button>
        {isAuthenticated && userProfile ? (
          <div className="header-actions">
            <button className="header-settings-button" type="button" onClick={openSettings} aria-label="Налаштування сповіщень">
              <SettingsIcon size={19} />
            </button>
            <div className="profile-menu-wrap">
              <button
                className="profile-trigger"
                type="button"
                aria-label="Відкрити меню профілю"
                aria-haspopup="menu"
                aria-expanded={profileMenuOpen}
                onClick={() => setProfileMenuOpen(open => !open)}
              >
                <span className="profile-avatar" aria-hidden="true">
                  {userProfile.avatar
                    ? <img src={userProfile.avatar} alt="" />
                    : <UserRound size={20} />}
                </span>
                <ChevronDown className={profileMenuOpen ? 'profile-chevron open' : 'profile-chevron'} size={16} />
              </button>
              {profileMenuOpen && (
                <>
                  <button className="profile-menu-backdrop" type="button" onClick={() => setProfileMenuOpen(false)} aria-label="Закрити меню профілю" />
                  <div className="profile-menu" role="menu">
                    <button type="button" role="menuitem" onClick={openSilpoAccount}><Store size={18} /><span>Перейти в Сільпо</span></button>
                    <button type="button" role="menuitem" onClick={openSilpoBasket}><ShoppingCart size={18} /><span>Мій кошик</span></button>
                    <span className="profile-menu-divider" />
                    <button className="profile-menu-danger" type="button" role="menuitem" onClick={() => void logout()}><LogOut size={18} /><span>Вийти</span></button>
                  </div>
                </>
              )}
            </div>
          </div>
        ) : null}
      </header>

      {isAuthenticated && userProfile && (
        <button className="store-bar" type="button" onClick={() => void openStorePicker()}>
          <span className="store-bar-icon"><MapPin size={19} /></span>
          <span className="store-bar-copy">
            <small>ЦІНИ ДЛЯ ВИБРАНОГО МАГАЗИНУ</small>
            <strong>{userProfile.storeLabel}</strong>
            <span>
              {deliveryLabel(userProfile.deliveryType)} · {availabilityBasis === 'next_day_reference'
                ? 'наявність на найближчий денний слот'
                : availabilityBasis === 'unverified'
                  ? 'наявність перевіримо у робочий час'
                  : lastUpdated ? updatedLabel(lastUpdated) : 'оновлено щойно'}
            </span>
          </span>
          <ChevronDown size={18} />
        </button>
      )}

      <div className={pullDistance > 0 || isRefreshing ? 'pull-refresh visible' : 'pull-refresh'} style={{ height: isRefreshing ? 34 : pullDistance }} aria-hidden="true">
        <span className={isRefreshing ? 'refresh-indicator spinning' : 'refresh-indicator'}>↻</span>
        <small>{isRefreshing ? 'Оновлюємо…' : pullDistance >= 48 ? 'Відпускайте' : 'Потягніть для оновлення'}</small>
      </div>

      {!isAuthenticated && (
        <main className="connect-screen">
          <button className="connect-card" onClick={connectSilpo}>
            <span className="connect-icon"><Link2 size={22} /></span>
            <span className="connect-copy"><strong>{tgId ? 'Підключити акаунт Сільпо' : 'Відкрийте через Telegram'}</strong><small>{tgId ? 'Щоб бачити улюблені товари та актуальні ціни' : 'Ідентифікатор Telegram не знайдено'}</small></span>
          </button>
        </main>
      )}

      {isAuthenticated && <main className="main-content">
        {activeTab === 'favorites' ? (
          <section className="page-section">
            <div className="section-heading">
              <div>
                <h2>Улюблені товари</h2>
                {favorites.length > 0 && <p className="section-subtitle">{favoriteInsights}</p>}
              </div>
              <span className="count-pill">{favorites.length}</span>
            </div>

            {isAuthenticated && (
              <button className="product-search-launcher" type="button" onClick={() => void openProductSearch()}>
                <Search size={20} />
                <span>Пошук товару...</span>
                <span className="product-search-launcher-hint">Знайти й додати</span>
              </button>
            )}

            {favorites.length > 0 ? (
              <div className="products-list">
                {favorites.map(product => {
                  const discount = discountPercent(product.effective_price, product.reference_price);
                  const link = productUrl(product);
                  const isBusy = busyProductId === product.product_id;
                  return (
                    <article className="product-card" key={product.product_id}>
                      <div className="product-media">
                        {product.has_promo && <span className="promo-badge"><Tag size={12} /> АКЦІЯ</span>}
                        {link ? <a href={link} target="_blank" rel="noreferrer"><ProductImage product={product} /></a> : <ProductImage product={product} />}
                      </div>
                      <div className="product-details">
                        <div className="product-topline">
                          <span className={product.available === true && !product.availability_note ? 'availability available' : product.available === null ? 'availability unknown' : 'availability'}>
                            <span className="status-dot" />{product.availability_note || (product.available === true
                              ? 'Є у вибраному магазині'
                              : product.available === null ? 'Наявність уточнюємо' : 'Немає у вибраному магазині')}
                          </span>
                          <button className="icon-button tiny-icon" onClick={() => void removeFromFavorites(product)} disabled={isBusy} aria-label="Видалити з Улюблених">
                            <Heart size={18} fill="currentColor" />
                          </button>
                        </div>
                        {link ? <a className="product-name" href={link} target="_blank" rel="noreferrer">{product.name}</a> : <h3 className="product-name">{product.name}</h3>}
                        {product.displayWeight && <p className="product-meta">{product.displayWeight}</p>}
                        <div className="price-line">
                          <strong>{formatPrice(product.effective_price)}{product.price_unit && <span className="price-unit"> / {product.price_unit}</span>}</strong>
                          {product.special_price_count > 1 && <span className="condition-badge">від {product.special_price_count} шт</span>}
                          {discount > 0 && <span className="discount-badge">−{discount}%</span>}
                          {product.reference_price > product.effective_price && <del>{formatPrice(product.reference_price)}</del>}
                        </div>
                        <button className={`target-button ${product.target_price > 0 ? 'target-set' : ''}`} onClick={() => openTargetModal(product)}>
                          <Sparkles size={15} />
                          <span>{product.target_price > 0 ? `Бажана ціна: ${formatPrice(product.target_price)}` : 'Встановити бажану ціну'}</span>
                        </button>
                        <div className="product-footer">
                          {product.available !== false ? (
                            <button className="cart-button" onClick={() => void addToCart(product)} disabled={isBusy}>
                              {isBusy ? <span className="button-spinner" /> : <><Plus size={18} /><span>{product.special_price_count > 1 ? `${product.special_price_count} шт у кошик` : 'У кошик'}</span></>}
                            </button>
                          ) : <span className="unavailable-note"><Package size={16} /> Немає у вибраному магазині</span>}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="empty-card"><div className="empty-icon"><ShoppingCart size={28} /></div><h3>Улюблених поки немає</h3><p>Знайдіть товар через пошук вище — він додасться одночасно сюди й в Улюблені Сільпо.</p></div>
            )}

            {dealBasket.ready && (
              <div className="deal-basket-card compact-deal-basket">
                <span className="deal-basket-icon"><ShoppingCart size={19} /></span>
                <span className="deal-basket-copy">
                  <strong>Добірка до кошика: {dealBasket.items.length} товарів</strong>
                  <span>{formatPrice(dealBasket.total)} · мінімум замовлення виконано</span>
                </span>
                <button type="button" disabled={addingDealBasket} onClick={() => void addDealBasket()}>
                  {addingDealBasket ? <span className="button-spinner" /> : 'У кошик'}
                </button>
              </div>
            )}
          </section>
        ) : (
          <section className="page-section">
            <div className="settings-heading">
              <button className="icon-button" type="button" onClick={openFavorites} aria-label="Повернутися до товарів"><ArrowLeft size={20} /></button>
              <div><p className="section-kicker">КЕРУВАННЯ</p><h2>Сповіщення</h2></div>
            </div>
            <div className="chat-explainer">
              <span><Send size={21} /></span>
              <div><strong>Усе приходитиме в чат із ботом</strong><p>Не треба перевіряти застосунок вручну. Коли станеться вибрана подія, бот надішле коротке повідомлення з товаром, ціною та магазином.</p></div>
            </div>
            <div className="settings-list">
              {SETTING_DEFINITIONS.map(item => {
                const SettingIcon = item.icon;
                return (
                  <label className="setting-row" key={item.key}>
                    <span className="setting-emoji"><SettingIcon size={20} /></span>
                    <span className="setting-copy"><strong>{item.title}</strong><small>{item.description}</small></span>
                    <span className={`toggle ${settings[item.key] ? 'on' : ''}`}><input type="checkbox" checked={settings[item.key]} onChange={() => void toggleSetting(item.key)} /><span className="toggle-knob" /></span>
                  </label>
                );
              })}
            </div>
            <div className="info-card"><ShieldCheck size={18} /><p><strong>Захист від хибних сповіщень.</strong> Наявність підтверджується двома перевірками, дрібні коливання ціни ігноруються, а після зміни магазину порівняння починається заново. Бажана ціна перевіряється одразу.</p></div>
          </section>
        )}
      </main>}

      {isAuthenticated && userProfile && !settings.onboarding_completed && (
        <div className="onboarding-backdrop">
          <section className="onboarding-card" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
            {onboardingStep === 0 ? (
              <>
                <div className="onboarding-hero-icon"><Send size={30} /></div>
                <p className="section-kicker">ПЕРШИЙ ЗАПУСК</p>
                <h2 id="onboarding-title">Лише потрібні сповіщення</h2>
                <p className="onboarding-copy">Цінолов не надсилатиме нічого, доки ви самі не виберете події. Повідомлення приходитимуть у цей Telegram-чат, навіть коли Mini App закритий.</p>
                <div className="onboarding-preview">
                  <Bell size={19} />
                  <span><strong>Бот напише коротко й по справі</strong><small>Товар · нова ціна · умова акції · вибраний магазин</small></span>
                </div>
                <button className="primary-button" type="button" onClick={() => setOnboardingStep(1)}>Вибрати сповіщення</button>
                <button className="onboarding-skip" type="button" disabled={savingOnboarding} onClick={() => void saveOnboarding(DEFAULT_SETTINGS)}>Поки без сповіщень</button>
              </>
            ) : (
              <>
                <button className="onboarding-back" type="button" onClick={() => setOnboardingStep(0)}><ArrowLeft size={18} /> Назад</button>
                <p className="section-kicker">ВАШ ВИБІР</p>
                <h2 id="onboarding-title">Про що повідомляти?</h2>
                <p className="onboarding-copy compact">Ми вже позначили спокійний рекомендований набір. Решту можна змінити будь-коли через ⚙️ біля аватара.</p>
                <div className="onboarding-options">
                  {SETTING_DEFINITIONS.map(item => {
                    const checked = onboardingDraft[item.key];
                    const recommended = ['price_target', 'price_drop', 'promo_personal'].includes(item.key);
                    const SettingIcon = item.icon;
                    return (
                      <button
                        className={checked ? 'onboarding-option selected' : 'onboarding-option'}
                        type="button"
                        key={item.key}
                        onClick={() => setOnboardingDraft(previous => ({ ...previous, [item.key]: !previous[item.key] }))}
                      >
                        <span className="setting-emoji"><SettingIcon size={20} /></span>
                        <span><strong>{item.title}{recommended && <small>Рекомендовано</small>}</strong><em>{item.description}</em></span>
                        <i>{checked && <Check size={16} />}</i>
                      </button>
                    );
                  })}
                </div>
                <button className="primary-button" type="button" disabled={savingOnboarding} onClick={() => void saveOnboarding(onboardingDraft)}>
                  {savingOnboarding ? <span className="button-spinner light" /> : 'Увімкнути вибране'}
                </button>
                <button className="onboarding-skip" type="button" disabled={savingOnboarding} onClick={() => void saveOnboarding(DEFAULT_SETTINGS)}>Не надсилати нічого</button>
              </>
            )}
          </section>
        </div>
      )}

      {productSearchOpen && (
        <div className="modal-backdrop product-search-backdrop" role="presentation" onMouseDown={() => setProductSearchOpen(false)}>
          <section className="product-search-sheet" data-swipe-sheet role="dialog" aria-modal="true" aria-labelledby="product-search-title" onMouseDown={event => event.stopPropagation()}>
            <SwipeHandle onClose={() => setProductSearchOpen(false)} />
            <div className="sheet-header">
              <div><p className="section-kicker">СІЛЬПО</p><h2 id="product-search-title">Додати улюблений товар</h2></div>
              <button className="icon-button" type="button" onClick={() => setProductSearchOpen(false)} aria-label="Закрити"><X size={20} /></button>
            </div>
            <p className="product-search-context"><MapPin size={14} /><span>Ціна й наявність для <strong>{userProfile?.storeLabel}</strong></span></p>
            <label className="product-search-input">
              <Search size={19} />
              <input
                value={productSearch}
                onChange={event => setProductSearch(event.target.value)}
                placeholder="Пошук товару..."
              />
              {productSearch && <button type="button" onClick={() => setProductSearch('')} aria-label="Очистити пошук"><X size={16} /></button>}
            </label>

            <div className="product-search-scroll">
              {catalogPath.length > 0 && productSearch.trim().length === 0 && (
                <div className="catalog-navigation">
                  <button type="button" onClick={goBackCatalogCategory} aria-label="Повернутися до попередньої категорії">
                    <ArrowLeft size={18} />
                  </button>
                  <div>
                    <small>{catalogPath.slice(0, -1).map(category => category.name).join(' · ') || 'Каталог'}</small>
                    <strong>{activeCatalogCategory?.name}</strong>
                  </div>
                </div>
              )}

              {productResultsMode === null && productSearch.trim().length === 0 ? (
                catalogLoading ? (
                  <div className="product-search-state"><span className="loading-spinner" />Завантажуємо каталог Сільпо…</div>
                ) : catalogError ? (
                  <div className="product-search-empty error">
                    <strong>Категорії тимчасово недоступні</strong>
                    <p>Пошук за назвою продовжує працювати.</p>
                  </div>
                ) : (
                  <div className="catalog-browser">
                    {!activeCatalogCategory && (
                      <div className="catalog-intro">
                        <strong>Категорії товарів</strong>
                        <p>Обирайте категорію та підкатегорію або скористайтеся пошуком.</p>
                      </div>
                    )}
                    {activeCatalogCategory && (
                      <button className="catalog-show-all" type="button" onClick={() => void loadCategoryProducts(activeCatalogCategory)}>
                        <span>
                          <strong>Усі товари категорії</strong>
                          {activeCatalogCategory.productCount !== null && <small>{activeCatalogCategory.productCount} товарів</small>}
                        </span>
                        <ChevronRight size={18} />
                      </button>
                    )}
                    <div className="catalog-category-list">
                      {visibleCatalogCategories.map(category => (
                        <button type="button" key={category.id} onClick={() => openCatalogCategory(category)}>
                          <span>
                            <strong>{category.name}</strong>
                            <small>{category.children.length > 0
                              ? `${category.children.length} підкатегорій`
                              : category.productCount !== null ? `${category.productCount} товарів` : 'Переглянути товари'}</small>
                          </span>
                          <ChevronRight size={18} />
                        </button>
                      ))}
                    </div>
                    {visibleCatalogCategories.length === 0 && (
                      <div className="product-search-empty">
                        <strong>У цій категорії немає підкатегорій</strong>
                        <p>Натисніть «Усі товари категорії», щоб переглянути асортимент.</p>
                      </div>
                    )}
                  </div>
                )
              ) : productResultsMode === null ? (
                <div className="product-search-empty compact">
                  <span><Search size={25} /></span>
                  <strong>Введіть ще один символ</strong>
                  <p>Пошук починається від двох символів.</p>
                </div>
              ) : productSearchLoading && productSearchResults.length === 0 ? (
                <div className="product-search-state"><span className="loading-spinner" />Шукаємо в каталозі Сільпо…</div>
              ) : productSearchError ? (
                <div className="product-search-empty error">
                  <strong>Пошук тимчасово недоступний</strong>
                  <p>Перевірте з’єднання або спробуйте інший запит.</p>
                </div>
              ) : productSearchResults.length === 0 ? (
                <div className="product-search-empty">
                  <strong>Нічого не знайшли</strong>
                  <p>Спробуйте коротшу назву, бренд або точний артикул товару.</p>
                </div>
              ) : (
                <>
                  <div className="search-results-list">
                    {productSearchResults.map(product => {
                      const isFavorite = product.is_favorite || favorites.some(item =>
                        item.product_id === product.product_id
                        || (item.external_product_id && item.external_product_id === product.external_product_id));
                      const isAdding = addingFavoriteId === product.product_id;
                      return (
                        <article className="search-result-card" key={product.product_id}>
                          <div className="search-result-image"><ProductImage product={product} /></div>
                          <div className="search-result-copy">
                            <span className={product.available === true && !product.availability_note ? 'availability available' : product.available === null ? 'availability unknown' : 'availability'}>
                              <span className="status-dot" />{product.availability_note || (product.available === true ? 'Є в магазині' : product.available === null ? 'Наявність уточнюємо' : 'Зараз немає')}
                            </span>
                            <strong>{product.name}</strong>
                            {product.displayWeight && <small>{product.displayWeight}</small>}
                            <div className="search-result-price">
                              <b>{formatPrice(product.effective_price)}{product.price_unit && <span className="price-unit"> / {product.price_unit}</span>}</b>
                              {product.special_price_count > 1 && <span>від {product.special_price_count} шт</span>}
                              {product.reference_price > product.effective_price && <del>{formatPrice(product.reference_price)}</del>}
                            </div>
                          </div>
                          <button
                            className={isFavorite ? 'search-add-button added' : 'search-add-button'}
                            type="button"
                            disabled={Boolean(isFavorite || isAdding)}
                            onClick={() => void addToFavorites(product)}
                            aria-label={isFavorite ? 'Уже в Улюблених' : 'Додати в Улюблені'}
                          >
                            {isAdding ? <span className="button-spinner" /> : isFavorite ? <Check size={18} /> : <Plus size={19} />}
                            <span>{isFavorite ? 'Додано' : 'Додати'}</span>
                          </button>
                        </article>
                      );
                    })}
                  </div>
                  {productResultsHasMore && (
                    <button className="search-load-more" type="button" disabled={productSearchLoading} onClick={() => void loadMoreProducts()}>
                      {productSearchLoading ? <><span className="loading-spinner" />Завантажуємо…</> : 'Показати ще товари'}
                    </button>
                  )}
                </>
              )}
            </div>
          </section>
        </div>
      )}

      {storePickerOpen && (
        <div className="modal-backdrop store-picker-backdrop" role="presentation" onMouseDown={() => setStorePickerOpen(false)}>
          <section className="store-sheet" data-swipe-sheet role="dialog" aria-modal="true" aria-labelledby="store-picker-title" onMouseDown={event => event.stopPropagation()}>
            <SwipeHandle onClose={() => setStorePickerOpen(false)} />
            <div className="sheet-header">
              <div><p className="section-kicker">КОНТЕКСТ ЦІН</p><h2 id="store-picker-title">Вибрати магазин</h2></div>
              <button className="icon-button" type="button" onClick={() => setStorePickerOpen(false)} aria-label="Закрити"><X size={20} /></button>
            </div>
            <p className="store-sheet-hint">Ціни, наявність і сповіщення перерахуються саме для цього магазину. Ваш кошик Сільпо від вибору не зміниться.</p>
            <label className="store-search">
              <Search size={18} />
              <input value={storeSearch} onChange={event => setStoreSearch(event.target.value)} placeholder="Місто, вулиця або адреса магазину" />
            </label>
            <div className="store-options-scroll">
              {storeLoading && !storeOptions ? <div className="store-loading"><span className="loading-spinner" />Завантажуємо магазини…</div> : null}
              {storeSearch.trim().length >= 2 ? (
                <StoreGroup title="Результати пошуку" stores={storeSearchResults} current={storeOptions?.current} disabled={storeLoading} onSelect={selectStore} empty="Нічого не знайдено" />
              ) : storeOptions ? (
                <>
                  <StoreGroup title="Магазин з акаунта Сільпо" stores={[storeOptions.accountDefault]} current={storeOptions.current} disabled={storeLoading} onSelect={selectStore} />
                  <StoreGroup title="З останніх замовлень" stores={storeOptions.recent} current={storeOptions.current} disabled={storeLoading} onSelect={selectStore} empty="Недавніх магазинів немає" />
                  <StoreGroup title="Мої адреси" stores={storeOptions.addresses} current={storeOptions.current} disabled={storeLoading} onSelect={selectStore} empty="Збережених адрес немає" />
                </>
              ) : null}
            </div>
          </section>
        </div>
      )}

      {modalProduct && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setModalProduct(null)}>
          <section className="target-sheet" data-swipe-sheet role="dialog" aria-modal="true" aria-labelledby="target-title" onMouseDown={event => event.stopPropagation()}>
            <SwipeHandle onClose={() => setModalProduct(null)} />
            <div className="sheet-header"><div><p className="section-kicker">ЦІНОВИЙ КОНТРОЛЬ</p><h2 id="target-title">Бажана ціна</h2></div><button className="icon-button" onClick={() => setModalProduct(null)} aria-label="Закрити"><X size={20} /></button></div>
            <p className="sheet-product">{modalProduct.name}</p>
            <label className="input-label" htmlFor="target-price">Нагадати, коли ціна буде</label>
            <div className="price-input-wrap"><input id="target-price" type="number" min="0" step="0.01" inputMode="decimal" autoFocus value={targetDraft} onChange={event => setTargetDraft(event.target.value)} placeholder="0" /><span>₴{modalProduct.price_unit ? ` / ${modalProduct.price_unit}` : ''}</span></div>
            <p className="sheet-hint">{targetHint}</p>
            <button className="primary-button" disabled={savingTargetId === modalProduct.product_id} onClick={() => void saveTargetPrice(modalProduct, targetDraft)}>{savingTargetId === modalProduct.product_id ? <span className="button-spinner light" /> : 'Зберегти бажану ціну'}</button>
            {modalProduct.target_price > 0 && <button className="remove-target-button" onClick={() => void saveTargetPrice(modalProduct, '0')}>Скинути бажану ціну</button>}
          </section>
        </div>
      )}
    </div>
  );
}

function ProductImage({ product }: { product: Product }) {
  const [failed, setFailed] = useState(false);
  if (!product.image_url || failed) return <div className="product-image-fallback">{product.name.slice(0, 1).toUpperCase()}</div>;
  return <img className="product-image" src={product.image_url} alt={product.name} onError={() => setFailed(true)} />;
}

function StoreGroup({
  title,
  stores,
  current,
  disabled,
  onSelect,
  empty,
}: {
  title: string;
  stores: StoreOption[];
  current?: StoreOption;
  disabled: boolean;
  onSelect: (store: StoreOption) => Promise<void>;
  empty?: string;
}) {
  return (
    <div className="store-group">
      <p>{title}</p>
      {stores.length ? stores.map((store, index) => {
        const selected = current?.branchId === store.branchId && current?.deliveryType === store.deliveryType;
        return (
          <button type="button" key={`${store.branchId}-${store.deliveryType}-${index}`} disabled={disabled} onClick={() => void onSelect(store)}>
            <span className="store-option-icon"><Store size={18} /></span>
            <span><strong>{store.storeLabel}</strong><small>{store.addressLabel || deliveryLabel(store.deliveryType)}</small></span>
            {selected ? <i><Check size={16} /></i> : <ChevronRight size={17} />}
          </button>
        );
      }) : <span className="store-empty">{empty}</span>}
    </div>
  );
}

export default App;
