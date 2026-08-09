import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bell,
  Check,
  ChevronRight,
  Heart,
  Link2,
  LogOut,
  Package,
  Plus,
  Settings as SettingsIcon,
  ShoppingCart,
  Sparkles,
  Tag,
  X,
} from 'lucide-react';

const API_URL = '';

function getTgId(): number {
  try {
    const telegram = (window as any).Telegram?.WebApp;
    return Number(telegram?.initDataUnsafe?.user?.id || import.meta.env.VITE_TEST_TG_ID || 0);
  } catch {
    return Number(import.meta.env.VITE_TEST_TG_ID || 0);
  }
}

const tgId = getTgId();

function telegramInitData(): string {
  return String((window as any).Telegram?.WebApp?.initData || '');
}

function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const initData = telegramInitData();
  if (initData) headers.set('X-Telegram-Init-Data', initData);
  return fetch(input, { ...init, headers });
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
}

type Settings = Record<SettingKey, boolean>;

interface UserProfile {
  name: string;
  avatar: string;
  branchId: string;
  deliveryType: string;
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
  { key: 'price_target', icon: '🎯', title: 'Бажана ціна', description: 'Коли товар коштує не дорожче за вашу стелю' },
  { key: 'price_drop', icon: '📉', title: 'Зниження ціни', description: 'Коли ціна товару стала нижчою' },
  { key: 'promo_new', icon: '🔥', title: 'Нові акції', description: 'Коли на товар зʼявилася акція' },
  { key: 'promo_personal', icon: '⭐', title: 'Персональні пропозиції', description: 'Вигідні пропозиції саме для вас' },
  { key: 'in_stock', icon: '📦', title: 'Повернення в наявність', description: 'Коли недоступний товар знову можна купити' },
  { key: 'delivery_available', icon: '🚚', title: 'Доступність доставки', description: 'Коли товар знову доступний для доставки' },
  { key: 'alt_cheaper', icon: '💡', title: 'Дешевші альтернативи', description: 'Коли є вигідніший схожий товар' },
  { key: 'smart_buy', icon: '🧠', title: 'Smart Buy', description: 'Коли ціна виглядає особливо вигідною' },
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
  const hasSpecialPrice = (Array.isArray(specialPrices) && specialPrices.length > 0)
    || (specialPrices && typeof specialPrices === 'object' && Object.keys(specialPrices).length > 0);

  return {
    product_id: id,
    name: String(item.title ?? item.name ?? item.productName ?? 'Товар'),
    current_price: currentPrice,
    old_price: oldPrice,
    added_price: numberValue(item.added_price ?? item.addedPrice, oldPrice),
    image_url: String(item.image ?? item.imageUrl ?? item.image_url ?? ''),
    has_promo: hasExplicitPromo !== undefined ? booleanValue(hasExplicitPromo) : hasSpecialPrice || oldPrice > currentPrice,
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

function App() {
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
    try {
      const statusResponse = await apiFetch(`${API_URL}/api/auth/status?tg_id=${tgId}`);
      if (!statusResponse.ok) throw new Error('Auth status unavailable');
      const status = await statusResponse.json();
      setIsAuthenticated(Boolean(status.authenticated));

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
      const savedSettings = await settingsResponse.json();
      setUserProfile(profile);
      setSettings({ ...DEFAULT_SETTINGS, ...savedSettings });

      const favoritesResponse = await apiFetch(
        `${API_URL}/api/favorites?tg_id=${tgId}&branchId=${encodeURIComponent(profile.branchId || '')}&deliveryType=${encodeURIComponent(profile.deliveryType || '')}`
      );
      if (!favoritesResponse.ok) throw new Error('Favorites unavailable');
      const favoritesData = await favoritesResponse.json();
      setFavorites(Array.isArray(favoritesData.favorites) ? favoritesData.favorites.map(normalizeProduct) : []);
    } catch (error) {
      console.error('[Mini App] Failed to load data:', error);
      setIsAuthenticated(false);
      setFavorites([]);
      showToast('Не вдалося завантажити дані');
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    const telegram = (window as any).Telegram?.WebApp;
    try {
      telegram?.ready();
      telegram?.expand();
      telegram?.setHeaderColor?.('#f97316');
      telegram?.setBackgroundColor?.('#f7f7f5');
    } catch {
      // The app can still render in a regular browser for development.
    }
    void loadData();
  }, [loadData]);

  const connectSilpo = () => {
    if (!tgId) {
      showToast('Відкрийте застосунок через Telegram');
      return;
    }
    window.location.assign(`${API_URL}/auth/start?tg_id=${tgId}&init_data=${encodeURIComponent(telegramInitData())}`);
  };

  const logout = async () => {
    try {
      await apiFetch(`${API_URL}/api/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tg_id: tgId }),
      });
      setIsAuthenticated(false);
      setUserProfile(null);
      setFavorites([]);
      showToast('Акаунт відʼєднано');
    } catch {
      showToast('Не вдалося відʼєднати акаунт');
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
          current_price: product.current_price,
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
        ? 'Ціль досягнута — сповіщення вже надіслано'
        : targetPrice > 0 ? 'Стелю збережено' : 'Стелю скинуто');
    } catch (error) {
      console.error('[Mini App] Failed to save target:', error);
      showToast('Не вдалося зберегти стелю');
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
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.success) throw new Error(result.error || 'Cart update failed');
      showToast('Додано в кошик');
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
      showToast('Товар прибрано з Обраного');
    } catch (error) {
      console.error('[Mini App] Failed to remove favorite:', error);
      setFavorites(previous);
      showToast('Не вдалося видалити товар');
    } finally {
      setBusyProductId(null);
    }
  };

  const targetHint = useMemo(() => {
    if (!modalProduct || !targetDraft) return 'Сповіщення прийде, коли поточна ціна буде не більшою за цю суму.';
    const target = numberValue(targetDraft);
    return modalProduct.current_price <= target
      ? 'Ціна вже відповідає цілі — після збереження перевіримо її одразу.'
      : 'Бот перевірятиме ціну автоматично та напише, коли вона впаде до цілі.';
  }, [modalProduct, targetDraft]);

  const openTargetModal = (product: Product) => {
    setModalProduct(product);
    setTargetDraft(product.target_price > 0 ? String(product.target_price) : '');
  };

  if (isLoading) {
    return <div className="loading-screen"><div className="loading-spinner" /><p>Завантажуємо ваше Обране…</p></div>;
  }

  return (
    <div className="app-shell">
      {toast && <div className="toast" role="status">{toast}</div>}

      <header className="app-header">
        <div className="brand-lockup">
          <div className="brand-mark">🎯</div>
          <div>
            <p className="eyebrow">SMART SILPO WATCHLIST</p>
            <h1>Цінолов</h1>
          </div>
        </div>
        {isAuthenticated && userProfile ? (
          <div className="header-actions">
            <div className="store-pill">
              <span>{userProfile.deliveryType || 'Сільпо'}</span>
              <strong>{userProfile.name || 'Мій акаунт'}</strong>
            </div>
            <button className="icon-button header-icon" onClick={logout} aria-label="Вийти з акаунта" title="Вийти">
              <LogOut size={18} />
            </button>
          </div>
        ) : <span className="header-status">Mini App</span>}
      </header>

      {!isAuthenticated && (
        <button className="connect-card" onClick={connectSilpo}>
          <span className="connect-icon"><Link2 size={20} /></span>
          <span className="connect-copy"><strong>{tgId ? 'Підключити акаунт Сільпо' : 'Відкрийте через Telegram'}</strong><small>{tgId ? 'Щоб бачити реальне Обране та ціни' : 'Ідентифікатор Telegram не знайдено'}</small></span>
          <ChevronRight size={20} />
        </button>
      )}

      <main className="main-content">
        {activeTab === 'favorites' ? (
          <section className="page-section">
            <div className="section-heading">
              <div><p className="section-kicker">МОЄ ОБРАНЕ</p><h2>Товари під наглядом</h2></div>
              <span className="count-pill">{favorites.length}</span>
            </div>

            {favorites.length > 0 ? (
              <div className="products-list">
                {favorites.map(product => {
                  const discount = discountPercent(product.current_price, product.old_price);
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
                            <span className="status-dot" />{product.available ? 'В наявності' : 'Очікується'}
                          </span>
                          <button className="icon-button tiny-icon" onClick={() => void removeFromFavorites(product)} disabled={isBusy} aria-label="Видалити з Обраного">
                            <Heart size={18} fill="currentColor" />
                          </button>
                        </div>
                        {link ? <a className="product-name" href={link} target="_blank" rel="noreferrer">{product.name}</a> : <h3 className="product-name">{product.name}</h3>}
                        <p className="product-meta">{product.displayWeight || '1 шт'}</p>
                        <div className="price-line">
                          <strong>{product.available ? formatPrice(product.current_price) : 'Немає в продажу'}</strong>
                          {discount > 0 && <span className="discount-badge">−{discount}%</span>}
                          {product.old_price > product.current_price && <del>{formatPrice(product.old_price)}</del>}
                        </div>
                        <button className={`target-button ${product.target_price > 0 ? 'target-set' : ''}`} onClick={() => openTargetModal(product)}>
                          <Sparkles size={15} />
                          {product.target_price > 0 ? `Стеля ${formatPrice(product.target_price)}` : 'Встановити стелю'}
                        </button>
                        <div className="product-footer">
                          {product.available ? (
                            <button className="cart-button" onClick={() => void addToCart(product)} disabled={isBusy}>
                              {isBusy ? <span className="button-spinner" /> : <><Plus size={18} /><span>У кошик</span></>}
                            </button>
                          ) : <span className="unavailable-note"><Package size={16} /> Немає в магазині</span>}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="empty-card"><div className="empty-icon"><ShoppingCart size={28} /></div><h3>Обране поки порожнє</h3><p>Додавайте товари в Обране у застосунку Сільпо — тут вони зʼявляться автоматично.</p></div>
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
            <div className="info-card"><Check size={18} /><p>Зміни зберігаються одразу. Перевірка цін відбувається автоматично, а при збереженні стелі поточна ціна перевіряється без очікування наступного циклу.</p></div>
          </section>
        )}
      </main>

      <nav className="bottom-nav" aria-label="Основна навігація">
        <button className={activeTab === 'favorites' ? 'nav-button active' : 'nav-button'} onClick={() => setActiveTab('favorites')}><Heart size={20} fill={activeTab === 'favorites' ? 'currentColor' : 'none'} /><span>Обране</span></button>
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
            <button className="primary-button" disabled={savingTargetId === modalProduct.product_id} onClick={() => void saveTargetPrice(modalProduct, targetDraft)}>{savingTargetId === modalProduct.product_id ? <span className="button-spinner light" /> : 'Зберегти стелю'}</button>
            {modalProduct.target_price > 0 && <button className="remove-target-button" onClick={() => void saveTargetPrice(modalProduct, '0')}>Скинути стелю</button>}
          </section>
        </div>
      )}
    </div>
  );
}

function ProductImage({ product }: { product: Product }) {
  const [failed, setFailed] = useState(false);
  if (!product.image_url || failed) return <div className="product-image-fallback">{product.name.slice(0, 1).toUpperCase()}</div>;
  return <img className="product-image" src={product.image_url} alt="" onError={() => setFailed(true)} />;
}

export default App;
