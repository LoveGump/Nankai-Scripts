import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const CONFIG = {
  indexUrl:
    'https://eamis.nankai.edu.cn/eams/stdElectCourse!innerIndex.action?projectId=1',
  electionUrl:
    'https://eamis.nankai.edu.cn/eams/stdElectCourse!defaultPage.action?electionProfile.id=2079',
  profileName: '专业课、通识选修课、国际学分课正选第一阶段',
  courseName: '互联网数据库开发',
  lessonId: '656504',
  courseNo: '',
  retryIntervalMs: 1500,
  retryForMs: 30_000,
  postNavigationDelayMs: 1000,
  rateLimitBackoffMs: 2500,
};

const KNOWN_LESSONS = new Map([
  ['656428', '抗量子密码的数学基础(计算机科学中的格理论)'],
  ['656504', '互联网数据库开发'],
]);

function parseArgs(argv) {
  const options = {
    at: undefined,
    courseName: undefined,
    lessonId: undefined,
    courseNo: undefined,
    dryRun: false,
    now: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--at') options.at = argv[++i];
    else if (argv[i] === '--course-name') options.courseName = argv[++i];
    else if (argv[i] === '--lesson-id') options.lessonId = argv[++i];
    else if (argv[i] === '--course-no') options.courseNo = argv[++i];
    else if (argv[i] === '--dry-run') options.dryRun = true;
    else if (argv[i] === '--now') options.now = true;
    else if (argv[i] === '--help') {
      console.log(`
用法：
  npm start
  npm start -- --at "2026-09-03 13:00:00"
  npm start -- --lesson-id 123456 --dry-run
  npm start -- --lesson-id 123456 --now
  npm start -- --lesson-id 123456 --course-name "测试课程名" --dry-run
  npm start -- --course-no 3300 --dry-run
  npm start -- --course-no 3300 --now
  npm start -- --course-name "课程名称" --dry-run
  npm start -- --course-name "课程名称" --now

参数：
  --at       本机时区的执行时间；默认是今天 13:00:00
  --now      登录完成后立即执行（不能和 --at 一起使用）
  --course-name  目标课程名称（可选，用于页面搜索和备用匹配）
  --lesson-id    课程详情链接中的 lesson.id 数字
  --course-no    选课列表第一列显示的课程序号/课号
  --dry-run  找到选课按钮后停止，不点击、不提交
`);
      process.exit(0);
    }
  }
  return options;
}

function targetTime(value) {
  if (value) {
    const normalized = value.trim().replace(' ', 'T');
    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) throw new Error(`无法识别时间：${value}`);
    return parsed;
  }
  const now = new Date();
  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    13,
    0,
    0,
    0,
  );
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const normalizeCourseText = (value) =>
  (value ?? '').replace(/\s+/g, '').replace(/[()（）]/g, '');

function formatTime(date) {
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'medium',
    hour12: false,
  }).format(date);
}

async function waitUntil(when) {
  while (true) {
    const remaining = when.getTime() - Date.now();
    if (remaining <= 0) return;
    if (remaining > 1000) {
      process.stdout.write(`\r距离执行还有 ${Math.ceil(remaining / 1000)} 秒   `);
      await sleep(Math.min(500, remaining - 500));
    } else if (remaining > 12) {
      process.stdout.write(`\r距离执行还有 ${(remaining / 1000).toFixed(3)} 秒   `);
      await sleep(Math.max(1, remaining - 8));
    } else {
      // 最后数毫秒用本机时钟短暂自旋，减少 setTimeout 调度造成的超时。
      while (Date.now() < when.getTime()) {}
      return;
    }
  }
}

async function isLoggedIn(page) {
  if (!page || page.isClosed()) return false;
  try {
    return new URL(page.url()).hostname === 'eamis.nankai.edu.cn';
  } catch {
    return false;
  }
}

function livePages(context) {
  return context.pages().filter((candidate) => !candidate.isClosed());
}

async function currentPage(context, preferred) {
  if (preferred && !preferred.isClosed()) return preferred;

  const pages = livePages(context);
  const eamisPage = pages.find((candidate) => {
    try {
      return new URL(candidate.url()).hostname === 'eamis.nankai.edu.cn';
    } catch {
      return false;
    }
  });
  if (eamisPage) return eamisPage;
  if (pages.length) return pages.at(-1);

  try {
    return await context.newPage();
  } catch {
    throw new Error('Chrome 已被关闭。请重新运行脚本，并保持脚本打开的 Chrome 窗口开启。');
  }
}

function loggedInPage(context) {
  return livePages(context).find((candidate) => {
    try {
      return new URL(candidate.url()).hostname === 'eamis.nankai.edu.cn';
    } catch {
      return false;
    }
  });
}

function allScopes(page) {
  return [page, ...page.frames()];
}

async function findCourseAction(page) {
  for (const scope of allScopes(page)) {
    if (CONFIG.courseNo) {
      const firstCells = await scope.locator('tr > td:first-child').all();
      for (const cell of firstCells) {
        const cellText = normalizeCourseText(await cell.innerText().catch(() => ''));
        if (cellText !== normalizeCourseText(CONFIG.courseNo)) continue;
        if (!(await cell.isVisible().catch(() => false))) continue;
        const row = cell.locator('xpath=parent::tr');
        const rowText = normalizeCourseText(await row.innerText().catch(() => ''));
        const expectedName = normalizeCourseText(CONFIG.courseName);
        if (expectedName && !rowText.includes(expectedName)) continue;
        if (CONFIG.lessonId) {
          const idLink = row.locator(`a[href*="lesson.id=${CONFIG.lessonId}"]`).first();
          if (!(await idLink.count())) continue;
        }
        const action = row
          .getByRole('button', { name: /^(选课|选择|选中)$/ })
          .or(row.getByRole('link', { name: /^(选课|选择|选中)$/ }))
          .filter({ visible: true })
          .first();
        if (await action.count()) return action;
      }
    }

    if (CONFIG.lessonId) {
      const lessonLink = scope
        .locator(`a[href*="lesson.id=${CONFIG.lessonId}"]`)
        .filter({ visible: true })
        .first();
      if (await lessonLink.count()) {
        const row = lessonLink.locator('xpath=ancestor::tr[1]');
        if (await row.count()) {
          const rowText = normalizeCourseText(await row.innerText().catch(() => ''));
          const expectedName = normalizeCourseText(CONFIG.courseName);
          if (expectedName && !rowText.includes(expectedName)) continue;
          const action = row
            .getByRole('button', { name: /^(选课|选择|选中)$/ })
            .or(row.getByRole('link', { name: /^(选课|选择|选中)$/ }))
            .filter({ visible: true })
            .first();
          if (await action.count()) return action;
        }
      }
    }

    if (!CONFIG.courseName) continue;
    const rows = await scope.locator('tr').all();
    for (const row of rows) {
      if (!(await row.isVisible().catch(() => false))) continue;
      const rowText = normalizeCourseText(await row.innerText().catch(() => ''));
      if (!rowText.includes(normalizeCourseText(CONFIG.courseName))) continue;
      const action = row
        .getByRole('button', { name: /选课|选择|选中/ })
        .or(row.getByRole('link', { name: /选课|选择|选中/ }))
        .filter({ visible: true })
        .first();
      if (await action.count()) return action;
    }

    const courseText = scope
      .getByText(CONFIG.courseName, { exact: true })
      .filter({ visible: true })
      .first();
    if (await courseText.count()) {
      const row = courseText.locator('xpath=ancestor::tr[1]');
      if (await row.count()) {
        const action = row
          .getByRole('button', { name: /选课|选择|选中/ })
          .or(row.getByRole('link', { name: /选课|选择|选中/ }))
          .filter({ visible: true })
          .first();
        if (await action.count()) return action;
      }

      // 某些版本用 div/card 而不是表格。
      const container = courseText.locator(
        'xpath=ancestor::*[self::div or self::li][.//button or .//a][1]',
      );
      if (await container.count()) {
        const action = container
          .getByRole('button', { name: /选课|选择|选中/ })
          .or(container.getByRole('link', { name: /选课|选择|选中/ }))
          .filter({ visible: true })
          .first();
        if (await action.count()) return action;
      }
    }
  }
  return null;
}

async function searchCourse(page) {
  // 用户提供课程序号时，必须优先在“课程序号”列查询；课程名称只作校验。
  const query = CONFIG.courseNo || CONFIG.courseName;
  if (!query) return false;
  for (const scope of allScopes(page)) {
    let input = scope
      .locator(
        'input[placeholder*="课程"], input[placeholder*="课号"], input[name*="courseName"], input[name*="lessonName"], input[name*="courseNo"], input[name*="lessonNo"]',
      )
      .first();

    // 该教务系统的表格筛选框没有 placeholder/name；按“课程名称”表头的横坐标定位。
    if (!(await input.count()) || !(await input.isVisible().catch(() => false))) {
      const headerText = CONFIG.courseNo ? '课程序号' : '课程名称';
      const header = scope
        .getByText(headerText, { exact: true })
        .filter({ visible: true })
        .first();
      if (await header.count()) {
        const headerBox = await header.boundingBox().catch(() => null);
        if (headerBox) {
          const inputs = await scope.locator('input').all();
          let best = null;
          let bestDistance = Number.POSITIVE_INFINITY;
          for (const candidate of inputs) {
            if (!(await candidate.isVisible().catch(() => false))) continue;
            const box = await candidate.boundingBox().catch(() => null);
            if (!box) continue;
            const centerX = box.x + box.width / 2;
            if (centerX < headerBox.x || centerX > headerBox.x + headerBox.width) continue;
            const distance = Math.abs(box.y - headerBox.y);
            if (distance < bestDistance) {
              best = candidate;
              bestDistance = distance;
            }
          }
          if (best) input = best;
        }
      }
    }

    if (!(await input.count()) || !(await input.isVisible().catch(() => false))) continue;

    await input.fill(query);
    const search = scope
      .getByRole('button', { name: /查询|搜索|检索/ })
      .or(scope.getByRole('link', { name: /查询|搜索|检索/ }))
      .first();
    if (await search.count()) await search.click();
    else await input.press('Enter');
    // 课程列表通常由 AJAX 更新，给结果表留出渲染时间。
    await sleep(1000);
    return true;
  }
  return false;
}

async function resolveCourseNameFromLessonId(context) {
  if (!CONFIG.lessonId || CONFIG.courseName) return CONFIG.courseName;

  const knownName = KNOWN_LESSONS.get(CONFIG.lessonId);
  const detailPage = await context.newPage();
  detailPage.setDefaultTimeout(2500);
  try {
    const detailUrl =
      `https://eamis.nankai.edu.cn/eams/stdElectCourse!courseInfo.action?lesson.id=${CONFIG.lessonId}`;
    await detailPage.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    const extracted = await detailPage.locator('tr').evaluateAll((rows) => {
      for (const row of rows) {
        const cells = [...row.querySelectorAll('th,td')];
        const labelIndex = cells.findIndex((cell) =>
          (cell.textContent ?? '').replace(/\s+/g, '').includes('课程名称'),
        );
        if (labelIndex >= 0 && cells[labelIndex + 1]) {
          const value = (cells[labelIndex + 1].textContent ?? '').trim();
          if (value && !value.includes('课程名称')) return value;
        }
      }
      return '';
    });
    return extracted || knownName || '';
  } catch {
    return knownName || '';
  } finally {
    await detailPage.close().catch(() => {});
  }
}

async function discoverElectionUrl(page) {
  if (!page.url().includes('stdElectCourse!innerIndex.action')) {
    await page.goto(CONFIG.indexUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  }

  const deadline = Date.now() + 15_000;
  const tokens = ['专业课', '通识选修课', '国际学分课', '正选第一阶段'];

  while (Date.now() < deadline) {
    for (const scope of allScopes(page)) {
      const selected = await scope
        .locator('body')
        .evaluate((body, { profileName, tokens }) => {
          const normalize = (value) => (value ?? '').replace(/\s+/g, '');
          const wanted = normalize(profileName);
          const actionValue = (element) =>
            [
              element.getAttribute('href'),
              element.getAttribute('onclick'),
              element.getAttribute('data-url'),
            ]
              .filter(Boolean)
              .join(' ');
          const isElectionAction = (element) =>
            /defaultPage\.action|electionProfile\.id/.test(actionValue(element));

          // 找到包含完整阶段名的最小元素，避免把整个列表容器误当成目标阶段。
          let labels = [...body.querySelectorAll('*')].filter((element) => {
            const ownText = normalize(element.innerText || element.textContent);
            if (!ownText.includes(wanted)) return false;
            return ![...element.children].some((child) =>
              normalize(child.innerText || child.textContent).includes(wanted),
            );
          });

          // 页面可能在标点处拆分文本；仍要求四个关键短语同时出现在最小容器中。
          if (!labels.length) {
            labels = [...body.querySelectorAll('*')].filter((element) => {
              const ownText = normalize(element.innerText || element.textContent);
              if (!tokens.every((token) => ownText.includes(token))) return false;
              return ![...element.children].some((child) => {
                const childText = normalize(child.innerText || child.textContent);
                return tokens.every((token) => childText.includes(token));
              });
            });
          }

          for (const label of labels) {
            let container = label;
            for (let level = 0; level < 8 && container && container !== body; level += 1) {
              const actions = [
                ...(container.matches('a,button,input,[onclick],[data-url]') ? [container] : []),
                ...container.querySelectorAll('a,button,input,[onclick],[data-url]'),
              ].filter(isElectionAction);
              if (actions.length) return actionValue(actions[0]);
              container = container.parentElement;
            }
          }
          return '';
        }, { profileName: CONFIG.profileName, tokens })
        .catch(() => '');
      if (selected) {
        const action = selected.replaceAll('&amp;', '&');
        const fullUrl = action.match(/(?:https?:\/\/[^'"\s]+)?\/?[^'"\s]*defaultPage\.action\?electionProfile\.id=\d+/)?.[0];
        if (fullUrl) return new URL(fullUrl, page.url()).href;

        const profileId = action.match(/electionProfile\.id\D+(\d+)/)?.[1];
        if (profileId) {
          return new URL(
            `/eams/stdElectCourse!defaultPage.action?electionProfile.id=${profileId}`,
            page.url(),
          ).href;
        }
      }
    }

    await sleep(500);
  }

  await saveDiagnostics(page, 'entry-discovery-error');
  throw new Error(
    `在选课入口页没有找到“${CONFIG.profileName}”。已保存 entry-discovery-error.png 和 entry-discovery-error.html。`,
  );
}

async function confirmSelection(page) {
  for (let round = 0; round < 5; round += 1) {
    await sleep(150);
    for (const scope of allScopes(page)) {
      const modal = scope
        .locator('[role="dialog"], .modal, .ui-dialog, .x-window, .layui-layer')
        .filter({ visible: true })
        .last();
      // 只点击明确位于弹窗内的确认按钮，避免误点页面上的通用“提交”。
      if (!(await modal.count())) continue;
      const confirm = modal
        .getByRole('button', { name: /^(确定|确认|提交|确认选课)$/ })
        .or(modal.getByRole('link', { name: /^(确定|确认|提交|确认选课)$/ }))
        .first();
      if (await confirm.count()) {
        await confirm.click();
        await sleep(250);
        return true;
      }
    }
  }

  return false;
}

async function visibleMessage(page, pattern) {
  for (const scope of allScopes(page)) {
    const message = scope.getByText(pattern).filter({ visible: true }).first();
    if (await message.count()) return await message.innerText().catch(() => '');
  }
  return '';
}

async function saveDiagnostics(page, prefix) {
  await page.screenshot({ path: `${prefix}.png`, fullPage: true }).catch(() => {});
  await writeFile(`${prefix}.html`, await page.content(), 'utf8').catch(() => {});
}

async function hasRateLimitWarning(page) {
  for (const scope of allScopes(page)) {
    const warning = scope
      .getByText(/请不要点击过快|操作过于频繁|请求过于频繁/)
      .filter({ visible: true })
      .first();
    if (await warning.count()) return true;
  }
  return false;
}

async function selectCourse(page, dryRun, useCurrentResults = false) {
  const deadline = Date.now() + CONFIG.retryForMs;
  let searched = useCurrentResults;

  while (Date.now() < deadline) {
    // 每轮先通过页面筛选框查询，再在查询结果中定位，避免点击未过滤的旧列表。
    if (!searched && (CONFIG.courseNo || CONFIG.courseName)) {
      searched = await searchCourse(page);
    }
    const action = await findCourseAction(page);

    if (action) {
      const targetLabel =
        CONFIG.courseName ||
        (CONFIG.courseNo ? `课号=${CONFIG.courseNo}` : `lesson.id=${CONFIG.lessonId}`);
      console.log(`\n已找到“${targetLabel}”的选课按钮。`);
      const matchedRow = await action
        .evaluate((element) => {
          const row = element.closest('tr');
          return {
            text: row?.innerText?.replace(/\s+/g, ' ').trim() ?? '',
            firstCell: row?.querySelector('td:first-child')?.textContent?.trim() ?? '',
            hrefs: [...(row?.querySelectorAll('a[href]') ?? [])].map(
              (link) => link.getAttribute('href') ?? '',
            ),
          };
        })
        .catch(() => ({ text: '', firstCell: '', hrefs: [] }));
      console.log(`匹配到的课程行：${matchedRow.text || '无法读取（已停止真实提交）'}`);
      if (dryRun) {
        await saveDiagnostics(page, 'course-match');
        return 'dry-run';
      }
      if (
        !matchedRow.text ||
        (CONFIG.courseName &&
          !normalizeCourseText(matchedRow.text).includes(normalizeCourseText(CONFIG.courseName))) ||
        (CONFIG.courseNo &&
          normalizeCourseText(matchedRow.firstCell) !== normalizeCourseText(CONFIG.courseNo)) ||
        (CONFIG.lessonId &&
          !matchedRow.hrefs.some((href) => {
            const match = href.match(/[?&]lesson\.id=(\d+)/);
            return match?.[1] === CONFIG.lessonId;
          }))
      ) {
        await saveDiagnostics(page, 'course-match-error');
        throw new Error('课程名称与即将点击的表格行不一致，已停止提交。');
      }

      // 必须在点击前监听：原生 confirm 会同步弹出并阻塞 click。
      let nativeDialogAccepted = false;
      let rateLimited = false;
      let fatalDialogMessage = '';
      const dialogHandler = async (dialog) => {
        const message = dialog.message();
        console.log(`\n浏览器提示：${message}`);
        if (/请不要点击过快|操作过于频繁|请求过于频繁/.test(message)) {
          rateLimited = true;
        } else if (/请求参数非法|参数非法/.test(message)) {
          fatalDialogMessage = message;
        } else {
          nativeDialogAccepted = true;
        }
        await dialog.accept();
      };
      page.on('dialog', dialogHandler);

      const actionInfo = await action
        .evaluate((element) => ({
          tag: element.tagName,
          text: element.textContent?.trim(),
          href: element.getAttribute('href'),
          onclick: element.getAttribute('onclick'),
        }))
        .catch(() => null);
      console.log(`即将点击的控件：${JSON.stringify(actionInfo)}`);
      await action.click();
      await sleep(350);

      if (rateLimited || (await hasRateLimitWarning(page))) {
        page.off('dialog', dialogHandler);
        console.log(`触发页面限速，等待 ${CONFIG.rateLimitBackoffMs / 1000} 秒后重试……`);
        await sleep(CONFIG.rateLimitBackoffMs);
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(() => {});
        await sleep(CONFIG.postNavigationDelayMs);
        searched = false;
        continue;
      }

      const illegalMessage =
        fatalDialogMessage || (await visibleMessage(page, /请求参数非法|参数非法/));
      if (illegalMessage) {
        page.off('dialog', dialogHandler);
        await saveDiagnostics(page, 'selection-error');
        throw new Error(
          `${illegalMessage}。已保存 selection-error.png 和 selection-error.html；该课程可能不属于 electionProfile.id=2079，或页面控件识别有误。`,
        );
      }

      console.log('已点击选课，正在确认……');
      const pageConfirmed = await confirmSelection(page);
      page.off('dialog', dialogHandler);

      // “请求已提交”不等于“选课成功”；读取教务系统返回的操作结果。
      await sleep(500);
      const rejectionMessage = await visibleMessage(
        page,
        /选课失败|失败[:：].*原因|计划外名额已满|课容量已满|名额已满|时间冲突/,
      );
      if (rejectionMessage) {
        await saveDiagnostics(page, 'selection-error');
        throw new Error(`教务系统拒绝选课：${rejectionMessage}`);
      }

      if (!nativeDialogAccepted && !pageConfirmed) {
        await saveDiagnostics(page, 'selection-after-click');
      }
      return nativeDialogAccepted || pageConfirmed ? 'submitted' : 'clicked';
    }

    await sleep(CONFIG.retryIntervalMs);
    // 再次点击页面“查询”更新结果，不刷新整个选课页面。
    searched = false;
  }

  await saveDiagnostics(page, 'course-search-timeout');
  throw new Error(
    `等待 ${CONFIG.retryForMs / 1000} 秒仍未找到目标课程的选课按钮。已保存 course-search-timeout.png 和 course-search-timeout.html。`,
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.at && options.now) throw new Error('--at 和 --now 不能同时使用。');
  const hasCustomTarget =
    options.lessonId !== undefined ||
    options.courseNo !== undefined ||
    options.courseName !== undefined;
  CONFIG.courseNo = options.courseNo ?? '';
  CONFIG.lessonId = hasCustomTarget ? (options.lessonId ?? '') : CONFIG.lessonId;
  CONFIG.courseName = hasCustomTarget ? (options.courseName ?? '') : CONFIG.courseName;
  if (CONFIG.lessonId && !/^\d+$/.test(CONFIG.lessonId)) {
    throw new Error('--lesson-id 必须是课程详情链接中的纯数字。');
  }
  if (CONFIG.courseNo && !/^\d+$/.test(CONFIG.courseNo)) {
    throw new Error('--course-no 必须是选课列表第一列中的纯数字。');
  }
  if (!CONFIG.lessonId && !CONFIG.courseNo && !CONFIG.courseName) {
    throw new Error('请至少提供 --course-name 或 --course-no。');
  }

  const at = options.now ? new Date() : targetTime(options.at);
  if (at.getTime() < Date.now() - 1000 && !options.dryRun) {
    throw new Error(`目标时间 ${formatTime(at)} 已经过了，请用 --at 指定新时间。`);
  }

  const profileDir = path.resolve('.chrome-course-profile');
  const context = await chromium.launchPersistentContext(profileDir, {
    channel: 'chrome',
    headless: false,
    viewport: null,
    args: ['--start-maximized'],
  });
  const restoredPages = context.pages();
  let page = restoredPages[0] ?? (await context.newPage());
  // 持久化配置可能恢复上次遗留页面；只保留一个主页面，避免误判登录状态。
  for (const stalePage of restoredPages.slice(1)) {
    await stalePage.close().catch(() => {});
  }
  page.setDefaultTimeout(1500);
  context.on('page', (openedPage) => {
    // 统一身份认证可能新开标签页，并关闭登录前的旧标签页。
    openedPage.setDefaultTimeout(1500);
    page = openedPage;
  });

  const targetLabel = CONFIG.courseName || '未提供课程名';
  const targetId = CONFIG.courseNo
    ? `course-no=${CONFIG.courseNo}`
    : `lesson.id=${CONFIG.lessonId}`;
  console.log(`目标课程：${targetLabel}（${targetId}）`);
  console.log(`执行时间：${formatTime(at)}`);
  console.log('正在打开选课入口；如出现统一身份认证，请现在手动登录。');
  await page.goto(CONFIG.indexUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });

  while (!(await isLoggedIn(page))) {
    page = await currentPage(context, page);
    process.stdout.write('\r等待你完成南开统一身份认证……   ');
    await sleep(1000);
  }
  console.log('\n登录状态已就绪。请保持本程序和 Chrome 窗口开启。');

  page = await currentPage(context, page);
  if (CONFIG.lessonId && !CONFIG.courseName) {
    CONFIG.courseName = await resolveCourseNameFromLessonId(context);
    if (CONFIG.courseName) console.log(`由 lesson.id 解析出的课程名称：${CONFIG.courseName}`);
    else throw new Error(`无法从 lesson.id=${CONFIG.lessonId} 解析课程名称，无法使用页面查询。`);
    // 临时详情页关闭后，重新取得仍然打开的教务系统主页面。
    page = await currentPage(context, page);
  }
  CONFIG.electionUrl = await discoverElectionUrl(page);
  const profileId = new URL(CONFIG.electionUrl).searchParams.get('electionProfile.id');
  console.log(`已找到选课阶段：${CONFIG.profileName}`);
  console.log(`本次动态获取的 electionProfile.id：${profileId ?? '未识别'}`);
  await page.goto(CONFIG.electionUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });

  if (options.dryRun) {
    page = await currentPage(context, page);
    const result = await selectCourse(page, true);
    console.log(`试运行结束：${result}，未点击、未提交。`);
    return;
  }

  // 定时任务提前完成页面查询；到点时只定位并点击当前结果中的按钮。
  let prepositioned = false;
  if (at.getTime() - Date.now() > 2500 && (CONFIG.courseNo || CONFIG.courseName)) {
    console.log('正在提前查询并锁定目标课程……');
    const searched = await searchCourse(page);
    const preparedAction = searched ? await findCourseAction(page) : null;
    if (preparedAction) {
      prepositioned = true;
      const preparedRow = await preparedAction
        .evaluate((element) => element.closest('tr')?.innerText?.replace(/\s+/g, ' ').trim() ?? '')
        .catch(() => '');
      console.log(`已提前锁定课程行：${preparedRow}`);
      console.log('请勿刷新、关闭或操作该 Chrome 页面，等待 13:00 自动点击。');
    } else {
      console.log('暂未提前找到课程，到点后会继续通过查询框检索。');
    }
  }

  await waitUntil(at);
  console.log('\n到达执行时间，开始选课。');
  page = await currentPage(context, page);
  const alreadyOnElectionPage = page.url().includes('stdElectCourse!defaultPage.action');
  if (!prepositioned && (!options.now || !alreadyOnElectionPage)) {
    await page.goto(CONFIG.electionUrl, { waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(() => {});
    await sleep(CONFIG.postNavigationDelayMs);
  }
  page = await currentPage(context, page);
  const result = await selectCourse(page, false, prepositioned);

  if (result === 'submitted') {
    console.log('已点击选课并点击页面确认/提交按钮，请在页面中核对最终结果。');
  } else {
    console.log('已点击选课；页面未出现可识别的确认按钮，请立即查看当前页面。');
  }

  await page.screenshot({ path: 'selection-result.png', fullPage: true }).catch(() => {});
  console.log('结果截图（如成功生成）：selection-result.png');
}

main().catch((error) => {
  console.error(`\n执行失败：${error.message}`);
  process.exitCode = 1;
});
