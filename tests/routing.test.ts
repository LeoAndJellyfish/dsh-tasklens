import { test } from 'node:test';
import assert from 'node:assert/strict';
import { route, rounded, segmentClear, type Rect } from '../src/client/routing.js';
test('正交路径绕过节点和标题，圆角范围内保持避障余量', () => { const obstacles: Rect[] = [{ left: 80, top: 30, right: 180, bottom: 160 }, { left: 30, top: 180, right: 240, bottom: 210 }];
  const points = route({ x: 20, y: 80 }, { x: 270, y: 240 }, obstacles, 300, 300, [], 'a'); assert(points);
  for (let i = 1; i < points.length; i++) { assert(points[i].x === points[i - 1].x || points[i].y === points[i - 1].y); assert(segmentClear(points[i - 1], points[i], obstacles)); }
  assert(rounded(points).includes('Q')); assert(rounded(points).endsWith('270 240'));
});
test('无法避障的关系明确失败，避免穿过任务卡片', () => { const obstacle = { left: 0, top: 0, right: 300, bottom: 300 }; assert.equal(route({ x: 10, y: 10 }, { x: 290, y: 290 }, [obstacle], 300, 300, [], 'a'), null); });
test('多个关系使用独立端点，重复计算保持相同路线', () => { const obstacles: Rect[] = [{ left: 90, top: 70, right: 170, bottom: 170 }];
  const a = route({ x: 40, y: 100 }, { x: 240, y: 110 }, obstacles, 300, 250, [], 'a'); const b = route({ x: 40, y: 100 }, { x: 240, y: 110 }, obstacles, 300, 250, [], 'a'); assert.deepEqual(a, b);
});
