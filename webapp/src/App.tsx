import { useState, useEffect } from 'react';
import axios from 'axios';
import { Heart, Settings as SettingsIcon } from 'lucide-react';
import WebApp from '@twa-dev/sdk';

// Get tgId from Telegram WebApp SDK, fallback to 123 for local testing
const tgId = WebApp.initDataUnsafe?.user?.id || 123;
const API_URL = 'http://localhost:3000/api'; // Usually use ngrok URL or relative in prod

interface Product {
  product_id: string;
  name: string;
  current_price: number;
  old_price: number;
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

function App() {
  const [activeTab, setActiveTab] = useState<'favorites' | 'settings'>('favorites');
  const [favorites, setFavorites] = useState<Product[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    // Let Telegram know the App is ready
    WebApp.ready();
    WebApp.expand();

    // Fetch data
    fetchFavorites();
    fetchSettings();
  }, []);

  const fetchFavorites = async () => {
    try {
      const { data } = await axios.get(`${API_URL}/favorites?tg_id=${tgId}`);
      setFavorites(data);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchSettings = async () => {
    try {
      const { data } = await axios.get(`${API_URL}/settings?tg_id=${tgId}`);
      setSettings(data);
    } catch (e) {
      console.error(e);
    }
  };

  const updateTargetPrice = async (productId: string, price: number) => {
    try {
      await axios.post(`${API_URL}/favorites/target`, {
        tg_id: tgId,
        product_id: productId,
        target_price: price
      });
      // Update local state without full refetch
      setFavorites(favs => favs.map(f => f.product_id === productId ? { ...f, target_price: price } : f));
    } catch (e) {
      console.error(e);
    }
  };

  const toggleSetting = async (key: keyof Settings) => {
    if (!settings) return;
    const newVal = !settings[key];
    setSettings({ ...settings, [key]: newVal });

    try {
      await axios.post(`${API_URL}/settings`, {
        tg_id: tgId,
        [key]: newVal
      });
    } catch (e) {
      console.error(e);
      // Revert if error
      setSettings({ ...settings, [key]: !newVal });
    }
  };

  return (
    <>
      <header className="header">
        <h1>Цінолов 🛒</h1>
      </header>

      <main className="container">
        {activeTab === 'favorites' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h2 style={{ fontSize: '18px', fontWeight: '700' }}>Моє Обране</h2>
            
            {favorites.map(product => (
              <div key={product.product_id} className="glass product-card">
                <img src={product.image_url} alt={product.name} className="product-image" />
                <div className="product-info">
                  <div className="product-name">{product.name}</div>
                  <div>
                    <span className="product-price">{product.current_price} ₴</span>
                    {product.old_price > product.current_price && (
                      <span className="product-old-price">{product.old_price} ₴</span>
                    )}
                  </div>
                  
                  <div className="target-price-container">
                    <label>Моя стеля ціни (₴):</label>
                    <input 
                      type="number" 
                      className="target-price-input" 
                      value={product.target_price || ''}
                      onChange={(e) => updateTargetPrice(product.product_id, parseFloat(e.target.value))}
                      placeholder="Немає"
                    />
                  </div>
                </div>
              </div>
            ))}
            
            {favorites.length === 0 && (
              <p style={{ color: 'var(--text-secondary)' }}>Ваш список обраного порожній.</p>
            )}
          </div>
        )}

        {activeTab === 'settings' && settings && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h2 style={{ fontSize: '18px', fontWeight: '700' }}>Налаштування сповіщень</h2>
            
            <div className="glass">
              <div className="setting-item">
                <div className="setting-info">
                  <div className="setting-title">📉 Зниження ціни</div>
                  <div className="setting-desc">Коли ціна стає меншою за попередню</div>
                </div>
                <label className="switch">
                  <input type="checkbox" checked={!!settings.price_drop} onChange={() => toggleSetting('price_drop')} />
                  <span className="slider"></span>
                </label>
              </div>
              <div style={{ borderTop: '1px solid #eee' }} />

              <div className="setting-item">
                <div className="setting-info">
                  <div className="setting-title">🎯 Цільова ціна</div>
                  <div className="setting-desc">Коли ціна падає нижче вашої стелі</div>
                </div>
                <label className="switch">
                  <input type="checkbox" checked={!!settings.price_target} onChange={() => toggleSetting('price_target')} />
                  <span className="slider"></span>
                </label>
              </div>
              <div style={{ borderTop: '1px solid #eee' }} />

              <div className="setting-item">
                <div className="setting-info">
                  <div className="setting-title">🔥 Акції</div>
                  <div className="setting-desc">Нові акції на товари в кошику</div>
                </div>
                <label className="switch">
                  <input type="checkbox" checked={!!settings.promo_new} onChange={() => toggleSetting('promo_new')} />
                  <span className="slider"></span>
                </label>
              </div>
              <div style={{ borderTop: '1px solid #eee' }} />

              <div className="setting-item">
                <div className="setting-info">
                  <div className="setting-title">🧠 Smart Buy</div>
                  <div className="setting-desc">Аналіз історичного мінімуму</div>
                </div>
                <label className="switch">
                  <input type="checkbox" checked={!!settings.smart_buy} onChange={() => toggleSetting('smart_buy')} />
                  <span className="slider"></span>
                </label>
              </div>
            </div>
          </div>
        )}
      </main>

      <nav className="bottom-nav">
        <button 
          className={`nav-item ${activeTab === 'favorites' ? 'active' : ''}`}
          onClick={() => setActiveTab('favorites')}
        >
          <Heart size={24} />
          <span>Обране</span>
        </button>
        <button 
          className={`nav-item ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => setActiveTab('settings')}
        >
          <SettingsIcon size={24} />
          <span>Налаштування</span>
        </button>
      </nav>
    </>
  )
}

export default App
