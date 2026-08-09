import axios from 'axios';

const SILPO_API_URL = 'https://api.silpo.ua/v2'; // Note: Replace with real endpoint or MCP integration

/**
 * Mocked integration with Silpo MCP to get user favorites
 */
export const getMyFavorites = async (accessToken: string) => {
    // In a real scenario, this would make a request to the Silpo MCP / API
    console.log(`[API] Fetching favorites for user with token: ${accessToken}`);
    
    // Mocking response
    return [
        {
            product_id: '12345',
            name: 'Coca-Cola 2L',
            current_price: 35.50,
            old_price: 45.00,
            in_stock: true,
            has_promo: true,
            image_url: 'https://cdn.silpo.ua/product/12345.png'
        },
        {
            product_id: '67890',
            name: 'Croissant with chocolate',
            current_price: 25.00,
            old_price: 25.00,
            in_stock: false,
            has_promo: false,
            image_url: 'https://cdn.silpo.ua/product/67890.png'
        }
    ];
};

/**
 * Mock token refresh logic
 */
export const refreshAccessToken = async (refreshToken: string) => {
    console.log(`[API] Refreshing token: ${refreshToken}`);
    return {
        access_token: 'new_access_token_abc123',
        refresh_token: 'new_refresh_token_xyz890'
    };
};
