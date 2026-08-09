import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bell,
  ChevronDown,
  ChevronRight,
  Heart,
  Link2,
  LogOut,
  MapPin,
  Package,
  Plus,
  Settings as SettingsIcon,
  ShoppingCart,
  ShieldCheck,
  Sparkles,
  Tag,
  UserRound,
  X,
} from 'lucide-react';

const API_URL = '';
const SILPO_LOGO_URL = 'https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/eb/99/68/eb9968ce-3c3b-be25-ecb3-4903ba0b7b7d/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/512x512bb.jpg';
const SILPO_ACCOUNT_URL = 'https://my.silpo.ua/';
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
  name: string;
  current_price: number;
  old_price: number;
  added_price: number;
  image_url: string;
  has_promo: boolean;
  target_price: number;
  slug?: string;
  available: boolean;
  stock: number;
  displayWeight?: string;
  company_id?: string;
  special_price: number;
  special_price_count: number;
  effective_price: number;
  reference_price: number;
}

type Settings = Record<SettingKey, boolean>;

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
}

const DEFAULT_SETTINGS: Settings = {
  price_drop: true,
  price_target: true,
  promo_new: true,
  promo_personal: true,
  in_stock: true,
  delivery_available: true,
  alt_cheaper: true,
  smart_buy: true,
};

const SETTING_DEFINITIONS: Array<{
  key: SettingKey;
  icon: string;
  title: string;
  description: string;
}> = [
  { key: 'price_target', icon: '🎯', title: 'Бажана ціна', description: 'Коли товар коштує не дорожче за бажану ціну' },
  { key: 'price_drop', icon: '📉', title: 'Помітне зниження ціни', description: 'Від 2% і щонайменше 2 ₴ — без копійчаного шуму' },
  { key: 'promo_new', icon: '🔥', title: 'Нові акції', description: 'Коли на товар зʼявилася акція' },
  { key: 'promo_personal', icon: '⭐', title: 'Нові персональні пропозиції', description: 'Коли в акаунті Сільпо з’являється нова пропозиція' },
  { key: 'in_stock', icon: '📦', title: 'Повернення в наявність', description: 'Коли недоступний товар знову можна купити' },
  { key: 'delivery_available', icon: '🚚', title: 'Доступність доставки', description: 'Коли товар знову доступний для доставки' },
  { key: 'alt_cheaper', icon: '💡', title: 'Точні дешевші варіанти', description: 'Лише той самий бренд, тип і сумісна фасовка' },
  { key: 'smart_buy', icon: '🧠', title: 'Велика знижка', description: 'Коли ціна щонайменше на 20% нижча за звичайну' },
];

function numberValue(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function booleanValue(value: unknown, fallback = false): boolean {
  if (value === undefined || value === null) return fallback;
  return value === true || value === 1 || value === '1' || value === 'true';
}

function normalizeProduct(item: any): Product {
  const currentPrice = numberValue(item.price ?? item.current_price ?? item.currentPrice ?? item.salePrice);
  const oldPrice = numberValue(item.oldPrice ?? item.old_price ?? item.originalPrice, currentPrice);
  const id = String(item.id ?? item.product_id ?? item.productId ?? item.slug ?? '');
  const specialPrices = item.specialPrices;
  const hasExplicitPromo = item.hasPromo ?? item.has_promo ?? item.isPromo;
  const specialOffer = Array.isArray(specialPrices)
    ? specialPrices
      .map((offer: any) => ({ price: numberValue(offer?.price), count: numberValue(offer?.count) }))
      .filter((offer: { price: number }) => offer.price > 0 && offer.price < currentPrice)
      .sort((left: { price: number }, right: { price: number }) => left.price - right.price)[0]
    : undefined;
  const specialPrice = specialOffer?.price || 0;
  const effectivePrice = specialPrice || currentPrice;
  const referencePrice = oldPrice > effectivePrice ? oldPrice : specialPrice ? currentPrice : currentPrice;

  return {
    product_id: id,
    name: String(item.title ?? item.name ?? item.productName ?? 'Товар'),
    current_price: currentPrice,
    old_price: oldPrice,
    added_price: numberValue(item.added_price ?? item.addedPrice, oldPrice),
    image_url: String(item.image ?? item.imageUrl ?? item.image_url ?? ''),
    has_promo: booleanValue(hasExplicitPromo) || Boolean(specialPrice) || oldPrice > currentPrice,
    target_price: numberValue(item.target_price ?? item.targetPrice),
    slug: item.slug ? String(item.slug) : undefined,
    available: item.available !== undefined
      ? booleanValue(item.available)
      : item.in_stock !== undefined
        ? booleanValue(item.in_stock)
        : item.stock !== undefined
          ? numberValue(item.stock) > 0
          : true,
    stock: numberValue(item.stock, 1),
    displayWeight: item.displayWeight ?? item.display_weight ?? item.unit ?? undefined,
    company_id: item.companyId ? String(item.companyId) : undefined,
    special_price: specialPrice,
    special_price_count: specialOffer?.count || 0,
    effective_price: effectivePrice,
    reference_price: referencePrice,
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

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2600);
  }, []);

  const loadData = useCallback(async () => {
    if (!tgId) {
      setIsAuthenticated(false);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
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
      };
      const savedSettings = await settingsResponse.json();
      setUserProfile(normalizedProfile);
      setSettings({ ...DEFAULT_SETTINGS, ...savedSettings });

      const storeStorageKey = `${ACTIVE_STORE_STORAGE_KEY}_${tgId}`;
      const previousStore = window.localStorage.getItem(storeStorageKey);
      if (previousStore && previousStore !== normalizedProfile.branchId) {
        window.setTimeout(() => showToast('Магазин змінився — ціни перебазовано без хибних сповіщень'), 150);
      }
      window.localStorage.setItem(storeStorageKey, normalizedProfile.branchId);

      const favoritesResponse = await apiFetch(
        `${API_URL}/api/favorites?tg_id=${tgId}&branchId=${encodeURIComponent(normalizedProfile.branchId || '')}&deliveryType=${encodeURIComponent(normalizedProfile.deliveryType || '')}`
      );
      if (!favoritesResponse.ok) throw new Error('Favorites unavailable');
      const favoritesData = await favoritesResponse.json();
      setFavorites(Array.isArray(favoritesData.favorites) ? favoritesData.favorites.map(normalizeProduct) : []);
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
      setIsLoading(false);
    }
  }, [showToast, tgId]);

  useEffect(() => {
    const telegram = (window as any).Telegram?.WebApp;
    try {
      telegram?.ready();
      telegram?.expand();
      telegram?.disableVerticalSwipes?.();
      telegram?.requestFullscreen?.();
      telegram?.setHeaderColor?.('#f97316');
      telegram?.setBackgroundColor?.('#f7f7f5');
      telegram?.setBottomBarColor?.('#ffffff');
    } catch {
      // The app can still render in a regular browser for development.
    }
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
    };
  }, [loadData, tgId]);

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

  const openSilpoAccount = () => {
    setProfileMenuOpen(false);
    const telegram = (window as any).Telegram?.WebApp;
    if (telegram?.openLink) {
      telegram.openLink(SILPO_ACCOUNT_URL);
      return;
    }
    window.open(SILPO_ACCOUNT_URL, '_blank', 'noopener,noreferrer');
  };

  const openFavorites = () => {
    setActiveTab('favorites');
    setProfileMenuOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
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
        body: JSON.stringify({ tg_id: tgId, product_id: product.product_id, slug: product.slug }),
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

  const openTargetModal = (product: Product) => {
    setModalProduct(product);
    setTargetDraft(product.target_price > 0 ? String(product.target_price) : '');
  };

  if (isLoading) {
    return <div className="loading-screen"><div className="loading-spinner" /><p>Завантажуємо улюблені товари…</p></div>;
  }

  return (
    <div className="app-shell">
      {toast && <div className="toast" role="status">{toast}</div>}

      <header className="app-header">
        <div className="brand-lockup">
          <div className="brand-mark">
            <img className="brand-logo" src={SILPO_LOGO_URL} alt="Сільпо" />
          </div>
          <div>
            <p className="eyebrow">СІЛЬПО</p>
            <h1>Цінолов</h1>
          </div>
        </div>
        {isAuthenticated && userProfile ? (
          <div className="header-actions">
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
                    <button type="button" role="menuitem" onClick={openFavorites}><Heart size={18} /><span>Улюблені</span></button>
                    <button type="button" role="menuitem" onClick={openSilpoAccount}><Link2 size={18} /><span>Кабінет Сільпо</span></button>
                    <span className="profile-menu-divider" />
                    <button className="profile-menu-danger" type="button" role="menuitem" onClick={() => void logout()}><LogOut size={18} /><span>Вийти</span></button>
                  </div>
                </>
              )}
            </div>
          </div>
        ) : <span className="header-status">Mini App</span>}
      </header>

      {!isAuthenticated && (
        <button className="connect-card" onClick={connectSilpo}>
          <span className="connect-icon"><Link2 size={20} /></span>
          <span className="connect-copy"><strong>{tgId ? 'Підключити акаунт Сільпо' : 'Відкрийте через Telegram'}</strong><small>{tgId ? 'Щоб бачити реальні улюблені товари та ціни' : 'Ідентифікатор Telegram не знайдено'}</small></span>
          <ChevronRight size={20} />
        </button>
      )}

      <main className="main-content">
        {activeTab === 'favorites' ? (
          <section className="page-section">
            <div className="section-heading">
              <div><p className="section-kicker">МОЇ УЛЮБЛЕНІ</p><h2>Товари під наглядом</h2></div>
              <span className="count-pill">{favorites.length}</span>
            </div>

            {userProfile && (
              <div className="store-context-card">
                <span className="store-context-icon"><MapPin size={20} /></span>
                <span className="store-context-copy">
                  <small>ЦІНИ ДЛЯ ВАШОГО МАГАЗИНУ</small>
                  <strong>{userProfile.storeLabel}</strong>
                  <span>{deliveryLabel(userProfile.deliveryType)} · {lastUpdated ? updatedLabel(lastUpdated) : 'Оновлено щойно'}</span>
                </span>
                {userProfile.isOpen !== null && <span className={userProfile.isOpen ? 'store-open' : 'store-open closed'}>{userProfile.isOpen ? 'Відкрито' : 'Зачинено'}</span>}
              </div>
            )}

            {favorites.length > 0 && (
              <div className="watch-summary">
                <ShieldCheck size={19} />
                <div><strong>Розумний контроль активний</strong><span>{favorites.length} товарів · {favorites.filter(item => item.has_promo).length} акцій · {favorites.filter(item => item.target_price > 0).length} бажаних цін</span></div>
              </div>
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
                          <span className={product.available ? 'availability available' : 'availability'}>
                            <span className="status-dot" />{product.available ? 'В цьому магазині' : 'Очікується'}
                          </span>
                          <button className="icon-button tiny-icon" onClick={() => void removeFromFavorites(product)} disabled={isBusy} aria-label="Видалити з Улюблених">
                            <Heart size={18} fill="currentColor" />
                          </button>
                        </div>
                        {link ? <a className="product-name" href={link} target="_blank" rel="noreferrer">{product.name}</a> : <h3 className="product-name">{product.name}</h3>}
                        <p className="product-meta">{product.displayWeight || '1 шт'}</p>
                        <div className="price-line">
                          <strong>{formatPrice(product.effective_price)}</strong>
                          {product.special_price_count > 1 && <span className="condition-badge">від {product.special_price_count} шт</span>}
                          {discount > 0 && <span className="discount-badge">−{discount}%</span>}
                          {product.reference_price > product.effective_price && <del>{formatPrice(product.reference_price)}</del>}
                        </div>
                        <button className={`target-button ${product.target_price > 0 ? 'target-set' : ''}`} onClick={() => openTargetModal(product)}>
                          <Sparkles size={15} />
                          {product.target_price > 0 ? `Бажана ціна: ${formatPrice(product.target_price)}` : 'Встановити бажану ціну'}
                        </button>
                        <div className="product-footer">
                          {product.available ? (
                            <button className="cart-button" onClick={() => void addToCart(product)} disabled={isBusy}>
                              {isBusy ? <span className="button-spinner" /> : <><Plus size={18} /><span>{product.special_price_count > 1 ? `${product.special_price_count} шт у кошик` : 'У кошик'}</span></>}
                            </button>
                          ) : <span className="unavailable-note"><Package size={16} /> Немає в цьому магазині</span>}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="empty-card"><div className="empty-icon"><ShoppingCart size={28} /></div><h3>Улюблених поки немає</h3><p>Додавайте товари в Улюблені у застосунку Сільпо — тут вони зʼявляться автоматично.</p></div>
            )}
          </section>
        ) : (
          <section className="page-section">
            <div className="section-heading"><div><p className="section-kicker">КЕРУВАННЯ</p><h2>Сповіщення</h2></div><Bell size={22} className="section-icon" /></div>
            <div className="settings-list">
              {SETTING_DEFINITIONS.map(item => (
                <label className="setting-row" key={item.key}>
                  <span className="setting-emoji">{item.icon}</span>
                  <span className="setting-copy"><strong>{item.title}</strong><small>{item.description}</small></span>
                  <span className={`toggle ${settings[item.key] ? 'on' : ''}`}><input type="checkbox" checked={settings[item.key]} onChange={() => void toggleSetting(item.key)} /><span className="toggle-knob" /></span>
                </label>
              ))}
            </div>
            <div className="info-card"><ShieldCheck size={18} /><p><strong>Захист від хибних сповіщень.</strong> Наявність підтверджується двома перевірками, дрібні коливання ціни ігноруються, а після зміни магазину порівняння починається заново. Бажана ціна перевіряється одразу.</p></div>
          </section>
        )}
      </main>

      <nav className="bottom-nav" aria-label="Основна навігація">
        <button className={activeTab === 'favorites' ? 'nav-button active' : 'nav-button'} onClick={() => setActiveTab('favorites')}><Heart size={20} fill={activeTab === 'favorites' ? 'currentColor' : 'none'} /><span>Улюблені</span></button>
        <button className={activeTab === 'settings' ? 'nav-button active' : 'nav-button'} onClick={() => setActiveTab('settings')}><SettingsIcon size={20} /><span>Налаштування</span></button>
      </nav>

      {modalProduct && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setModalProduct(null)}>
          <section className="target-sheet" role="dialog" aria-modal="true" aria-labelledby="target-title" onMouseDown={event => event.stopPropagation()}>
            <div className="sheet-handle" />
            <div className="sheet-header"><div><p className="section-kicker">ЦІНОВИЙ КОНТРОЛЬ</p><h2 id="target-title">Бажана ціна</h2></div><button className="icon-button" onClick={() => setModalProduct(null)} aria-label="Закрити"><X size={20} /></button></div>
            <p className="sheet-product">{modalProduct.name}</p>
            <label className="input-label" htmlFor="target-price">Нагадати, коли ціна буде</label>
            <div className="price-input-wrap"><input id="target-price" type="number" min="0" step="0.01" inputMode="decimal" autoFocus value={targetDraft} onChange={event => setTargetDraft(event.target.value)} placeholder="0" /><span>₴</span></div>
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

export default App;
