'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
global.CampusDeskThemeEdition = true;
const Core = require('../Resources/core.js');
delete global.CampusDeskThemeEdition;
test('OpenAI provider and model survive state and backup validation independently of DeepSeek', () => {
  const state = Core.emptyState();
  Object.assign(state.settings, { aiProvider: 'openai', aiOpenAIModel: 'gpt-6-luna', aiModel: 'deepseek-flash' });
  const restored = Core.validateState(JSON.parse(JSON.stringify(state)));
  assert.equal(restored.settings.aiProvider, 'openai');
  assert.equal(restored.settings.aiOpenAIModel, 'gpt-6-luna');
  assert.equal(restored.settings.aiModel, 'deepseek-flash');
  assert.doesNotMatch(JSON.stringify(restored), /apiKey|openAIKey|sk-proj-/);
});
