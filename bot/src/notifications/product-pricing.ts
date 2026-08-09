export interface ProductPricing {
    basePrice: number;
    effectivePrice: number;
    referencePrice: number;
    specialPrice: number | null;
    specialCount: number | null;
    condition: string;
    hasPromo: boolean;
    discountPercent: number;
}
function numeric(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function productPricing(product: any): ProductPricing {
    const basePrice = numeric(product?.price ?? product?.current_price ?? product?.currentPrice ?? product?.salePrice);
    const oldPrice = numeric(product?.oldPrice ?? product?.old_price ?? product?.originalPrice);
    const offers = Array.isArray(product?.specialPrices)
        ? product.specialPrices
            .map((offer: any) => ({ price: numeric(offer?.price), count: numeric(offer?.count) }))
            .filter((offer: any) => offer.price > 0 && offer.price < basePrice)
            .sort((left: any, right: any) => left.price - right.price)
        : [];
    const bestOffer = offers[0];
    const specialPrice = bestOffer?.price || null;
    const specialCount = bestOffer?.count || null;
    const effectivePrice = specialPrice || basePrice;
    const referencePrice = oldPrice > effectivePrice
        ? oldPrice
        : specialPrice && basePrice > effectivePrice
            ? basePrice
            : basePrice;
    const hasPromo = Boolean(specialPrice || oldPrice > basePrice);
    const discountPercent = referencePrice > effectivePrice
        ? Math.round((1 - effectivePrice / referencePrice) * 100)
        : 0;

    return {
        basePrice,
        effectivePrice,
        referencePrice,
        specialPrice,
        specialCount,
        condition: specialCount && specialCount > 1 ? `від ${specialCount} шт` : '',
        hasPromo,
        discountPercent,
    };
}
