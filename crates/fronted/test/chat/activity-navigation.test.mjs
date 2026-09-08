import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsModuleLoader } from '../helpers/load-ts-module.mjs';
const trace = (id, args = {}) => ({ toolCall: { id, name: 'Bash', arguments: args } });

test('tool navigation isolates conversations and replaces a selected running trace with its result', () => {
  const { toolActivitySelection: store } = createTsModuleLoader().loadModule('src/lib/chat/toolActivityNavigation.ts');
  let updates = 0;
  const unsubscribe = store.subscribe(() => updates++);
  const running = trace('shell-1', { description: 'Check the editor contents' });
  store.select('chat-a', running);
  store.select('chat-b', trace('shell-2'));
  const finished = { ...running, toolResult: { isError: true, content: [{ type: 'text', text: 'Editor unavailable' }] } };
  store.select('chat-a', finished);
  assert.equal(store.get('chat-a'), finished);
  assert.equal(store.get('chat-b').toolCall.id, 'shell-2');
  store.select('chat-a', null);
  assert.equal(store.get('chat-a'), null);
  assert.equal(updates, 4);
  unsubscribe();
  store.select('chat-b', null);
  assert.equal(updates, 4);
});

test('step labels use supplied purpose without exposing commands as summaries or fabricating outcomes', () => {
  const { toolStepLabel } = createTsModuleLoader().loadModule('src/lib/chat/toolActivityNavigation.ts');
  assert.equal(toolStepLabel(trace('1', { brief: 'Confirm text in Notepad', command: 'secret-command' }), 'Run command'), 'Confirm text in Notepad');
  assert.equal(toolStepLabel(trace('2', { command: 'echo ok' }), 'Run command'), 'Run command');
  assert.equal(toolStepLabel(trace('3', { path: 'notes.txt' }), 'Read file'), 'Read file · notes.txt');
});

test('image selection retains image actions and the selected slide independently of another conversation', async () => {
  const { imageActivitySelection: store } = createTsModuleLoader().loadModule('src/lib/chat/imageActivityNavigation.ts');
  let saved = false;
  const slides = [{ src: 'data:image/png;base64,abc', onSave: () => { saved = true; } }, { src: 'second.png' }];
  store.select('a', { slides, index: 1 });
  store.select('b', { slides: [{ src: 'other.png' }], index: 0 });
  assert.equal(store.get('a').index, 1);
  await store.get('a').slides[0].onSave();
  assert.equal(saved, true);
  store.select('b', null);
  assert.equal(store.get('a').slides[1].src, 'second.png');
});
