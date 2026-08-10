import assert from 'node:assert/strict';
import test from 'node:test';
import { bold, escapeTelegramHtml, productLink } from './telegram-format';

test('escapes dynamic Telegram HTML', () => {
    assert.equal(escapeTelegramHtml('Сир <Брі> & Co'), 'Сир &lt;Брі&gt; &amp; Co');
    assert.equal(bold('28,39 ₴'), '<b>28,39 ₴</b>');
});

test('embeds the product URL into the bold product name', () => {
    assert.equal(
        productLink('Pepsi & Lime', 'napii-pepsi-cola-37871'),
        '<b><a href="https://silpo.ua/product/napii-pepsi-cola-37871">Pepsi &amp; Lime</a></b>'
    );
});
