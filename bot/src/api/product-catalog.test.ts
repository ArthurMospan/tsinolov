import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCatalogArgs, categoriesFromResponse } from './product-catalog';

function response(root: any) {
    return { result: { content: [{ type: 'text', text: JSON.stringify(root) }] } };
}

test('normalizes a nested MCP category tree', () => {
    const categories = categoriesFromResponse(response({ categories: [{
        categoryId: 'food',
        name: 'Їжа',
        children: [{ id: 'fruit', title: 'Фрукти', productsCount: 42 }],
    }] }));
    assert.equal(categories[0].id, 'food');
    assert.equal(categories[0].children[0].name, 'Фрукти');
    assert.equal(categories[0].children[0].productCount, 42);
});

test('builds arguments from the live MCP input schema names', () => {
    const start = new Date('2026-08-10T09:00:00.000Z');
    const end = new Date('2026-08-10T11:00:00.000Z');
    const args = buildCatalogArgs({
        name: 'silpo_get_products',
        inputSchema: { properties: {
            branchId: { type: 'string' },
            deliveryType: { type: 'string' },
            categoryIds: { type: 'array' },
            limit: { type: 'number' },
            offset: { type: 'number' },
            timeslotStart: { type: 'string' },
        } },
    }, { branchId: 'branch', deliveryType: 'DeliveryHome' }, {
        category: { id: 'fruit' }, limit: 30, offset: 60, start, end,
    });
    assert.deepEqual(args, {
        branchId: 'branch',
        deliveryType: 'DeliveryHome',
        timeslotStart: start.toISOString(),
        limit: 30,
        offset: 60,
        categoryIds: ['fruit'],
    });
});

test('uses a category slug when the live schema asks for one', () => {
    const start = new Date('2026-08-10T09:00:00.000Z');
    const args = buildCatalogArgs({
        name: 'silpo_get_products',
        inputSchema: { properties: { categorySlug: { type: 'string' } } },
    }, { branchId: 'branch', deliveryType: 'DeliveryHome' }, {
        category: { id: '42', slug: 'frukty', name: 'Фрукти' },
        start,
        end: new Date('2026-08-10T11:00:00.000Z'),
    });
    assert.equal(args.categorySlug, 'frukty');
});
