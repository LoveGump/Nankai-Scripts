const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../peer-assessment.user.js'), 'utf8');
const fn = source.slice(source.indexOf('  function collectStudents()'), source.indexOf('  async function loadStudent'));
function collect(paths, ledger = {}, path = '/student/stuassess/id/3113.html') {
  const origin = 'https://fuxue.nankai.edu.cn';
  const context = {
    URL, location: { origin, pathname: path, href: origin + path },
    normalize: s => (s || '').replace(/\s+/g, ''), readLedger: () => ledger,
    document: { querySelectorAll: () => paths.map(item => ({
      textContent: '评价', getAttribute: () => typeof item === 'string' ? item : item.url,
      closest: () => typeof item === 'string' ? null : {
        querySelector: () => null, querySelectorAll: () => [{ textContent: item.status }]
      }
    })) }
  };
  return vm.runInNewContext(fn + '; collectStudents()', context);
}
const url = sid => `/student/otherstu/mid/3113/sid/${sid}.html`;
test('同一学生去重，只收集同源且属于当前互评任务的链接', () => {
  const result = collect([url(1), url(1) + '?foo=1', url(2), '/student/otherstu/mid/999/sid/3.html', 'https://example.com' + url(4)]);
  assert.equal(result.length, 2);
});
test('跳过已评价、已成功及结果不明；保留未评价', () => {
  const origin = 'https://fuxue.nankai.edu.cn';
  const result = collect([{ url: url(1), status: '已评价' }, { url: url(2), status: '未评价' }, url(3), url(4)], {
    [origin + url(3)]: 'done', [origin + url(4)]: 'pending'
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].url, origin + url(2));
});
test('详情页不能启动列表队列', () => {
  assert.throws(() => collect([], {}, url(1)), /列表页/);
});
