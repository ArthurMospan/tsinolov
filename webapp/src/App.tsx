import { useState, useEffect } from 'react';
import { Heart, Settings as SettingsIcon } from 'lucide-react';

// ── Demo Data (will be replaced with MCP data on hackathon) ──────────
const DEMO_PRODUCTS = [
  {
    product_id: '101',
    name: 'Coca-Cola Zero 2л',
    current_price: 35.50,
    old_price: 49.90,
    added_price: 49.90,
    image_url: 'https://content.silpo.ua/sku/ecommerce/11/480x480wwm/151411_480x480wwm_22bb2571-a tried-4cfb-a73a-2d1cb5c87975.png',
    has_promo: true,
    target_price: 0,
  },
  {
    product_id: '102',
    name: 'Молоко Яготинське 2.6% 900г',
    current_price: 42.90,
    old_price: 42.90,
    added_price: 38.50,
    image_url: 'https://content.silpo.ua/sku/ecommerce/11/480x480wwm/300411_480x480wwm_placeholder.png',
    has_promo: false,
    target_price: 35,
  },
  {
    product_id: '103',
    name: 'Хліб Київхліб "Київський" 950г',
    current_price: 28.90,
    old_price: 34.50,
    added_price: 34.50,
    image_url: 'https://content.silpo.ua/sku/ecommerce/11/480x480wwm/500311_480x480wwm_placeholder.png',
    has_promo: true,
    target_price: 25,
  },
  {
    product_id: '104',
    name: 'Банан 1кг',
    current_price: 54.90,
    old_price: 59.90,
    added_price: 59.90,
    image_url: 'https://content.silpo.ua/sku/ecommerce/11/480x480wwm/100111_480x480wwm_placeholder.png',
    has_promo: false,
    target_price: 0,
  },
  {
    product_id: '105',
    name: 'Сир Президент Брі 125г',
    current_price: 89.90,
    old_price: 129.00,
    added_price: 129.00,
    image_url: 'https://content.silpo.ua/sku/ecommerce/11/480x480wwm/200511_480x480wwm_placeholder.png',
    has_promo: true,
    target_price: 85,
  },
];

const DEFAULT_SETTINGS = {
  price_drop: true,
  price_target: true,
  promo_new: true,
  in_stock: false,
  smart_buy: true,
};

// ── Types ────────────────────────────────────────────────────────────
interface Product {
  product_id: string;
  name: string;
  current_price: number;
  old_price: number;
  added_price: number;
  image_url: string;
  has_promo: boolean;
  target_price: number;
}

interface Settings {
  price_drop: boolean;
  price_target: boolean;
  promo_new: boolean;
  in_stock: boolean;
  smart_buy: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────
function getDiscountPercent(current: number, old: number): number {
  if (old <= current) return 0;
  return Math.round(((old - current) / old) * 100);
}

function getPriceStatusEmoji(product: Product): string {
  const discount = getDiscountPercent(product.current_price, product.added_price);
  if (discount >= 20) return '🔥';
  if (discount > 0) return '📉';
  if (product.current_price > product.added_price) return '📈';
  return '';
}

// ── Component ────────────────────────────────────────────────────────
function App() {
  const [activeTab, setActiveTab] = useState<'favorites' | 'settings'>('favorites');
  const [favorites, setFavorites] = useState<Product[]>(DEMO_PRODUCTS);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    // Try to init Telegram WebApp SDK safely
    try {
      const tg = (window as any).Telegram?.WebApp;
      if (tg) {
        tg.ready();
        tg.expand();
        tg.setHeaderColor('#f47920');
      }
    } catch { /* ignore – works outside Telegram too */ }
  }, []);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  };

  const updateTargetPrice = (productId: string, price: number) => {
    setFavorites(favs =>
      favs.map(f =>
        f.product_id === productId ? { ...f, target_price: price } : f
      )
    );
  };

  const saveTargetPrice = (product: Product) => {
    if (product.target_price > 0) {
      showToast(`✅ Стеля ${product.target_price} ₴ для "${product.name}" збережена!`);
    } else {
      showToast(`🗑 Стелю ціни для "${product.name}" скинуто`);
    }
  };

  const toggleSetting = (key: keyof Settings) => {
    setSettings(prev => {
      const newSettings = { ...prev, [key]: !prev[key] };
      showToast(!prev[key] ? '✅ Увімкнено' : '⏸ Вимкнено');
      return newSettings;
    });
  };

  const removeFromFavorites = (productId: string) => {
    setFavorites(favs => favs.filter(f => f.product_id !== productId));
    showToast('🗑 Видалено з обраного');
  };

  return (
    <>
      {/* Toast notification */}
      {toast && <div className="toast">{toast}</div>}

      <header className="header">
        <div className="header-left">
          <div className="logo-icon">🎯</div>
          <h1>Цінолов</h1>
        </div>
        <span className="header-badge">Сільпо</span>
      </header>

      <main className="container">
        {activeTab === 'favorites' && (
          <div className="page-content">
            <div className="section-header">
              <h2>Моє Обране</h2>
              <span className="badge">{favorites.length} товарів</span>
            </div>

            {favorites.map(product => {
              const discount = getDiscountPercent(product.current_price, product.added_price);
              const emoji = getPriceStatusEmoji(product);
              const isTargetReached = product.target_price > 0 && product.current_price <= product.target_price;

              return (
                <div key={product.product_id} className={`glass product-card ${isTargetReached ? 'target-reached' : ''}`}>
                  {discount > 0 && (
                    <div className="discount-badge">-{discount}%</div>
                  )}
                  {isTargetReached && (
                    <div className="target-badge">🎯 Час купувати!</div>
                  )}

                  <div className="product-card-top">
                    <div className="product-image-wrapper">
                      <div className="product-image-placeholder">
                        {product.name.charAt(0)}
                      </div>
                    </div>
                    <div className="product-info">
                      <div className="product-name">{product.name}</div>

                      <div className="price-row">
                        <span className="product-price">{product.current_price.toFixed(2)} ₴</span>
                        {product.old_price > product.current_price && (
                          <span className="product-old-price">{product.old_price.toFixed(2)} ₴</span>
                        )}
                        {emoji && <span className="price-emoji">{emoji}</span>}
                      </div>

                      <div className="added-price-row">
                        <span>Ціна при додаванні: </span>
                        <strong>{product.added_price.toFixed(2)} ₴</strong>
                      </div>

                      {product.has_promo && (
                        <div className="promo-tag">🏷 Акція</div>
                      )}
                    </div>
                  </div>

                  <div className="product-card-bottom">
                    <div className="target-price-container">
                      <label>🎯 Моя стеля ціни:</label>
                      <div className="target-input-group">
                        <input
                          type="number"
                          className="target-price-input"
                          value={product.target_price || ''}
                          onChange={(e) => updateTargetPrice(product.product_id, parseFloat(e.target.value) || 0)}
                          onBlur={() => saveTargetPrice(product)}
                          placeholder="Вкажіть суму"
                        />
                        <span className="currency">₴</span>
                      </div>
                    </div>
                    <button className="remove-btn" onClick={() => removeFromFavorites(product.product_id)}>
                      ✕
                    </button>
                  </div>
                </div>
              );
            })}

            {favorites.length === 0 && (
              <div className="empty-state">
                <div className="empty-icon">🛒</div>
                <p>Ваш список обраного порожній</p>
                <span>Додайте товари через застосунок Сільпо</span>
              </div>
            )}
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="page-content">
            <div className="section-header">
              <h2>Сповіщення</h2>
            </div>

            <div className="glass settings-card">
              <div className="setting-item">
                <div className="setting-info">
                  <div className="setting-icon">📉</div>
                  <div>
                    <div className="setting-title">Зниження ціни</div>
                    <div className="setting-desc">Коли ціна стає нижчою за ту, при якій ви додали товар</div>
                  </div>
                </div>
                <label className="switch">
                  <input type="checkbox" checked={settings.price_drop} onChange={() => toggleSetting('price_drop')} />
                  <span className="slider"></span>
                </label>
              </div>

              <div className="setting-divider" />

              <div className="setting-item">
                <div className="setting-info">
                  <div className="setting-icon">🎯</div>
                  <div>
                    <div className="setting-title">Цільова ціна</div>
                    <div className="setting-desc">Коли ціна падає нижче вашої "стелі"</div>
                  </div>
                </div>
                <label className="switch">
                  <input type="checkbox" checked={settings.price_target} onChange={() => toggleSetting('price_target')} />
                  <span className="slider"></span>
                </label>
              </div>

              <div className="setting-divider" />

              <div className="setting-item">
                <div className="setting-info">
                  <div className="setting-icon">🔥</div>
                  <div>
                    <div className="setting-title">Нові акції</div>
                    <div className="setting-desc">Сповіщення про акції на ваші товари</div>
                  </div>
                </div>
                <label className="switch">
                  <input type="checkbox" checked={settings.promo_new} onChange={() => toggleSetting('promo_new')} />
                  <span className="slider"></span>
                </label>
              </div>

              <div className="setting-divider" />

              <div className="setting-item">
                <div className="setting-info">
                  <div className="setting-icon">📦</div>
                  <div>
                    <div className="setting-title">Наявність</div>
                    <div className="setting-desc">Товар повернувся у продаж</div>
                  </div>
                </div>
                <label className="switch">
                  <input type="checkbox" checked={settings.in_stock} onChange={() => toggleSetting('in_stock')} />
                  <span className="slider"></span>
                </label>
              </div>

              <div className="setting-divider" />

              <div className="setting-item">
                <div className="setting-info">
                  <div className="setting-icon">🧠</div>
                  <div>
                    <div className="setting-title">Smart Buy</div>
                    <div className="setting-desc">Аналіз: товар на історичному мінімумі ціни</div>
                  </div>
                </div>
                <label className="switch">
                  <input type="checkbox" checked={settings.smart_buy} onChange={() => toggleSetting('smart_buy')} />
                  <span className="slider"></span>
                </label>
              </div>
            </div>

            <div className="glass info-card">
              <div className="info-icon">💡</div>
              <p>Сповіщення надходитимуть автоматично у цей Telegram-чат. Частоту перевірки встановлено на кожні 30 хвилин.</p>
            </div>
          </div>
        )}
      </main>

      <nav className="bottom-nav">
        <button
          className={`nav-item ${activeTab === 'favorites' ? 'active' : ''}`}
          onClick={() => setActiveTab('favorites')}
        >
          <Heart size={22} fill={activeTab === 'favorites' ? '#f47920' : 'none'} />
          <span>Обране</span>
        </button>
        <button
          className={`nav-item ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => setActiveTab('settings')}
        >
          <SettingsIcon size={22} />
          <span>Налаштування</span>
        </button>
      </nav>
    </>
  );
}

export default App;
