import { callMCPTool, listMCPTools, type MCPToolDefinition } from './mcp-direct';
import { nextDaytimeReference, productAvailability } from './monitoring-favorites';
import { productsFromSearchResponse } from './product-search';
import { parseMcpContent, type StoreContext } from './store-context';

export interface CatalogCategory {
    id: string;
    name: string;
    slug: string;
    productCount: number | null;
    children: CatalogCategory[];
    parentId?: string;
}

export interface CatalogProductPage {
    products: any[];
    hasMore: boolean;
    nextOffset: number;
    availabilityReliable: boolean;
    availabilityBasis: 'current_slot' | 'next_day_reference';
    checkedFor: string;
}

type SchemaProperties = Record<string, any>;

function firstValue(value: any, keys: string[]): any {
    for (const key of keys) {
        if (value?.[key] !== undefined && value?.[key] !== null) return value[key];
    }
    return undefined;
}

function categoryChildren(value: any): any[] {
    for (const key of ['children', 'subcategories', 'subCategories', 'categories', 'items']) {
        if (Array.isArray(value?.[key])) return value[key];
    }
    return [];
}

function categoryNode(value: any): CatalogCategory | null {
    if (!value || typeof value !== 'object') return null;
    const name = String(firstValue(value, ['name', 'title', 'label', 'displayName']) || '').trim();
    const id = String(firstValue(value, ['id', 'categoryId', 'category_id', 'externalId', 'external_id', 'code', 'slug']) || '').trim();
    if (!name || !id) return null;
    const count = Number(firstValue(value, ['productCount', 'productsCount', 'products_count', 'count']));
    return {
        id,
        name,
        slug: String(firstValue(value, ['slug', 'categorySlug', 'category_slug']) || '').trim(),
        productCount: Number.isFinite(count) ? count : null,
        children: categoryChildren(value).map(categoryNode).filter(Boolean) as CatalogCategory[],
        parentId: String(firstValue(value, ['parentId', 'parent_id', 'parentCategoryId', 'parent_category_id']) || '').trim() || undefined,
    };
}

function categoryArray(root: any): any[] {
    if (Array.isArray(root)) return root;
    if (!root || typeof root !== 'object') return [];
    for (const key of ['categories', 'categoryTree', 'tree', 'items', 'results', 'data']) {
        if (Array.isArray(root[key])) return root[key];
        if (root[key] && typeof root[key] === 'object') {
            const nested = categoryArray(root[key]);
            if (nested.length) return nested;
        }
    }
    return categoryNode(root) ? [root] : [];
}

export function categoriesFromResponse(response: any): CatalogCategory[] {
    const nodes = parseMcpContent(response).flatMap(categoryArray).map(categoryNode).filter(Boolean) as CatalogCategory[];
    const byId = new Map<string, CatalogCategory>();
    const collect = (node: CatalogCategory, inheritedParentId?: string): CatalogCategory => {
        const parentId = node.parentId || inheritedParentId;
        const children = node.children.map(child => collect(child, node.id));
        const existing = byId.get(node.id);
        const merged = existing
            ? { ...existing, ...node, parentId, children: [...existing.children, ...children] }
            : { ...node, parentId, children };
        byId.set(node.id, merged);
        return merged;
    };
    nodes.forEach(node => collect(node));

    for (const node of byId.values()) {
        if (!node.parentId) continue;
        const parent = byId.get(node.parentId);
        if (parent && !parent.children.some(child => child.id === node.id)) parent.children.push(node);
    }

    const collator = new Intl.Collator('uk', { sensitivity: 'base' });
    const sortTree = (items: CatalogCategory[]): CatalogCategory[] => [...new Map(items.map(item => [item.id, item])).values()]
        .map(item => ({ ...item, children: sortTree(item.children) }))
        .sort((left, right) => collator.compare(left.name, right.name));
    let roots = [...byId.values()].filter(node => !node.parentId || !byId.has(node.parentId));
    const onlyRoot = roots[0];
    const syntheticRoot = onlyRoot
        ? [onlyRoot.id, onlyRoot.name].some(value => /^(root|catalog|categories|all|каталог|категорії|усі)$/i.test(value.trim()))
        : false;
    if (roots.length === 1 && onlyRoot.children.length > 0 && onlyRoot.productCount === null && syntheticRoot) {
        roots = roots[0].children;
    }
    return sortTree(roots);
}

function propertyName(properties: SchemaProperties, candidates: string[]): string | undefined {
    return candidates.find(candidate => Object.prototype.hasOwnProperty.call(properties, candidate));
}

function setAccepted(
    target: Record<string, any>,
    properties: SchemaProperties,
    candidates: string[],
    value: any
): void {
    const name = propertyName(properties, candidates);
    if (name && value !== undefined && value !== null && value !== '') target[name] = value;
}

function categoryValue(key: string, schema: any, category: { id: string; slug?: string; name?: string }): any {
    const normalizedKey = key.toLowerCase();
    const value = normalizedKey.includes('slug')
        ? category.slug || category.id
        : normalizedKey.includes('name')
            ? category.name || category.id
            : category.id || category.slug || category.name;
    if (schema?.type === 'object') return { id: category.id, slug: category.slug, name: category.name };
    return schema?.type === 'array' ? [value] : value;
}

export function buildCatalogArgs(
    tool: MCPToolDefinition,
    context: Pick<StoreContext, 'branchId' | 'deliveryType'>,
    options: {
        category?: { id: string; slug?: string; name?: string };
        query?: string;
        limit?: number;
        offset?: number;
        start: Date;
        end: Date;
    }
): Record<string, any> {
    const properties = tool.inputSchema?.properties || {};
    const args: Record<string, any> = {};
    setAccepted(args, properties, ['branchId', 'branch_id', 'storeId', 'store_id'], context.branchId);
    setAccepted(args, properties, ['deliveryType', 'delivery_type'], context.deliveryType);
    setAccepted(args, properties, ['timeslotStart', 'timeSlotStart', 'timeslot_start'], options.start.toISOString());
    setAccepted(args, properties, ['timeslotEnd', 'timeSlotEnd', 'timeslot_end'], options.end.toISOString());
    setAccepted(args, properties, ['limit', 'take', 'pageSize', 'page_size'], options.limit);
    setAccepted(args, properties, ['offset', 'skip'], options.offset);
    if (options.limit && options.offset !== undefined) {
        setAccepted(args, properties, ['page'], Math.floor(options.offset / options.limit) + 1);
    }
    setAccepted(args, properties, ['query', 'search', 'searchQuery', 'search_query', 'searchText', 'search_text', 'text'], options.query);

    if (options.category) {
        const key = propertyName(properties, [
            'categoryId', 'category_id', 'categoryIds', 'category_ids', 'categorySlug', 'category_slug',
            'categorySlugs', 'category_slugs', 'categories', 'category'
        ]);
        if (key) args[key] = categoryValue(key, properties[key], options.category);
    }

    const filterKey = propertyName(properties, ['filters', 'filter']);
    if (filterKey && properties[filterKey]?.properties) {
        const filters = buildCatalogArgs(
            { name: `${tool.name}:filters`, inputSchema: { properties: properties[filterKey].properties } },
            context,
            options
        );
        if (Object.keys(filters).length) args[filterKey] = filters;
    }
    return args;
}

async function toolByName(token: string, name: string): Promise<MCPToolDefinition> {
    return (await listMCPTools(token)).find(tool => tool.name === name) || { name };
}

function requestWindow(now = new Date()): { start: Date; end: Date; basis: 'current_slot' | 'next_day_reference' } {
    const currentEnd = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    if (now.getUTCHours() >= 6 && now.getUTCHours() <= 17) {
        return { start: now, end: currentEnd, basis: 'current_slot' };
    }
    return { ...nextDaytimeReference(now), basis: 'next_day_reference' };
}

export async function getCatalogCategories(
    token: string,
    context: Pick<StoreContext, 'branchId' | 'deliveryType'>
): Promise<CatalogCategory[]> {
    const { start, end } = requestWindow();
    for (const toolName of ['silpo_get_categories_tree', 'silpo_get_categories']) {
        try {
            const tool = await toolByName(token, toolName);
            const response = await callMCPTool(token, toolName, buildCatalogArgs(tool, context, { start, end }));
            const categories = categoriesFromResponse(response);
            if (categories.length) return categories;
        } catch (error) {
            console.warn(`[Catalog] ${toolName} failed:`, error);
        }
    }
    return [];
}

export async function getCatalogProducts(
    token: string,
    context: Pick<StoreContext, 'branchId' | 'deliveryType'>,
    options: {
        category?: { id: string; slug?: string; name?: string };
        query?: string;
        limit?: number;
        offset?: number;
    }
): Promise<CatalogProductPage> {
    const limit = Math.min(40, Math.max(1, options.limit || 30));
    const offset = Math.max(0, options.offset || 0);
    const { start, end, basis } = requestWindow();
    const tool = await toolByName(token, 'silpo_get_products');
    const response = await callMCPTool(token, tool.name, buildCatalogArgs(tool, context, {
        ...options,
        limit,
        offset,
        start,
        end,
    }));
    const products = productsFromSearchResponse(response);
    return {
        products,
        hasMore: products.length === limit,
        nextOffset: offset + products.length,
        availabilityReliable: basis === 'current_slot'
            && !products.some(product => productAvailability(product) === null),
        availabilityBasis: basis,
        checkedFor: start.toISOString(),
    };
}
