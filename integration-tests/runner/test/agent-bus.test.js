const { describe, it } = require('node:test');
const assert = require('node:assert');
const { AgentCooperation, semanticFor, SEMANTIC_RESOLUTION } = require('../lib/ai-world/agent-bus');
const { AgentBus, makeMessage } = require('../lib/ai-world/hermes-bridge');

describe('semanticFor', () => {
  it('miner -> share, closed space, miner: factKey', () => {
    const r = semanticFor({
      who: 'Steve',
      job: 'miner',
      observation: { x: 5203.7, y: 40, z: 5193.2, block_below: 'COBBLESTONE' },
    });
    assert.ok(r != null, 'expected a share object');
    assert.strictEqual(r.intent, 'share');
    assert.ok(r.content.includes('mining'), 'content mentions mining');
    assert.ok(r.content.includes('5204') && r.content.includes('5193'), 'content has position');
    assert.ok(r.factKey.startsWith('miner:'), 'factKey starts miner:');
    assert.strictEqual(r.space, 'closed');
  });

  it('builder -> share, open space, build: factKey', () => {
    const r = semanticFor({
      who: 'Alex',
      job: 'builder',
      site: 'farmhouse',
      observation: { x: 5210, y: 72, z: 5200 },
    });
    assert.ok(r != null);
    assert.strictEqual(r.intent, 'share');
    assert.ok(
      r.content.includes('building') && r.content.includes('farmhouse'),
      'content has building + site'
    );
    assert.ok(r.factKey.startsWith('build:'), 'factKey starts build:');
    assert.strictEqual(r.space, 'open');
  });

  it('farmer -> share, open space, farm: factKey', () => {
    const r = semanticFor({
      who: 'Steve',
      job: 'farmer',
      observation: { x: 5203, y: 71, z: 5193 },
    });
    assert.ok(r != null);
    assert.strictEqual(r.intent, 'share');
    assert.ok(r.content.includes('farming'), 'content mentions farming');
    assert.ok(r.factKey.startsWith('farm:'), 'factKey starts farm:');
  });

  it('hostiles > 0 -> share, indoor, combat:watch, high priority', () => {
    const r = semanticFor({
      who: 'Steve',
      observation: {
        x: 5203,
        y: 71,
        z: 5193,
        hostiles: 3,
        nearest_hostile: { type: 'ZOMBIE', distance: 5.2 },
      },
    });
    assert.ok(r != null);
    assert.strictEqual(r.intent, 'share');
    assert.ok(
      r.content.includes('combat') && r.content.includes('3'),
      'content mentions combat + count'
    );
    assert.strictEqual(r.factKey, 'combat:watch');
    assert.strictEqual(r.priority, 0.8);
    assert.strictEqual(r.space, 'indoor');
  });

  it('low health -> share, indoor, health: factKey', () => {
    const r = semanticFor({
      who: 'Alex',
      observation: { x: 5203, y: 71, z: 5193, health: 0.18 },
    });
    assert.ok(r != null);
    assert.strictEqual(r.intent, 'share');
    assert.ok(r.content.includes('low on health'), 'content mentions low health');
    assert.strictEqual(r.priority, 0.7);
    assert.strictEqual(r.space, 'indoor');
  });

  it('no job/focus/hostiles/low_health -> null', () => {
    const r = semanticFor({ who: 'Steve', observation: { x: 5203, y: 71, z: 5193 } });
    assert.strictEqual(r, null);
  });
});

describe('AgentCooperation', () => {
  it('subscribe + share: peer receives message', async () => {
    const bus = new AgentBus();
    const ac = new AgentCooperation({ bus });
    const received = [];
    ac.subscribe('Steve', (msg) => {
      received.push(msg);
    });
    ac.subscribe('Alex', (msg) => received.push(msg));

    // Fire-and-forget publish — await so handlers have flushed.
    await ac.share('Alex', 'all', 'building: I am at the farmhouse', {
      factKey: 'build:farmhouse:5210:5200',
      priority: 0.3,
      space: 'SPATIAL',
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.ok(received.length >= 2, `expected at least 2 messages (Steve + Alex), got ${received.length}`);
  });

  it('share mirrors SPATIAL fact into shared worldMemory', async () => {
    const bus = new AgentBus();
    const ac = new AgentCooperation({ bus });
    await ac.share('Alex', 'all', 'cave: I found a cave at (5203/5193)', {
      factKey: 'cave:5203:5193',
      priority: 0.9,
      space: 'SPATIAL',
    });
    // The SPATIAL mirror runs inside share() (async, awaited above).
    const cave = ac.worldMemory.get('cave:5203:5193');
    assert.ok(cave != null, 'SPATIAL fact mirrored into worldMemory');
    assert.strictEqual(cave.value, 'cave: I found a cave at (5203/5193)');
    assert.strictEqual(cave.stale, false);
  });

  it('publishSituation derives from semanticFor and shares', async () => {
    const bus = new AgentBus();
    const ac = new AgentCooperation({ bus });
    const received = [];
    ac.subscribe('all', (msg) => received.push(msg));
    await ac.publishSituation(
      'Steve',
      semanticFor({
        who: 'Steve',
        job: 'miner',
        observation: { x: 5203, y: 40, z: 5193, block_below: 'STONE' },
      })
    );
    // At least the subscriber received something.
    assert.ok(received.length >= 1, 'publishSituation delivered a message to the subscriber');
    assert.ok(received[0].content.includes('mining'), 'delivered content mentions mining');
  });

  it('SEMANTIC_RESOLUTION order is SPATIAL > SPECIFIC > INTERPRETATIVE', () => {
    assert.deepStrictEqual(SEMANTIC_RESOLUTION, ['SPATIAL', 'SPECIFIC', 'INTERPRETATIVE']);
  });

  it('makeMessage produces a well-formed AgentMessage', () => {
    const msg = makeMessage({
      sender: 'Steve',
      receiver: 'Alex',
      intent: 'share',
      type: 'SEMANTIC',
      content: 'cave at (5203,5193)',
      priority: 0.5,
      context: { factKey: 'cave:5203:5193', space: 'SPATIAL' },
    });
    assert.strictEqual(msg.sender, 'Steve');
    assert.strictEqual(msg.receiver, 'Alex');
    assert.strictEqual(msg.intent, 'share');
    assert.strictEqual(msg.type, 'SEMANTIC');
    assert.strictEqual(msg.content, 'cave at (5203,5193)');
    assert.strictEqual(msg.priority, 0.5);
    assert.deepStrictEqual(msg.context, { factKey: 'cave:5203:5193', space: 'SPATIAL' });
  });
});
