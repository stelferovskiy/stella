const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore } = require('../src/main/store');

test('Computer Use appears in existing skills once and a later removal persists', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stella-skills-'));
  try {
    const dir = path.join(root, 'data');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({
      skills: [{ label: 'My task', prompt: 'Do it' }]
    }));
    const store = createStore(root);
    const skills = store.getSettings().skills;
    assert.equal(skills.length, 2);
    assert.equal(skills[0].label, 'My task');
    assert.equal(skills[1].builtin, 'computerUse');
    assert.equal(createStore(root).getSettings().skills.length, 2);
    store.saveSettings({ skills: skills.slice(0, 1) });
    assert.deepEqual(createStore(root).getSettings().skills.map(s => s.label), ['My task']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('existing user-added Computer Use shortcut is not duplicated', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stella-skills-'));
  try {
    const dir = path.join(root, 'data');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({
      skills: [{ label: 'Управлять компьютером', prompt: 'Используй Computer Use: ' }]
    }));
    assert.equal(createStore(root).getSettings().skills.length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
