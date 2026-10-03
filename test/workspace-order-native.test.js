'use strict';

// Workspace reordering with Herdr's own panel order. radar disabled it there;
// it is what lets each machine keep Herdr's native machine order (local first,
// no plugin sort) and still list its busiest workspaces first.

const test = require('node:test');
const assert = require('node:assert/strict');

const config = require('../lib/config');
const ipc = require('../lib/ipc');
const { WorkspaceOrder } = require('../lib/workspace-order');

const KEYS = new Map([
  ['w1', '000000000010-w1'],
  ['w2', '000000000099-w2'],
  ['w3', '000000000000-w3'],
]);

function run(t, { reorder }) {
  const calls = [];
  t.mock.method(ipc, 'call', async (method, params) => {
    calls.push([method, params]);
    return { result: { workspaces: params.workspace_ids.map((id) => ({ workspace_id: id })) } };
  });
  const saved = config.reorderWorkspaces;
  config.reorderWorkspaces = reorder;
  const order = new WorkspaceOrder();
  return {
    calls,
    sync: () => order.sync(['w1', 'w2', 'w3'], KEYS, new Map(), 1000),
    done: () => {
      config.reorderWorkspaces = saved;
    },
  };
}

test('with reorder_workspaces on, the busiest workspace moves first', async (t) => {
  const { calls, sync, done } = run(t, { reorder: true });
  try {
    assert.equal(await sync(), true);
    assert.deepEqual(calls[0], ['workspace.move_block', { workspace_ids: ['w2', 'w1', 'w3'] }]);
  } finally {
    done();
  }
});

test('with reorder_workspaces off, nothing is moved', async (t) => {
  const { calls, sync, done } = run(t, { reorder: false });
  try {
    assert.equal(await sync(), false);
    assert.equal(calls.length, 0);
  } finally {
    done();
  }
});
