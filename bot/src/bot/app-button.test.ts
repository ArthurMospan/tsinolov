import assert from 'node:assert/strict';
import test from 'node:test';
import { openAppKeyboard } from './app-button';

test('the app opens from a button Telegram signs, not from the reply keyboard', () => {
    const markup = openAppKeyboard('https://tsinolov.example').reply_markup as any;
    assert.equal(markup.keyboard, undefined);
    const [[button]] = markup.inline_keyboard;
    assert.equal(button.text, '📱 Відкрити застосунок');
    assert.deepEqual(button.web_app, { url: 'https://tsinolov.example' });
});
