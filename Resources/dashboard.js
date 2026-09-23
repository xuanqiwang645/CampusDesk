(function () {
  'use strict';
  const Core = window.CampusCore;
  if (!Core) {
    document.getElementById('content').textContent = '核心文件 core.js 未能加载。请重新解压完整的 CampusDesk 文件夹。';
    return;
  }
  const native = Boolean(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.campus);
  const storageKey = 'campusdesk.browser.v1';
  let state = Core.emptyState();
  let page = ['overview', 'learning', 'schedule', 'grades', 'tasks', 'feedback', 'teams', 'ec', 'settings'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'overview';
  let selectedDate = Core.today();
  let taskFilter = 'open';
  let taskSubjectFilter = 'all';
  let customScheduleMode = 'period';
  let customScheduleDays = [];
  let customScheduleKind = 'weekly';
  let customSchedulePattern = 'all';
  let customScheduleOneDate = '';
  let customScheduleDraft = { title: '', room: '', period: '', start: '', end: '' };
  let feedbackFilter = 'all';
  let teamsFilter = 'all';
  let teamsChannelFilter = 'all';
  let ecQuery = '', ecDateFilter = 'all', renderedPage = null;
  let detailTaskId = null;
  let notificationPermission = 'unknown';
  let learningQuery = '';
  let cachedSearchIndex = null;
  let draggingTaskID = '';
  let pageSwitchAnimation = null;
  let gpaChartMountScheduled = false;
  let teamsPostsCache = new Map();
  let ecSearchIndex = null;
  let ecSearchBuildToken = 0;
  let ecSearchBuildProgress = 0;
  let ecVisibleLimit = 40;
  let teamsVisibleLimit = 40;
  const MESSAGE_PAGE_SIZE = 40;
  let lastReminderSignature = '';
  let lastRenderedDay = Core.today();
  let lastClockBoundary = '';
  let statuses = {};
  // Authentication stays in the native layer; only display-safe status lives here.
  let graphStatus = { configured: false, connected: false, busy: false, displayName: '', message: '', clientId: '', tenant: 'organizations', requiresAdminConsent: false };
  let graphConfigurationDraft = null;
  let teamsAuto = { running: false, phase: 'idle', message: '登录 Teams 后自动发现频道和聊天。', counts: {}, warnings: [], coverageItems: [] };
  let gpaKlineChart = null;
  let gpaKlineChartKey = '';
  let gpaKlineWheelAt = -Infinity;
  const GPA_KLINE_INTERVALS = [
    { ms: 60 * 60 * 1000, label: '1 小时', short: '1h', chart: { type: 'hour', span: 1 } },
    { ms: 2 * 60 * 60 * 1000, label: '2 小时', short: '2h', chart: { type: 'hour', span: 2 } },
    { ms: 4 * 60 * 60 * 1000, label: '4 小时', short: '4h', chart: { type: 'hour', span: 4 } },
    { ms: 6 * 60 * 60 * 1000, label: '6 小时', short: '6h', chart: { type: 'hour', span: 6 } },
    { ms: 12 * 60 * 60 * 1000, label: '12 小时', short: '12h', chart: { type: 'hour', span: 12 } },
    { ms: 24 * 60 * 60 * 1000, label: '1 天', short: '1d', chart: { type: 'day', span: 1 } },
    { ms: 2 * 24 * 60 * 60 * 1000, label: '2 天', short: '2d', chart: { type: 'day', span: 2 } },
    { ms: 3 * 24 * 60 * 60 * 1000, label: '3 天', short: '3d', chart: { type: 'day', span: 3 } },
    { ms: 7 * 24 * 60 * 60 * 1000, label: '7 天', short: '7d', chart: { type: 'day', span: 7 } },
    { ms: 14 * 24 * 60 * 60 * 1000, label: '14 天', short: '14d', chart: { type: 'day', span: 14 } },
    { ms: 30 * 24 * 60 * 60 * 1000, label: '30 天', short: '30d', chart: { type: 'day', span: 30 } }
  ];
  let gpaKlineIntervalIndex = 5;
  let toastTimer = null;
  let lastMenuTitle = '';
  let lastMenuCountdown = '';
  let markupEscapes = null;
  const pageNames = { overview: '总览', learning: '学习中心', schedule: '课程表', grades: '成绩与 GPA', tasks: '待办事项', feedback: '老师反馈', teams: 'Teams 消息', ec: 'English Corner', settings: '连接与设置' };
  // Only CampusDesk's own fixed labels are translated. School data stays exactly as received.
  const english = Object.freeze({
    '总览': 'Overview', '学习中心': 'Study Center', '课程表': 'Schedule', '成绩与 GPA': 'Grades & GPA', '待办事项': 'To-Do', '老师反馈': 'Teacher Feedback', 'Teams 消息': 'Teams Messages', '连接与设置': 'Connections & Settings', '希悦': 'Seiue',
    '学习，一目了然': 'Study, in view', '我的校园': 'My Campus', '北京时间': 'Beijing time', '把今天留给重要的事。': 'Make today count.', '同步数据': 'Sync data', '尚未同步': 'Not synced',
    '界面语言': 'Interface language', '选择 CampusDesk 的界面语言。课程、作业、消息、附件和学校原文保持原样，不会被翻译。': 'Choose the CampusDesk interface language. Courses, assignments, messages, attachments, and school content stay exactly as received.', '简体中文': 'Simplified Chinese',
    '让它适合你的每一天。': 'Make it work for every day.', '学校系统各自登录；课表、任务和频道原文保存在本机。': 'Sign in to each school system separately; schedules, tasks, and channel content remain on this Mac.', '更改会立即应用到导航、页面标题、按钮与固定说明文字。': 'Changes apply immediately to navigation, page titles, buttons, and fixed help text.',
    '面板样式': 'Dashboard style', '经典面板': 'Classic dashboard', '卡片看板': 'Card board', '熟悉的课程、成绩与待办布局': 'Familiar schedule, grades, and to-do layout', '统计概览与密集任务卡片': 'At-a-glance metrics and focused task cards', 'GPA K 线涨跌颜色': 'GPA candle colors', '选择成绩上升和下降时 K 线的颜色，设置会保存在本机。': 'Choose how rising and falling GPA candles are colored. This preference stays on this Mac.', '红涨绿跌': 'Red up, green down', '绿涨红跌': 'Green up, red down', 'GPA K 线已设为绿涨红跌。': 'GPA candles are set to green up, red down.', 'GPA K 线已设为红涨绿跌。': 'GPA candles are set to red up, green down.',
    '日常偏好': 'Daily preferences', '学校连接': 'School connections', '数据与备份': 'Data & backups', '自动刷新间隔': 'Automatic refresh interval', '空白课节显示为自习': 'Show open periods as self-study', '显示时区': 'Display time zone', '每 5 分钟': 'Every 5 minutes', '每 15 分钟': 'Every 15 minutes', '每 30 分钟': 'Every 30 minutes', '每小时': 'Hourly',
    '自编课表': 'Custom schedule', '添加自编课程': 'Add custom class', '课程名称': 'Class name', '教室（可选）': 'Room (optional)', '选择星期': 'Choose weekdays', '按节次': 'By period', '按时刻': 'By time', '第几节': 'Period', '开始时间': 'Start time', '结束时间': 'End time', '保存自编课程': 'Save custom class', '已添加': 'Added', '删除自编课程': 'Delete custom class', '请选择至少一天': 'Choose at least one weekday', '结束时间将自动补为开始时间后 45 分钟。': 'An empty or invalid end time is filled as 45 minutes after the start.', '按时间填写时，会按重叠比例自动归入对应节次。': 'Time-based entries are assigned by overlap with the matching period.', '周日': 'Sun', '周一': 'Mon', '周二': 'Tue', '周三': 'Wed', '周四': 'Thu', '周五': 'Fri', '周六': 'Sat',
    '上课日期': 'Class date', '操作': 'Action', '如：晨会、社团': 'e.g. morning meeting or club', '如：操场': 'e.g. playground', '如：调课后的课程': 'e.g. adjusted class name', '选择节次后自动带出时间': 'Choose a period to fill in the times', '填入开始时间后会自动识别节次': 'A period is suggested after you enter the start time', '将归入 ': 'Assigned to ', '未匹配节次，将按开始时间插入': 'No period match; will be placed by start time', '该节次暂无已读取的时间': 'No captured time is available for this period', '尚未设置节假日；设置后当天常规课表和每周自编课程会隐藏。': 'No holidays set. Adding one hides regular and weekly custom classes for that date.',
    '希悦网址': 'Seiue URL', '学校 ManageBac 网址': 'School ManageBac URL', '导出或恢复本机数据': 'Export or restore local data', '构建时配置；未配置时不会连接。': 'Configured at build time; no connection is made when it is empty.', '构建时配置；仅允许指定学校的精确地址。': 'Configured at build time; only the approved school address is allowed.',
    'Teams 作业提醒': 'Teams assignment reminders', '截止前系统通知': 'System notifications before due dates', '提前多久提醒': 'Reminder lead time',
    '课程成绩': 'Course grades', '学校 GPA': 'School GPA', '参考 GPA': 'Estimated GPA', '今日课程': 'Today\'s classes', '全部待办': 'All to-dos', '添加待办': 'Add to-do', '查看全部': 'View all',
    'Teams 作业': 'Teams assignments', 'ManageBac 作业': 'ManageBac assignments', '个人待办': 'Personal to-dos', '作业来源': 'Assignment source', '学科': 'Subject', '特别关注': 'Favorite', '已关注': 'Following',
    '未完成': 'Open', '已逾期': 'Overdue', '已完成': 'Completed', '全部': 'All', '全部学科': 'All subjects', '全部频道': 'All channels', '全部消息': 'All messages', '作业消息': 'Assignment messages', '其他通知': 'Other notifications',
    '打开 Teams': 'Open Teams', '登录／打开 Teams': 'Sign in / Open Teams', '打开 ManageBac': 'Open ManageBac', '打开希悦课表': 'Open schedule', '查看要求': 'View requirements', '查看原文 ↗': 'View original ↗', '查看 Teams 原文 ↗': 'View Teams original ↗',
    '前一天': 'Previous day', '后一天': 'Next day', '今天': 'Today', '保存页面': 'Save page', '导出备份': 'Export backup', '导入备份': 'Import backup',
    '为每一节课，留好位置。': 'Make room for every class.', '以北京时间展示课程。空白课节按你的设置显示为自习。': 'Classes use Beijing time. Open periods follow your self-study preference.',
    '看见积累，也看见进步。': 'See the progress you have made.', '先确认成绩来自哪一门课、哪一个学期，再理解 GPA。': 'Confirm the course and term before interpreting GPA.',
    '一件一件，慢慢完成。': 'One task at a time.', '先分 Teams 与 ManageBac，再在各自来源内按学科整理。': 'Teams and ManageBac are separated first, then grouped by subject.',
    '认真读懂，每一次反馈。': 'Read every piece of feedback carefully.', '把老师的建议带回下一次学习。': 'Bring each teacher suggestion into your next study session.',
    '频道里的重要信息，在这里。': 'Important channel updates, in one place.', '按发件人和频道整理；特别关注仅影响 CampusDesk 的优先展示。': 'Grouped by sender and channel; favorites only affect CampusDesk ordering.',
    'English Corner，记得赴约。': 'English Corner, don\'t miss it.', '搜索已读取原文和附件文字，核对最新安排。': 'Search captured posts and attachment text to confirm the latest plan.',
    '现在没有待完成的事项': 'Nothing is due right now', '等待处理的任务': 'Tasks waiting for you', '优先回到原页面核对': 'Check the source page first', '有明确截止时间': 'With confirmed due dates', '仅本机勾选记录': 'Local completion records only', '等待成绩同步': 'Waiting for grade sync', '登录希悦并打开课表后，这里会显示当天课程。': 'Sign in to Seiue and open the schedule to see today\'s classes here.', '卡片只整理已经读取到的课程、成绩和作业；点击学校任务可查看原文要求。': 'Cards organize only captured schedules, grades, and assignments; open school tasks to read the original requirements.', '标为已完成：': 'Mark complete: ', '标为未完成：': 'Mark incomplete: ',
    '集中处理最重要的事': 'Focus on what matters most', '今日提示': 'Today\'s note', '信息以原平台为准': 'The source platform is authoritative', '等待课表同步': 'Waiting for schedule sync', '节已读取课程': 'captured classes', '7 天内': 'Within 7 days', 'CAMPUSDESK · 学习看板': 'CAMPUSDESK · STUDY BOARD', '今天，稳稳推进。': 'Today, make steady progress.', '把今天的课程和待办排得清清楚楚。': 'Keep today\'s classes and to-dos clear and organized.',
    '今天，也有条不紊。': 'Today, steady and organized.', '课程、成绩和待办，在这里从容安排。': 'Schedule, grades, and to-dos, organized in one place.', '完整课表': 'Full schedule', '先把你的课程表接进来': 'Connect your schedule first', '在应用中登录希悦并打开课程表，这里的每一天就有了安排。': 'Sign in to Seiue and open your schedule to plan each day here.', '打开希悦': 'Open Seiue', '成绩详情': 'Grade details', '非官方 · 等权参考': 'Unofficial · equally weighted', '门可用课程': ' available courses', '90 / 80 / 70 / 60 分 → 4 / 3 / 2 / 1，不含 AP 加权。': '90 / 80 / 70 / 60 points → 4 / 3 / 2 / 1. AP weighting is not included.', '不含 AP 加权。': 'AP weighting is not included.', '待办一览': 'To-do overview', '今日截止': 'Due today', '接下来要做': 'Up next', '完成勾选仅保存在本机': 'Completion checks stay on this Mac', '不代表已向学校提交': 'They do not submit work to school', '老师的反馈': 'Teacher feedback', '等待新的反馈': 'Waiting for new feedback', '同步后汇总已读取的老师评语。仅覆盖已读取页面。': 'Captured teacher feedback appears after sync; coverage is limited to pages read.', '个附件': ' attachment(s)', '打开学校任务': 'Open school task',
    '课表日期': 'Schedule date', '自习仅补充学校页面中能确认时间的空白课节，不推测未读取的课表。': 'Self-study only fills confirmed open periods; it does not infer an unread schedule.', '勾选仅更新本机待办状态，不会提交作业、回复老师或修改 ManageBac / Teams。学科特别关注只保存在本机。': 'Checks only update local to-do status; they never submit work, reply to teachers, or modify ManageBac / Teams. Subject favorites stay on this Mac.',
    '发件人未标明': 'Sender unknown', '收件人未标明': 'Recipient unknown', '频道未标明': 'Channel unknown', '作业消息': 'Assignment message', 'EC 通知': 'EC notice', '频道消息': 'Channel message', '发送者未标明': 'Sender unknown', '发布日期未确认': 'Publication date unconfirmed', 'English Corner 通知': 'English Corner notice', '本条消息未读取到文字，请打开原页面。': 'This message has no captured text; open the original page.', '查看未完成范围': 'View incomplete coverage',
    'Teams 自动同步 · 0.4.0': 'Teams automatic sync · 0.4.0', '登录 Teams 后自动发现频道和聊天。': 'Sign in to Teams to automatically discover channels and chats.', '立即自动同步': 'Sync now', '优先读取 EC': 'Prioritize EC', '停止本轮': 'Stop this run', '连接设置': 'Connection settings', 'Teams 待完成作业': 'Teams open assignments', '自动发现账号可见页面，优先读取 EC；无需逐页关注。应用运行、Mac 唤醒且联网时按设置周期更新。学校要求重新验证时需要你登录。正式作业、成绩及全部历史尚未验证，不会当作已完整同步。': 'Automatically discovers pages visible to your account, prioritizing EC; no page-by-page following is needed. The app updates on schedule while running, awake, and online. Sign in again when the school asks. Assignments, grades, and full history are not yet verified as complete.', '查看未完成范围（': 'View incomplete coverage (', '范围（': 'coverage (', '正文尚未读取': 'Text not captured', '仅覆盖已加载消息': 'Only loaded messages are covered',
    '先核对取消或变更通知，再查看对应日期的名单；旧名单不代表今天的安排。下面按通知的明确发布日期筛选，不推断活动日期或参与人员。附件提取文字可能不完整，未匹配到姓名不代表不在名单中，请核对原件。': 'Check cancellation or change notices first, then review the roster for the relevant date; an old roster does not represent today\'s plan. Results use explicit publication dates and do not infer event dates or attendees. Attachment extraction may be incomplete; a missing name is not proof of absence, so check the original.', '姓名或全文': 'Name or full text', '搜索通知和已解析附件': 'Search notices and parsed attachments', '通知发布日期': 'Notice publication date', '全部日期': 'All dates', '仅日期未确认': 'Date unconfirmed only', '清除筛选': 'Clear filters', '条已读取通知': ' captured notices',
    '全部反馈': 'All feedback', '这里汇总 ManageBac 评语和 Teams 已发布的作业反馈，覆盖范围取决于同步结果。尚未读取的课程、附件或历史内容请到学校原页面查看。已读标记仅保存在本机。': 'This page combines ManageBac comments and published Teams assignment feedback. Coverage depends on sync; check the school pages for unread courses, attachments, or history. Read markers stay on this Mac.', '等待老师的下一条建议': 'Waiting for the next teacher suggestion', '登录 ManageBac 并打开评语页，或连接 Teams 同步已发布的作业反馈。': 'Sign in to ManageBac and open comments, or connect Teams to sync published assignment feedback.',
    '打开成绩页面': 'Open grades', '学校公布': 'Published by school', '非官方 · 4.0 制': 'Unofficial · 4.0 scale', '尚未读取到学校公布的 GPA。这里不会用参考值替代。': 'No published school GPA has been captured. The estimate will not replace it.', '根据': 'Based on ', '门已读取课程': ' captured courses', '等权估算。': ' courses, equally weighted.', '参考换算：90–100 → 4.0；80–89.99 → 3.0；70–79.99 → 2.0；60–69.99 → 1.0；低于 60 → 0。仅使用能确认的当前学期课程总评，不把单次作业分数当总评；不含学分与 AP 加权，也不代表学校的换算规则。': 'Reference conversion: 90–100 → 4.0; 80–89.99 → 3.0; 70–79.99 → 2.0; 60–69.99 → 1.0; below 60 → 0. Only confirmed current-term course grades are used; individual assignment scores are not treated as final grades. Credits and AP weighting are excluded, and this is not the school\'s official conversion.', '你的成绩，值得准确地记录': 'Your grades deserve an accurate record', '登录 ManageBac 并打开当前学期成绩页面。读取到课程总评后，参考 GPA 会自动计算。': 'Sign in to ManageBac and open the current-term grades page. Estimated GPA is calculated after course grades are captured.',
    '课程表 · 上课时间 · 教室': 'Schedule · class times · rooms', '作业要求 · 提醒 · EC 通知': 'Assignment requirements · reminders · EC notices', '课程成绩 · 学校任务 · 老师反馈': 'Course grades · school tasks · teacher feedback', '尚未连接': 'Not connected', '最近读取：': 'Last read: ', '登录并连接': 'Sign in and connect', '退出登录': 'Sign out', '在浏览器打开 Teams': 'Open Teams in browser', '自动发现 · EC 附件 · 本机缓存': 'Automatic discovery · EC attachments · local cache', '浏览器自动同步': 'Browser automatic sync', '频道消息 · 作业要求 · EC 名单': 'Channel messages · assignments · EC rosters', '待首次配置': 'Initial setup needed', '等待登录': 'Waiting for sign-in', '已连接': 'Connected', '正在同步': 'Syncing', '正在读取': 'Reading',
    'Teams 连接方式': 'Teams connection method', '浏览器模式复用你的学校登录。Graph 模式需要独立应用配置及学校授权。': 'Browser mode reuses your school sign-in. Graph mode needs separate app configuration and school authorization.', '浏览器自动发现': 'Browser automatic discovery', '微软 Graph 授权': 'Microsoft Graph authorization', '定时自动发现和同步': 'Scheduled discovery and sync', '关闭后停止当前自动读取，保留已同步内容。': 'Turn off to stop automatic reading while keeping synced content.', '也同步我参与的聊天': 'Also sync chats I participate in', '关闭后只自动读取团队频道。': 'When off, only team channels are read automatically.', '浏览器连接与授权': 'Browser connection & authorization', '学校账号只在 Chrome 或 Edge 中登录。CampusDesk 使用专用 Teams 同步标签读取消息和可访问附件；接口不可用时尝试页面读取。': 'Sign in to the school account only in Chrome or Edge. CampusDesk reads messages and accessible attachments from a dedicated Teams sync tab, with page reading as a fallback.', '用于 Teams 的浏览器': 'Browser for Teams', '选择你已安装并登录学校账号的浏览器。': 'Choose the browser where you are signed in to the school account.', '允许读取 Teams 浏览器页面': 'Allow reading Teams browser pages', '允许只读发现和同步账号可见的团队、频道、聊天及附件。不会发送消息、提交作业或修改学校数据；关闭后停止自动读取并保留缓存。': 'Allow read-only discovery and sync of teams, channels, chats, and attachments visible to the account. No messages, assignments, or school data are changed; turning this off stops automatic reading and keeps the cache.', '手动读取当前页面': 'Read the current page manually', '关注浏览器当前 Teams 页': 'Follow the current Teams page', '读取当前页': 'Read current page', '读取选中文字': 'Read selected text',
    '系统通知已允许。仅为已确认截止时间的 Teams 未完成作业安排提醒。': 'System notifications are allowed. Reminders are scheduled only for unfinished Teams assignments with confirmed due dates.', '启用后将请求 macOS 通知权限。没有明确截止时间的作业可在“查看要求”中手动设置。': 'Enabling this will request macOS notification permission. Assignments without a clear due date can be set manually in “View requirements”.', '如果提前提醒时间已过，将在截止时提醒。已逾期或已完成的作业不安排通知。': 'If the lead time has passed, a reminder is sent at the deadline. Overdue or completed assignments are not scheduled.', '截止时': 'At due time', '提前 10 分钟': '10 minutes before', '提前 30 分钟': '30 minutes before', '提前 1 小时': '1 hour before', '提前 1 天': '1 day before', 'Teams 作业截止提醒': 'Teams assignment due reminders',
    '经典面板保留原有的信息布局；卡片看板用更紧凑的统计卡和任务卡集中展示今天的重点。两种样式使用同一份本机数据，随时可切换。': 'The classic dashboard keeps the familiar information layout; the card board focuses today\'s priorities with compact metrics and task cards. Both styles use the same local data and can be switched at any time.', '允许 CampusDesk 读取 Teams 浏览器页面': 'Allow CampusDesk to read Teams browser pages', '首次同步时，按 Mac 提示允许 CampusDesk 控制 Google Chrome。也可在系统设置 → 隐私与安全性 → 自动化核对。': 'During the first sync, follow the Mac prompt to let CampusDesk control Google Chrome. You can also check System Settings → Privacy & Security → Automation.', '首次同步时，按 Mac 提示允许 CampusDesk 控制 ': 'During the first sync, follow the Mac prompt to let CampusDesk control ', '。也可在系统设置 → 隐私与安全性 → 自动化核对。': '. You can also check System Settings → Privacy & Security → Automation.', '浏览器需启用 Allow JavaScript from Apple Events（允许来自 Apple 事件的 JavaScript）。Chrome 位于“显示 → 开发者”。': 'Enable Allow JavaScript from Apple Events in the browser. In Chrome, it is under View → Developer.', '同步时请保留专用 Teams 标签，不要切换其中的页面。登录凭据仅在浏览器内使用；附件在本机解析，不上传外部 AI 服务。关闭应用后不会继续同步。': 'Keep the dedicated Teams tab open during sync. Sign-in credentials stay in the browser; attachments are parsed locally and are not sent to external AI services. Sync stops when the app closes.', '学校连接': 'School connections', '希悦和 ManageBac 配置后在应用内登录并读取页面。Teams 默认使用本机 Chrome 或 Edge 已登录页面读取，也可选配 Microsoft Graph 授权；应用运行时定期同步。权限不足、网络中断或接口限制会在同步状态中提示，现有内容作为缓存保留。': 'Sign in to Seiue and ManageBac after configuration. Teams uses a signed-in Chrome or Edge page by default, with optional Microsoft Graph authorization; the app syncs periodically while running. Permission, network, and API limits are shown in sync status, while existing content remains cached.', '连接校园，开始你的第一天': 'Connect your campus', '连接希悦、ManageBac 和 Teams，把课表、作业和通知放在一起。': 'Connect Seiue, ManageBac, and Teams to keep schedules, assignments, and notices together.',
    '课表倒计时按北京时间每秒更新，依据已读取课节的结束和下一节开始时间计算。应用需定期运行并同步，才能发现新作业和截止时间变更；系统通知是否显示还受 Mac 通知和专注模式设置影响。': 'The class countdown updates every second in Beijing time using captured class end and next-start times. The app must run and sync periodically to discover new assignments and due-date changes; macOS notifications and Focus settings control whether alerts appear.',
    '未配置；编辑 SchoolConfig.json 后重新构建': 'Not configured; edit SchoolConfig.json and rebuild', '应用正在运行且电脑联网时，尝试更新已连接的数据。': 'Connected data is refreshed while the app is running and the Mac is online.', '只处理希悦明确给出时间的空白课节。': 'Only open periods with explicit times from Seiue are filled.', '在不同地区使用 Mac，也按北京的上课时间展示。': 'Classes are shown in Beijing time even when the Mac is used in another region.', '包含课程缓存、个人待办及 GPA 记录。也包含 Teams 消息、EC 通知和提醒设置。备份不包含登录会话或密码。': 'Includes schedule cache, personal to-dos, GPA records, Teams messages, EC notices, and reminder settings. Backups do not include sign-in sessions or passwords.', '本地预览版 · 独立学习工具，与希悦、ManageBac 及 Microsoft 无隶属关系。': 'Local preview · independent study tool, not affiliated with Seiue, ManageBac, or Microsoft.',
    '距离下课': 'Class ends in', '课间剩余': 'Break remaining', '午间休息剩余': 'Lunch break remaining', '距离第一节课': 'First class starts in', '今日课程已结束': 'Classes are finished for today', '等待今日课表': 'Waiting for today\'s schedule', '课表缓存待更新 · ': 'Schedule cache needs updating · ', '基于已读取课表 · ': 'Based on captured schedule · ', '今日课程倒计时': 'Today\'s class countdown', '时间待定': 'Time TBD', '已读取课节均已结束，可以查看接下来的待办。': 'All captured classes have ended; you can review the next to-dos.', '同步希悦当天课表后，这里显示课间倒计时。': 'After syncing today\'s schedule, break countdowns appear here.',
    '正在读取学校页面…': 'Reading school pages…', '最近读取 ': 'Last read ', '尚未同步': 'Not synced', '界面语言已切换为 English。': 'Interface language changed to English.', 'Interface language changed to Simplified Chinese.': '界面语言已切换为简体中文。'
  });
  const scheduleEnglish = Object.freeze({
    '每周课程': 'Weekly class', '一次性课程': 'One-time class', '单双周': 'Week pattern', '每周': 'Every week', '单周': 'Odd weeks', '双周': 'Even weeks',
    '单周/双周基准周（周一）': 'Anchor Monday for odd/even weeks', '节假日与临时调课': 'Holidays & temporary changes', '添加节假日': 'Add holiday', '临时调课日期': 'Adjustment date',
    '取消当天课程': 'Cancel class', '替换当天课程': 'Replace class', '原课程节次': 'Original period', '新课程节次': 'New period', '保存临时调课': 'Save temporary change',
    '成绩百分比分布': 'Percentage grade distribution', '暂无可绘制的百分制成绩。': 'No percentage grades are available for the chart.', '节假日': 'Holiday', '临时调课': 'Temporary change', '移除': 'Remove',
    '把学习安排与变化放在一起。': 'Plan your study and track what changed.', '搜索已读取内容，核对每个来源，再安排今天的重点。': 'Search captured content, check each source, and plan today.', '全局搜索': 'Global search', '作业、Teams 消息、老师反馈、成绩与附件文字': 'Assignments, Teams messages, feedback, grades, and attachment text', '搜索已读取内容': 'Search captured content', '今日学习计划': 'Today’s study plan', '项待办 · 拖动可调整顺序': ' tasks · drag to reorder', '根据今天课表避开上课时段，按截止日期、优先级和预计耗时排入空档。时间只是本机建议，可拖动并修改。': 'Avoids classes and schedules by due date, priority, and estimated effort. Times are local suggestions; drag to reorder or adjust.', '分钟': 'Minutes', '优先级': 'Priority', '高': 'High', '中': 'Medium', '低': 'Low', '今日暂未排入': 'Not scheduled today', '拖动以调整顺序': 'Drag to reorder', '先展示前 24 项；调整优先级或完成任务后，计划会重新排列。': 'Showing the first 24; the plan updates as priorities change or tasks are completed.', '同步可信度中心': 'Sync confidence', '“没有内容”表示本次成功读取且数量为零；登录或读取失败会单独显示。覆盖范围只代表已发现和已读取数据。': '“No content” means a successful read returned zero records. Sign-in and read failures are shown separately; coverage only reflects discovered and captured data.', '已读取内容': 'Content captured', '部分读取': 'Partially read', '缓存可能过期': 'Cache may be stale', '本次成功检查：没有内容': 'Checked successfully: no content', '本次未读取成功': 'Could not read this attempt', '最近尝试：': 'Last attempt: ', '最近有效数据：': 'Last useful data: ', '条已读记录': ' captured records', '个页面': ' pages', '个频道': ' channels', '项范围核对成功': ' coverage checks complete',
    '变化收件箱': 'Change inbox', '只比较同一来源页面连续两次成功同步到的相同记录。首次读取、未加载页面和被权限挡住的内容不会被猜测。': 'Compares matching records across successful syncs of the same source page. First reads, unloaded pages, and permission-blocked content are not inferred.', '条近期变化': ' recent changes', '截止日期已调整': 'Due date changed', '截止日期说明已调整': 'Due date note changed', '作业要求已更新': 'Assignment requirements updated', '附件有增删或版本变化': 'Attachments or versions changed', '课程百分比成绩已更新': 'Course percentage updated', '作业得分已更新': 'Assignment score updated', '成绩等级已更新': 'Grade label updated', '正文内容已更新': 'Content updated', '标题已更新': 'Title updated', '提交状态已更新': 'Submission status updated', '暂时还没有可比较的变化。下一次成功同步后，截止日期、要求、附件和成绩更新会显示在这里。': 'No changes captured yet. Due dates, requirements, attachments, and grades will appear after a later successful sync.',
    'EC 智能定位': 'EC locator', '输入你的姓名别名后，只标出原文精确匹配及其附近可识别的时间/地点，始终可回原文核对。': 'Add name aliases to find exact mentions and nearby time or location details. Always verify against the original.', '我的姓名 / 英文名': 'My name / aliases', '多个名字用逗号分隔': 'Separate names with commas', '保存到本机': 'Save on this Mac', '查看原文': 'View original', '附件中心': 'Attachment center', '最多显示 100 个已发现附件': 'Up to 100 discovered attachments', '同名附件会提示数量；离线预览依赖已读取的文字，完整文件仍需打开原始附件。': 'Duplicate names are grouped. Offline preview uses captured text; open the source for the full file.', '已离线缓存文字': 'Text cached for offline reading', '已提取（截断）': 'Text extracted (truncated)', '可打开原附件': 'Original file available', '仅发现名称': 'Name only', '查看已缓存文字': 'View cached text', '已记录版本标识': 'Version tracked', '已捕获 ': ' captured ', '个版本标识': ' version IDs',
    '成绩目标模拟': 'Grade goal simulator', '模拟数据 · 不会改动学校成绩': 'Simulation · does not change school grades', '假设当前百分比是已完成部分的平均分，按剩余权重估算后续部分需要的分数；实际课程权重请以老师公布为准。': 'Assumes the current percentage is the completed-work average and estimates the score needed on remaining work. Use the teacher’s actual weighting when available.', '目标百分比': 'Target %', '剩余权重': 'Remaining weight %', '真实当前成绩': 'Real current grade', '按当前均分已达到目标': 'Target already reached at current average', '按此权重，目标将超过 100%，无法仅靠剩余部分达到': 'Target exceeds 100% under these assumptions', '剩余部分需达到 ': 'Need ', '当前没有已读取的课程': 'No captured class right now', '给自己一段安静的学习时间': 'Take a quiet moment to study', '最近截止日期': 'Coming deadlines', '退出专注': 'Exit focus', '专注模式': 'Focus mode', '专注': 'Focus',
    '作业': 'Assignment', '消息': 'Message', '成绩': 'Grade', '反馈': 'Feedback', '组别 ': 'Group ', '原文时间 ': 'Source time ', '原文地点 ': 'Source location ', '成员原文 ': 'Members in source ', '附近没有明确的组别、时间、地点或成员字段': 'No explicit group, time, location, or member fields nearby', '新读取到记录（可能为新增，也可能是首次覆盖到此内容）': 'Newly captured record (may be new or newly covered)', 'EC 组别信息有变化': 'EC group details changed', 'EC 时间信息有变化': 'EC time details changed', 'EC 地点信息有变化': 'EC location details changed', 'EC 成员名单信息有变化': 'EC member list changed'
  });
  function isEnglish() { return state.settings.language === 'en-US'; }
  function t(value) { return isEnglish() && typeof value === 'string' ? (english[value] || scheduleEnglish[value] || value) : value; }
  function pageName(key) { return t(pageNames[key] || key); }
  function localizeMarkup(markup) {
    if (!isEnglish()) return markup;
    const labels = Object.assign({}, english, scheduleEnglish);
    return Object.keys(labels).sort((a, b) => b.length - a.length).reduce((result, source) => result.split(source).join(labels[source]), markup);
  }
  function localizedHTML(renderMarkup) {
    markupEscapes = [];
    try {
      const output = localizeMarkup(renderMarkup());
      return output.replace(/\uE000(\d+)\uE001/g, (_, index) => {
        const value = markupEscapes[Number(index)] || '';
        return isEnglish() && Object.prototype.hasOwnProperty.call(Object.assign({}, english, scheduleEnglish), value) ? (english[value] || scheduleEnglish[value]) : value;
      });
    } finally { markupEscapes = null; }
  }
  const icons = {
    overview: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    schedule: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18m-13 4h3m3 0h3m-9 3h3"/>',
    grades: '<path d="M4 20V10m6 10V4m6 16v-7m5 7H2"/>',
    tasks: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m7 12 3 3 7-7"/>',
    feedback: '<path d="M21 11a8 8 0 0 1-8 8H7l-4 3v-8a8 8 0 0 1 8-10h2a8 8 0 0 1 8 7Z"/><path d="M7 10h9m-9 4h6"/>',
    teams: '<rect x="3" y="7" width="11" height="13" rx="2"/><path d="M6 11h5m-2.5 0v6m8-9h4v8a3 3 0 0 1-4 3"/><circle cx="17" cy="4" r="2"/><path d="M6 4h5"/>',
    ec: '<circle cx="8" cy="7" r="3"/><circle cx="17" cy="8" r="2"/><path d="M2 21v-3a6 6 0 0 1 12 0v3m3-8a5 5 0 0 1 5 5v3"/>',
    settings: '<path d="m9 3-.6 2.1-2 .9-2.1-.5-2 3.5L4 10.5v3L2.3 15l2 3.5 2.1-.5 2 .9L9 21h4l.6-2.1 2-.9 2.1.5 2-3.5-1.7-1.5v-3L19.7 9l-2-3.5-2.1.5-2-.9L13 3Z"/><circle cx="11" cy="12" r="3"/>',
    refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.4 7a8 8 0 0 1 13-2L20 7M4 17l1.6 2a8 8 0 0 0 13-2"/>',
    arrow: '<path d="m9 5 7 7-7 7"/>',
    back: '<path d="m15 5-7 7 7 7"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    link: '<path d="M14 4h6v6m0-6L10 14M20 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5"/>',
    book: '<path d="M12 6c-3-2-6-2-9-1v14c3-1 6-1 9 1m0-14c3-2 6-2 9-1v14c-3-1-6-1-9 1V6Z"/>',
    cloud: '<path d="M7 18a5 5 0 1 1 0-10 6 6 0 0 1 11-1 5.5 5.5 0 0 1 0 11M12 13v8m-3-3 3 3 3-3"/>',
    trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z"/><path d="M10 21h4"/>',
    search: '<circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/>',
    focus: '<path d="m12 3 2.75 5.57L21 9.48l-4.5 4.38 1.06 6.19L12 17.16l-5.56 2.89 1.06-6.19L3 9.48l6.25-.91L12 3Z"/>',
    alert: '<path d="M12 3 2 21h20L12 3Z"/><path d="M12 9v5m0 3h.01"/>'
  };
  function icon(name, cls) { return '<svg class="' + (cls || '') + '" viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (icons[name] || icons.book) + '</svg>'; }
  function esc(value) {
    const safe = String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    if (!markupEscapes) return safe;
    const token = '\uE000' + markupEscapes.length + '\uE001';
    markupEscapes.push(safe);
    return token;
  }
  function fmtDate(value, opts) {
    if (!value) return '时间未标明';
    const d = new Date(value);
    if (!Number.isFinite(d.getTime())) return String(value);
    return new Intl.DateTimeFormat(isEnglish() ? 'en-US' : 'zh-CN', Object.assign({ timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric' }, opts || {})).format(d);
  }
  function lastUpdated(value) { return value ? fmtDate(value, { hour: '2-digit', minute: '2-digit', hour12: false }) : t('尚未同步'); }
  function dayLabel(value) { return fmtDate(value + 'T12:00:00+08:00', { weekday: 'long' }); }
  function button(label, action, extra, kind) { return '<button class="button ' + (kind || 'button-light') + '" type="button" data-action="' + esc(action) + '" ' + (extra || '') + '>' + t(label) + '</button>'; }
  function goLink(target, label) { return '<button type="button" class="view-link" data-page="' + target + '">' + t(label) + icon('arrow') + '</button>'; }
  function toast(message) {
    const el = document.getElementById('toast');
    el.textContent = message; el.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 5200);
  }
  function send(action, details) {
    if (native) { window.webkit.messageHandlers.campus.postMessage(Object.assign({ action: action }, details || {})); return true; }
    return false;
  }
  function persist(options) {
    const details = { state: state };
    if (options && options.imported === true) details.imported = true;
    if (!send('saveState', details)) {
      try { localStorage.setItem(storageKey, JSON.stringify(state)); }
      catch (_) { toast('浏览器无法保存数据。请导出备份，或使用 Mac 应用。'); }
    }
    syncReminders();
  }
  function sourceName(source) { return t(({ seiue: '希悦', managebac: 'ManageBac', teams: 'Microsoft Teams' })[source] || '个人待办'); }
  const schoolConfigurationHelp = '请在源码 Resources/SchoolConfig.json 配置学校 HTTPS 根地址后重新构建应用。留空时不会连接该学校系统，Teams 不受影响。';
  function sourceURL(source) { return source === 'teams' ? 'https://teams.microsoft.com/v2/' : Core.schoolHomes()[source] || ''; }
  function teamsBrowserName() { return state.settings.teamsBrowser === 'edge' ? 'Microsoft Edge' : 'Google Chrome'; }
  function graphPrimaryButton() {
    if (!graphStatus.configured) return button('设置 Teams 连接', 'graph-settings', '', 'button-primary');
    const canSync = graphStatus.connected && !graphStatus.authRequired;
    return button(graphStatus.busy ? (graphStatus.connected ? '正在同步…' : '正在登录…') : canSync ? '立即同步 Teams' : graphStatus.authRequired ? '重新登录 Teams' : '登录 Teams', canSync ? 'graph-sync' : 'graph-sign-in', graphStatus.busy || !native ? 'disabled' : '', 'button-primary');
  }
  function teamsPrimaryButton() {
    return state.settings.teamsMode === 'browser' ? button('登录／打开 Teams', 'teams-auto-login', !native || teamsAuto.running ? 'disabled' : '', 'button-primary') : graphPrimaryButton();
  }
  function graphStatusCopy() {
    if (!native) return '请在 CampusDesk Mac 应用中登录 Teams。';
    if (!graphStatus.configured) return '首次接入需要配置微软应用。配置完成后，登录学校账号即可自动同步。';
    if (graphStatus.requiresAdminConsent) return '学校要求管理员批准应用权限。请让学校管理员完成授权后重新登录。';
    if (graphStatus.message) return graphStatus.message;
    if (graphStatus.busy) return '正在自动发现你的团队、频道和课程作业…';
    if (graphStatus.connected) return (graphStatus.displayName ? graphStatus.displayName + ' · ' : '') + '已连接，应用运行时定期同步。';
    return '登录学校 Microsoft 账号，自动汇总频道消息、作业要求和 EC 通知。';
  }
  function graphScopeCopy() {
    const summary = typeof Core.getTeamsGraphSummary === 'function' ? Core.getTeamsGraphSummary(state) : null;
    const counts = graphStatus.counts || (summary && summary.counts);
    const parts = [];
    if (counts && typeof counts === 'object') {
      [['teams', '个团队'], ['channels', '个频道'], ['chats', '个聊天'], ['assignments', '份作业'], ['messages', '条消息']].forEach(entry => {
        const count = Number(counts[entry[0]]);
        if (Number.isFinite(count) && count >= 0) parts.push(Math.floor(count) + ' ' + entry[1]);
      });
    }
    return parts.length ? '本次同步：' + parts.join(' · ') : '自动发现账号所属团队和可访问频道，读取频道消息、回复及课程作业。';
  }
  function graphAction(action) {
    if (!native) { toast('Teams 自动同步需要使用 CampusDesk Mac 应用。'); return; }
    if (!graphStatus.configured) { showGraphConfiguration(); return; }
    if (graphStatus.busy) return;
    state.settings.teamsMode = 'graph';
    persist();
    send(action);
  }
  function showGraphConfiguration() {
    navigate('settings');
    const config = document.getElementById('graph-configuration');
    if (config) { config.open = true; config.scrollIntoView({ block: 'center', behavior: 'auto' }); }
  }
  function teamsBrowserAction(action, details) {
    if (!native) { toast('读取浏览器中的 Teams 页面需要使用 CampusDesk Mac 应用。'); return; }
    if (!state.settings.teamsBrowserAutomation) { navigate('settings'); toast('请先开启“允许读取 Teams 浏览器页面”，再按说明设置 Mac 和浏览器权限。'); return; }
    // Persist the selected browser and explicit opt-in before asking the native bridge to act.
    persist();
    send(action, details);
  }
  function teamsBrowserButtons() {
    const disabled = !native || !state.settings.teamsBrowserAutomation ? ' disabled' : '';
    return '<div class="teams-browser-actions">' + button('关注浏览器当前 Teams 页', 'pin-teams-browser', disabled) + button('读取当前页', 'capture-teams-browser', disabled) + button('读取选中文字', 'capture-teams-selection', disabled) + '</div>';
  }
  function openSource(source, requestedURL) {
    const url = requestedURL ? Core.safeURL(requestedURL, source) : Core.safeURL(sourceURL(source), source);
    if (!url) { navigate('settings'); toast(sourceURL(source) ? '此地址不属于当前配置的学校，已取消打开。' : schoolConfigurationHelp); return; }
    if (!send('openSource', { source: source, url: url })) {
      window.open(url, '_blank', 'noopener,noreferrer');
      toast('网页预览可以打开学校网站；把登录后的数据同步到这里需要使用 CampusDesk Mac 应用。');
    }
  }
  function sourceStatus(source) { return Core.getSourceStatus(state, source); }
  function sourceFooter(source) {
    const s = sourceStatus(source);
    return '<div class="section-foot"><span>' + esc(sourceName(source)) + ' · ' + esc(lastUpdated(s.lastCapturedAt)) + '</span><span>' + (s.loginRequired ? '请重新登录' : (s.stale && s.lastCapturedAt ? '缓存可能已过期' : '')) + '</span></div>';
  }
  function empty(kind, title, description, cta) {
    return '<div class="empty"><div class="empty-illustration">' + icon(kind) + '</div><h3>' + esc(t(title)) + '</h3><p>' + esc(t(description)) + '</p>' + (cta || '') + '</div>';
  }
  function heading(title, subtitle, right) {
    return '<div class="page-heading"><div><div class="eyebrow">YOUR EVERYDAY, IN VIEW</div><h1>' + esc(t(title)) + '</h1><p class="page-subtitle">' + esc(t(subtitle)) + '</p></div>' + (right || '') + '</div>';
  }
  function cardHeader(name, title, right) { return '<div class="card-header"><h2 class="card-title"><span class="icon">' + icon(name) + '</span>' + t(title) + '</h2>' + (right || '') + '</div>'; }
  function customPeriods() {
    const periods = typeof Core.getSchedulePeriods === 'function' ? Core.getSchedulePeriods(state) : [];
    return periods.length ? periods : Array.from({ length: 9 }, (_, index) => ({ period: 'P' + (index + 1), start: '', end: '' }));
  }
  function customHm2min(value) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
    if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return null;
    return Number(match[1]) * 60 + Number(match[2]);
  }
  function customMin2hm(value) {
    const minutes = ((Math.round(value) % 1440) + 1440) % 1440;
    return String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0');
  }
  function customPeriodTimes(period) {
    const key = String(period || '').toUpperCase();
    return customPeriods().find(item => String(item.period || '').toUpperCase() === key) || null;
  }
  function customBestPeriod(start, end) {
    const a = customHm2min(start);
    if (a === null) return null;
    let b = customHm2min(end);
    if (b === null || b <= a) b = a + 45;
    let best = null, overlap = 0;
    for (const period of customPeriods()) {
      const pa = customHm2min(period.start), pb = customHm2min(period.end);
      if (pa === null || pb === null) continue;
      const amount = Math.min(b, pb) - Math.max(a, pa);
      if (amount > overlap) { overlap = amount; best = period; }
    }
    return best && overlap / (b - a) >= 0.5 ? best : null;
  }
  function customCaptureDraft() {
    const read = id => document.getElementById(id);
    customScheduleDraft = {
      title: read('custom-title') ? read('custom-title').value : customScheduleDraft.title,
      room: read('custom-room') ? read('custom-room').value : customScheduleDraft.room,
      period: read('custom-period') ? read('custom-period').value : customScheduleDraft.period,
      start: read('custom-start') ? read('custom-start').value : customScheduleDraft.start,
      end: read('custom-end') ? read('custom-end').value : customScheduleDraft.end
    };
  }
  function customSyncFromPeriod() {
    if (customScheduleMode !== 'period') return;
    const period = customPeriodTimes(customScheduleDraft.period);
    if (!period) return;
    customScheduleDraft.start = period.start || '';
    customScheduleDraft.end = period.end || '';
    const start = document.getElementById('custom-start'), end = document.getElementById('custom-end');
    if (start) start.value = customScheduleDraft.start;
    if (end) end.value = customScheduleDraft.end;
    const hint = document.getElementById('custom-time-hint');
    if (hint) hint.textContent = period.start ? period.start + (period.end ? '–' + period.end : '') : t('该节次暂无已读取的时间');
  }
  function customSyncFromTime() {
    const hint = document.getElementById('custom-time-hint');
    if (!hint) return;
    const start = document.getElementById('custom-start'), end = document.getElementById('custom-end');
    customScheduleDraft.start = start ? start.value : customScheduleDraft.start;
    customScheduleDraft.end = end ? end.value : customScheduleDraft.end;
    const a = customHm2min(customScheduleDraft.start);
    if (a === null) { hint.textContent = t('填入开始时间后会自动识别节次'); return; }
    const b = customHm2min(customScheduleDraft.end);
    if (b === null || b <= a) {
      customScheduleDraft.end = customMin2hm(a + 45);
      if (end) end.value = customScheduleDraft.end;
    }
    const hit = customBestPeriod(customScheduleDraft.start, customScheduleDraft.end);
    hint.textContent = hit ? t('将归入 ') + hit.period + (hit.start ? ' · ' + hit.start + '–' + hit.end : '') : t('未匹配节次，将按开始时间插入');
  }
  function renderScheduleRules() {
    const holidays = state.settings.scheduleHolidays || [], overrides = state.settings.scheduleOverrides || [];
    const periods = customPeriods();
    const holidayRows = holidays.map(date => '<span class="schedule-rule-chip">' + esc(date) + '<button type="button" data-action="remove-holiday" data-date="' + esc(date) + '" aria-label="' + esc(t('移除')) + '">×</button></span>').join('');
    const overrideRows = overrides.map(item => '<div class="custom-lesson-row"><div><strong>' + esc(item.date + ' · ' + (item.action === 'cancel' ? t('取消当天课程') : item.title)) + '</strong><small>' + esc((item.targetPeriod || item.targetStart || '') + (item.period ? ' → ' + item.period : '') + (item.start ? ' · ' + item.start + (item.end ? '–' + item.end : '') : '') + (item.room ? ' · ' + item.room : '')) + '</small></div><button class="icon-button" type="button" data-action="remove-schedule-override" data-id="' + esc(item.id) + '" aria-label="' + esc(t('移除')) + '" title="' + esc(t('移除')) + '">' + icon('trash') + '</button></div>').join('');
    return '<section class="card custom-schedule-card schedule-rules-card"><div class="card-header"><h2 class="card-title"><span class="icon">' + icon('settings') + '</span>' + t('节假日与临时调课') + '</h2></div><div class="custom-schedule-grid"><label><span>' + t('单周/双周基准周（周一）') + '</span><input id="schedule-week-anchor" type="date" value="' + esc(state.settings.scheduleWeekAnchor || '') + '"></label><label><span>' + t('添加节假日') + '</span><div class="inline-form"><input id="holiday-date" type="date"><button type="button" class="button button-light" data-action="add-holiday">' + t('添加节假日') + '</button></div></label></div>' + (holidayRows ? '<div class="schedule-rule-chips">' + holidayRows + '</div>' : '<p class="custom-schedule-note">' + t('尚未设置节假日；设置后当天常规课表和每周自编课程会隐藏。') + '</p>') + '<form id="schedule-override-form" class="custom-schedule-form"><div class="custom-schedule-grid"><label><span>' + t('临时调课日期') + '</span><input id="override-date" type="date" required></label><label><span>' + t('操作') + '</span><select id="override-action"><option value="replace">' + t('替换当天课程') + '</option><option value="cancel">' + t('取消当天课程') + '</option></select></label><label><span>' + t('原课程节次') + '</span><select id="override-target-period"><option value="">—</option>' + periods.map(item => '<option value="' + esc(item.period) + '">' + esc(item.period) + '</option>').join('') + '</select></label><label><span>' + t('新课程节次') + '</span><select id="override-period"><option value="">—</option>' + periods.map(item => '<option value="' + esc(item.period) + '">' + esc(item.period) + '</option>').join('') + '</select></label><label><span>' + t('课程名称') + '</span><input id="override-title" maxlength="300" placeholder="' + t('如：调课后的课程') + '"></label><label><span>' + t('教室（可选）') + '</span><input id="override-room" maxlength="200"></label><label><span>' + t('开始时间') + '</span><input id="override-start" type="time"></label><label><span>' + t('结束时间') + '</span><input id="override-end" type="time"></label></div><button class="button button-light" type="submit">' + t('保存临时调课') + '</button></form>' + (overrideRows ? '<div class="custom-lesson-list"><div class="custom-schedule-label">' + t('临时调课') + ' ' + overrides.length + '</div>' + overrideRows + '</div>' : '') + '</section>';
  }
  function renderCustomSchedule() {
    const periods = customPeriods(), days = [1, 2, 3, 4, 5, 6, 0], labels = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
    const draft = customScheduleDraft, lessons = state.settings.customLessons || [], mode = customScheduleMode === 'time' ? 'time' : 'period';
    const rows = lessons.map((lesson, index) => {
      const when = lesson.date || (lesson.weekdays || []).map(day => ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][day]).join('、');
      const pattern = !lesson.date && lesson.weekPattern && lesson.weekPattern !== 'all' ? ' · ' + (lesson.weekPattern === 'odd' ? '单周' : '双周') : '';
      const period = lesson.period ? lesson.period + ' · ' : '';
      return `<div class="custom-lesson-row"><div><strong>${esc(period + (lesson.start || '') + (lesson.end ? '–' + lesson.end : '') + ' · ' + lesson.title)}</strong><small>${esc(when + pattern + (lesson.room ? ' · ' + lesson.room : ''))}</small></div><button class="icon-button" type="button" data-action="delete-custom-lesson" data-index="${index}" aria-label="${esc(t('删除自编课程'))}" title="${esc(t('删除自编课程'))}">${icon('trash')}</button></div>`;
    }).join('');
    const kind = customScheduleKind === 'once' ? 'once' : 'weekly';
    /*
    return '<section class="card custom-schedule-card">' + cardHeader('schedule', '自编课表', '<span class="card-kicker">' + t('添加自编课程') + '</span>') +
      '<form id="custom-schedule-form" class="custom-schedule-form"><div class="custom-schedule-grid"><label><span>' + t('课程名称') + '</span><input id="custom-title" type="text" maxlength="300" value="' + esc(draft.title) + '" placeholder="如：晨会、社团"></label><label><span>' + t('教室（可选）') + '</span><input id="custom-room" type="text" maxlength="200" value="' + esc(draft.room) + '" placeholder="如：操场"></label></div><div class="custom-mode-tabs"><button type="button" class="custom-mode ' + (kind === 'weekly' ? 'active' : '') + '" data-action="custom-kind" data-kind="weekly">' + t('每周课程') + '</button><button type="button" class="custom-mode ' + (kind === 'once' ? 'active' : '') + '" data-action="custom-kind" data-kind="once">' + t('一次性课程') + '</button></div>' + (kind === 'weekly' ? '<div class="custom-schedule-label">' + t('选择星期') + '</div><div class="custom-days">' + days.map((day, index) => '<button type="button" class="custom-day ' + (customScheduleDays.includes(day) ? 'active' : '') + '" data-action="custom-day" data-day="' + day + '">' + t(labels[index]) + '</button>').join('') + '</div><label class="custom-inline-select"><span>' + t('单双周') + '</span><select id="custom-week-pattern"><option value="all"' + (customSchedulePattern === 'all' ? ' selected' : '') + '>' + t('每周') + '</option><option value="odd"' + (customSchedulePattern === 'odd' ? ' selected' : '') + '>' + t('单周') + '</option><option value="even"' + (customSchedulePattern === 'even' ? ' selected' : '') + '>' + t('双周') + '</option></select></label>' : '<label><span>上课日期</span><input id="custom-one-date" type="date" value="' + esc(customScheduleOneDate) + '"></label>') + '<div class="custom-mode-tabs"><button type="button" class="custom-mode ' + (mode === 'period' ? 'active' : '') + '" data-action="custom-mode" data-mode="period">' + t('按节次') + '</button><button type="button" class="custom-mode ' + (mode === 'time' ? 'active' : '') + '" data-action="custom-mode" data-mode="time">' + t('按时刻') + '</button></div><div class="custom-schedule-grid ' + (mode === 'time' ? 'is-time' : '') + '"><label class="custom-period-field"><span>' + t('第几节') + '</span><select id="custom-period">' + periods.map(item => '<option value="' + esc(item.period) + '"' + (item.period === draft.period ? ' selected' : '') + '>' + esc(item.period) + (item.start ? ' · ' + esc(item.start) + '–' + esc(item.end) : '') + '</option>').join('') + '</select></label><label><span>' + t('开始时间') + '</span><input id="custom-start" type="time" value="' + esc(draft.start) + '"></label><label><span>' + t('结束时间') + '</span><input id="custom-end" type="time" value="' + esc(draft.end) + '"></label></div><p id="custom-time-hint" class="custom-time-hint">' + esc(mode === 'period' ? '选择节次后自动带出时间' : '填入开始时间后会自动识别节次') + '</p><p class="custom-schedule-note">' + t('结束时间将自动补为开始时间后 45 分钟。') + ' ' + t('按时间填写时，会按重叠比例自动归入对应节次。')</p><button class="button button-primary" type="submit">' + icon('plus') + t('保存自编课程') + '</button></form>' + (rows ? '<div class="custom-lesson-list"><div class="custom-schedule-label">' + t('已添加') + ' ' + lessons.length + '</div>' + rows + '</div>' : '') + '</section>' + renderScheduleRules();
    */
    const weekdays = days.map((day, index) => `<button type="button" class="custom-day ${customScheduleDays.includes(day) ? 'active' : ''}" data-action="custom-day" data-day="${day}">${t(labels[index])}</button>`).join('');
    const periodOptions = periods.map(item => `<option value="${esc(item.period)}"${item.period === draft.period ? ' selected' : ''}>${esc(item.period)}${item.start ? ' · ' + esc(item.start) + '–' + esc(item.end) : ''}</option>`).join('');
    const scheduleKind = kind === 'weekly'
      ? `<div class="custom-schedule-label">${t('选择星期')}</div><div class="custom-days">${weekdays}</div><label class="custom-inline-select"><span>${t('单双周')}</span><select id="custom-week-pattern"><option value="all"${customSchedulePattern === 'all' ? ' selected' : ''}>${t('每周')}</option><option value="odd"${customSchedulePattern === 'odd' ? ' selected' : ''}>${t('单周')}</option><option value="even"${customSchedulePattern === 'even' ? ' selected' : ''}>${t('双周')}</option></select></label>`
      : `<label><span>上课日期</span><input id="custom-one-date" type="date" value="${esc(customScheduleOneDate)}"></label>`;
    return `<section class="card custom-schedule-card">${cardHeader('schedule', '自编课表', '<span class="card-kicker">' + t('添加自编课程') + '</span>')}<form id="custom-schedule-form" class="custom-schedule-form"><div class="custom-schedule-grid"><label><span>${t('课程名称')}</span><input id="custom-title" type="text" maxlength="300" value="${esc(draft.title)}" placeholder="如：晨会、社团"></label><label><span>${t('教室（可选）')}</span><input id="custom-room" type="text" maxlength="200" value="${esc(draft.room)}" placeholder="如：操场"></label></div><div class="custom-mode-tabs"><button type="button" class="custom-mode ${kind === 'weekly' ? 'active' : ''}" data-action="custom-kind" data-kind="weekly">${t('每周课程')}</button><button type="button" class="custom-mode ${kind === 'once' ? 'active' : ''}" data-action="custom-kind" data-kind="once">${t('一次性课程')}</button></div>${scheduleKind}<div class="custom-mode-tabs"><button type="button" class="custom-mode ${mode === 'period' ? 'active' : ''}" data-action="custom-mode" data-mode="period">${t('按节次')}</button><button type="button" class="custom-mode ${mode === 'time' ? 'active' : ''}" data-action="custom-mode" data-mode="time">${t('按时刻')}</button></div><div class="custom-schedule-grid ${mode === 'time' ? 'is-time' : ''}"><label class="custom-period-field"><span>${t('第几节')}</span><select id="custom-period">${periodOptions}</select></label><label><span>${t('开始时间')}</span><input id="custom-start" type="time" value="${esc(draft.start)}"></label><label><span>${t('结束时间')}</span><input id="custom-end" type="time" value="${esc(draft.end)}"></label></div><p id="custom-time-hint" class="custom-time-hint">${mode === 'period' ? '选择节次后自动带出时间' : '填入开始时间后会自动识别节次'}</p><p class="custom-schedule-note">${t('结束时间将自动补为开始时间后 45 分钟。')} ${t('按时间填写时，会按重叠比例自动归入对应节次。')}</p><button class="button button-primary" type="submit">${icon('plus')}${t('保存自编课程')}</button></form>${rows ? '<div class="custom-lesson-list"><div class="custom-schedule-label">' + t('已添加') + ' ' + lessons.length + '</div>' + rows + '</div>' : ''}</section>${renderScheduleRules()}`;
  }
  function scheduleRows(rows, date) {
    const now = Core.clock(), today = Core.today();
    return '<div class="schedule-list">' + rows.map(row => {
      const current = date === today && row.start && row.end && row.start <= now && row.end > now;
      const past = date < today || (date === today && row.end && row.end <= now);
      return '<div class="schedule-row ' + (row.custom ? 'custom-row ' : '') + (current ? 'current' : past ? 'past' : '') + '"><div class="schedule-time">' + esc(row.start || (row.period || '待定')) + '<small>' + esc(row.end || '') + '</small></div><div class="timeline"><span class="timeline-dot"></span></div><div class="class-tile"><h3>' + esc(row.title || (row.isSelfStudy ? '自习课' : '未命名课程')) + (row.custom ? '<span class="inline-label custom-label">自编</span>' : '') + (current ? '<span class="inline-label">正在上课</span>' : '') + '</h3><div class="class-meta">' + (row.room ? '<span>' + esc(row.room) + '</span>' : '') + (row.teacher ? '<span>' + esc(row.teacher) + '</span>' : '') + (row.period ? '<span>' + esc(row.period) + '</span>' : '') + (row.isSelfStudy ? '<span>空白课节 · 自习</span>' : '') + (!row.room && !row.teacher && !row.period && !row.isSelfStudy ? '<span>教室与教师未显示</span>' : '') + '</div></div></div>';
    }).join('') + '</div>';
  }
  function noSchedule(date) {
    const status = sourceStatus('seiue');
    const connected = Boolean(status.lastCapturedAt);
    return empty('schedule', connected ? '这一天暂无已读取的课程' : '先把你的课程表接进来', connected ? '可能没有课程，也可能尚未读取这一天。打开希悦核对并切换到对应日期，再同步。' : '在应用中登录希悦并打开课程表，这里的每一天就有了安排。', button('打开希悦', 'open-source', 'data-source="seiue"', 'button-light'));
  }
  function getGpaView() {
    const official = Core.getOfficialGPA(state);
    const courses = Core.getCourses(state);
    const estimate = Core.estimateGPA(courses);
    return { official: official, estimate: estimate, courses: courses };
  }
  function gpaValue(value, scale) { return '<div class="gpa-value">' + (value == null || !Number.isFinite(Number(value)) ? '—' : Number(value).toFixed(2)) + '<small>/ ' + esc(scale || '4.00') + '</small></div>'; }
  function renderGradePie(courses, displayGpa) {
    const bands = [
      { label: '90–100%', color: '#4f8a70', test: value => value >= 90 },
      { label: '80–89%', color: '#7098bc', test: value => value >= 80 && value < 90 },
      { label: '70–79%', color: '#b79253', test: value => value >= 70 && value < 80 },
      { label: '60–69%', color: '#c47768', test: value => value >= 60 && value < 70 },
      { label: '<60%', color: '#8e879f', test: value => value < 60 }
    ];
    const eligible = courses.filter(course => course.percentage != null && Number.isFinite(Number(course.percentage)) && course.gpaEligible !== false);
    if (!eligible.length) return '<section class="card grade-distribution"><div class="card-header"><h2 class="card-title"><span class="icon">' + icon('grades') + '</span>' + t('成绩百分比分布') + '</h2></div><p class="subtle">' + t('暂无可绘制的百分制成绩。') + '</p></section>';
    const scale = displayGpa && Number(displayGpa.scale) > 0 ? Number(displayGpa.scale) : 4;
    const value = displayGpa && displayGpa.value != null && Number.isFinite(Number(displayGpa.value)) ? (Number(displayGpa.value) / scale * 100).toFixed(1) + '%' : '—';
    const counts = bands.map(band => eligible.filter(course => band.test(Number(course.percentage))).length), total = eligible.length;
    let cursor = 0;
    const stops = counts.map((count, index) => { const start = cursor; cursor += count / total * 100; return bands[index].color + ' ' + start.toFixed(2) + '% ' + cursor.toFixed(2) + '%'; }).join(', ');
    return '<section class="card grade-distribution"><div class="card-header"><h2 class="card-title"><span class="icon">' + icon('grades') + '</span>' + t('成绩百分比分布') + '</h2><span class="card-kicker">' + total + ' 门课程</span></div><div class="grade-pie-layout"><div class="grade-pie" style="background:conic-gradient(' + stops + ')" role="img" aria-label="' + esc(t('成绩百分比分布')) + '"><span class="grade-pie-center" style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;z-index:1"><strong style="font-family:Georgia,\"Times New Roman\",serif;font-size:22px;line-height:1.1;color:#315447">' + esc(value) + '</strong><small style="font-size:9px;color:#8b9884;margin-top:4px">GPA → %</small></span></div><div class="grade-pie-legend">' + bands.map((band, index) => '<div class="grade-pie-legend-row"><span class="grade-pie-swatch" style="background:' + band.color + '"></span><span>' + band.label + '</span><strong>' + (counts[index] / total * 100).toFixed(1) + '%</strong><small>' + counts[index] + ' 门</small></div>').join('') + '</div></div><p class="gpa-note">饼图中心为当前显示 GPA 按量表换算的百分比；成绩分布按已读取的百分制课程总评统计。</p></section>';
  }
  function taskDue(task) {
    if (!task.dueAt) return { label: task.dueLabel || '未设置截止日期', overdue: false };
    const time = new Date(task.dueAt).getTime();
    if (!Number.isFinite(time)) return { label: task.dueLabel || '截止日期待核对', overdue: false };
    return { label: fmtDate(task.dueAt, { hour: '2-digit', minute: '2-digit', hour12: false }), overdue: !task.completed && time < Date.now() };
  }
  function taskRows(tasks, limit) {
    return '<div class="task-list">' + tasks.slice(0, limit || tasks.length).map(task => {
      const local = state.manualTasks.some(t => t.id === task.id), source = task.source === 'teams' ? 'teams' : 'managebac';
      const due = taskDue(task);
      const hasKnownDue = Boolean(task.dueAt) && Number.isFinite(new Date(task.dueAt).getTime());
      const dueText = (due.overdue ? '已逾期 · ' : '') + due.label + (task.dueOverride ? ' · 本机设置' : '');
      // A deadline icon is not a claim that a macOS notification was scheduled.
      const dueBadge = '<span class="task-due ' + (due.overdue ? 'is-overdue' : hasKnownDue ? 'has-date' : 'date-unknown') + '">' +
        (hasKnownDue ? icon(due.overdue ? 'alert' : 'clock', 'task-due-icon') : '') + '<span>' + esc(dueText) + '</span></span>';
      const checkLabel = isEnglish() ? (task.completed ? 'Mark incomplete: ' : 'Mark complete: ') + task.title : (task.completed ? '标为未完成：' : '标为已完成：') + task.title;
      return '<div class="task-row ' + (task.completed ? 'done' : '') + '"><button class="check-button ' + (task.completed ? 'checked' : '') + '" type="button" data-action="toggle-task" data-id="' + esc(task.id) + '" aria-label="' + esc(checkLabel) + '" aria-pressed="' + Boolean(task.completed) + '">' + (task.completed ? icon('check') : '') + '</button><div class="task-copy"><h3>' + (local ? esc(task.title) : '<button class="task-title-button" type="button" data-action="task-detail" data-id="' + esc(task.id) + '">' + esc(task.title) + '</button>') + '</h3><div class="task-meta"><span>' + esc(task.course || (local ? '个人待办' : sourceName(source))) + '</span>' + dueBadge + '</div>' + (!local ? '<button class="text-action" type="button" data-action="task-detail" data-id="' + esc(task.id) + '">' + t('查看要求') + (task.attachments && task.attachments.length ? ' · ' + task.attachments.length + t(' 个附件') : '') + ' ↗</button>' : '') + '</div><span class="task-tag ' + (local ? 'local' : source === 'teams' ? 'teams-tag' : '') + '">' + (local ? '个人' : source === 'teams' ? 'Teams' : 'MB') + '</span>' + (local ? '<button class="icon-button" data-action="delete-task" data-id="' + esc(task.id) + '" aria-label="删除个人待办" title="删除个人待办">' + icon('trash') + '</button>' : task.url ? '<button class="icon-button" data-action="open-source" data-source="' + source + '" data-url="' + esc(task.url) + '" aria-label="' + esc(t('打开学校任务')) + '" title="' + esc(t('打开学校任务')) + '">' + icon('link') + '</button>' : '') + '</div>';
    }).join('') + '</div>';
  }
  function feedbackRows(items, limit) {
    return items.slice(0, limit || items.length).map(item => '<article class="feedback-row"><div class="feedback-top"><span class="feedback-initial">' + esc((item.teacher || '师').slice(0, 1)) + '</span><span>' + esc(item.teacher || '老师反馈') + '</span>' + (!item.read ? '<span class="unread-dot" aria-label="未读"></span>' : '') + '<span class="feedback-course">' + esc((item.source === 'teams' ? 'Teams · ' : '') + (item.course || '')) + '</span></div><p class="feedback-text">' + esc(item.text) + '</p><div class="feedback-bottom"><span>' + esc(item.date ? fmtDate(item.date) : '日期未标明') + '</span><span><button type="button" data-action="toggle-feedback" data-id="' + esc(item.id) + '">' + (item.read ? '标为未读' : '标为已读') + '</button>' + (item.url ? '<button type="button" data-action="open-source" data-source="' + (item.source === 'teams' ? 'teams' : 'managebac') + '" data-url="' + esc(item.url) + '">查看原文 ↗</button>' : '') + '</span></div></article>').join('');
  }
  function clockCopy(clock) {
    const labels = { class: '距离下课', break: '课间剩余', lunch: '午间休息剩余', before: '距离第一节课', after: '今日课程已结束', empty: '等待今日课表' };
    const next = clock.next;
    return {
      label: t(labels[clock.phase] || labels.empty),
      time: clock.phase === 'empty' || clock.phase === 'after' ? '—' : clock.remainingLabel,
      detail: clock.phase === 'class' && clock.current ? (isEnglish() ? 'Current: ' : '当前 ') + clock.current.title + ' · ' + (clock.current.start || t('时间待定')) + '–' + (clock.current.end || t('时间待定')) + (next ? (isEnglish() ? ' | Next: ' : ' ｜下节 ') + next.title + ' · ' + (next.start || t('时间待定')) + '–' + (next.end || t('时间待定')) : '') + (clock.current.room ? ' · ' + clock.current.room : '') : next ? (isEnglish() ? 'Next: ' : '下节 ') + next.title + ' · ' + (next.start || t('时间待定')) + '–' + (next.end || t('时间待定')) + (next.room ? ' · ' + next.room : '') : clock.phase === 'after' ? t('已读取课节均已结束，可以查看接下来的待办。') : t('同步希悦当天课表后，这里显示课间倒计时。')
    };
  }
  function renderClassClock() {
    const clock = Core.getClassClock(state), copy = clockCopy(clock), status = sourceStatus('seiue');
    return '<section id="class-clock" class="class-clock phase-' + esc(clock.phase) + '" aria-label="' + esc(t('今日课程倒计时')) + '"><div class="clock-mark">' + icon('clock') + '</div><div class="clock-primary"><span id="class-clock-label" class="clock-label">' + esc(copy.label) + '</span><span id="class-clock-time" class="clock-value" role="timer" aria-live="off">' + esc(copy.time) + '</span></div><div class="clock-secondary"><p id="class-clock-detail">' + esc(copy.detail) + '</p><small id="class-clock-cache">' + esc(t(clock.stale ? '课表缓存待更新 · ' : '基于已读取课表 · ') + lastUpdated(status.lastCapturedAt)) + '</small></div></section>';
  }
  function updateClock() {
    const clock = Core.getClassClock(state), copy = clockCopy(clock), root = document.getElementById('class-clock');
    if (root) {
      root.className = 'class-clock phase-' + clock.phase;
      document.getElementById('class-clock-label').textContent = copy.label;
      document.getElementById('class-clock-time').textContent = copy.time;
      document.getElementById('class-clock-detail').textContent = copy.detail;
      document.getElementById('class-clock-cache').textContent = t(clock.stale ? '课表缓存待更新 · ' : '基于已读取课表 · ') + lastUpdated(sourceStatus('seiue').lastCapturedAt);
    }
    return clock;
  }
  function attachmentsHTML(items, owner) {
    const valid = (Array.isArray(items) ? items : []).slice(0,100);
    return valid.length ? '<div class="attachment-list">' + valid.map((item,index) => {
      const url = Core.safeAttachmentURL(item.url), title = esc(item.title || '附件');
      const key = 'attachment-' + encodeURIComponent((owner || 'detail') + '|' + (item.id || url || item.title || index));
      const label = item.text ? (item.cached ? '缓存文字' : item.extractionStatus === 'partial' ? '已提取部分文字' : '已提取文字') : ({error:'读取失败',unsupported:'格式暂不支持',read:'没有可提取文字',no_text:'未识别到文字'}[item.extractionStatus] || '正文尚未读取');
      const warnings = (Array.isArray(item.warnings) ? item.warnings : []).filter(value => typeof value === 'string').slice(0,2);
      return '<div class="attachment-preview">' + (url ? button(icon('link') + title, 'open-attachment', 'data-url="' + esc(url) + '"') : '<span>' + title + '</span>') + '<small> · ' + label + (item.truncated ? ' · 内容已截断' : '') + (item.capturedAt ? ' · 提取于 ' + esc(lastUpdated(item.capturedAt)) : '') + '</small>' + (item.text ? '<details id="' + esc(key) + '"><summary>查看表格／文档文字</summary><p class="attachment-caution">提取文字不等于名单已核验；请结合日期、表格布局和原件确认。</p><pre id="' + esc(key+'-text') + '" data-preserve-scroll data-selection-key class="attachment-text">' + esc(item.text) + '</pre></details>' : '') + (warnings.length ? '<p class="gpa-note">' + warnings.map(esc).join('<br>') + '</p>' : '') + (item.error ? '<p class="gpa-note">' + esc(item.error) + '</p>' : '') + '</div>';
    }).join('') + '</div>' : '';
  }
  function retainAttachmentMetadata(item, result) {
    if (['text_extracted','partial','none'].includes(result.extractionCoverage)) item.extractionCoverage=result.extractionCoverage;
    if (result.textOnly===true) item.textOnly=true;
    if (result.semanticVerified===false) item.semanticVerified=false;
    for (const key of ['pagesTotal','pagesRead','ocrPages']) if(Number.isSafeInteger(result[key]) && result[key]>=0 && result[key]<=100000)item[key]=result[key];
    if(Array.isArray(result.warnings))item.warnings=result.warnings.filter(value=>typeof value==='string').slice(0,8).map(value=>value.slice(0,500));
    if(Array.isArray(result.pageCoverage))item.pageCoverage=result.pageCoverage.slice(0,100).filter(row=>row && Number.isSafeInteger(row.page) && row.page>=1 && row.page<=100000 && ['text_extracted','partial','no_text','skipped'].includes(row.status) && ['pdf_text','pdf_text+ocr','ocr','none'].includes(row.method) && ['detected','not_detected','unknown'].includes(row.visualContent) && ['not_needed','completed','failed','limit','no_text'].includes(row.ocrStatus) && Number.isSafeInteger(row.characters) && row.characters>=0 && row.characters<=80000).map(row=>{
      const value={page:row.page,status:row.status,method:row.method,visualContent:row.visualContent,ocrStatus:row.ocrStatus,characters:row.characters};
      if(typeof row.ocrMeanConfidence==='number' && Number.isFinite(row.ocrMeanConfidence) && row.ocrMeanConfidence>=0 && row.ocrMeanConfidence<=1)value.ocrMeanConfidence=row.ocrMeanConfidence;
      if(Number.isSafeInteger(row.ocrLowConfidenceLines) && row.ocrLowConfidenceLines>=0 && row.ocrLowConfidenceLines<=10000)value.ocrLowConfidenceLines=row.ocrLowConfidenceLines;
      if(typeof row.reason==='string')value.reason=row.reason.slice(0,500);return value;
    });
  }
  function teamsGuide() {
    if (state.settings.teamsMode === 'browser') return renderTeamsAutoPanel(false);
    return '<div class="teams-guide graph-guide"><div><h3>' + (graphStatus.connected ? 'Teams 已连接，信息自动汇总' : '登录一次，自动汇总校园信息') + '</h3><p id="graph-progress-message">' + esc(graphStatusCopy()) + '</p><small id="graph-progress-scope">' + esc(graphScopeCopy()) + '</small><small>读取范围取决于学校授权和同步结果。默认也读取你参与的聊天，可在连接设置中关闭；图片和 PDF 通过原件入口查看。</small><p id="graph-progress-partial" class="source-warning"'+(graphStatus.coverage !== 'partial'?' hidden':'')+'>本次仅完成部分同步，已保留已获取内容，请查看同步提示。</p></div><div id="graph-progress-actions" class="banner-actions">' + graphPrimaryButton() + button('连接设置', 'teams-settings') + '</div></div>';
  }
  function teamsWarning() {
    const status = sourceStatus('teams');
    const warnings = [...new Set((graphStatus.warnings || []).concat(status.warnings || []))];
    return warnings.length ? '<div class="source-warning teams-warning">' + warnings.slice(0, 6).map(esc).join('<br>') + '</div>' : '';
  }
  function focusButton(action, value, active, label) {
    const englishLabel = isEnglish() ? label.replace(/^学科：/, 'Subject: ').replace(/^频道：/, 'Channel: ') : label;
    const aria = isEnglish() ? (active ? 'Unfavorite ' : 'Favorite ') + englishLabel : (active ? '取消' : '特别关注') + label;
    return '<button type="button" class="focus-button ' + (active ? 'active' : '') + '" data-action="' + esc(action) + '" data-value="' + esc(value) + '" aria-pressed="' + active + '" aria-label="' + esc(aria) + '">' + icon('focus') + '<span>' + (active ? '已关注' : '特别关注') + '</span></button>';
  }
  function postSender(post) { return post.author || t('发件人未标明'); }
  function postRecipient(post) { return post.recipient || t('收件人未标明'); }
  function postChannel(post) { return post.channel || t('频道未标明'); }
  function teamsPosts(kind) {
    const key = kind || '*';
    if (!teamsPostsCache.has(key)) teamsPostsCache.set(key, Core.getTeamsPosts(state, kind));
    return teamsPostsCache.get(key);
  }
  function postRows(posts) {
    return posts.map(post => {
      const kind = ({ assignment: '作业消息', ec: 'EC 通知', general: '频道消息' }[post.kind] || '频道消息');
      const published = post.publishedAt ? lastUpdated(post.publishedAt) : post.dateLabel ? (isEnglish() ? 'Original time: ' + post.dateLabel + ' (date unconfirmed)' : '原文时间：' + post.dateLabel + '（日期未确认）') : t('发布日期未确认');
      return '<article id="post-' + esc(encodeURIComponent(post.id)) + '" class="teams-post" data-reading-anchor><div class="post-meta"><span class="post-kind">' + t(kind) + '</span><span>' + (isEnglish() ? 'Recipient: ' : '收件人：') + esc(postRecipient(post)) + '</span><span>' + (isEnglish() ? 'Channel: ' : '频道：') + esc(postChannel(post)) + '</span><span>' + esc(post.author || t('发送者未标明')) + '</span><span>' + esc(published) + '</span></div><h3>' + esc(post.title || (post.kind === 'ec' ? t('English Corner 通知') : t('频道消息'))) + '</h3><div id="post-text-' + esc(encodeURIComponent(post.id)) + '" data-selection-key class="post-original">' + esc(post.text || t('本条消息未读取到文字，请打开原页面。')) + '</div>' + attachmentsHTML(post.attachments, 'post:'+post.id) + '<div class="post-foot"><span>' + (isEnglish() ? 'Captured ' : '读取于 ') + esc(lastUpdated(post.capturedAt)) + '</span>' + (post.url ? button('查看 Teams 原文 ↗', 'open-source', 'data-source="teams" data-url="' + esc(post.url) + '"', 'button-plain') : '') + '</div></article>';
    }).join('');
  }
  function groupedTeamsPosts(posts) {
    const watched = new Set(state.settings.focusTeamsChannels || []), senders = new Map();
    for (const post of posts) { const sender = postSender(post), channel = postChannel(post); if (!senders.has(sender)) senders.set(sender, new Map()); const channels = senders.get(sender); if (!channels.has(channel)) channels.set(channel, []); channels.get(channel).push(post); }
    return [...senders.entries()].sort((a, b) => a[0].localeCompare(b[0], 'zh-CN')).map(([sender, channels]) => '<section class="teams-recipient-group"><h2>' + (isEnglish() ? 'Sender: ' : '发件人：') + esc(sender) + '</h2>' + [...channels.entries()].sort((a, b) => Number(watched.has(b[0])) - Number(watched.has(a[0])) || a[0].localeCompare(b[0], 'zh-CN')).map(([channel, rows]) => '<div class="teams-channel-group"><div class="group-heading"><div><p>' + (isEnglish() ? 'Channel' : '频道') + '</p><h3>' + esc(channel) + '<span>' + rows.length + (isEnglish() ? ' item(s)' : ' 条') + '</span></h3></div>' + focusButton('toggle-focus-channel', channel, watched.has(channel), '频道：' + channel) + '</div>' + postRows(rows) + '</div>').join('') + '</section>').join('');
  }
  function renderTeams() {
    const posts = teamsPosts(), watched = new Set(state.settings.focusTeamsChannels || []);
    const kindVisible = posts.filter(post => teamsFilter === 'all' || post.kind === teamsFilter);
    const filtered = kindVisible.filter(post => teamsChannelFilter !== 'focus' || watched.has(postChannel(post)));
    const visible = filtered.slice(0, teamsVisibleLimit);
    const remaining = Math.max(0, filtered.length - visible.length);
    const tasks = Core.getTasks(state).filter(task => task.source === 'teams' && !task.completed);
    const rangeText = isEnglish() ? 'Showing ' + visible.length + ' / ' + filtered.length + ' captured message(s)' : '显示 ' + visible.length + ' / ' + filtered.length + ' 条已读取消息';
    const controls = '<div class="page-tools teams-tools"><div class="filter-pills">' + [['all', '全部消息'], ['assignment', '作业消息'], ['general', '其他通知']].map(filter => '<button type="button" class="pill ' + (teamsFilter === filter[0] ? 'active' : '') + '" data-action="teams-filter" data-filter="' + filter[0] + '">' + filter[1] + '</button>').join('') + '</div><div class="filter-pills"><button type="button" class="pill ' + (teamsChannelFilter === 'all' ? 'active' : '') + '" data-action="teams-channel-filter" data-filter="all">全部频道</button><button type="button" class="pill ' + (teamsChannelFilter === 'focus' ? 'active' : '') + '" data-action="teams-channel-filter" data-filter="focus">特别关注</button></div><span class="subtle">' + rangeText + '</span></div>';
    const showMore = remaining ? '<div class="message-pagination">' + button(isEnglish() ? 'Show 40 more (' + remaining + ' remaining)' : '再显示 40 条（还剩 ' + remaining + ' 条）', 'teams-show-more', '', 'button-light') + '</div>' : '';
    return heading('频道里的重要信息，在这里。', '按发件人和频道整理；特别关注仅影响 CampusDesk 的优先展示。', button(icon('link') + '打开 Teams', 'open-source', 'data-source="teams"')) + teamsGuide() + (tasks.length ? '<section class="card settings-section">' + cardHeader('tasks', 'Teams 待完成作业', goLink('tasks', '全部待办')) + taskRows(tasks, 5) + (tasks.length > 5 ? '<p class="gpa-note">另有 ' + (tasks.length - 5) + ' 项，可在待办中查看。</p>' : '') + '</section>' : '') + controls + '<section class="card teams-groups-card">' + (visible.length ? groupedTeamsPosts(visible) : empty('teams', teamsChannelFilter === 'focus' ? '还没有特别关注频道的已读取消息' : '还没有已读取的消息', teamsChannelFilter === 'focus' ? '在任意频道标题旁点“特别关注”，它会优先显示在这里。' : '连接学校 Microsoft 账号后，这里会自动汇总有权访问的频道消息。没有同步到消息不代表频道没有消息。')) + showMore + teamsWarning() + sourceFooter('teams') + '</section>';
  }
  function ecDate(post) { return post.publishedAt ? Core.today(new Date(post.publishedAt)) : ''; }
  function searchText(value) { return String(value || '').normalize('NFKC').toLocaleLowerCase().replace(/\s+/g,' ').trim(); }
  function scheduleEcSearchChunk(callback) {
    if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(callback, { timeout: 80 });
    else window.setTimeout(() => callback({ timeRemaining: () => 8 }), 0);
  }
  function ensureEcSearchIndex(posts) {
    if (ecSearchIndex) return;
    const makeRow = post => {
      const fields = [post.title, post.text, post.channel, post.author, ...(post.attachments || []).flatMap(file => [file.title, file.text])].map(searchText).filter(Boolean);
      return { post, date: ecDate(post), fields };
    };
    // Keep tiny rosters instant; index larger histories in idle-time slices.
    if (posts.length <= 12) {
      ecSearchBuildProgress = posts.length;
      ecSearchIndex = posts.map(makeRow);
      return;
    }
    const token = ++ecSearchBuildToken;
    ecSearchBuildProgress = 0;
    const indexed = [];
    const step = deadline => {
      if (token !== ecSearchBuildToken) return;
      let processed = 0;
      while (ecSearchBuildProgress < posts.length && processed < 6 && (processed === 0 || deadline.timeRemaining() > 1)) {
        const post = posts[ecSearchBuildProgress++];
        indexed.push(makeRow(post));
        processed++;
      }
      if (ecSearchBuildProgress >= posts.length) {
        ecSearchIndex = indexed;
        updateECResults();
      } else {
        const count = document.getElementById('ec-result-count');
        const fill = document.getElementById('ec-search-progress-fill');
        if (count) count.textContent = (isEnglish() ? 'Preparing search · ' : '正在准备搜索索引 · ') + ecSearchBuildProgress + ' / ' + posts.length;
        if (fill) fill.style.width = (posts.length ? Math.round(ecSearchBuildProgress / posts.length * 100) : 100) + '%';
        scheduleEcSearchChunk(step);
      }
    };
    scheduleEcSearchChunk(step);
  }
  function ecResultsHTML() {
    const all = teamsPosts('ec'), query = searchText(ecQuery);
    if (query && !ecSearchIndex) {
      ensureEcSearchIndex(all);
      if (!ecSearchIndex) return '<p id="ec-result-count" class="ec-result-count" role="status" aria-live="polite">' + (isEnglish() ? 'Preparing search · ' : '正在准备搜索索引 · ') + ecSearchBuildProgress + ' / ' + all.length + '</p><div class="ec-search-progress" aria-hidden="true"><span id="ec-search-progress-fill" style="width:' + (all.length ? Math.round(ecSearchBuildProgress / all.length * 100) : 100) + '%"></span></div>';
    }
    const rows = query ? ecSearchIndex.filter(row => row.fields.some(field => field.includes(query))) : all.map(post => ({ post, date: ecDate(post) }));
    const knownRows = rows.filter(row => row.date && ecDateFilter !== 'unknown' && (ecDateFilter === 'all' || row.date === ecDateFilter));
    const unknownRows = rows.filter(row => !row.date);
    const shown = knownRows.length + unknownRows.length;
    const visibleKnown = knownRows.slice(0, ecVisibleLimit);
    const visibleUnknown = unknownRows.slice(0, Math.max(0, ecVisibleLimit - visibleKnown.length));
    const visibleCount = visibleKnown.length + visibleUnknown.length;
    const countText = isEnglish() ? 'Showing ' + visibleCount + ' / ' + all.length + ' matching notice(s)' + (unknownRows.length ? ' · ' + unknownRows.length + ' date-unconfirmed notice(s) kept visible' : '') : '显示 ' + visibleCount + ' / ' + all.length + ' 条匹配通知' + (unknownRows.length ? ' · ' + unknownRows.length + ' 条日期未确认（保留显示）' : '');
    const more = shown > visibleCount ? '<div class="message-pagination">' + button(isEnglish() ? 'Show 40 more (' + (shown - visibleCount) + ' remaining)' : '再显示 40 条（还剩 ' + (shown - visibleCount) + ' 条）', 'ec-show-more', '', 'button-light') + '</div>' : '';
    return '<p id="ec-result-count" class="ec-result-count" role="status" aria-live="polite">' + countText + '</p>' + (visibleKnown.length ? postRows(visibleKnown.map(row => row.post)) : '') + (visibleUnknown.length ? '<h3 class="ec-undated-heading">发布日期未确认</h3><p class="subtle">这些原文未因日期筛选被隐藏，不据此推断活动日期。</p>' + postRows(visibleUnknown.map(row => row.post)) : '') + more + (!shown ? empty('ec', all.length ? '没有匹配的已读取通知' : '等待第一份 EC 通知', all.length ? '试试姓名的一部分、附件中的词语，或清除筛选。未匹配不代表不在名单中。' : '登录 Teams 并完成同步后，这里汇总已识别的 EC 原文。', all.length ? button('清除筛选','ec-clear') : teamsPrimaryButton()) : '');
  }
  function updateECResults() { const target = document.getElementById('ec-results'); if (target) target.innerHTML = localizedHTML(ecResultsHTML); }
  function renderEC() {
    const dates = [...new Set(teamsPosts('ec').map(ecDate).filter(Boolean))].sort().reverse();
    return heading('English Corner，记得赴约。', '搜索已读取原文和附件文字，核对最新安排。', button(icon('link') + '打开 Teams', 'open-source', 'data-source="teams"')) + teamsGuide() + '<div class="info-note">先核对取消或变更通知，再查看对应日期的名单；旧名单不代表今天的安排。下面按通知的明确发布日期筛选，不推断活动日期或参与人员。附件提取文字可能不完整，未匹配到姓名不代表不在名单中，请核对原件。</div>' + '<section class="card"><div class="ec-filters"><label for="ec-search">姓名或全文<input id="ec-search" type="search" value="' + esc(ecQuery) + '" placeholder="搜索通知和已解析附件" autocomplete="off" maxlength="200" aria-controls="ec-results"></label><label for="ec-date-filter">通知发布日期<select id="ec-date-filter" aria-controls="ec-results"><option value="all"' + (ecDateFilter === 'all' ? ' selected' : '') + '>全部日期</option><option value="unknown"' + (ecDateFilter === 'unknown' ? ' selected' : '') + '>仅日期未确认</option>' + dates.map(date => '<option value="' + date + '"' + (ecDateFilter === date ? ' selected' : '') + '>' + date + '</option>').join('') + '</select></label>' + button('清除筛选','ec-clear') + '</div><div id="ec-results">' + ecResultsHTML() + '</div>' + teamsWarning() + sourceFooter('teams') + '</section>';
  }
  function renderClassicOverview() {
    const today = Core.today(), classes = Core.getSchedule(state, today), tasks = Core.getTasks(state), feedback = Core.getFeedback(state);
    const openTasks = tasks.filter(t => !t.completed), overdue = openTasks.filter(t => taskDue(t).overdue).length;
    const dueToday = openTasks.filter(t => t.dueAt && Core.today(new Date(t.dueAt)) === today).length;
    const gpa = getGpaView(), displayGpa = gpa.official || gpa.estimate;
    const course = Core.getNextClass(state);
    const connected = Boolean(sourceStatus('seiue').lastCapturedAt || sourceStatus('managebac').lastCapturedAt || sourceStatus('teams').lastCapturedAt);
    const topText = course.current ? '正在上 ' + course.current.title + '，' + (course.current.end || '课后') + ' 结束。' : course.next ? '下一节是 ' + course.next.title + '，' + (course.next.start || '时间待定') + ' 开始。' : '课程、成绩和待办，在这里从容安排。';
    const date = new Date();
    const taskPreview = taskSourceSections(openTasks, rows => taskRows(rows, 3));
    return heading('今天，也有条不紊。', topText, '<div class="date-stamp">' + esc(fmtDate(date, { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })) + '<span>BEIJING · ' + esc(Core.clock()) + '</span></div>') +
      (!native ? '<div class="browser-banner">你正在使用网页预览。个人待办可以本地保存；学校登录与自动同步需要打开 CampusDesk Mac 应用。</div>' : '') +
      (!connected ? '<div class="connect-banner"><div class="banner-icon">' + icon('cloud') + '</div><div class="banner-copy"><h3>连接校园，开始你的第一天</h3><p>连接希悦、ManageBac 和 Teams，把课表、作业和通知放在一起。</p></div><div class="banner-actions">' + button('连接希悦', 'open-source', 'data-source="seiue"', 'button-primary') + button('连接 ManageBac', 'open-source', 'data-source="managebac"') + teamsPrimaryButton() + '</div></div>' : '') +
      renderClassClock() + '<div class="overview-grid"><section class="card schedule-card">' + cardHeader('schedule', '今日课程', goLink('schedule', '完整课表')) + (classes.length ? scheduleRows(classes, today) : noSchedule(today)) + sourceFooter('seiue') + '</section>' +
      '<section class="card gpa-card">' + cardHeader('grades', gpa.official ? '学校 GPA' : '参考 GPA', goLink('grades', '成绩详情')) + '<div class="gpa-row">' + gpaValue(displayGpa && displayGpa.value, displayGpa && displayGpa.scale) + '<div class="gpa-detail">' + (gpa.official ? '学校页面显示的 GPA<br>' + esc(gpa.official.label || '') : '非官方 · 等权参考<br>' + esc(gpa.estimate.count || 0) + ' 门可用课程') + '</div></div><p class="gpa-note">' + (gpa.official ? '以学校正式成绩单为准。' : '90 / 80 / 70 / 60 分 → 4 / 3 / 2 / 1，不含 AP 加权。') + '</p></section>' +
      '<section class="card task-summary-card">' + cardHeader('tasks', '待办一览', goLink('tasks', '全部待办')) + '<div class="task-stats"><div class="stat"><span class="stat-number">' + openTasks.length + '</span><span class="stat-name">未完成</span></div><div class="stat"><span class="stat-number">' + dueToday + '</span><span class="stat-name">今日截止</span></div><div class="stat overdue"><span class="stat-number">' + overdue + '</span><span class="stat-name">已逾期</span></div></div></section></div>' +
      '<div class="overview-bottom"><section class="card overview-task-sources">' + cardHeader('tasks', '接下来要做', button(icon('plus') + '添加待办', 'add-task', '', 'button-plain')) + (openTasks.length ? taskPreview : '<div class="empty small-empty"><h3>给重要的事留一个位置</h3><p>学校任务会在同步后出现，也可以先添加自己的待办。</p></div>') + '<div class="section-foot"><span>完成勾选仅保存在本机</span><span>不代表已向学校提交</span></div></section><section class="card feedback-preview">' + cardHeader('feedback', '老师的反馈', goLink('feedback', '查看全部')) + (feedback.length ? feedbackRows(feedback, 1) : '<div class="empty small-empty"><h3>等待新的反馈</h3><p>同步后汇总已读取的老师评语。仅覆盖已读取页面。</p></div>') + sourceFooter('managebac') + '</section></div>';
  }
  function boardDueLabel(task) {
    const due = taskDue(task);
    return due.label === '未标明' ? '截止时间未标明' : due.label;
  }
  function boardTaskCards(tasks, limit) {
    const visible = tasks.slice(0, limit || tasks.length);
    if (!visible.length) return '<div class="board-empty"><span>' + icon('tasks') + '</span><h3>现在没有待完成的事项</h3><p>学校任务同步后会出现在这里；也可以从经典面板添加个人待办。</p></div>';
    return '<div class="board-task-grid">' + visible.map(task => {
      const source = task.source || 'manual', local = source === 'manual', due = taskDue(task);
      const accent = due.overdue ? 'rose' : source === 'teams' ? 'teal' : local ? 'violet' : 'amber';
      const tag = local ? '个人' : source === 'teams' ? 'Teams' : 'ManageBac';
      return '<article class="board-task-card board-accent-' + accent + '"><div class="board-task-top"><span class="board-course">' + esc(task.course || (local ? '个人待办' : sourceName(source))) + '</span><span class="board-source">' + esc(tag) + '</span></div><h3>' + (local ? esc(task.title) : '<button type="button" data-action="task-detail" data-id="' + esc(task.id) + '">' + esc(task.title) + '</button>') + '</h3><div class="board-task-foot"><span class="board-due ' + (due.overdue ? 'overdue' : '') + '">' + esc(boardDueLabel(task)) + '</span><button class="board-check" type="button" data-action="toggle-task" data-id="' + esc(task.id) + '" aria-label="标为已完成：' + esc(task.title) + '">' + icon('check') + '</button></div></article>';
    }).join('') + '</div>';
  }
  function renderBoardOverview() {
    const today = Core.today(), tasks = Core.getTasks(state), openTasks = tasks.filter(task => !task.completed);
    const overdue = openTasks.filter(task => taskDue(task).overdue).length;
    const nextWeek = openTasks.filter(task => {
      if (!task.dueAt) return false;
      const time = new Date(task.dueAt).getTime(), now = Date.now();
      return time >= now && time <= now + 7 * 24 * 60 * 60 * 1000;
    }).length;
    const completed = tasks.filter(task => task.completed).length;
    const gpa = getGpaView(), displayGpa = gpa.official || gpa.estimate;
    const classes = Core.getSchedule(state, today), course = Core.getNextClass(state);
    const topText = course.current ? (isEnglish() ? 'Current class: ' + course.current.title + ' ends at ' + (course.current.end || 'the end of class') + '.' : '正在上 ' + course.current.title + '，' + (course.current.end || '课后') + ' 结束。') : course.next ? (isEnglish() ? 'Next: ' + course.next.title + ' starts at ' + (course.next.start || 'TBD') + '.' : '下一节 ' + course.next.title + '，' + (course.next.start || '时间待定') + ' 开始。') : t('把今天的课程和待办排得清清楚楚。');
    const classPreview = classes.slice(0, 3).map(item => '<div class="board-class-row"><span>' + esc(item.start || '—') + '</span><strong>' + esc(item.title || '自习课') + '</strong><small>' + esc(item.room || '地点待确认') + '</small></div>').join('');
    const boardClock = '<div class="board-header-clock">' + renderClassClock() + '</div>';
    const metrics = '<div class="board-kpi-grid"><article class="board-kpi board-kpi-open"><span>未完成</span><strong>' + openTasks.length + '</strong><small>等待处理的任务</small></article><article class="board-kpi board-kpi-overdue"><span>已逾期</span><strong>' + overdue + '</strong><small>优先回到原页面核对</small></article><article class="board-kpi board-kpi-week"><span>7 天内</span><strong>' + nextWeek + '</strong><small>有明确截止时间</small></article><article class="board-kpi board-kpi-done"><span>已完成</span><strong>' + completed + '</strong><small>仅本机勾选记录</small></article><article class="board-kpi board-kpi-gpa"><span>' + (gpa.official ? '学校 GPA' : '参考 GPA') + '</span><strong>' + (displayGpa && displayGpa.value != null ? esc(Number(displayGpa.value).toFixed(2)) : '—') + '</strong><small>' + (displayGpa && displayGpa.scale ? '/ ' + esc(displayGpa.scale) : '等待成绩同步') + '</small></article></div>';
    const boardTasks = taskSourceSections(openTasks, rows => boardTaskCards(rows, 6));
    const taskSection = '<section class="board-task-section"><div class="board-section-heading"><div><p>全部待办</p><h2>集中处理最重要的事</h2></div><div>' + button(icon('plus') + '添加待办', 'add-task', '', 'button-primary') + button('查看全部', 'go-tasks', '', 'button-light') + '</div></div><div class="board-source-groups">' + (openTasks.length ? boardTasks : boardTaskCards(openTasks)) + '</div>' + (openTasks.length > 15 ? '<p class="board-more">另有 ' + (openTasks.length - 15) + ' 项，前往“待办事项”查看。</p>' : '') + '</section>';
    const side = '<aside class="board-side-column"><section class="board-mini-card"><p>今日课程</p><h2>' + (classes.length ? classes.length + ' 节已读取课程' : '等待课表同步') + '</h2>' + (classPreview || '<p class="board-muted">登录希悦并打开课表后，这里会显示当天课程。</p>') + '</section><section class="board-mini-card board-tip"><p>今日提示</p><h2>信息以原平台为准</h2><span>卡片只整理已经读取到的课程、成绩和作业；点击学校任务可查看原文要求。</span></section></aside>';
    return '<section class="board-panel"><div class="board-hero"><div><p class="board-eyebrow">CAMPUSDESK · 学习看板</p><h1>今天，稳稳推进。</h1><p>' + esc(topText) + '</p></div><div class="board-hero-actions"><span>' + esc(fmtDate(new Date(), { month: 'long', day: 'numeric', weekday: 'long' })) + '</span>' + button(icon('settings') + '面板样式', 'appearance-settings', '', 'button-light') + '</div></div>' + boardClock + metrics + '<div class="board-layout">' + taskSection + side + '</div></section>';
  }
  function renderOverview() {
    return state.settings.dashboardTheme === 'board' ? renderBoardOverview() : renderClassicOverview();
  }
  function renderSchedule() {
    const rows = Core.getSchedule(state, selectedDate);
    return heading('为每一节课，留好位置。', '以北京时间展示课程。空白课节按你的设置显示为自习。') + (selectedDate === Core.today() ? renderClassClock() : '') + '<div class="page-tools"><div class="date-control"><button class="icon-button" type="button" data-action="prev-day" aria-label="前一天">' + icon('back') + '</button><label class="visually-hidden" for="schedule-date">课表日期</label><input id="schedule-date" type="date" value="' + esc(selectedDate) + '"><button class="icon-button" type="button" data-action="next-day" aria-label="后一天">' + icon('arrow') + '</button><span class="date-day">' + esc(dayLabel(selectedDate)) + '</span>' + button('今天', 'today') + '</div>' + button(icon('link') + '打开希悦课表', 'open-source', 'data-source="seiue"') + '</div>' + renderScheduleConflicts(rows, selectedDate) + '<section class="card schedule-full">' + cardHeader('schedule', selectedDate === Core.today() ? '今日课程' : esc(selectedDate) + ' 的课程', '<span class="card-kicker">' + rows.length + ' 节已读取课程</span>') + (rows.length ? scheduleRows(rows, selectedDate) : noSchedule(selectedDate)) + sourceFooter('seiue') + '</section>' + renderCustomSchedule() + '<p class="footer-note">自习仅补充学校页面中能确认时间的空白课节，不推测未读取的课表。</p>';
  }
  function renderScheduleConflicts(rows, date) {
    const timed = rows.filter(row => row.start && row.end && /^\d{2}:\d{2}$/.test(row.start) && /^\d{2}:\d{2}$/.test(row.end)).map(row => ({ row, start: row.start, end: row.end })).sort((a, b) => a.start.localeCompare(b.start));
    const conflicts = [];
    for (let i = 0; i < timed.length; i++) for (let j = i + 1; j < timed.length && timed[j].start < timed[i].end; j++) {
      if (timed[i].start < timed[j].end) conflicts.push([timed[i].row, timed[j].row]);
    }
    if (!conflicts.length) return '<section class="card conflict-card conflict-clear"><strong>' + (isEnglish() ? 'No schedule conflicts' : '未发现课程时间冲突') + '</strong><span>' + esc(date) + ' · ' + (isEnglish() ? 'checked captured, one-time and adjusted classes' : '已核对已读取课程、一次性课程和临时调课') + '</span></section>';
    return '<section class="card conflict-card conflict-warning"><strong>' + (isEnglish() ? 'Schedule conflicts' : '发现时间冲突') + ' · ' + conflicts.length + '</strong><div>' + conflicts.map(pair => '<p>' + esc(pair[0].start + '–' + pair[0].end + ' ' + pair[0].title + ' ↔ ' + pair[1].start + '–' + pair[1].end + ' ' + pair[1].title) + '</p>').join('') + '</div><small>' + (isEnglish() ? 'Please verify the source schedule and your local rules.' : '请核对来源课表和本机调课规则。') + '</small></section>';
  }
  function escapeRegExp(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function searchIndex() {
    if (cachedSearchIndex) return cachedSearchIndex;
    const rows = [];
    for (const task of Core.getTasks(state)) rows.push({ kind: 'task', id: task.id, title: task.title, meta: [task.course, sourceName(task.source), task.dueAt ? fmtDate(task.dueAt) : ''].filter(Boolean).join(' · '), text: [task.requirements, task.status, ...(task.attachments || []).map(a => a.title + ' ' + (a.text || ''))].join(' '), source: task.source === 'teams' ? 'teams' : task.source === 'managebac' ? 'managebac' : '', url: task.url, task });
    for (const post of teamsPosts()) rows.push({ kind: 'post', id: post.id, title: post.title, meta: ['Teams', post.author, post.recipient, post.channel, post.dateLabel].filter(Boolean).join(' · '), text: [post.text, ...(post.attachments || []).map(a => a.title + ' ' + (a.text || ''))].join(' '), source: 'teams', url: post.url, item: post });
    for (const item of Core.getFeedback(state)) rows.push({ kind: 'feedback', id: item.id, title: item.teacher || '老师反馈', meta: [item.source === 'teams' ? 'Teams' : 'ManageBac', item.course, item.date].filter(Boolean).join(' · '), text: item.text, source: item.source, url: item.url, item });
    for (const course of Core.getCourses(state)) rows.push({ kind: 'grade', id: course.id, title: course.name, meta: ['ManageBac', course.term, course.percentage == null ? '' : Number(course.percentage).toFixed(1) + '%'].filter(Boolean).join(' · '), text: course.name + ' ' + course.term, source: 'managebac', url: course.url, item: course });
    for (const grade of Core.getTeamsGrades(state)) rows.push({ kind: 'grade', id: grade.id, title: grade.title || grade.gradeLabel || 'Teams 成绩', meta: ['Teams', grade.course, grade.date].filter(Boolean).join(' · '), text: [grade.gradeLabel, grade.rubric, grade.feedback].filter(Boolean).join(' '), source: 'teams', url: grade.url, item: grade });
    const attachments = [];
    for (const task of Core.getTasks(state)) for (const file of task.attachments || []) attachments.push({ file, course: task.course, source: task.source === 'teams' ? 'teams' : task.source === 'managebac' ? 'managebac' : '', owner: task.title, parentURL: task.url });
    for (const post of teamsPosts()) for (const file of post.attachments || []) attachments.push({ file, course: post.channel || post.course, source: 'teams', owner: post.title, parentURL: post.url });
    const seen = new Set();
    for (const entry of attachments) {
      const file = entry.file, key = [entry.source, file.id || file.url || file.title, entry.course].join('|');
      if (seen.has(key)) continue; seen.add(key);
      rows.push({ kind: 'attachment', id: file.id || file.url || file.title, title: file.title, meta: [entry.source === 'teams' ? 'Teams' : entry.source === 'managebac' ? 'ManageBac' : '', entry.course, entry.owner, file.mimeType].filter(Boolean).join(' · '), text: [file.text, file.error].filter(Boolean).join(' '), source: entry.source, url: file.url, parentURL: entry.parentURL, file });
    }
    cachedSearchIndex = rows;
    return cachedSearchIndex;
  }
  function searchResultsHTML(query) {
    const q = String(query || '').trim().toLocaleLowerCase();
    if (!q) return '<p class="hub-hint">' + (isEnglish() ? 'Search assignments, messages, feedback, grades, and attachment text.' : '可搜索作业、Teams 消息、老师反馈、成绩和已提取的附件文字。') + '</p>';
    const found = searchIndex().filter(item => (item.title + ' ' + item.meta + ' ' + item.text).toLocaleLowerCase().includes(q)).slice(0, 60);
    if (!found.length) return '<p class="hub-hint">' + (isEnglish() ? 'No captured results. Unread pages are not searched.' : '没有匹配的已读取内容；尚未读取的页面不会出现在搜索结果里。') + '</p>';
    return '<div class="hub-search-results">' + found.map(item => {
      const fileURL = item.kind === 'attachment' ? (Core.safeAttachmentURL(item.url) || Core.safeURL(item.url, item.source) || '') : '';
      const originalURL = item.kind === 'attachment' ? (item.parentURL || '') : item.url;
      return '<article class="hub-search-result"><div><small>' + esc(item.meta || item.kind) + '</small><strong>' + esc(item.title || '未命名') + '</strong><p>' + esc(String(item.text || '').replace(/\s+/g, ' ').slice(0, 220)) + '</p></div><div class="hub-result-actions">' + (item.kind === 'task' ? '<button class="button button-light" type="button" data-action="task-detail" data-id="' + esc(item.id) + '">查看要求</button>' : '') + (fileURL ? '<button class="button button-light" type="button" data-action="' + (Core.safeAttachmentURL(fileURL) ? 'open-attachment' : 'open-source') + '" data-source="' + esc(item.source) + '" data-url="' + esc(fileURL) + '">打开附件</button>' : '') + (originalURL && item.source ? '<button class="icon-button" type="button" data-action="open-source" data-source="' + esc(item.source) + '" data-url="' + esc(originalURL) + '" aria-label="查看原始页面">' + icon('link') + '</button>' : '') + '</div></article>';
    }).join('') + '</div>';
  }
  function taskPlan() {
    const settings = state.settings, all = Core.getTasks(state).filter(task => !task.completed);
    const order = new Map((settings.planOrder || []).map((id, index) => [id, index]));
    all.sort((a, b) => {
      const ao = order.has(a.id) ? order.get(a.id) : Infinity, bo = order.has(b.id) ? order.get(b.id) : Infinity;
      if (ao !== bo) return ao - bo;
      const ap = Number(settings.taskPriority[a.id]) || 2, bp = Number(settings.taskPriority[b.id]) || 2;
      if (ap !== bp) return ap - bp;
      const ad = Date.parse(a.dueAt) || Infinity, bd = Date.parse(b.dueAt) || Infinity;
      if (ad !== bd) return ad - bd;
      const af = (settings.focusSubjects || []).includes(a.course) ? 0 : 1, bf = (settings.focusSubjects || []).includes(b.course) ? 0 : 1;
      return af - bf || a.title.localeCompare(b.title);
    });
    const nowDate = Core.today(), now = Core.clock(), [hh, mm] = now.split(':').map(Number);
    const nowAt = Date.parse(nowDate + 'T' + String(Math.max(8, hh)).padStart(2, '0') + ':' + String(hh < 8 ? 0 : mm).padStart(2, '0') + ':00+08:00');
    const endAt = Date.parse(nowDate + 'T22:00:00+08:00');
    const classes = Core.getSchedule(state, nowDate).filter(row => row.start && row.end).map(row => ({ start: Date.parse(nowDate + 'T' + row.start + ':00+08:00'), end: Date.parse(nowDate + 'T' + row.end + ':00+08:00') })).sort((a, b) => a.start - b.start);
    let cursor = nowAt;
    return all.map(task => {
      const duration = (Number(settings.taskMinutes[task.id]) || 30) * 60000;
      let attempts = 0;
      while (attempts++ < classes.length + 2) {
        const overlap = classes.find(item => cursor < item.end && cursor + duration > item.start);
        if (!overlap) break;
        cursor = overlap.end + 10 * 60000;
      }
      const fits = cursor + duration <= endAt;
      const slot = fits ? { start: cursor, end: cursor + duration } : null;
      if (fits) cursor += duration + 10 * 60000;
      return { task, slot, duration: duration / 60000 };
    });
  }
  function renderPlanRows() {
    const items = taskPlan();
    if (!items.length) return '<p class="hub-hint">' + (isEnglish() ? 'No open tasks to schedule.' : '没有未完成待办，可以安心推进课程或休息。') + '</p>';
    const visible = items.slice(0, 24);
    return '<div class="hub-plan-list" id="hub-plan-list">' + visible.map((item, index) => {
      const task = item.task, priority = Number(state.settings.taskPriority[task.id]) || 2, minutes = Number(state.settings.taskMinutes[task.id]) || 30;
      const due = taskDue(task);
      return '<article class="hub-plan-row" draggable="true" data-plan-task="' + esc(task.id) + '"><span class="hub-drag" aria-label="拖动以调整顺序">⠿</span><span class="hub-plan-index">' + (index + 1) + '</span><div class="hub-plan-main"><strong>' + esc(task.title) + '</strong><small>' + esc([task.course, item.slot ? fmtDate(item.slot.start, { hour: '2-digit', minute: '2-digit', hour12: false }) + '–' + fmtDate(item.slot.end, { hour: '2-digit', minute: '2-digit', hour12: false }) : (isEnglish() ? 'Unscheduled today' : '今日暂未排入'), due.label].filter(Boolean).join(' · ')) + '</small></div><label class="hub-plan-control"><span>分钟</span><select data-plan-minutes="' + esc(task.id) + '">' + [15, 30, 45, 60, 90, 120].map(value => '<option value="' + value + '"' + (minutes === value ? ' selected' : '') + '>' + value + '</option>').join('') + '</select></label><label class="hub-plan-control"><span>优先级</span><select data-plan-priority="' + esc(task.id) + '"><option value="1"' + (priority === 1 ? ' selected' : '') + '>高</option><option value="2"' + (priority === 2 ? ' selected' : '') + '>中</option><option value="3"' + (priority === 3 ? ' selected' : '') + '>低</option></select></label></article>';
    }).join('') + '</div>' + (items.length > visible.length ? '<p class="hub-hint">' + (isEnglish() ? 'Showing the first 24 tasks; refine priority or complete tasks to refresh the plan.' : '先展示前 24 项；调整优先级或完成任务后，计划会重新排列。') + '</p>' : '');
  }
  function renderTrustCards() {
    const sources = ['seiue', 'managebac', 'teams'];
    const labels = { available: '已读取内容', partial: '部分读取', stale: '缓存可能过期', empty: '本次成功检查：没有内容', unread: '本次未读取成功', login_required: '需要重新登录', not_connected: '尚未同步' };
    const en = { available: 'Content captured', partial: 'Partially read', stale: 'Cache may be stale', empty: 'Checked successfully: no content', unread: 'This attempt could not read content', login_required: 'Sign-in required', not_connected: 'Not synced' };
    return '<div class="hub-trust-grid">' + sources.map(source => {
      const status = Core.getSourceStatus(state, source), condition = status.condition || 'not_connected';
      const latestAttempt = status.lastAttemptAt ? fmtDate(status.lastAttemptAt, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : (isEnglish() ? 'Never' : '尚无记录');
      const lastContent = status.lastCapturedAt ? fmtDate(status.lastCapturedAt, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : (isEnglish() ? 'None' : '无');
      let coverage = status.records + (isEnglish() ? ' captured records' : ' 条已读记录');
      if (status.coverage && Number.isFinite(status.coverage.discovered)) {
        const read = Number.isFinite(status.coverage.read) ? status.coverage.read : status.records;
        coverage += ' · ' + read + '/' + status.coverage.discovered + (isEnglish() ? ' discovered' : ' 项已发现范围');
      }
      if (status.coverageLabel) coverage += ' · ' + status.coverageLabel;
      if (source === 'teams') {
        const counts = teamsAuto.counts || {};
        coverage += ' · ' + (counts.channelsRead || 0) + '/' + (counts.channels || 0) + (isEnglish() ? ' channels' : ' 个频道');
        if (teamsAuto.coverageItems && teamsAuto.coverageItems.length) coverage += ' · ' + teamsAuto.coverageItems.filter(item => item.status === 'complete').length + '/' + teamsAuto.coverageItems.length + (isEnglish() ? ' coverage checks complete' : ' 项范围核对成功');
      } else if (status.snapshotCount > 1) coverage += ' · ' + status.snapshotCount + (isEnglish() ? ' pages' : ' 个页面');
      const reasons = (status.warnings || []).slice(0, 2).join(' · ');
      return '<article class="hub-trust-card ' + (['partial', 'stale', 'empty', 'unread', 'login_required', 'not_connected'].includes(condition) ? 'is-warning' : '') + '"><div class="hub-trust-top"><strong>' + esc(sourceName(source)) + '</strong><span class="hub-status-pill">' + esc(isEnglish() ? en[condition] || en.unread : labels[condition] || labels.unread) + '</span></div><p>' + (isEnglish() ? 'Last attempt: ' : '最近尝试：') + esc(latestAttempt) + '</p><p>' + (isEnglish() ? 'Last useful data: ' : '最近有效数据：') + esc(lastContent) + '</p><small>' + esc(coverage) + (reasons ? ' · ' + esc(reasons) : '') + '</small></article>';
    }).join('') + '</div>';
  }
  function collectAttachments() {
    const files = [];
    for (const task of Core.getTasks(state)) for (const file of task.attachments || []) files.push({ file, course: task.course, source: task.source, parent: task.title, url: task.url });
    for (const post of teamsPosts()) for (const file of post.attachments || []) files.push({ file, course: post.channel || post.course, source: 'teams', parent: post.title, url: post.url });
    const seen = new Set();
    return files.filter(item => { const key = [item.source, item.file.id || item.file.url || item.file.title, item.course].join('|'); if (seen.has(key)) return false; seen.add(key); return true; });
  }
  function renderAttachmentHub() {
    const files = collectAttachments().slice(0, 100);
    if (!files.length) return '<p class="hub-hint">' + (isEnglish() ? 'No captured attachments yet.' : '同步到带有附件的消息或作业后，这里会按课程和来源整理。') + '</p>';
    const signatures = new Map();
    for (const item of files) { const key = item.file.title.toLocaleLowerCase(); if (!signatures.has(key)) signatures.set(key, []); signatures.get(key).push(item); }
    return '<div class="hub-attachment-grid">' + files.map(item => {
      const file = item.file, status = file.text ? (file.truncated ? '已提取（截断）' : '已离线缓存文字') : file.url ? '可打开原附件' : '仅发现名称';
      const siblings = signatures.get(file.title.toLocaleLowerCase()) || [], duplicates = siblings.length;
      const versions = [...new Set(siblings.map(entry => entry.file.versionKey).filter(Boolean))];
      const compareMap = new Map();
      for (const entry of siblings) {
        const signature = entry.file.versionKey || entry.file.text || '';
        if (signature) compareMap.set(signature, entry);
      }
      const canOpenAttachment = Boolean(Core.safeAttachmentURL(file.url));
      const directSource = item.source === 'managebac' && Core.safeURL(file.url, 'managebac') ? 'managebac' : 'teams';
      const openURL = canOpenAttachment || directSource === 'managebac' ? file.url : item.url;
      const openButton = openURL ? '<button class="icon-button" type="button" data-action="' + (canOpenAttachment ? 'open-attachment' : 'open-source') + '" data-source="' + directSource + '" data-url="' + esc(openURL) + '" aria-label="打开附件或原始页面">' + icon('link') + '</button>' : '';
      const cachedText = file.text ? '<details class="hub-cached-text"><summary>' + (isEnglish() ? 'View cached text' : '查看已缓存文字') + '</summary><pre>' + esc(file.text.slice(0, 8000)) + (file.truncated ? '\n…' : '') + '</pre></details>' : '';
      const versionNote = versions.length > 1 ? (isEnglish() ? versions.length + ' versions captured' : '已捕获 ' + versions.length + ' 个版本标识') : file.versionKey ? (isEnglish() ? 'Version tracked' : '已记录版本标识') : '';
      const versionCompare = compareMap.size > 1 ? '<details class="hub-cached-text"><summary>' + (isEnglish() ? 'Compare captured versions' : '并列对照已缓存版本') + ' · ' + compareMap.size + '</summary><div class="hub-version-compare">' + [...compareMap.values()].slice(0, 4).map(entry => '<section><small>' + esc(entry.file.versionKey || '版本标识未提供') + '</small><pre>' + esc(String(entry.file.text || '没有可离线对照的文字').slice(0, 1200)) + '</pre></section>').join('') + '</div></details>' : '';
      return '<article class="hub-attachment-card"><div class="hub-attachment-kind">' + esc((file.mimeType || file.title.split('.').pop() || 'FILE').toUpperCase().slice(0, 18)) + '</div><div><strong>' + esc(file.title) + '</strong><small>' + esc([item.course, sourceName(item.source), item.parent].filter(Boolean).join(' · ')) + '</small><p>' + esc(status + (duplicates > 1 ? ' · 同名 ' + duplicates + ' 份' : '') + (versionNote ? ' · ' + versionNote : '')) + '</p>' + cachedText + versionCompare + '</div>' + openButton + '</article>';
    }).join('') + '</div>';
  }
  function ecIdentityMatches() {
    const names = state.settings.ecIdentityNames || [];
    if (!names.length) return [];
    const matches = [];
    for (const post of teamsPosts('ec')) {
      const content = [post.title, post.text, ...(post.attachments || []).map(file => file.text || '')].join('\n');
      const found = names.map(name => ({ name, index: findAliasIndex(content, name) })).find(item => item.name && item.index >= 0);
      if (!found) continue;
      const match = found.name, index = found.index, snippet = content.slice(Math.max(0, index - 100), Math.min(content.length, index + match.length + 150)).replace(/\s+/g, ' ');
      const time = ((snippet.match(/(?:时间|集合时间|time)\s*[:：]?\s*([^，,。；;\n]{2,50})/i) || [])[1] || (snippet.match(/\b(?:[01]?\d|2[0-3])[:：][0-5]\d(?:\s*[-–—至]\s*(?:[01]?\d|2[0-3])[:：][0-5]\d)?\b/) || [])[0]);
      const place = (snippet.match(/(?:地点|教室|位置|集合地点|at|room|location)\s*[:：]?\s*([^，,。；;\n]{2,50})/i) || [])[1];
      const group = (snippet.match(/(?:组别|小组|团队|group)\s*[:：]?\s*([^，,。；;\n]{2,50})/i) || [])[1];
      const members = (snippet.match(/(?:成员|参加人员|名单|participants?|attendees?)\s*[:：]?\s*([^。；;\n]{2,100})/i) || [])[1];
      matches.push({ post, match, snippet, time: time || '', place: place || '', group: group || '', members: members || '' });
    }
    return matches;
  }
  function findAliasIndex(content, alias) {
    const value = String(content || ''), name = String(alias || '').trim();
    if (!name) return -1;
    if (!/^[A-Za-z0-9][A-Za-z0-9 .'-]*$/.test(name)) return value.toLocaleLowerCase().indexOf(name.toLocaleLowerCase());
    const match = new RegExp('(^|[^A-Za-z0-9])(' + escapeRegExp(name) + ')(?=$|[^A-Za-z0-9])', 'i').exec(value);
    return match ? match.index + match[1].length : -1;
  }
  function renderECMatches() {
    const matches = ecIdentityMatches();
    if (!(state.settings.ecIdentityNames || []).length) return '<p class="hub-hint">' + (isEnglish() ? 'Add your name or aliases to find exact mentions in captured EC notices. A match does not verify attendance.' : '添加你的姓名或常用名字，可在已读取的 EC 通知与附件文字中定位原文提及；命中不等于确认参加或名单完整。') + '</p>';
    if (!matches.length) return '<p class="hub-hint">' + (isEnglish() ? 'No exact name matches in the captured notices.' : '已读取内容中没有找到精确姓名匹配。图片或未提取的附件需要回原页核对。') + '</p>';
    return '<div class="hub-search-results">' + matches.slice(0, 40).map(item => '<article class="hub-search-result"><div><small>' + esc(item.post.dateLabel || '发布日期待确认') + ' · ' + esc(item.post.channel || item.post.author || 'Teams') + '</small><strong>' + esc(item.post.title || 'EC 通知') + '</strong><p>' + esc(item.snippet) + '</p><small>' + esc([item.group && '组别 ' + item.group, item.time && '原文时间 ' + item.time, item.place && '原文地点 ' + item.place, item.members && '成员原文 ' + item.members].filter(Boolean).join(' · ') || '附近没有明确的组别、时间、地点或成员字段') + '</small></div><div class="hub-result-actions">' + (item.post.url ? '<button class="button button-light" type="button" data-action="open-source" data-source="teams" data-url="' + esc(item.post.url) + '">查看原文</button>' : '') + '</div></article>').join('') + '</div>';
  }
  function renderLearning() {
    const changes = (state.changeLog || []).slice().sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt)).slice(0, 60);
    const names = state.settings.ecIdentityNames || [];
    const nameValue = names.join(', ');
    const openTasks = Core.getTasks(state).filter(task => !task.completed).length;
    return heading('把学习安排与变化放在一起。', '搜索已读取内容，核对每个来源，再安排今天的重点。') +
      '<section class="card hub-search-card">' + cardHeader('overview', '全局搜索') + '<label class="hub-search-label" for="hub-search">作业、Teams 消息、老师反馈、成绩与附件文字</label><input id="hub-search" type="search" value="' + esc(learningQuery) + '" placeholder="搜索已读取内容" autocomplete="off"><div id="hub-search-results">' + searchResultsHTML(learningQuery) + '</div></section>' +
      '<section class="card hub-plan-card">' + cardHeader('tasks', '今日学习计划', '<span class="card-kicker">' + openTasks + ' 项待办 · 拖动可调整顺序</span>') + '<p class="hub-section-note">根据今天课表避开上课时段，按截止日期、优先级和预计耗时排入空档。时间只是本机建议，可拖动并修改。</p>' + renderPlanRows() + '</section>' +
      '<section class="card hub-trust-section">' + cardHeader('cloud', '同步可信度中心') + '<p class="hub-section-note">“没有内容”表示本次成功读取且数量为零；登录或读取失败会单独显示。覆盖范围只代表已发现和已读取数据。</p>' + renderTrustCards() + '</section>' +
      '<section class="card hub-change-section">' + cardHeader('refresh', '变化收件箱', '<span class="card-kicker">' + changes.length + (isEnglish() ? ' recent changes' : ' 条近期变化') + '</span>') + '<p class="hub-section-note">只比较同一来源页面连续两次成功同步到的相同记录。首次读取、未加载页面和被权限挡住的内容不会被猜测。</p>' + (changes.length ? '<div class="hub-change-list">' + changes.map(item => '<article class="hub-change-row"><span class="hub-change-source">' + esc(sourceName(item.source)) + '</span><div><strong>' + esc(item.title || item.category) + '</strong><small>' + esc([item.course, item.category, fmtDate(item.capturedAt, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })].filter(Boolean).join(' · ')) + '</small><p>' + esc(item.detail) + '</p></div>' + (item.url ? '<button class="icon-button" type="button" data-action="open-source" data-source="' + esc(item.source) + '" data-url="' + esc(item.url) + '" aria-label="打开原页面">' + icon('link') + '</button>' : '') + '</article>').join('') + '</div>' : '<p class="hub-hint">' + (isEnglish() ? 'No changes captured yet. Changes will appear after a later successful sync.' : '暂时还没有可比较的变化。下一次成功同步后，截止日期、要求、附件和成绩更新会显示在这里。') + '</p>') + '</section>' +
      '<section class="card hub-ec-section">' + cardHeader('ec', 'EC 智能定位') + '<p class="hub-section-note">输入你的姓名别名后，只标出原文精确匹配及其附近可识别的时间/地点，始终可回原文核对。</p><div class="hub-identity-form"><label for="ec-identity-names">我的姓名 / 英文名</label><input id="ec-identity-names" value="' + esc(nameValue) + '" placeholder="多个名字用逗号分隔"><button class="button button-light" type="button" data-action="save-ec-identity">保存到本机</button></div><div id="ec-match-results">' + renderECMatches() + '</div></section>' +
      '<section class="card hub-attachment-section">' + cardHeader('book', '附件中心', '<span class="card-kicker">最多显示 100 个已发现附件</span>') + '<p class="hub-section-note">同名附件会提示数量；离线预览依赖已读取的文字，完整文件仍需打开原始附件。</p>' + renderAttachmentHub() + '</section>';
  }
  function renderGradeGoalSimulation(courses) {
    const eligible = courses.filter(course => course.percentage != null && Number.isFinite(Number(course.percentage)));
    if (!eligible.length) return '';
    const goals = state.settings.gradeGoals || {};
    return '<section class="card grade-goal-card">' + cardHeader('grades', '成绩目标模拟', '<span class="card-kicker">模拟数据 · 不会改动学校成绩</span>') + '<p class="hub-section-note">假设当前百分比是已完成部分的平均分，按剩余权重估算后续部分需要的分数；实际课程权重请以老师公布为准。</p><div class="grade-goal-list">' + eligible.map(course => {
      const saved = goals[course.id] || { target: 90, remainingWeight: 30 }, target = Number(saved.target), weight = Number(saved.remainingWeight), current = Number(course.percentage);
      const required = (target - current * (1 - weight / 100)) / (weight / 100);
      const outcome = required <= 0 ? (isEnglish() ? 'Target already reached' : '按当前均分已达到目标') : required > 100 ? (isEnglish() ? 'Target is above 100% under these assumptions' : '按此权重，目标将超过 100%，无法仅靠剩余部分达到') : (isEnglish() ? 'Need ' + required.toFixed(2) + '% on remaining work' : '剩余部分需达到 ' + required.toFixed(2) + '%');
      return '<article class="grade-goal-row"><div class="grade-goal-course"><strong>' + esc(course.name) + '</strong><small>' + (isEnglish() ? 'Real current grade' : '真实当前成绩') + ' · ' + esc(current.toFixed(2)) + '%</small></div><label><span>' + (isEnglish() ? 'Target %' : '目标百分比') + '</span><input type="number" min="0" max="100" step="0.1" value="' + esc(target) + '" data-grade-target="' + esc(course.id) + '"></label><label><span>' + (isEnglish() ? 'Remaining weight %' : '剩余权重') + '</span><input type="number" min="1" max="100" step="1" value="' + esc(weight) + '" data-grade-weight="' + esc(course.id) + '"></label><p class="grade-goal-result">' + esc(outcome) + '</p></article>';
    }).join('') + '</div></section>';
  }
  function renderFocusMode() {
    const clock = Core.getClassClock(state), plan = taskPlan().slice(0, 3), rows = Core.getSchedule(state, Core.today());
    const current = clock.current, next = clock.next;
    const clockText = current ? (isEnglish() ? 'In class · ' : '正在上课 · ') + current.start + '–' + current.end : next ? (isEnglish() ? 'Next class · ' : '下一节课程 · ') + next.start + '–' + next.end : (isEnglish() ? 'No captured class right now' : '当前没有已读取的课程');
    return '<section class="focus-view"><div class="focus-view-top"><span class="hub-kicker">' + (isEnglish() ? 'FOCUS SESSION' : '专注模式') + '</span><button class="button button-light" type="button" data-action="toggle-focus-mode">' + (isEnglish() ? 'Exit focus' : '退出专注') + '</button></div><p class="focus-date">' + esc(fmtDate(new Date(), { month: 'long', day: 'numeric', weekday: 'long' })) + '</p><h1>' + esc(current ? current.title : next ? next.title : (isEnglish() ? 'A quiet moment to study' : '给自己一段安静的学习时间')) + '</h1><p class="focus-subtitle">' + esc(clockText) + '</p><section class="focus-next-task"><small>' + (isEnglish() ? 'NEXT TASK' : '下一项任务') + '</small>' + (plan.length ? '<strong>' + esc(plan[0].task.title) + '</strong><p>' + esc((plan[0].task.course || sourceName(plan[0].task.source)) + ' · ' + (plan[0].slot ? fmtDate(plan[0].slot.start, { hour: '2-digit', minute: '2-digit', hour12: false }) : (isEnglish() ? 'Not scheduled today' : '今日暂未排入'))) + '</p>' : '<strong>' + (isEnglish() ? 'No open tasks' : '没有未完成任务') + '</strong>') + '</section><section class="focus-deadlines"><h2>' + (isEnglish() ? 'Coming deadlines' : '最近截止日期') + '</h2>' + (plan.length ? plan.map(item => '<div><span>' + esc(item.task.course || sourceName(item.task.source)) + '</span><strong>' + esc(item.task.title) + '</strong><small>' + esc(taskDue(item.task).label) + '</small></div>').join('') : '<p>—</p>') + '</section><small class="focus-course-count">' + rows.length + (isEnglish() ? ' captured classes today' : ' 节已读取课程') + '</small></section>';
  }
  function renderGrades() {
    const gpa = getGpaView();
    return heading('看见积累，也看见进步。', '先确认成绩来自哪一门课、哪一个学期，再理解 GPA。', button(icon('link') + '打开成绩页面', 'open-source', 'data-source="managebac"')) +
      '<div class="grade-top"><section class="card">' + cardHeader('grades', '学校 GPA', '<span class="card-kicker">学校公布</span>') + gpaValue(gpa.official && gpa.official.value, gpa.official ? gpa.official.scale : '—') + '<p class="gpa-note">' + (gpa.official ? esc(gpa.official.label || '来自已读取的学校页面，以正式成绩单为准。') : '尚未读取到学校公布的 GPA。这里不会用参考值替代。') + '</p></section><section class="card">' + cardHeader('grades', '参考 GPA', '<span class="card-kicker">非官方 · 4.0 制</span>') + gpaValue(gpa.estimate.value, '4.00') + '<p class="gpa-note">根据 ' + esc(gpa.estimate.count || 0) + ' 门可用课程等权估算' + (gpa.estimate.excluded ? '，另有 ' + esc(gpa.estimate.excluded) + ' 门未计入' : '') + '。</p></section></div>' +
      '<div class="info-note">参考换算：90–100 → 4.0；80–89.99 → 3.0；70–79.99 → 2.0；60–69.99 → 1.0；低于 60 → 0。仅使用能确认的当前学期课程总评，不把单次作业分数当总评；不含学分与 AP 加权，也不代表学校的换算规则。</div>' + renderGradePie(gpa.courses, gpa.official || gpa.estimate) + '<section class="card">' + cardHeader('book', '课程成绩', '<span class="card-kicker">' + gpa.courses.length + ' 门已读取课程</span>') +
      (gpa.courses.length ? '<div style="overflow-x:auto"><table class="grade-table"><thead><tr><th>课程</th><th>学期</th><th>百分制总评</th><th>参考绩点</th><th></th></tr></thead><tbody>' + gpa.courses.map(c => '<tr><td class="course-name">' + esc(c.name) + '</td><td>' + esc(c.term || '未确认') + '</td><td class="num">' + (c.percentage == null ? '—' : esc(Number(c.percentage).toFixed(1)) + '%') + (c.percentage == null ? '' : '<span class="grade-bar"><span style="width:' + Math.max(0, Math.min(100, Number(c.percentage) || 0)) + '%"></span></span>') + '</td><td class="num">' + (c.gpaEligible === false || c.percentage == null ? '未计入' : Core.estimateGPA([c]).value == null ? '未计入' : Number(Core.estimateGPA([c]).value).toFixed(2)) + '</td><td>' + (c.url ? '<button type="button" class="icon-button" data-action="open-source" data-source="managebac" data-url="' + esc(c.url) + '" aria-label="打开课程成绩">' + icon('link') + '</button>' : '') + '</td></tr>').join('') + '</tbody></table></div>' : empty('grades', '你的成绩，值得准确地记录', '登录 ManageBac 并打开当前学期成绩页面。读取到课程总评后，参考 GPA 会自动计算。', button('打开 ManageBac', 'open-source', 'data-source="managebac"'))) + sourceFooter('managebac') + '</section>' + renderGradeGoalSimulation(gpa.courses) + renderKlineChartHistory();
  }
  function gpaHistoryTimestamp(item) {
    const raw = String(item && (item.capturedAt || item.date) || '').trim();
    if (!raw) return NaN;
    const value = raw.includes('T') ? Date.parse(raw) : Date.parse(raw + 'T12:00:00+08:00');
    return Number.isFinite(value) ? value : NaN;
  }
  function gpaKlineBuckets(history, intervalMs) {
    const rows = history.map(item => ({ item: item, timestamp: gpaHistoryTimestamp(item) })).filter(row => Number.isFinite(row.timestamp)).sort((a, b) => a.timestamp - b.timestamp);
    if (!rows.length) return [];
    const anchor = rows[0].timestamp, groups = new Map();
    rows.forEach(row => {
      const bucket = Math.max(0, Math.floor((row.timestamp - anchor) / intervalMs)), key = String(bucket);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    });
    let previousClose = null;
    return [...groups.entries()].map(([key, groupedRows]) => {
      const values = groupedRows.map(row => Number(row.item.value)).filter(Number.isFinite), close = values[values.length - 1], open = previousClose == null ? values[0] : previousClose;
      previousClose = close;
      return { timestamp: anchor + Number(key) * intervalMs, open, high: Math.max.apply(null, values.concat(open)), low: Math.min.apply(null, values.concat(open)), close, volume: groupedRows.reduce((sum, row) => sum + (Number(row.item.count) || 0), 0), periodKey: key, sourceCount: groupedRows.length };
    });
  }
  function renderKlineChartHistory() {
    const history = (state.gradeHistory || []).filter(h => h.value != null && Number.isFinite(Number(h.value))).slice().sort((a, b) => gpaHistoryTimestamp(a) - gpaHistoryTimestamp(b));
    if (!history.length) return '';
    const palette = state.settings.gpaCandleColors === 'green-up' ? { up: '#4f8a70', down: '#c47768', label: '绿涨红跌' } : { up: '#c47768', down: '#4f8a70', label: '红涨绿跌' };
    const interval = GPA_KLINE_INTERVALS[gpaKlineIntervalIndex] || GPA_KLINE_INTERVALS[5], data = gpaKlineBuckets(history, interval.ms), tickLabels = GPA_KLINE_INTERVALS.map((item, index) => '<option value="' + index + '" label="' + item.short + '"></option>').join('');
    return '<section class="card gpa-kline-card" style="margin-top:21px"><div class="card-header"><h2 class="card-title"><span class="icon">' + icon('clock') + '</span>本机 GPA K 线</h2><span class="card-kicker">' + interval.label + ' · ' + data.length + ' 个周期</span></div><div class="gpa-kline-time-control"><div class="gpa-kline-time-heading"><span>时间分度值</span><output id="gpa-kline-interval-output" for="gpa-kline-interval">' + interval.label + '</output></div><input id="gpa-kline-interval" type="range" min="0" max="' + (GPA_KLINE_INTERVALS.length - 1) + '" step="1" value="' + gpaKlineIntervalIndex + '" list="gpa-kline-interval-ticks" data-action="gpa-kline-interval" aria-label="选择 GPA K 线时间分度值"><datalist id="gpa-kline-interval-ticks">' + tickLabels + '</datalist><div class="gpa-kline-time-scale"><span>1 小时</span><span>1 天</span><span>30 天</span></div></div><div class="gpa-kline-plot"><div id="gpa-kline-chart" aria-label="GPA K 线图" style="width:100%;height:500px;min-height:420px"></div></div><div class="gpa-kline-legend"><span><i style="background:' + palette.up + '"></i>上涨柱</span><span><i style="background:' + palette.down + '"></i>下降柱</span><span><i class="line"></i>收盘折线</span><span>当前：' + interval.label + '</span><span>' + (isEnglish() ? 'Hover to snap to the close line; show GPA only' : '悬停只吸附收盘折线并显示 GPA 数值，不吸附日期') + '</span></div><p class="gpa-note">时间分度值按首条 GPA 记录起算并聚合到固定窗口；柱顶显示收盘 GPA，折线连接各周期收盘值。下方同时显示成交量与 MACD 技术指标。</p></section>';
  }
  function ensureGpaValueOverlay(lib) {
    if (window.__campusGpaValueOverlay || !lib || typeof lib.registerOverlay !== 'function') return;
    lib.registerOverlay({ name: 'campus-gpa-value-label', totalStep: 2, needDefaultPointFigure: false, needDefaultXAxisFigure: false, needDefaultYAxisFigure: false, mode: 'normal', createPointFigures: ({ coordinates, overlay, bounding }) => {
      const point = coordinates && coordinates[0], label = overlay && overlay.extendData && overlay.extendData.label;
      if (!point || !label) return [];
      // No indicator legend lives inside this pane. Keep labels above their bars,
      // with a small edge inset rather than moving them onto the candle bodies.
      if (point.x < 20 || point.x > bounding.width - 20) return [];
      const labelY = Math.max(12, Math.min(point.y - 14, bounding.height - 12));
      return [{ type: 'text', attrs: { x: point.x, y: labelY, text: label, width: 38, height: 17, align: 'center', baseline: 'middle' }, styles: { style: 'stroke_fill', color: '#2e6650', size: 10, weight: 600, borderColor: '#d3e4d7', borderSize: 1, borderRadius: 4, backgroundColor: '#ffffff' } }];
    } });
    window.__campusGpaValueOverlay = true;
  }
  function zoomGpaKline(step) {
    if (!gpaKlineChart) return;
    const container = document.getElementById('gpa-kline-chart');
    if (!container) return;
    const chart = gpaKlineChart, width = Math.max(240, container.clientWidth - 80);
    const space = step === 0 ? Math.max(48, Math.min(100, width / (chart.getDataList().length + 2))) : Math.max(48, Math.min(120, chart.getBarSpace().bar * (step > 0 ? 1.2 : 1 / 1.2)));
    chart.setBarSpace(space);
    if (step === 0) chart.setOffsetRightDistance(Math.max(48, (width - chart.getDataList().length * space) / 2));
  }
  function attachGpaLineSnap(chart, container) {
    const plot = container.closest('.gpa-kline-plot') || container.parentElement;
    if (!plot) return;
    let badge = document.getElementById('gpa-kline-snap-value');
    if (!badge) {
      badge = document.createElement('span');
      badge.id = 'gpa-kline-snap-value';
      badge.className = 'gpa-kline-snap-value';
      badge.hidden = true;
      badge.setAttribute('aria-hidden', 'true');
      plot.appendChild(badge);
    } else if (badge.parentElement !== plot) plot.appendChild(badge);
    const hide = () => { badge.hidden = true; };
    if (container.dataset.gpaSnapLeave !== 'true') {
      container.dataset.gpaSnapLeave = 'true';
      container.addEventListener('mouseleave', hide);
    }
    chart.subscribeAction('onCrosshairChange', point => {
      if (!point || point.paneId !== 'candle_pane' || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
        hide();
        return;
      }
      const bars = chart.getDataList();
      let index = Number.isInteger(point.realDataIndex) ? point.realDataIndex : Number(point.dataIndex);
      if (!Number.isInteger(index) || !bars[index] || bars[index].timestamp !== point.timestamp) index = bars.findIndex(bar => bar.timestamp === point.timestamp);
      if (index < 0 || !bars[index]) { hide(); return; }
      const pixelAt = dataIndex => {
        const bar = bars[dataIndex];
        if (!bar) return null;
        const pixel = chart.convertToPixel({ timestamp: bar.timestamp, value: Number(bar.close) }, { paneId: 'candle_pane' });
        return pixel && Number.isFinite(pixel.x) && Number.isFinite(pixel.y) ? { x: pixel.x, y: pixel.y, value: Number(bar.close) } : null;
      };
      const current = pixelAt(index), previous = pixelAt(index - 1), next = pixelAt(index + 1);
      if (!current) { hide(); return; }
      const [start, end] = point.x < current.x && previous ? [previous, current] : next ? [current, next] : [previous || current, current];
      const ratio = end.x === start.x ? 0 : Math.max(0, Math.min(1, (point.x - start.x) / (end.x - start.x)));
      const value = start.value + (end.value - start.value) * ratio;
      const snappedY = start.y + (end.y - start.y) * ratio;
      if (!Number.isFinite(value) || !Number.isFinite(snappedY)) { hide(); return; }
      if (Math.abs(point.y - snappedY) > 0.5) chart.executeAction('onCrosshairChange', { x: point.x, y: snappedY, paneId: 'candle_pane' });
      badge.textContent = 'GPA · ' + value.toFixed(2);
      badge.hidden = false;
      const plotRect = plot.getBoundingClientRect(), chartRect = container.getBoundingClientRect();
      const localX = chartRect.left - plotRect.left + point.x;
      const localY = chartRect.top - plotRect.top + snappedY;
      const left = Math.max(8, Math.min(plot.clientWidth - (badge.offsetWidth || 82) - 8, localX + 12));
      const top = Math.max(8, Math.min(plot.clientHeight - 24, localY - 14));
      badge.style.left = left + 'px';
      badge.style.top = top + 'px';
    });
  }
  function mountGpaKlineChart() {
    const container = document.getElementById('gpa-kline-chart'), lib = window.klinecharts;
    if (!container || !lib || typeof lib.init !== 'function') return;
    if (!document.getElementById('gpa-kline-tools')) {
      const toolbar = document.createElement('div');
      toolbar.id = 'gpa-kline-tools';
      toolbar.className = 'gpa-kline-tools';
      toolbar.innerHTML = '<span>' + (isEnglish() ? 'Drag to pan · ⌘/Ctrl + scroll to zoom' : '拖动平移 · ⌘/Ctrl + 滚轮缩放') + '</span><div><button type="button" data-action="gpa-kline-zoom" data-step="-1" aria-label="' + (isEnglish() ? 'Zoom out' : '缩小 K 线') + '">−</button><button type="button" data-action="gpa-kline-zoom" data-step="1" aria-label="' + (isEnglish() ? 'Zoom in' : '放大 K 线') + '">+</button><button type="button" data-action="gpa-kline-zoom" data-step="0">' + (isEnglish() ? 'Reset view' : '重置视图') + '</button></div>';
      container.parentElement.before(toolbar);
    }
    if (!container.dataset.gpaGestures) {
      container.dataset.gpaGestures = 'true';
      // The library guesses pan vs. zoom on EVERY trackpad event. Diagonal
      // movement can switch modes mid-gesture. Zoom now requires explicit intent.
      container.addEventListener('wheel', event => {
        event.stopPropagation();
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          if (event.deltaY) zoomGpaKline(event.deltaY < 0 ? 1 : -1);
        } else if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
          event.preventDefault();
          if (gpaKlineChart) gpaKlineChart.scrollByDistance(-event.deltaX);
        }
        // Plain vertical scrolling continues to move the page, not resize bars.
      }, { capture: true, passive: false });
    }
    const history = (state.gradeHistory || []).filter(h => h.value != null && Number.isFinite(Number(h.value))).slice().sort((a, b) => gpaHistoryTimestamp(a) - gpaHistoryTimestamp(b));
    if (!history.length) return;
    const palette = state.settings.gpaCandleColors === 'green-up' ? { up: '#4f8a70', down: '#c47768' } : { up: '#c47768', down: '#4f8a70' };
    const interval = GPA_KLINE_INTERVALS[gpaKlineIntervalIndex] || GPA_KLINE_INTERVALS[5], data = gpaKlineBuckets(history, interval.ms);
    const chartKey = JSON.stringify([data, interval.ms, palette, isEnglish()]);
    if (gpaKlineChart && gpaKlineChartKey === chartKey) { gpaKlineChart.resize(); return; }
    if (gpaKlineChart) { lib.dispose(gpaKlineChart); gpaKlineChart = null; }
    // Labels occupy 38px: even at maximum zoom-out each record must keep its
    // own readable slot. Use the library's native limits, not an after-zoom reset.
    const chart = lib.init(container, { layout: { barSpaceLimit: { min: 48, max: 120 }, yAxis: { scrollZoomEnabled: false, gap: { top: 0.18, bottom: 0.1 } } }, zoomAnchor: 'last_bar', locale: isEnglish() ? 'en-US' : 'zh-CN' });
    if (!chart) return;
    // Native wheel, pinch and time-axis dragging all share this zoom switch.
    // Keep panning enabled; only the dedicated controls may change candle width.
    chart.setZoomEnabled(false);
    chart.setSymbol({ ticker: 'GPA', pricePrecision: 2, volumePrecision: 0 });
    chart.setPeriod(interval.chart);
    chart.setStyles({ candle: { type: 'candle_solid', bar: { upColor: palette.up, downColor: palette.down, noChangeColor: '#8a9386', upBorderColor: palette.up, downBorderColor: palette.down, noChangeBorderColor: '#8a9386', upWickColor: palette.up, downWickColor: palette.down, noChangeWickColor: '#8a9386' }, priceMark: { high: { show: false }, low: { show: false }, last: { show: true, text: { show: true }, line: { show: true } } }, tooltip: { showRule: 'none' } }, indicator: { tooltip: { showRule: 'none' } }, grid: { show: true, horizontal: { show: true, color: '#e5ebe4', size: 1, style: 'dashed', dashedValue: [2, 2] }, vertical: { show: false } }, crosshair: { show: true, horizontal: { show: true, line: { color: '#83b79e', size: 1, style: 'dashed' } }, vertical: { show: true, line: { show: true, color: '#8592a0', size: 1, style: 'dashed' }, text: { show: false } } } });
    const plotWidth = Math.max(240, container.clientWidth - 80);
    const barSpace = Math.max(48, Math.min(100, plotWidth / (data.length + 2)));
    chart.setBarSpace(barSpace);
    chart.setLeftMinVisibleBarCount(Math.min(data.length, 4));
    chart.setRightMinVisibleBarCount(Math.min(data.length, 4));
    chart.setOffsetRightDistance(Math.max(48, (plotWidth - data.length * barSpace) / 2));
    chart.setDataLoader({ getBars: params => params.callback(params.type === 'init' ? data : [], { backward: false, forward: false }) });
    try { ensureGpaValueOverlay(lib); data.forEach(bar => chart.createOverlay({ name: 'campus-gpa-value-label', paneId: 'candle_pane', lock: true, points: [{ timestamp: bar.timestamp, value: bar.high }], extendData: { label: Number(bar.close).toFixed(2) } })); } catch (_) { /* Labels are optional; the native crosshair remains available. */ }
    try { chart.createIndicator({ name: 'MA', calcParams: [1, 5, 10, 30, 60], precision: 2, paneId: 'candle_pane', styles: { lines: [{ color: '#607f6e', size: 2 }, { color: '#f0a23b', size: 1.4 }, { color: '#9d72b8', size: 1.4 }, { color: '#4f93d1', size: 1.4 }, { color: '#d95c91', size: 1.4 }] } }, false); } catch (_) { /* The candle chart remains usable if an older bundled build omits MA. */ }
    try { chart.createIndicator({ name: 'VOL', calcParams: [5, 10, 20], precision: 0, paneId: 'volume_pane' }, false); } catch (_) { /* Volume is an enhancement; the price chart remains usable. */ }
    try { chart.createIndicator({ name: 'MACD', calcParams: [12, 26, 9], precision: 2, paneId: 'macd_pane' }, false); } catch (_) { /* MACD is an enhancement; the price chart remains usable. */ }
    attachGpaLineSnap(chart, container);
    chart.resize();
    gpaKlineChart = chart;
    gpaKlineChartKey = chartKey;
  }
  function deferGpaChartDispose(chart, library) {
    if (!chart || !library || typeof library.dispose !== 'function') return;
    const dispose = () => { try { library.dispose(chart); } catch (_) { /* The chart host may already be detached. */ } };
    if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(dispose, { timeout: 320 });
    else window.setTimeout(dispose, 160);
  }
  function scheduleGpaChartMount() {
    if (gpaChartMountScheduled || typeof window.requestAnimationFrame !== 'function') return;
    gpaChartMountScheduled = true;
    const mount = () => {
      gpaChartMountScheduled = false;
      if (page === 'grades' && !state.settings.focusMode) mountGpaKlineChart();
    };
    if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(mount, { timeout: 420 });
    else window.requestAnimationFrame(mount);
  }
  function animatePageSwitch(content) {
    if (!content || typeof content.animate !== 'function') return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (pageSwitchAnimation) pageSwitchAnimation.cancel();
    pageSwitchAnimation = content.animate([
      { opacity: 0.42, transform: 'translate3d(0, 16px, 0) scale(.986)' },
      { opacity: 1, transform: 'translate3d(0, 0, 0) scale(1)' }
    ], {
      duration: 360,
      easing: 'cubic-bezier(.16,1,.3,1)'
    });
    pageSwitchAnimation.onfinish = () => { pageSwitchAnimation = null; };
  }
  function renderHistory() {
    const history = (state.gradeHistory || []).filter(h => h.value != null && Number.isFinite(Number(h.value))).slice().sort((a, b) => String(a.capturedAt || a.date || '').localeCompare(String(b.capturedAt || b.date || '')));
    if (!history.length) return '';
    const values = history.map(h => Number(h.value));
    const minValue = Math.max(0, Math.min.apply(null, values) - 0.12), maxValue = Math.min(4, Math.max.apply(null, values) + 0.12), span = Math.max(0.2, maxValue - minValue);
    const midpoint = (maxValue + minValue) / 2;
    const plotWidth = Math.max(600, history.length * 38);
    const palette = state.settings.gpaCandleColors === 'green-up' ? { up: '#4f8a70', down: '#c47768', label: '绿涨红跌' } : { up: '#c47768', down: '#4f8a70', label: '红涨绿跌' };
    const candles = history.map((h, index) => {
      const close = values[index], open = index ? values[index - 1] : close, topValue = Math.max(open, close), bottomValue = Math.min(open, close);
      const wickTop = (maxValue - topValue) / span * 100, wickHeight = Math.max(0.8, (topValue - bottomValue) / span * 100), bodyTop = wickTop, bodyHeight = Math.max(4, wickHeight);
      const color = close > open ? palette.up : close < open ? palette.down : '#8a9386';
      const fullLabel = lastUpdated(h.capturedAt || h.date), dateLabel = /^\d{4}-\d{2}-\d{2}$/.test(String(h.date || '')) ? String(h.date).slice(5).replace('-', '/') : fullLabel.split(' ')[0], timeLabel = fullLabel.split(' ')[1] || '';
      return '<div class="gpa-kline-candle" style="position:relative;flex:0 0 38px;height:260px" title="' + esc(fullLabel + ' · 开 ' + open.toFixed(2) + ' · 高 ' + topValue.toFixed(2) + ' · 低 ' + bottomValue.toFixed(2) + ' · 收 ' + close.toFixed(2) + ' · ' + (h.count || 0) + ' 门课程') + '"><span style="position:absolute;left:18px;top:' + wickTop.toFixed(2) + '%;height:' + wickHeight.toFixed(2) + '%;width:2px;background:' + color + '"></span><span style="position:absolute;left:10px;top:' + bodyTop.toFixed(2) + '%;height:' + bodyHeight.toFixed(2) + '%;width:18px;min-height:8px;border-radius:3px;background:' + color + ';box-shadow:0 1px 2px rgba(40,65,52,.12)"></span><small style="position:absolute;left:0;right:0;bottom:-38px;text-align:center;color:#778779;font-size:10px;line-height:1.25;white-space:nowrap"><b>' + esc(dateLabel) + '</b><br><span style="font-size:9px;color:#a0aa9e">' + esc(timeLabel) + '</span></small></div>';
    }).join('');
    const linePoints = history.map((h, index) => (index * 38 + 19).toFixed(1) + ',' + ((maxValue - values[index]) / span * 260).toFixed(1)).join(' ');
    const lineMarkup = '<svg aria-label="GPA 收盘折线" style="position:absolute;inset:0;width:100%;height:260px;z-index:2;pointer-events:none;overflow:visible" viewBox="0 0 ' + plotWidth + ' 260" preserveAspectRatio="none"><polyline fill="none" stroke="#607f6e" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" points="' + linePoints + '"></polyline>' + history.map((h, index) => { const x = index * 38 + 19, y = (maxValue - values[index]) / span * 260, topY = (maxValue - Math.max(values[index], index ? values[index - 1] : values[index])) / span * 260, labelY = Math.max(17, topY - 8); return '<circle cx="' + x + '" cy="' + y.toFixed(1) + '" r="3.5" fill="#607f6e" stroke="#fff" stroke-width="1.5"></circle><rect x="' + (x - 17) + '" y="' + (labelY - 14).toFixed(1) + '" width="34" height="17" rx="5" fill="#fff" fill-opacity=".96" stroke="#dfe8df" stroke-width=".7"></rect><text x="' + x + '" y="' + labelY.toFixed(1) + '" text-anchor="middle" font-size="10.5" font-weight="700" fill="#466453">' + values[index].toFixed(2) + '</text>'; }).join('') + '</svg>';
    return '<section class="card" style="margin-top:21px">' + cardHeader('clock', '本机 GPA K 线', '<span class="card-kicker">全部历史 · ' + history.length + ' 次</span>') + '<div style="display:flex;align-items:stretch;gap:10px;margin-top:8px"><div style="width:42px;flex:0 0 42px;height:260px;display:flex;flex-direction:column;justify-content:space-between;color:#8b9884;font-size:10px;text-align:right;padding:2px 0 0"><span>' + maxValue.toFixed(2) + '</span><span>' + midpoint.toFixed(2) + '</span><span>' + minValue.toFixed(2) + '</span></div><div style="overflow-x:auto;overflow-y:hidden;flex:1;padding:0 8px 48px 0"><div style="position:relative;display:flex;align-items:stretch;min-width:' + plotWidth + 'px;height:260px;background:linear-gradient(to bottom,rgba(125,151,132,.22) 1px,transparent 1px,transparent calc(50% - 1px),rgba(125,151,132,.16) 50%,transparent calc(50% + 1px),transparent calc(100% - 1px),rgba(125,151,132,.22) calc(100% - 1px))">' + candles + lineMarkup + '</div></div></div><div style="display:flex;gap:18px;flex-wrap:wrap;margin-top:20px;color:#778779;font-size:11px"><span><i style="display:inline-block;width:9px;height:9px;border-radius:2px;background:' + palette.up + ';margin-right:5px"></i>上涨</span><span><i style="display:inline-block;width:9px;height:9px;border-radius:2px;background:' + palette.down + ';margin-right:5px"></i>下降</span><span>当前设置：' + palette.label + '</span><span>折线连接收盘 GPA · 柱顶标注数值</span></div><p class="gpa-note">每条 K 线对应一次本机 GPA 记录；底部日期按月/日和时间分两行显示，完整时间与开高低收信息可悬停查看。</p></section>';
  }
  function taskSubjectGroups(tasks, renderRows) {
    const focused = new Set(state.settings.focusSubjects || []), groups = new Map();
    for (const task of tasks) { const subject = task.course || '未分类'; if (!groups.has(subject)) groups.set(subject, []); groups.get(subject).push(task); }
    return [...groups.entries()].sort((a, b) => Number(focused.has(b[0])) - Number(focused.has(a[0])) || a[0].localeCompare(b[0], 'zh-CN')).map(([subject, rows]) => '<section class="task-subject-group"><div class="group-heading"><div><p>' + t('学科') + '</p><h2>' + esc(subject) + '<span>' + rows.length + (isEnglish() ? ' item(s)' : ' 项') + '</span></h2></div>' + focusButton('toggle-focus-subject', subject, focused.has(subject), '学科：' + subject) + '</div>' + (renderRows ? renderRows(rows) : taskRows(rows)) + '</section>').join('');
  }
  function taskSourceSections(tasks, renderRows) {
    const sources = [['teams', 'Teams 作业'], ['managebac', 'ManageBac 作业'], ['manual', '个人待办']];
    return '<div class="task-source-grid">' + sources.map(([source, title]) => {
      const rows = tasks.filter(task => task.source === source);
      return rows.length ? '<section class="task-source-section task-source-' + source + '"><div class="task-source-heading"><div><p>' + t('作业来源') + '</p><h2>' + esc(t(title)) + '</h2></div><span>' + rows.length + (isEnglish() ? ' item(s)' : ' 项') + '</span></div><div class="task-source-subjects">' + taskSubjectGroups(rows, renderRows) + '</div></section>' : '';
    }).join('') + '</div>';
  }
  function renderTasks() {
    const all = Core.getTasks(state), focused = new Set(state.settings.focusSubjects || []);
    const statusTasks = all.filter(task => taskFilter === 'all' || (taskFilter === 'done' ? task.completed : taskFilter === 'overdue' ? taskDue(task).overdue : !task.completed));
    const tasks = statusTasks.filter(task => taskSubjectFilter !== 'focus' || focused.has(task.course || '未分类'));
    const controls = '<div class="page-tools task-tools"><div class="filter-pills">' + [['open', '未完成'], ['overdue', '已逾期'], ['done', '已完成'], ['all', '全部']].map(f => '<button type="button" class="pill ' + (taskFilter === f[0] ? 'active' : '') + '" data-action="task-filter" data-filter="' + f[0] + '">' + f[1] + '</button>').join('') + '</div><div class="filter-pills"><button type="button" class="pill ' + (taskSubjectFilter === 'all' ? 'active' : '') + '" data-action="task-subject-filter" data-filter="all">全部学科</button><button type="button" class="pill ' + (taskSubjectFilter === 'focus' ? 'active' : '') + '" data-action="task-subject-filter" data-filter="focus">特别关注</button></div><span class="subtle">' + tasks.length + (isEnglish() ? ' item(s)' : ' 项') + '</span></div>';
    return heading('一件一件，慢慢完成。', '先分 Teams 与 ManageBac，再在各自来源内按学科整理。', button(icon('plus') + '添加待办', 'add-task', '', 'button-primary')) + controls + '<div class="info-note">勾选仅更新本机待办状态，不会提交作业、回复老师或修改 ManageBac / Teams。学科特别关注只保存在本机。</div><section class="card task-subjects-card">' + (tasks.length ? taskSourceSections(tasks) : empty('tasks', taskSubjectFilter === 'focus' ? '还没有特别关注学科的任务' : taskFilter === 'done' ? '完成的事情，会留在这里' : '这里暂时没有待办', taskSubjectFilter === 'focus' ? '在任意学科标题旁点“特别关注”，它会优先显示在这里。' : taskFilter === 'open' ? '连接 ManageBac 和 Teams 获取已读取的学校任务，或添加一个个人待办。' : '切换筛选条件，查看其他任务。', taskFilter === 'open' && taskSubjectFilter !== 'focus' ? button(icon('plus') + '添加待办', 'add-task', '', 'button-primary') : '')) + sourceFooter('managebac') + sourceFooter('teams') + '</section>';
  }
  function renderFeedback() {
    const all = Core.getFeedback(state), items = all.filter(f => feedbackFilter === 'all' || !f.read);
    return heading('认真读懂，每一次反馈。', '把老师的建议带回下一次学习。', button(icon('link') + '打开 ManageBac', 'open-source', 'data-source="managebac"')) + '<div class="page-tools"><div class="filter-pills"><button type="button" class="pill ' + (feedbackFilter === 'all' ? 'active' : '') + '" data-action="feedback-filter" data-filter="all">全部反馈</button><button type="button" class="pill ' + (feedbackFilter === 'unread' ? 'active' : '') + '" data-action="feedback-filter" data-filter="unread">' + (isEnglish() ? 'Unread' : '未读') + '</button></div><span class="subtle">' + items.length + (isEnglish() ? ' item(s)' : ' 条') + '</span></div><div class="info-note">这里汇总 ManageBac 评语和 Teams 已发布的作业反馈，覆盖范围取决于同步结果。尚未读取的课程、附件或历史内容请到学校原页面查看。已读标记仅保存在本机。</div><section class="card">' + (items.length ? feedbackRows(items) : empty('feedback', feedbackFilter === 'unread' ? '没有已读取的未读反馈' : '等待老师的下一条建议', '登录 ManageBac 并打开评语页，或连接 Teams 同步已发布的作业反馈。', button('打开 ManageBac', 'open-source', 'data-source="managebac"'))) + sourceFooter('managebac') + sourceFooter('teams') + '</section>';
  }
  function renderSourceCard(source) {
    if (source === 'teams') return renderGraphSourceCard();
    if (!sourceURL(source)) return '<section class="card source-card"><h2>' + esc(sourceName(source)) + '</h2><span class="status-badge warning">未配置学校地址</span><p>' + esc(schoolConfigurationHelp) + '</p></section>';
    const status = sourceStatus(source), busy = statuses[source] && statuses[source].busy;
    const badge = busy ? '正在同步' : status.loginRequired ? '需要登录' : status.lastCapturedAt ? status.stale ? '缓存待更新' : '已读取' : '尚未连接';
    return '<section class="card source-card"><div class="source-header"><span class="source-logo ' + (source === 'managebac' ? 'mb' : source === 'teams' ? 'teams-logo' : '') + '">' + (source === 'seiue' ? (isEnglish() ? 'S' : '希') : source === 'teams' ? 'T' : 'M') + '</span><div><h2>' + sourceName(source) + '</h2><p>' + (source === 'seiue' ? '课程表 · 上课时间 · 教室' : source === 'teams' ? '作业要求 · 提醒 · EC 通知' : '课程成绩 · 学校任务 · 老师反馈') + '</p></div><span class="status-badge ' + (status.stale || status.loginRequired ? 'warning' : '') + '">' + badge + '</span></div><p>最近读取：' + esc(lastUpdated(status.lastCapturedAt)) + '</p>' + (statuses[source] && statuses[source].message ? '<p>' + esc(statuses[source].message) + '</p>' : '') + (status.warnings && status.warnings.length ? '<div class="source-warning">' + status.warnings.slice(0, 3).map(esc).join('<br>') + '</div>' : '') + '<div class="source-actions">' + button(source === 'teams' ? '在浏览器打开 Teams' : status.lastCapturedAt ? '打开学校页面' : '登录并连接', 'open-source', 'data-source="' + source + '"', 'button-primary') + (source === 'teams' ? '' : button('退出登录', 'clear-session', 'data-source="' + source + '"')) + '</div>' + (source === 'teams' ? '<p class="gpa-note">使用 ' + esc(teamsBrowserName()) + ' 的登录状态，退出 Teams 请在该浏览器操作。应用内旧登录状态不会转移到浏览器。</p>' : '') + '</section>';
  }
  function permissionCopy() {
    if (!native) return '通知提醒只在 CampusDesk Mac 应用中可用。';
    if (notificationPermission === 'denied') return '系统通知未允许。请到 Mac 系统设置 → 通知 → CampusDesk 开启。';
    if (notificationPermission === 'authorized' || notificationPermission === 'provisional' || notificationPermission === 'granted') return '系统通知已允许。仅为已确认截止时间的 Teams 未完成作业安排提醒。';
    return '启用后将请求 macOS 通知权限。没有明确截止时间的作业可在“查看要求”中手动设置。';
  }
  function renderGraphSourceCard() {
    if (state.settings.teamsMode === 'browser') return '<section class="card source-card"><div class="source-header"><span class="source-logo teams-logo">T</span><div><h2>Microsoft Teams</h2><p>自动发现 · EC 附件 · 本机缓存</p></div><span id="teams-source-badge" class="status-badge">' + (teamsAuto.running ? '正在读取' : '浏览器自动同步') + '</span></div><p id="teams-source-message">' + esc(teamsAuto.message) + '</p><div class="source-actions">' + button('登录／打开 Teams', 'teams-auto-login', !native ? 'disabled' : '', 'button-primary') + '</div></section>';
    const badge = graphStatus.busy ? '正在同步' : graphStatus.connected ? '已连接' : graphStatus.configured ? '等待登录' : '待首次配置';
    return '<section class="card source-card"><div class="source-header"><span class="source-logo teams-logo">T</span><div><h2>Microsoft Teams</h2><p>频道消息 · 作业要求 · EC 名单</p></div><span class="status-badge ' + (!graphStatus.connected ? 'warning' : '') + '">' + badge + '</span></div><p>' + esc(graphStatusCopy()) + '</p><div class="source-actions">' + graphPrimaryButton() + '</div></section>';
  }
  function renderGraphSettings() {
    const config = graphConfigurationDraft || { clientId: graphStatus.clientId || '', tenant: graphStatus.tenant || 'organizations' };
    return '<section id="teams-settings" class="card settings-section">' + cardHeader('teams', 'Teams 自动同步') + '<p class="settings-intro">' + esc(graphStatusCopy()) + '</p><div class="graph-connection-actions">' + graphPrimaryButton() + (graphStatus.connected || graphStatus.busy ? button(graphStatus.connected ? '退出并清除 Teams 缓存' : '取消连接', 'graph-sign-out') : '') + '</div><p class="graph-coverage">' + esc(graphScopeCopy()) + '</p><p class="gpa-note">自动发现你所属团队中的可访问频道，读取消息、回复、课程作业及已发布的老师反馈。EC 名单公告保留原文和附件入口。同步状态会说明未能读取的范围，无法授权的内容不会被获取。</p>' + (graphStatus.coverage === 'partial' ? '<div class="source-warning">本次同步不完整，已保留成功读取的内容和历史缓存。请查看同步提示后重试。</div>' : '') + teamsWarning() + '<div class="settings-fields"><div class="settings-field"><div><label for="graph-include-chats">也同步我参与的聊天</label><p>默认汇总你参与的一对一和群聊。关闭后，后续同步只读取团队频道与课程作业。</p></div><label class="toggle" for="graph-include-chats"><input id="graph-include-chats" type="checkbox" ' + (state.settings.graphIncludeChats ? 'checked' : '') + (!native ? ' disabled' : '') + ' aria-label="也同步 Teams 聊天"><span></span></label></div></div><details id="graph-configuration" class="advanced-settings"><summary>首次接入配置（开发者或学校管理员）</summary><p class="settings-intro">此测试版尚未配备已注册的微软应用。请在 Microsoft Entra 注册桌面应用，并按安装包 README 完成重定向地址和读取权限配置。学校可能需要管理员批准。这里只填写公开的应用 ID，不需要密码或客户端密钥。</p><div class="graph-config-fields"><label for="graph-client-id">应用（客户端）ID<input id="graph-client-id" type="text" maxlength="36" value="' + esc(config.clientId) + '" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" autocomplete="off" spellcheck="false"></label><label for="graph-tenant">租户<input id="graph-tenant" type="text" maxlength="253" value="' + esc(config.tenant) + '" placeholder="organizations" autocomplete="off" spellcheck="false"></label></div><p class="field-hint">一般使用 organizations；学校单租户应用请填写管理员提供的租户 ID 或域名。</p><div class="graph-connection-actions">' + button('保存连接配置', 'graph-save-configuration', graphStatus.busy || !native ? 'disabled' : '') + '</div></details></section>' + renderReminderSettings() + '<details class="advanced-settings legacy-connection"><summary>高级：旧版浏览器读取</summary><p class="settings-intro">仅在需要兼容旧版本时使用。自动同步无需关注页面，也无需保持 Teams 标签页打开。</p><div class="settings-field"><div><label for="teams-mode">Teams 同步方式</label><p>默认使用微软授权自动同步。</p></div><select id="teams-mode"><option value="graph" ' + (state.settings.teamsMode !== 'browser' ? 'selected' : '') + '>微软授权自动同步</option><option value="browser" ' + (state.settings.teamsMode === 'browser' ? 'selected' : '') + '>旧版浏览器读取</option></select></div>' + renderTeamsLegacySettings() + '</details>';
  }
  function renderTeamsAutoPanel(settings) {
    const counts = teamsAuto.counts || {}, count = key => Number.isSafeInteger(counts[key]) && counts[key] >= 0 ? counts[key] : 0;
    const diagnostics = (teamsAuto.coverageItems || []).filter(item => item.status !== 'complete').slice(0,60);
    const enabled = native && state.settings.teamsBrowserAutomation;
    return '<section id="teams-auto-panel" class="card settings-section teams-auto-panel">' + cardHeader('teams', 'Teams 自动同步 · 0.4.0') + '<p id="teams-auto-message" role="status">' + esc(teamsAuto.message) + '</p><p id="teams-auto-counts" class="graph-coverage">' + esc(teamsAutoCountText()) + '</p><div class="banner-actions">' + button('登录／打开 Teams', 'teams-auto-login', 'id="teams-auto-login-button" '+(!native || teamsAuto.running ? 'disabled' : ''), 'button-primary') + button(teamsAuto.running ? '正在自动读取…' : '立即自动同步', 'teams-auto-start', 'id="teams-auto-start-button" '+(!enabled || teamsAuto.running ? 'disabled' : '')) + button('优先读取 EC', 'teams-auto-ec', 'id="teams-auto-ec-button" '+(!enabled || teamsAuto.running ? 'disabled' : '')) + button('停止本轮', 'teams-auto-stop', 'id="teams-auto-stop-button" '+(!teamsAuto.running ? 'disabled' : '')) + '</div><p class="gpa-note">自动发现账号可见页面，优先读取 EC；无需逐页关注。应用运行、Mac 唤醒且联网时按设置周期更新。学校要求重新验证时需要你登录。正式作业、成绩及全部历史尚未验证，不会当作已完整同步。</p><div id="teams-auto-warnings" class="source-warning"'+(!teamsAuto.warnings.length?' hidden':'')+'>' + teamsAuto.warnings.map(esc).join('<br>') + '</div><details id="teams-auto-diagnostics"'+(!diagnostics.length?' hidden':'')+'><summary id="teams-auto-diagnostics-summary">查看未完成范围（' + diagnostics.length + '）</summary><div id="teams-auto-diagnostics-items">' + diagnosticsHTML(diagnostics) + '</div></details>' + (!settings ? '<div class="banner-actions">' + button('连接设置', 'teams-settings') + '</div>' : '') + '</section>';
  }
  function teamsAutoCountText() {
    const counts = teamsAuto.counts || {}, count = key => Number.isSafeInteger(counts[key]) && counts[key] >= 0 ? counts[key] : 0;
    if (isEnglish()) return 'This run captured ' + count('messages') + ' message(s) · ' + count('channelsRead') + ' channel(s) · ' + count('chatsRead') + ' chat(s) · found ' + count('attachments') + ' attachment(s)' + (Number.isSafeInteger(teamsAuto.attachmentsParsed) ? ' · extracted text from ' + teamsAuto.attachmentsParsed + ' attachment(s)' : '') + (Number.isSafeInteger(teamsAuto.counts.attachmentsCached) ? ' · reused ' + count('attachmentsCached') + ' unchanged file(s)' : '');
    return '本轮已读取 ' + count('messages') + ' 条消息 · ' + count('channelsRead') + ' 个频道 · ' + count('chatsRead') + ' 个聊天 · 已发现 ' + count('attachments') + ' 个附件' + (Number.isSafeInteger(teamsAuto.attachmentsParsed) ? ' · 已提取文字 ' + teamsAuto.attachmentsParsed + ' 个附件' : '') + (Number.isSafeInteger(teamsAuto.counts.attachmentsCached) ? ' · 版本未变，复用 ' + count('attachmentsCached') + ' 份' : '');
  }
  function diagnosticsHTML(items) { return items.map(item => '<p><strong>' + esc(item.label || item.kind || 'Teams') + '</strong>：' + esc(item.reason || '部分读取') + '</p>').join(''); }
  function setText(id,value) { const node = document.getElementById(id); if (node && node.textContent !== value) node.textContent = value; }
  function setHTML(id,value) { const node = document.getElementById(id); if (node && node.innerHTML !== value) node.innerHTML = value; }
  function updateTeamsAutoPanel() {
    setText('teams-auto-message',teamsAuto.message); setText('teams-auto-counts',teamsAutoCountText());
    const enabled = native && state.settings.teamsBrowserAutomation;
    for (const [id,disabled] of [['login',!native || teamsAuto.running],['start',!enabled || teamsAuto.running],['ec',!enabled || teamsAuto.running],['stop',!teamsAuto.running]]) { const node = document.getElementById('teams-auto-'+id+'-button'); if (node) node.disabled = disabled; }
    setText('teams-auto-start-button',teamsAuto.running ? '正在自动读取…' : '立即自动同步');
    const warnings = document.getElementById('teams-auto-warnings'); if (warnings) { warnings.hidden = !teamsAuto.warnings.length; setHTML(warnings.id,teamsAuto.warnings.map(esc).join('<br>')); }
    const items = (teamsAuto.coverageItems || []).filter(item => item.status !== 'complete').slice(0,60), details = document.getElementById('teams-auto-diagnostics');
    if (details) { details.hidden = !items.length; setText('teams-auto-diagnostics-summary','查看未完成范围（'+items.length+'）'); setHTML('teams-auto-diagnostics-items',diagnosticsHTML(items)); }
    setText('teams-source-badge',teamsAuto.running ? '正在读取' : '浏览器自动同步'); setText('teams-source-message',teamsAuto.message);
    updateStatus();
  }
  function updateGraphProgress() {
    setText('graph-progress-message',graphStatusCopy());setText('graph-progress-scope',graphScopeCopy());
    const partial=document.getElementById('graph-progress-partial');if(partial)partial.hidden=graphStatus.coverage!=='partial';
    setHTML('graph-progress-actions',graphPrimaryButton()+button('连接设置','teams-settings'));updateStatus();
  }
  function renderTeamsSettings() {
    if (state.settings.teamsMode !== 'browser') return renderGraphSettings();
    return '<div id="teams-settings">' + renderTeamsAutoPanel(true) + '<section class="card settings-section"><div class="settings-field"><div><label for="teams-mode">Teams 连接方式</label><p>浏览器模式复用你的学校登录。Graph 模式需要独立应用配置及学校授权。</p></div><select id="teams-mode"><option value="browser" selected>浏览器自动发现</option><option value="graph">微软 Graph 授权</option></select></div><div class="settings-field"><div><label for="teams-auto-discover">定时自动发现和同步</label><p>关闭后停止当前自动读取，保留已同步内容。</p></div><input id="teams-auto-discover" type="checkbox" ' + (state.settings.teamsAutoDiscover ? 'checked' : '') + '></div><div class="settings-field"><div><label for="graph-include-chats">也同步我参与的聊天</label><p>关闭后只自动读取团队频道。</p></div><input id="graph-include-chats" type="checkbox" ' + (state.settings.graphIncludeChats ? 'checked' : '') + '></div></section>' + renderTeamsBrowserSettings() + renderReminderSettings() + '</div>';
  }
  function renderTeamsBrowserSettings() {
    return '<section id="teams-browser-settings" class="card settings-section">' + cardHeader('teams', '浏览器连接与授权') + '<p class="settings-intro">学校账号只在 Chrome 或 Edge 中登录。CampusDesk 使用专用 Teams 同步标签读取消息和可访问附件；接口不可用时尝试页面读取。</p><div class="settings-fields"><div class="settings-field"><div><label for="teams-browser">用于 Teams 的浏览器</label><p>选择你已安装并登录学校账号的浏览器。</p></div><select id="teams-browser"><option value="chrome" ' + (state.settings.teamsBrowser !== 'edge' ? 'selected' : '') + '>Google Chrome</option><option value="edge" ' + (state.settings.teamsBrowser === 'edge' ? 'selected' : '') + '>Microsoft Edge</option></select></div><div class="settings-field"><div><label for="teams-browser-automation">允许读取 Teams 浏览器页面</label><p>允许只读发现和同步账号可见的团队、频道、聊天及附件。不会发送消息、提交作业或修改学校数据；关闭后停止自动读取并保留缓存。</p></div><label class="toggle" for="teams-browser-automation"><input id="teams-browser-automation" type="checkbox" ' + (state.settings.teamsBrowserAutomation ? 'checked' : '') + (!native ? ' disabled' : '') + ' aria-label="允许 CampusDesk 读取 Teams 浏览器页面"><span></span></label></div></div><div class="browser-permission-guide"><p>首次同步时，按 Mac 提示允许 CampusDesk 控制 ' + esc(teamsBrowserName()) + '。也可在系统设置 → 隐私与安全性 → 自动化核对。</p><p>浏览器需启用 Allow JavaScript from Apple Events（允许来自 Apple 事件的 JavaScript）。Chrome 位于“显示 → 开发者”。</p><p>同步时请保留专用 Teams 标签，不要切换其中的页面。登录凭据仅在浏览器内使用；附件在本机解析，不上传外部 AI 服务。关闭应用后不会继续同步。</p></div><details><summary>手动读取当前页面</summary>' + teamsBrowserButtons() + '</details></section>';
  }
  function renderTeamsLegacySettings() {
    const pages = state.settings.teamsPages || [];
    return renderTeamsBrowserSettings() + '<section class="card settings-section">' + cardHeader('teams', '关注的 Teams 页面', button(icon('plus') + '添加页面', 'add-teams-page', '', 'button-plain')) + '<p class="settings-intro">在选定浏览器打开 Teams 频道，在 CampusDesk 点击“关注浏览器当前 Teams 页”，选择页面类型并保存。同步只读取已打开的关注标签页，不会替你打开已关闭的页面。</p>' + (pages.length ? '<div class="followed-pages">' + pages.map(item => '<div class="followed-page"><div><h3>' + esc(item.label) + '<span class="task-tag">' + ({ auto: '自动识别', assignments: '作业频道', ec: 'EC 频道' }[item.kind] || '自动识别') + '</span></h3><p>' + esc(item.url) + '</p></div><div class="page-item-actions">' + button('打开', 'open-source', 'data-source="teams" data-url="' + esc(item.url) + '"') + button('编辑', 'edit-teams-page', 'data-id="' + esc(item.id) + '"') + '<button class="icon-button" type="button" data-action="remove-teams-page" data-id="' + esc(item.id) + '" aria-label="取消关注 ' + esc(item.label) + '">' + icon('trash') + '</button></div></div>').join('') + '</div>' : '<div class="empty small-empty"><h3>先关注一个常看的频道</h3><p>例如课程团队 → HOMEWORK，以及学校团队 → ENGLISH CORNER ROSTER。页面类型随时可以修改。</p></div>') + '<p class="gpa-note">仅覆盖已加载的消息文字。EC 名单保留通知原文；图片或 PDF 内容请通过附件打开。</p></section>';
  }
  function renderReminderSettings() {
    return '<section id="reminder-settings" class="card settings-section">' + cardHeader('bell', 'Teams 作业提醒') + '<div class="settings-fields"><div class="settings-field"><div><label for="teams-notifications">截止前系统通知</label><p id="notification-status">' + esc(permissionCopy()) + '</p></div><label class="toggle" for="teams-notifications"><input id="teams-notifications" type="checkbox" ' + (state.settings.teamsNotifications ? 'checked' : '') + (!native ? ' disabled' : '') + ' aria-label="Teams 作业截止提醒"><span></span></label></div><div class="settings-field"><div><label for="reminder-minutes">提前多久提醒</label><p>如果提前提醒时间已过，将在截止时提醒。已逾期或已完成的作业不安排通知。</p></div><select id="reminder-minutes">' + [[0, '截止时'], [10, '提前 10 分钟'], [30, '提前 30 分钟'], [60, '提前 1 小时'], [1440, '提前 1 天']].map(item => '<option value="' + item[0] + '" ' + (Number(state.settings.reminderMinutes) === item[0] ? 'selected' : '') + '>' + item[1] + '</option>').join('') + '</select></div></div><p class="gpa-note">课表倒计时按北京时间每秒更新，依据已读取课节的结束和下一节开始时间计算。应用需定期运行并同步，才能发现新作业和截止时间变更；系统通知是否显示还受 Mac 通知和专注模式设置影响。</p></section>';
  }
  function renderAppearanceSettings() {
    const theme = state.settings.dashboardTheme || 'classic';
    const candleColors = state.settings.gpaCandleColors || 'red-up';
    return '<section id="appearance-settings" class="card settings-section appearance-settings">' + cardHeader('overview', '面板样式') + '<p class="settings-intro">经典面板保留原有的信息布局；卡片看板用更紧凑的统计卡和任务卡集中展示今天的重点。两种样式使用同一份本机数据，随时可切换。</p><div class="appearance-options"><button type="button" class="appearance-option ' + (theme === 'classic' ? 'selected' : '') + '" data-action="dashboard-theme" data-theme="classic" aria-pressed="' + (theme === 'classic') + '"><span class="appearance-preview preview-classic"><i></i><i></i><i></i></span><strong>经典面板</strong><small>熟悉的课程、成绩与待办布局</small></button><button type="button" class="appearance-option ' + (theme === 'board' ? 'selected' : '') + '" data-action="dashboard-theme" data-theme="board" aria-pressed="' + (theme === 'board') + '"><span class="appearance-preview preview-board"><i></i><i></i><i></i><i></i></span><strong>卡片看板</strong><small>统计概览与密集任务卡片</small></button></div><div class="settings-fields" style="margin-top:18px"><div class="settings-field"><div><label for="gpa-candle-colors">GPA K 线涨跌颜色</label><p>选择成绩上升和下降时 K 线的颜色，设置会保存在本机。</p></div><select id="gpa-candle-colors" aria-label="GPA K 线涨跌颜色"><option value="red-up"' + (candleColors === 'red-up' ? ' selected' : '') + '>红涨绿跌</option><option value="green-up"' + (candleColors === 'green-up' ? ' selected' : '') + '>绿涨红跌</option></select></div></div></section>';
  }
  function renderLanguageSettings() {
    const language = state.settings.language || 'zh-CN';
    return '<section id="language-settings" class="card settings-section">' + cardHeader('settings', '界面语言') + '<p class="settings-intro">选择 CampusDesk 的界面语言。课程、作业、消息、附件和学校原文保持原样，不会被翻译。</p><div class="settings-fields"><div class="settings-field"><div><label for="app-language">界面语言</label><p>更改会立即应用到导航、页面标题、按钮与固定说明文字。</p></div><select id="app-language" aria-label="界面语言"><option value="zh-CN"' + (language === 'zh-CN' ? ' selected' : '') + '>简体中文</option><option value="en-US"' + (language === 'en-US' ? ' selected' : '') + '>English</option></select></div></div></section>';
  }
  function renderSettings() {
    return heading('让它适合你的每一天。', '学校系统各自登录；课表、任务和频道原文保存在本机。') + (!native ? '<div class="browser-banner">这是网页预览。登录、会话管理与自动读取只在 Mac 应用中可用。</div>' : '') + '<div class="source-grid">' + renderSourceCard('seiue') + renderSourceCard('managebac') + renderSourceCard('teams') + '</div>' + renderLanguageSettings() + renderAppearanceSettings() + renderTeamsSettings() + '<section class="card settings-section">' + cardHeader('link', '学校连接') + '<div class="settings-fields"><div class="settings-field"><div><label for="seiue-url">希悦网址</label><p>构建时配置；未配置时不会连接。</p></div><input id="seiue-url" type="url" value="' + esc(sourceURL('seiue')) + '" placeholder="未配置；编辑 SchoolConfig.json 后重新构建" readonly></div><div class="settings-field"><div><label for="managebac-url">学校 ManageBac 网址</label><p>构建时配置；仅允许指定学校的精确地址。</p></div><input id="managebac-url" type="url" value="' + esc(sourceURL('managebac')) + '" placeholder="未配置；编辑 SchoolConfig.json 后重新构建" readonly></div></div></section><section class="card settings-section">' + cardHeader('settings', '日常偏好') + '<div class="settings-fields"><div class="settings-field"><div><label for="refresh-minutes">自动刷新间隔</label><p>应用正在运行且电脑联网时，尝试更新已连接的数据。</p></div><select id="refresh-minutes">' + [[5, '每 5 分钟'], [15, '每 15 分钟'], [30, '每 30 分钟'], [60, '每小时']].map(o => '<option value="' + o[0] + '" ' + (Number(state.settings.refreshMinutes) === o[0] ? 'selected' : '') + '>' + o[1] + '</option>').join('') + '</select></div><div class="settings-field"><div><label for="self-study">空白课节显示为自习</label><p>只处理希悦明确给出时间的空白课节。</p></div><label class="toggle" for="self-study"><input id="self-study" type="checkbox" ' + (state.settings.selfStudy ? 'checked' : '') + ' aria-label="空白课节显示为自习"><span></span></label></div><div class="settings-field"><div><label>显示时区</label><p>在不同地区使用 Mac，也按北京的上课时间展示。</p></div><span class="subtle">Asia / Shanghai · UTC+8</span></div></div></section><section class="card settings-section">' + cardHeader('cloud', '数据与备份') + '<div class="settings-fields"><div class="settings-field"><div><label>导出或恢复本机数据</label><p>包含课程缓存、个人待办及 GPA 记录。也包含 Teams 消息、EC 通知和提醒设置。备份不包含登录会话或密码。</p></div><div class="backup-actions">' + button('导出备份', 'export') + button('导入备份', 'import') + '</div></div></div></section><div class="info-note">希悦和 ManageBac 配置后在应用内登录并读取页面。Teams 默认使用本机 Chrome 或 Edge 已登录页面读取，也可选配 Microsoft Graph 授权；应用运行时定期同步。权限不足、网络中断或接口限制会在同步状态中提示，现有内容作为缓存保留。</div><p class="footer-note">CampusDesk 0.5.3 本地预览版 · 独立学习工具，与希悦、ManageBac 及 Microsoft 无隶属关系。</p>';
  }
  function navigate(target) {
    if (!pageNames[target]) return;
    if (target === page) return;
    page = target;
    location.hash = target;
    render();
    if (window.scrollY > 0) window.scrollTo({ top: 0, behavior: 'auto' });
  }
  function renderNav() {
    const openCount = Core.getTasks(state).filter(t => !t.completed).length;
    const nav = document.getElementById('nav');
    const signature = (isEnglish() ? 'en-US' : 'zh-CN') + ':' + openCount;
    if (nav.dataset.renderSignature !== signature) {
      nav.innerHTML = ['overview', 'learning', 'schedule', 'grades', 'tasks', 'feedback', 'teams', 'ec'].map(key => '<button type="button" class="nav-item ' + (page === key ? 'active' : '') + '" data-page="' + key + '" ' + (page === key ? 'aria-current="page"' : '') + '><span class="icon">' + icon(key === 'learning' ? 'search' : key) + '</span>' + pageName(key) + (key === 'tasks' && openCount ? '<span class="nav-count">' + openCount + '</span>' : '') + '</button>').join('');
      nav.dataset.renderSignature = signature;
    }
    for (const item of Array.from(nav.children || [])) {
      if (!item || !item.dataset || !item.dataset.page) continue;
      const active = item.dataset.page === page;
      item.classList.toggle('active', active);
      if (active) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    }
    document.querySelector('.settings-nav').classList.toggle('active', page === 'settings');
    document.getElementById('settings-icon').innerHTML = icon('settings');
  }
  function setText(id, value) { const node = document.getElementById(id); if (node) node.textContent = value; }
  function updateStaticChrome() {
    const locale = isEnglish() ? 'en-US' : 'zh-CN';
    if (document.documentElement) document.documentElement.lang = locale;
    if (typeof document.title === 'string') document.title = isEnglish() ? 'CampusDesk · Study, in view' : 'CampusDesk · 学习，一目了然';
    setText('brand-tagline', t('学习，一目了然'));
    setText('sidebar-label', t('我的校园'));
    setText('sidebar-clock-label', t('北京时间'));
    setText('sidebar-note', t('把今天留给重要的事。'));
    setText('settings-nav-label', t('连接与设置'));
    setText('breadcrumb-home', t('我的校园'));
    setText('sync-label', t('同步数据'));
    const focusButton = document.getElementById('focus-button');
    if (focusButton) { focusButton.innerHTML = icon('focus') + '<span>' + (isEnglish() ? (state.settings.focusMode ? 'Exit focus' : 'Focus') : (state.settings.focusMode ? '退出专注' : '专注模式')) + '</span>'; focusButton.setAttribute('aria-pressed', String(Boolean(state.settings.focusMode))); }
  }
  function updateStatus() {
    const busy = Object.values(statuses).some(s => s.busy);
    const sync = document.getElementById('sync-button');
    sync.disabled = busy; sync.classList.toggle('syncing', busy);
    const sourceTimes = ['seiue', 'managebac', 'teams'].map(s => sourceStatus(s).lastCapturedAt).filter(Boolean).sort();
    const active = Object.values(statuses).find(s => s.busy);
    document.getElementById('global-status').textContent = busy ? (active.message || t('正在读取学校页面…')) : sourceTimes.length ? t('最近读取 ') + lastUpdated(sourceTimes[sourceTimes.length - 1]) : t('尚未同步');
  }
  function updateMenu(clock) {
    clock = clock || Core.getClassClock(state);
    const count = Core.getTasks(state).filter(t => !t.completed).length;
    const title = clock.phase === 'break' || clock.phase === 'lunch' ? (clock.phase === 'break' ? '课间 ' : '午间 ') + clock.remainingLabel : clock.current ? clock.current.title + ' · ' + clock.remainingLabel : clock.next ? (clock.next.start || '') + ' ' + clock.next.title : count ? count + ' 项待办' : 'CampusDesk';
    if (title !== lastMenuTitle) { send('setMenuTitle', { title: title }); lastMenuTitle = title; }
    const isGap = (clock.phase === 'break' || clock.phase === 'lunch') && clock.next && clock.next.start;
    const countdown = isGap ? { label: clock.phase === 'break' ? '课间剩余' : '午休剩余', endsAt: (clock.next.date || Core.today()) + 'T' + clock.next.start + ':00+08:00', nextTitle: clock.next.title || '' } : { clear: true };
    const signature = JSON.stringify(countdown);
    if (signature !== lastMenuCountdown) { send('setMenuCountdown', countdown); lastMenuCountdown = signature; }
  }
  function readingState(container) {
    const all = selector => container && container.querySelectorAll ? Array.from(container.querySelectorAll(selector)) : [];
    const active = document.activeElement, current = {x:window.scrollX || 0,y:window.scrollY || 0,details:all('details[id]').filter(node => node.open).map(node => node.id),scrolls:all('[data-preserve-scroll][id]').map(node => ({id:node.id,top:node.scrollTop,left:node.scrollLeft}))};
    if (active && active.id && container && container.contains && container.contains(active)) current.focus = {id:active.id,value:active.value,start:active.selectionStart,end:active.selectionEnd,direction:active.selectionDirection};
    const anchor = all('[data-reading-anchor][id]').find(node => node.getBoundingClientRect && node.getBoundingClientRect().bottom > 0);
    if (anchor) current.anchor = {id:anchor.id,top:anchor.getBoundingClientRect().top};
    try {
      const selection = window.getSelection && window.getSelection();
      if (selection && selection.rangeCount && !selection.isCollapsed && document.createRange) {
        const range = selection.getRangeAt(0), element = range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
        const owner = element && element.closest && element.closest('[data-selection-key][id]');
        if (owner && container.contains(owner)) {
          const before = document.createRange(); before.selectNodeContents(owner); before.setEnd(range.startContainer,range.startOffset); const start = before.toString().length;
          before.setEnd(range.endContainer,range.endOffset);current.selection = {id:owner.id,start,end:before.toString().length,text:range.toString()};
        }
      }
    } catch (_) { /* A changing native selection must not interrupt rendering. */ }
    return current;
  }
  function restoreReading(saved) {
    if (!saved) return;
    for (const id of saved.details) { const node = document.getElementById(id); if (node) node.open = true; }
    for (const entry of saved.scrolls) { const node = document.getElementById(entry.id); if (node) { node.scrollTop=entry.top;node.scrollLeft=entry.left; } }
    if (saved.focus) { const node = document.getElementById(saved.focus.id); if (node) { if (typeof saved.focus.value === 'string') node.value=saved.focus.value; node.focus({preventScroll:true}); if (node.setSelectionRange && Number.isInteger(saved.focus.start)) try {node.setSelectionRange(saved.focus.start,saved.focus.end,saved.focus.direction);} catch (_) {} } }
    try {
      const selection=saved.selection,owner=selection && document.getElementById(selection.id);
      if (owner && document.createTreeWalker && document.createRange) {
        const walker=document.createTreeWalker(owner,4),range=document.createRange();let offset=0,node,start=null,end=null;
        while ((node=walker.nextNode())) { const length=node.textContent.length;if(!start && offset+length>=selection.start)start={node,offset:selection.start-offset};if(offset+length>=selection.end){end={node,offset:selection.end-offset};break;}offset+=length; }
        if(start && end){range.setStart(start.node,start.offset);range.setEnd(end.node,end.offset);if(range.toString()===selection.text){const current=window.getSelection();current.removeAllRanges();current.addRange(range);}}
      }
    } catch (_) {}
    let y=saved.y;const anchor=saved.anchor && document.getElementById(saved.anchor.id);if(anchor && anchor.getBoundingClientRect)y+=(anchor.getBoundingClientRect().top-saved.anchor.top);
    window.scrollTo(saved.x,Math.max(0,y));
  }
  function render() {
    cachedSearchIndex = null;
    teamsPostsCache = new Map();
    ecSearchIndex = null;
    ecSearchBuildProgress = 0;
    ecSearchBuildToken++;
    const pageChanged = renderedPage !== null && renderedPage !== page;
    const saved = renderedPage === page ? readingState(document.getElementById('content')) : null;
    const graphConfigOpen = page === 'settings' && document.getElementById('graph-configuration') && document.getElementById('graph-configuration').open;
    const shell = document.getElementById('app-shell');
    // Unrelated sync/status renders must not throw away the user's chart view.
    const retainedChart = page === 'grades' && gpaKlineChart ? document.getElementById('gpa-kline-chart') : null;
    if (!retainedChart && gpaKlineChart && window.klinecharts && typeof window.klinecharts.dispose === 'function') {
      const oldChart = gpaKlineChart;
      gpaKlineChart = null; gpaKlineChartKey = '';
      deferGpaChartDispose(oldChart, window.klinecharts);
    }
    if (shell) { shell.dataset.dashboardTheme = state.settings.dashboardTheme || 'classic'; shell.dataset.focusMode = String(Boolean(state.settings.focusMode)); }
    renderNav();
    updateStaticChrome();
    document.getElementById('breadcrumb-page').textContent = pageName(page);
    document.getElementById('sidebar-clock').textContent = Core.clock();
    document.getElementById('sync-icon').innerHTML = icon('refresh');
    const pageRenderers = { overview: renderOverview, learning: renderLearning, schedule: renderSchedule, grades: renderGrades, tasks: renderTasks, feedback: renderFeedback, teams: renderTeams, ec: renderEC, settings: renderSettings };
    const content = document.getElementById('content');
    content.innerHTML = localizedHTML(state.settings.focusMode ? renderFocusMode : pageRenderers[page]);
    if (pageChanged) animatePageSwitch(content);
    if (retainedChart) {
      const replacement = document.getElementById('gpa-kline-chart');
      if (replacement) replacement.replaceWith(retainedChart);
      else { window.klinecharts.dispose(gpaKlineChart); gpaKlineChart = null; gpaKlineChartKey = ''; }
    }
    if (graphConfigOpen && document.getElementById('graph-configuration')) document.getElementById('graph-configuration').open = true;
    renderedPage = page;restoreReading(saved);
    const clock = updateClock();
    lastRenderedDay = Core.today();
    lastClockBoundary = clock.phase + ':' + (clock.current && clock.current.id || '') + ':' + (clock.next && clock.next.id || '');
    updateStatus(); updateMenu(clock);
    if (page === 'grades' && !state.settings.focusMode) scheduleGpaChartMount();
  }
  function shiftDate(direction) {
    const d = new Date(selectedDate + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + direction);
    selectedDate = d.toISOString().slice(0, 10); render();
  }
  function openTaskDialog() {
    const dialog = document.getElementById('task-dialog');
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else { dialog.setAttribute('open', ''); dialog.classList.add('dialog-fallback'); }
  }
  function closeTaskDialog() {
    const dialog = document.getElementById('task-dialog');
    if (typeof dialog.close === 'function') dialog.close();
    else { dialog.removeAttribute('open'); dialog.classList.remove('dialog-fallback'); }
  }
  function showDialog(id) {
    const dialog = document.getElementById(id);
    if (dialog.open) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else { dialog.setAttribute('open', ''); dialog.classList.add('dialog-fallback'); }
  }
  function closeDialog(id) {
    const dialog = document.getElementById(id);
    if (typeof dialog.close === 'function') dialog.close();
    else { dialog.removeAttribute('open'); dialog.classList.remove('dialog-fallback'); }
  }
  function localDateInput(value) {
    const time = new Date(value).getTime();
    return value && Number.isFinite(time) ? new Date(time + 8 * 60 * 60 * 1000).toISOString().slice(0, 16) : '';
  }
  function openTaskDetail(id) {
    const task = Core.getTasks(state).find(item => item.id === id);
    if (!task) { toast('这条任务暂时无法找到，请刷新后重试。'); return; }
    detailTaskId = id;
    const teams = task.source === 'teams', due = taskDue(task), source = teams ? 'teams' : 'managebac';
    document.getElementById('detail-content').innerHTML = '<div class="dialog-heading"><span class="task-tag ' + (teams ? 'teams-tag' : '') + '">' + esc(sourceName(source)) + '</span><button class="icon-button" type="button" data-action="close-detail" aria-label="关闭任务详情">×</button></div><h2 id="detail-title">' + esc(task.title) + '</h2><div class="detail-meta"><span>' + esc(task.course || '') + '</span><span>' + esc(due.label) + (task.dueOverride ? ' · 本机设置' : '') + '</span><span>' + (task.completed ? '本机已完成' : '未完成') + '</span></div><h3 class="detail-subtitle">作业要求</h3><div class="requirements-text">' + esc(task.requirements || task.description || '尚未读取到这份作业的详细要求，请打开学校原页面查看。') + '</div>' + (task.attachments && task.attachments.length ? '<h3 class="detail-subtitle">原文附件</h3>' + attachmentsHTML(task.attachments) + '<p class="gpa-note">附件在浏览器打开，可能需要 Microsoft 登录。附件文字读取状态请逐项核对；未成功解析的请查看原件。</p>' : '') + (teams ? '<div class="due-editor"><label for="detail-due">本机提醒截止时间（北京时间）</label><input id="detail-due" type="datetime-local" value="' + esc(localDateInput(task.dueAt)) + '"><p class="field-hint">请核对原文后设置。这里只改变本机提醒，不会修改 Teams 作业。' + (task.originalDueAt ? '原文已读取截止时间：' + esc(lastUpdated(task.originalDueAt)) + '。' : '原文未读取到可确认的完整截止时间。') + '</p><div class="due-actions">' + button('保存截止时间', 'save-task-due', 'data-id="' + esc(task.id) + '"') + (task.dueOverride ? button('恢复原文时间', 'reset-task-due', 'data-id="' + esc(task.id) + '"') : '') + '</div></div>' : '') + '<div class="dialog-actions">' + button(task.completed ? '标为未完成' : '标为已完成', 'toggle-detail-task', 'data-id="' + esc(task.id) + '"') + (task.url ? button('打开原文 ↗', 'open-source', 'data-source="' + source + '" data-url="' + esc(task.url) + '"', 'button-primary') : '') + '</div>';
    showDialog('detail-dialog');
  }
  function openTeamsPageDialog(id, candidate) {
    const existing = (state.settings.teamsPages || []).find(entry => entry.id === id || (candidate && entry.url === candidate.url));
    const item = existing || candidate;
    document.getElementById('teams-page-form').reset();
    document.getElementById('teams-page-id').value = existing ? existing.id : '';
    document.getElementById('teams-page-label').value = item ? item.label : '';
    document.getElementById('teams-page-url').value = item ? item.url : '';
    document.getElementById('teams-page-kind').value = item ? item.kind : 'auto';
    showDialog('teams-page-dialog');
    document.getElementById('teams-page-label').focus();
  }
  function saveTeamsPage(candidate) {
    const url = Core.safeURL(candidate.url, 'teams'), label = String(candidate.label || '').trim().slice(0, 120);
    if (!url || !label) { toast('请填写页面名称，以及 teams.microsoft.com 或 teams.cloud.microsoft 的 HTTPS 页面网址。'); return false; }
    const pages = state.settings.teamsPages || [];
    const existing = pages.find(item => candidate.id ? item.id === candidate.id : item.url === url);
    if (!existing && pages.length >= 20) { toast('最多关注 20 个 Teams 页面，请先取消一个不常用页面。'); return false; }
    const item = { id: existing ? existing.id : 'page-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8), label: label, url: url, kind: existing && !candidate.id ? existing.kind : ['auto', 'assignments', 'ec'].includes(candidate.kind) ? candidate.kind : 'auto' };
    state.settings.teamsPages = existing ? pages.map(entry => entry.id === existing.id ? item : entry) : pages.concat(item);
    persist(); render(); toast('已关注 ' + label + '。下次同步将读取这个页面。');
    return true;
  }
  function syncReminders() {
    if (!native) return;
    const now = Date.now(), lead = Number(state.settings.reminderMinutes == null ? 30 : state.settings.reminderMinutes) * 60000;
    const items = state.settings.teamsNotifications ? Core.getTasks(state).filter(task => task.source === 'teams' && !task.completed).map(task => {
      const due = new Date(task.dueAt || '').getTime(), url = Core.safeURL(task.url, 'teams');
      if (!Number.isFinite(due) || due <= now || !url) return null;
      const fire = due - lead > now ? due - lead : due;
      return { id: task.id, title: task.title, body: (task.course ? task.course + ' · ' : '') + '作业即将截止，请查看要求。', fireAt: new Date(fire).toISOString(), source: 'teams', url: url };
    }).filter(Boolean).sort((a, b) => a.fireAt.localeCompare(b.fireAt)).slice(0, 60) : [];
    const signature = JSON.stringify(items);
    if (signature !== lastReminderSignature) { send('syncReminders', { items: items }); lastReminderSignature = signature; }
  }
  function exportBrowser() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), anchor = document.createElement('a');
    anchor.href = url; anchor.download = 'CampusDesk-backup-' + Core.today() + '.json'; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }
  function applyImport(input) {
    try {
      const candidate = Core.validateState(input);
      if (!window.confirm('导入将替换当前课程缓存、个人待办与 GPA 记录。确定恢复这份备份吗？')) return;
      state = candidate; persist({ imported: true }); render(); toast('已恢复备份。Teams 重新同步时会按当前账号重建缓存，其他学校账号需要在这台 Mac 上重新登录。');
    } catch (err) { toast('无法导入：' + (err.message || '备份格式无效。')); }
  }
  function setGpaKlineInterval(value, shouldRender) {
    const index = Math.max(0, Math.min(GPA_KLINE_INTERVALS.length - 1, Number(value)));
    if (!Number.isInteger(index) || index === gpaKlineIntervalIndex) return;
    gpaKlineIntervalIndex = index;
    if (shouldRender !== false) render();
  }
  document.addEventListener('click', event => {
    const target = event.target.closest('[data-action], [data-page]');
    if (!target) return;
    if (target.dataset.page) { navigate(target.dataset.page); return; }
    const action = target.dataset.action;
    if (action === 'open-source') openSource(target.dataset.source, target.dataset.url);
    else if (action === 'toggle-focus-mode') { state.settings.focusMode = !state.settings.focusMode; persist(); render(); toast(state.settings.focusMode ? '已进入专注模式。' : '已退出专注模式。'); }
    else if (action === 'save-ec-identity') {
      const input = document.getElementById('ec-identity-names');
      const names = [...new Set(String(input && input.value || '').split(/[，,\n;]/).map(value => value.trim().slice(0, 100)).filter(Boolean))].slice(0, 10);
      state.settings.ecIdentityNames = names; persist(); render(); toast(names.length ? '姓名匹配已保存在本机。' : '已清除姓名匹配。');
    }
    else if (action === 'gpa-kline-zoom') zoomGpaKline(Number(target.dataset.step));
    else if (action === 'dashboard-theme') {
      const theme = target.dataset.theme;
      if (!['classic', 'board'].includes(theme)) return;
      state.settings.dashboardTheme = theme; persist(); render();
      toast(theme === 'board' ? '已切换到卡片看板。' : '已切换回经典面板。');
    }
    else if (action === 'appearance-settings') {
      navigate('settings');
      const settings = document.getElementById('appearance-settings');
      if (settings) settings.scrollIntoView({ block: 'start', behavior: 'auto' });
    }
    else if (action === 'go-tasks') navigate('tasks');
    else if (action === 'graph-settings') showGraphConfiguration();
    else if (action === 'graph-sign-in') graphAction('graphSignIn');
    else if (action === 'graph-sync') graphAction('graphSync');
    else if (action === 'graph-sign-out') {
      if (!native) return;
      send('graphSignOut');
    }
    else if (action === 'graph-save-configuration') {
      if (!native || graphStatus.busy) return;
      const clientId = document.getElementById('graph-client-id').value.trim();
      const tenant = document.getElementById('graph-tenant').value.trim() || 'organizations';
      const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const domain = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
      if (!guid.test(clientId)) { toast('请填写微软应用的有效客户端 ID（UUID），不是密码或密钥。'); return; }
      if (tenant !== 'organizations' && !guid.test(tenant) && !domain.test(tenant)) { toast('租户应为 organizations、学校租户 ID 或学校域名。'); return; }
      state.settings.teamsMode = 'graph'; persist(); graphConfigurationDraft = null;
      send('graphSaveConfiguration', { clientId: clientId, tenant: tenant });
    }
    else if (action === 'pin-teams-browser') teamsBrowserAction('pinTeamsBrowserPage');
    else if (action === 'capture-teams-browser') teamsBrowserAction('captureTeamsBrowserPage', { selectionOnly: false });
    else if (action === 'capture-teams-selection') teamsBrowserAction('captureTeamsBrowserPage', { selectionOnly: true });
    else if (action === 'open-attachment') {
      const url = Core.safeAttachmentURL(target.dataset.url);
      if (!url) { toast('这个附件链接无法打开，请到 Teams 原页面查看。'); return; }
      if (!send('openAttachment', { url: url })) window.open(url, '_blank', 'noopener,noreferrer');
    }
    else if (action === 'task-detail') openTaskDetail(target.dataset.id);
    else if (action === 'close-detail') { detailTaskId = null; closeDialog('detail-dialog'); }
    else if (action === 'toggle-detail-task') {
      const item = Core.getTasks(state).find(task => task.id === target.dataset.id);
      if (item) { state.taskChecks[item.id] = !item.completed; persist(); render(); openTaskDetail(item.id); }
    }
    else if (action === 'save-task-due') {
      const task = Core.getTasks(state).find(item => item.id === target.dataset.id && item.source === 'teams');
      if (!task) return;
      const value = document.getElementById('detail-due').value;
      const date = value ? new Date(value + ':00+08:00') : null;
      if (!date || !Number.isFinite(date.getTime())) { toast('请选择有效的北京时间截止时间。'); return; }
      state.settings.teamsDueOverrides[task.id] = date.toISOString();
      persist(); render(); openTaskDetail(task.id); toast('本机截止时间已保存。');
    }
    else if (action === 'reset-task-due') {
      delete state.settings.teamsDueOverrides[target.dataset.id]; persist(); render(); openTaskDetail(target.dataset.id); toast('已恢复读取到的原文截止时间。');
    }
    else if (action === 'teams-settings') { navigate('settings'); document.getElementById('teams-settings').scrollIntoView({ block: 'start', behavior: 'auto' }); }
    else if (['teams-auto-login', 'teams-auto-start', 'teams-auto-stop', 'teams-auto-ec'].includes(action)) {
      if (!native) { toast('请在 Mac 应用中使用自动同步。'); return; }
      if (action !== 'teams-auto-login' && action !== 'teams-auto-stop' && !state.settings.teamsBrowserAutomation) { navigate('settings'); toast('请先允许读取 Teams 浏览器页面。'); return; }
      state.settings.teamsMode = 'browser'; persist();
      send(action === 'teams-auto-ec' ? 'teams-auto-start' : action, action === 'teams-auto-ec' ? {focus:'ec'} : {});
    }
    else if (action === 'add-teams-page') openTeamsPageDialog();
    else if (action === 'edit-teams-page') openTeamsPageDialog(target.dataset.id);
    else if (action === 'close-teams-page') closeDialog('teams-page-dialog');
    else if (action === 'remove-teams-page') {
      if (!window.confirm('取消关注这个 Teams 页面？已读取的消息会保留。')) return;
      state.settings.teamsPages = state.settings.teamsPages.filter(item => item.id !== target.dataset.id); persist(); render();
    }
    else if (action === 'toggle-focus-subject') {
      const value = String(target.dataset.value || '').trim();
      if (!value) return;
      const values = state.settings.focusSubjects || [], exists = values.includes(value);
      state.settings.focusSubjects = exists ? values.filter(item => item !== value) : values.concat(value).slice(0, 100);
      persist(); render(); toast(exists ? '已取消特别关注学科：' + value : '已特别关注学科：' + value);
    }
    else if (action === 'toggle-focus-channel') {
      const value = String(target.dataset.value || '').trim();
      if (!value) return;
      const values = state.settings.focusTeamsChannels || [], exists = values.includes(value);
      state.settings.focusTeamsChannels = exists ? values.filter(item => item !== value) : values.concat(value).slice(0, 100);
      persist(); render(); toast(exists ? '已取消关注频道：' + value : '已关注频道：' + value);
    }
    else if (action === 'teams-filter') { teamsFilter = target.dataset.filter; teamsVisibleLimit = MESSAGE_PAGE_SIZE; render(); }
    else if (action === 'teams-channel-filter') { teamsChannelFilter = target.dataset.filter === 'focus' ? 'focus' : 'all'; teamsVisibleLimit = MESSAGE_PAGE_SIZE; render(); }
    else if (action === 'teams-show-more') { teamsVisibleLimit += MESSAGE_PAGE_SIZE; render(); }
    else if (action === 'ec-show-more') { ecVisibleLimit += MESSAGE_PAGE_SIZE; updateECResults(); }
    else if (action === 'ec-clear') { ecQuery='';ecDateFilter='all';ecVisibleLimit=MESSAGE_PAGE_SIZE;const search=document.getElementById('ec-search'),date=document.getElementById('ec-date-filter');if(search)search.value='';if(date)date.value='all';updateECResults();if(search)search.focus(); }
    else if (action === 'add-task') { document.getElementById('task-form').reset(); openTaskDialog(); document.getElementById('task-title').focus(); }
    else if (action === 'close-task') closeTaskDialog();
    else if (action === 'toggle-task') {
      const item = Core.getTasks(state).find(t => t.id === target.dataset.id);
      if (item) { state.taskChecks[item.id] = !item.completed; persist(); render(); }
    } else if (action === 'delete-task') {
      const id = target.dataset.id;
      if (!window.confirm('删除这条个人待办？')) return;
      state.manualTasks = state.manualTasks.filter(t => t.id !== id); delete state.taskChecks[id]; persist(); render();
    } else if (action === 'toggle-feedback') {
      const item = Core.getFeedback(state).find(f => f.id === target.dataset.id);
      if (item) { state.feedbackRead[item.id] = !item.read; persist(); render(); }
    } else if (action === 'task-filter') { taskFilter = target.dataset.filter; render(); }
    else if (action === 'task-subject-filter') { taskSubjectFilter = target.dataset.filter === 'focus' ? 'focus' : 'all'; render(); }
    else if (action === 'feedback-filter') { feedbackFilter = target.dataset.filter; render(); }
    else if (action === 'prev-day') shiftDate(-1);
    else if (action === 'next-day') shiftDate(1);
    else if (action === 'today') { selectedDate = Core.today(); render(); }
    else if (action === 'custom-day') {
      customCaptureDraft();
      const day = Number(target.dataset.day);
      if (!Number.isInteger(day) || day < 0 || day > 6) return;
      customScheduleDays = customScheduleDays.includes(day) ? customScheduleDays.filter(item => item !== day) : customScheduleDays.concat(day).sort((a, b) => a - b);
      render();
    }
    else if (action === 'custom-kind') {
      customCaptureDraft();
      customScheduleKind = target.dataset.kind === 'once' ? 'once' : 'weekly';
      render();
    }
    else if (action === 'custom-mode') {
      customCaptureDraft();
      const mode = target.dataset.mode === 'time' ? 'time' : 'period';
      if (mode === 'time') {
        const period = customPeriodTimes(customScheduleDraft.period);
        if (period) { customScheduleDraft.start = period.start || ''; customScheduleDraft.end = period.end || ''; }
      } else {
        const hit = customBestPeriod(customScheduleDraft.start, customScheduleDraft.end);
        if (hit) customScheduleDraft.period = hit.period;
      }
      customScheduleMode = mode; render();
      if (mode === 'period') customSyncFromPeriod(); else customSyncFromTime();
    }
    else if (action === 'delete-custom-lesson') {
      const index = Number(target.dataset.index), lessons = state.settings.customLessons || [];
      if (!Number.isInteger(index) || index < 0 || index >= lessons.length) return;
      state.settings.customLessons = lessons.slice(0, index).concat(lessons.slice(index + 1));
      persist(); render(); toast('已删除自编课程。');
    }
    else if (action === 'add-holiday') {
      const input = document.getElementById('holiday-date'), value = input && input.value;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) { toast('请选择有效的节假日日期。'); return; }
      const holidays = state.settings.scheduleHolidays || [];
      if (!holidays.includes(value)) state.settings.scheduleHolidays = holidays.concat(value).sort();
      persist(); render(); toast('节假日已加入课表规则。');
    }
    else if (action === 'remove-holiday') {
      if (!window.confirm('移除这个节假日规则？当天课程会恢复显示。')) return;
      state.settings.scheduleHolidays = (state.settings.scheduleHolidays || []).filter(date => date !== target.dataset.date);
      persist(); render();
    }
    else if (action === 'remove-schedule-override') {
      if (!window.confirm('移除这条临时调课规则？')) return;
      state.settings.scheduleOverrides = (state.settings.scheduleOverrides || []).filter(item => item.id !== target.dataset.id);
      persist(); render();
    }
    else if (action === 'export') { if (!send('exportData')) exportBrowser(); }
    else if (action === 'import') { if (!send('importData')) document.getElementById('import-file').click(); }
    else if (action === 'clear-session') {
      if (!native) { toast('登录会话只能在 Mac 应用内管理。'); return; }
      if (target.dataset.source === 'teams') { toast('Teams 退出登录请在 ' + teamsBrowserName() + ' 中操作。'); return; }
      send('clearSession', { source: target.dataset.source });
    }
  });
  document.addEventListener('change', event => {
    const el = event.target;
    if (el.id === 'ec-date-filter') { ecDateFilter=/^(?:all|unknown|\d{4}-\d{2}-\d{2})$/.test(el.value)?el.value:'all';ecVisibleLimit=MESSAGE_PAGE_SIZE;updateECResults(); }
    else if (el.matches('[data-plan-minutes]')) {
      const id = el.dataset.planMinutes, value = Number(el.value);
      if (!id || ![15, 30, 45, 60, 90, 120].includes(value)) return;
      state.settings.taskMinutes[id] = value; persist(); render();
    }
    else if (el.matches('[data-plan-priority]')) {
      const id = el.dataset.planPriority, value = Number(el.value);
      if (!id || ![1, 2, 3].includes(value)) return;
      state.settings.taskPriority[id] = value; persist(); render();
    }
    else if (el.matches('[data-grade-target], [data-grade-weight]')) {
      const id = el.dataset.gradeTarget || el.dataset.gradeWeight;
      const targetInput = Array.from(document.querySelectorAll('[data-grade-target]')).find(input => input.dataset.gradeTarget === id), weightInput = Array.from(document.querySelectorAll('[data-grade-weight]')).find(input => input.dataset.gradeWeight === id);
      const targetValue = Number(targetInput && targetInput.value), weightValue = Number(weightInput && weightInput.value);
      if (!id || !Number.isFinite(targetValue) || targetValue < 0 || targetValue > 100 || !Number.isFinite(weightValue) || weightValue < 1 || weightValue > 100) { toast('目标成绩须为 0–100，剩余权重须为 1–100。'); render(); return; }
      state.settings.gradeGoals[id] = { target: targetValue, remainingWeight: weightValue }; persist(); render();
    }
    else if (el.id === 'schedule-date') { if (/^\d{4}-\d{2}-\d{2}$/.test(el.value)) { selectedDate = el.value; render(); } }
    else if (el.id === 'gpa-kline-interval') setGpaKlineInterval(el.value);
    else if (el.id === 'app-language') {
      if (!['zh-CN', 'en-US'].includes(el.value)) return;
      state.settings.language = el.value; persist(); render();
      toast(el.value === 'en-US' ? 'Interface language changed to English.' : '界面语言已切换为简体中文。');
    }
    else if (el.id === 'refresh-minutes') { state.settings.refreshMinutes = Number(el.value); persist(); toast('刷新间隔已更新。'); }
    else if (el.id === 'self-study') { state.settings.selfStudy = el.checked; persist(); toast('课表显示设置已更新。'); }
    else if (el.id === 'gpa-candle-colors') {
      if (!['red-up', 'green-up'].includes(el.value)) return;
      state.settings.gpaCandleColors = el.value; persist(); render();
      toast(t(el.value === 'green-up' ? 'GPA K 线已设为绿涨红跌。' : 'GPA K 线已设为红涨绿跌。'));
    }
    else if (el.id === 'teams-auto-discover') { state.settings.teamsAutoDiscover = Boolean(el.checked); persist(); render(); }
    else if (el.id === 'graph-include-chats') {
      if (!native) { el.checked = false; return; }
      state.settings.graphIncludeChats = Boolean(el.checked); persist();
      toast(el.checked ? '已加入聊天同步。下次连接时可能需要补充授权。' : '已关闭后续聊天同步，已读取内容仍保留在本机。');
    }
    else if (el.id === 'teams-mode') {
      if (!['graph', 'browser'].includes(el.value)) return;
      state.settings.teamsMode = el.value; persist(); render();
      toast(el.value === 'graph' ? '已使用微软授权自动同步。' : '已切换到浏览器自动发现，请登录 Teams 并允许浏览器读取。');
    }
    else if (el.id === 'teams-browser') {
      if (!['chrome', 'edge'].includes(el.value)) return;
      state.settings.teamsBrowser = el.value; persist(); render(); toast('Teams 浏览器已设为 ' + teamsBrowserName() + '，请在这个浏览器登录学校账号并保持关注标签页打开。');
    }
    else if (el.id === 'teams-browser-automation') {
      if (!native) { el.checked = false; toast('读取浏览器中的 Teams 页面需要使用 CampusDesk Mac 应用。'); return; }
      state.settings.teamsBrowserAutomation = Boolean(el.checked); persist(); render();
      toast(el.checked ? '已启用浏览器读取。请按页面说明设置 Mac 与浏览器权限，然后读取当前 Teams 页。' : '已关闭 Teams 浏览器读取，现有缓存仍可查看。');
    }
    else if (el.id === 'teams-notifications') {
      if (!native) { el.checked = false; toast('通知提醒需要使用 CampusDesk Mac 应用。'); return; }
      state.settings.teamsNotifications = Boolean(el.checked);
      if (el.checked) send('requestNotifications');
      persist(); toast(el.checked ? '已启用 Teams 截止提醒，请允许 Mac 通知。' : 'Teams 作业提醒已关闭。');
    }
    else if (el.id === 'reminder-minutes') { state.settings.reminderMinutes = Number(el.value); persist(); toast('作业提醒时间已更新。'); }
    else if (el.id === 'seiue-url' || el.id === 'managebac-url') {
      const source = el.id === 'seiue-url' ? 'seiue' : 'managebac', value = el.value.trim();
      const safe = value ? Core.safeURL(value, source) : '';
      if (value && !safe) { toast('请输入正确的学校 HTTPS 网址，不能使用其他网站。'); el.value = sourceURL(source); return; }
      state.settings[source + 'URL'] = safe; persist(); toast(sourceName(source) + ' 网址已保存。');
    }
  });
  document.addEventListener('input', event => {
    if (event.target.id === 'hub-search') {
      learningQuery = event.target.value.slice(0, 200);
      const results = document.getElementById('hub-search-results');
      if (results) results.innerHTML = localizedHTML(() => searchResultsHTML(learningQuery));
      return;
    }
    if (event.target.id === 'gpa-kline-interval') {
      const index = Number(event.target.value), interval = GPA_KLINE_INTERVALS[index];
      const output = document.getElementById('gpa-kline-interval-output');
      if (interval && output) output.value = interval.label;
      return;
    }
    if (event.target.id === 'ec-search') { ecQuery=event.target.value.slice(0,200);ecVisibleLimit=MESSAGE_PAGE_SIZE;updateECResults();return; }
    if (['custom-title', 'custom-room', 'custom-start', 'custom-end'].includes(event.target.id)) {
      customCaptureDraft();
      if (event.target.id === 'custom-start' || event.target.id === 'custom-end') customSyncFromTime();
      return;
    }
    if (event.target.id !== 'graph-client-id' && event.target.id !== 'graph-tenant') return;
    graphConfigurationDraft = { clientId: document.getElementById('graph-client-id').value, tenant: document.getElementById('graph-tenant').value };
  });
  document.addEventListener('dragstart', event => {
    const row = event.target.closest && event.target.closest('.hub-plan-row');
    if (!row) return;
    draggingTaskID = row.dataset.planTask || '';
    row.classList.add('is-dragging');
    if (event.dataTransfer) { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', draggingTaskID); }
  });
  document.addEventListener('dragover', event => {
    const row = event.target.closest && event.target.closest('.hub-plan-row');
    if (!draggingTaskID || !row) return;
    event.preventDefault();
    document.querySelectorAll('.hub-plan-row.drop-before, .hub-plan-row.drop-after').forEach(node => node.classList.remove('drop-before', 'drop-after'));
    const rect = row.getBoundingClientRect();
    row.classList.add(event.clientY < rect.top + rect.height / 2 ? 'drop-before' : 'drop-after');
  });
  document.addEventListener('drop', event => {
    const targetRow = event.target.closest && event.target.closest('.hub-plan-row');
    if (!draggingTaskID || !targetRow) return;
    event.preventDefault();
    const ids = Array.from(document.querySelectorAll('.hub-plan-row')).map(node => node.dataset.planTask).filter(id => id && id !== draggingTaskID);
    const targetID = targetRow.dataset.planTask;
    let index = ids.indexOf(targetID);
    if (index < 0) index = ids.length;
    if (targetRow.classList.contains('drop-after')) index += 1;
    ids.splice(index, 0, draggingTaskID);
    state.settings.planOrder = ids.concat((state.settings.planOrder || []).filter(id => !ids.includes(id)));
    draggingTaskID = ''; persist(); render();
  });
  document.addEventListener('dragend', () => {
    draggingTaskID = '';
    document.querySelectorAll('.hub-plan-row.is-dragging, .hub-plan-row.drop-before, .hub-plan-row.drop-after').forEach(node => node.classList.remove('is-dragging', 'drop-before', 'drop-after'));
  });
  document.addEventListener('wheel', event => {
    const slider = event.target.closest && event.target.closest('#gpa-kline-interval');
    if (!slider) return;
    event.preventDefault();
    if (!event.deltaY || Date.now() - gpaKlineWheelAt < 180) return;
    gpaKlineWheelAt = Date.now();
    const current = Number(slider.value), next = current + (event.deltaY > 0 ? 1 : -1);
    if (next >= 0 && next < GPA_KLINE_INTERVALS.length) setGpaKlineInterval(next);
  }, { passive: false });
  document.addEventListener('change', event => {
    const el = event.target;
    if (el.id === 'custom-period') {
      customScheduleDraft.period = el.value;
      customSyncFromPeriod();
    }
    else if (el.id === 'custom-week-pattern') customSchedulePattern = ['all', 'odd', 'even'].includes(el.value) ? el.value : 'all';
    else if (el.id === 'custom-one-date') customScheduleOneDate = /^\d{4}-\d{2}-\d{2}$/.test(el.value) ? el.value : '';
    else if (el.id === 'schedule-week-anchor') {
      state.settings.scheduleWeekAnchor = /^\d{4}-\d{2}-\d{2}$/.test(el.value) ? el.value : '';
      persist(); render(); toast('单双周基准周已保存。');
    }
  });
  document.addEventListener('submit', event => {
    if (!event.target) return;
    if (event.target.id === 'schedule-override-form') {
      event.preventDefault();
      const date = document.getElementById('override-date').value, action = document.getElementById('override-action').value;
      const targetPeriod = document.getElementById('override-target-period').value, period = document.getElementById('override-period').value;
      const title = document.getElementById('override-title').value.trim() || '临时课程';
      const start = document.getElementById('override-start').value, end = document.getElementById('override-end').value, room = document.getElementById('override-room').value.trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { toast('请选择有效的临时调课日期。'); return; }
      if (action === 'cancel' && !targetPeriod) { toast('取消课程时请选择原课程节次。'); return; }
      if (action === 'replace' && !period && !start) { toast('替换课程时请选择新节次或开始时间。'); return; }
      const id = 'override-' + (window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8));
      state.settings.scheduleOverrides = (state.settings.scheduleOverrides || []).concat({ id, date, action, targetPeriod, period, title, room, start, end });
      persist(); render(); toast('临时调课已保存。');
      return;
    }
    if (event.target.id !== 'custom-schedule-form') return;
    event.preventDefault();
    customCaptureDraft();
    const title = customScheduleDraft.title.trim();
    if (!title) { toast('请填写课程名称。'); return; }
    if (customScheduleKind === 'weekly' && !customScheduleDays.length) { toast(t('请选择至少一天')); return; }
    if (customScheduleKind === 'once' && !/^\d{4}-\d{2}-\d{2}$/.test(customScheduleOneDate)) { toast('请选择一次性课程日期。'); return; }
    if (customScheduleKind === 'weekly' && customSchedulePattern !== 'all' && !state.settings.scheduleWeekAnchor) { toast('单双周课程需要先设置基准周（周一）。'); return; }
    let period = customScheduleDraft.period, start = customScheduleDraft.start, end = customScheduleDraft.end;
    if (customScheduleMode === 'period') {
      const times = customPeriodTimes(period);
      start = times && times.start || start;
      end = times && times.end || end;
      if (!period) { toast('请选择节次。'); return; }
    } else {
      if (customHm2min(start) === null) { toast('请填写有效的开始时间。'); return; }
      if (customHm2min(end) === null || customHm2min(end) <= customHm2min(start)) end = customMin2hm(customHm2min(start) + 45);
      const hit = customBestPeriod(start, end);
      period = hit ? hit.period : '';
    }
    const id = 'custom-' + (window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10));
    state.settings.customLessons = (state.settings.customLessons || []).concat({ id, title, room: customScheduleDraft.room.trim(), date: customScheduleKind === 'once' ? customScheduleOneDate : '', weekdays: customScheduleKind === 'weekly' ? customScheduleDays.slice().sort((a, b) => a - b) : [], weekPattern: customScheduleKind === 'weekly' ? customSchedulePattern : 'all', period, start, end, byTime: customScheduleMode === 'time', temporary: customScheduleKind === 'once' });
    persist();
    customScheduleDraft = { title: '', room: '', period: period || customScheduleDraft.period, start: '', end: '' };
    customScheduleOneDate = '';
    render();
    toast('自编课程已添加。');
  });
  document.getElementById('teams-page-form').addEventListener('submit', event => {
    event.preventDefault();
    if (saveTeamsPage({ id: document.getElementById('teams-page-id').value, label: document.getElementById('teams-page-label').value, url: document.getElementById('teams-page-url').value, kind: document.getElementById('teams-page-kind').value })) closeDialog('teams-page-dialog');
  });
  document.getElementById('task-form').addEventListener('submit', event => {
    event.preventDefault();
    const title = document.getElementById('task-title').value.trim();
    if (!title) return;
    const due = document.getElementById('task-due').value;
    const dueDate = due ? new Date(due + ':00+08:00') : null;
    if (dueDate && !Number.isFinite(dueDate.getTime())) { toast('截止日期无效，请重新选择。'); return; }
    const id = 'manual-' + (window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10));
    state.manualTasks.push({ id: id, title: title, course: '个人待办', dueAt: dueDate ? dueDate.toISOString() : null, dueLabel: '', status: 'open', createdAt: new Date().toISOString() });
    persist(); closeTaskDialog(); render(); toast('个人待办已添加。');
  });
  document.getElementById('import-file').addEventListener('change', async event => {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) { toast('备份过大，请选择 25 MB 以内的 JSON 文件。'); event.target.value = ''; return; }
    try { applyImport(JSON.parse(await file.text())); } catch (_) { toast('无法读取这份 JSON 备份。'); }
    event.target.value = '';
  });
  document.getElementById('sync-button').addEventListener('click', () => {
    if (!send('sync')) toast('学校数据同步需要使用 Mac 应用。网页预览只能管理个人待办和本地备份。');
  });
  window.addEventListener('hashchange', () => { const target = location.hash.slice(1); if (pageNames[target] && target !== page) { page = target; render(); } });
  window.CampusDesk = {
    receive: function (event) {
      if (!event || typeof event !== 'object') return;
      try {
        if (event.type === 'state') { state = event.state && Object.keys(event.state).length ? Core.validateState(event.state) : Core.emptyState(); render(); syncReminders(); }
        else if (event.type === 'teamsAutoStatus') {
          teamsAuto.running = Boolean(event.running);
          ['phase','message','updatedAt','coverage'].forEach(key => { if (typeof event[key] === 'string') teamsAuto[key] = event[key].slice(0,1600); });
          if (event.counts && typeof event.counts === 'object') { teamsAuto.counts = {}; for (const key of ['teams','channels','channelsRead','chats','chatsRead','messages','attachments','attachmentsCached']) if (Number.isSafeInteger(event.counts[key]) && event.counts[key] >= 0) teamsAuto.counts[key] = event.counts[key]; }
          if (Number.isSafeInteger(event.attachmentsParsed)) teamsAuto.attachmentsParsed = event.attachmentsParsed;
          if (Array.isArray(event.warnings)) teamsAuto.warnings = event.warnings.filter(v => typeof v === 'string').slice(0,20).map(v => v.slice(0,1500));
          if (Array.isArray(event.coverageItems)) teamsAuto.coverageItems = event.coverageItems.filter(v => v && typeof v === 'object').slice(0,300).map(v => ({status:String(v.status||''),label:String(v.label||'').slice(0,300),reason:String(v.reason||'').slice(0,1500),kind:String(v.kind||'').slice(0,100)}));
          if (state.settings.teamsMode === 'browser') { statuses.teams = {busy:teamsAuto.running,message:teamsAuto.message}; updateTeamsAutoPanel(); }
        }
        else if (event.type === 'teamsAttachment') {
          if (!event.accountId || !event.snapshotId || !event.attachmentId || !event.result) return;
          const next = JSON.parse(JSON.stringify(state)); let changed = false;
          for (const snapshot of Object.values(next.snapshots.teams || {})) {
            if (snapshot.accountId !== event.accountId || snapshot.snapshotId !== event.snapshotId) continue;
            for (const row of (snapshot.posts || []).concat(snapshot.tasks || [])) for (const item of row.attachments || []) {
              if (item.id !== event.attachmentId) continue;
              const result = event.result, previous = item.text, previousTruncated = Boolean(item.truncated);
              if (typeof result.text === 'string' && result.text) { item.text = result.text.slice(0,80000); item.cached = false; }
              else if (previous) item.cached = true;
              item.extractionStatus = ['read','partial','no_text','unsupported','error'].includes(result.status) ? result.status : 'error';
              item.error = typeof result.error === 'string' ? result.error.slice(0,2000) : '';
              item.truncated = Boolean(result.truncated) || (typeof result.text === 'string' && result.text.length > 80000) || (item.cached && previousTruncated);
              if (item.truncated && item.text && item.extractionStatus === 'read') item.extractionStatus = 'partial';
              retainAttachmentMetadata(item,result);
              // A failed new-version extraction can retain old cached text, but
              // must never label that old text with the new version's identity.
              if(typeof result.text==='string' && result.text) {
                if(typeof event.versionKey==='string' && event.versionKey.length<=140 && /^v[0-9]+:[a-f0-9]{8,128}$/.test(event.versionKey))item.versionKey=event.versionKey;
                else delete item.versionKey;
              }
              if(!item.cached)item.capturedAt = new Date().toISOString(); changed = true;
            }
          }
          if (changed) { state = Core.validateState(next); persist(); render(); }
        }
        else if (event.type === 'teamsAttachmentUnchanged') {
          if(!event.accountId || !event.snapshotId || !event.attachmentId || typeof event.versionKey!=='string' || !event.versionKey || typeof event.checkedAt!=='string' || !Number.isFinite(Date.parse(event.checkedAt)))return;
          const next=JSON.parse(JSON.stringify(state));let changed=false;
          for(const snapshot of Object.values(next.snapshots.teams || {})) {
            if(snapshot.accountId!==event.accountId || snapshot.snapshotId!==event.snapshotId)continue;
            for(const row of (snapshot.posts || []).concat(snapshot.tasks || []))for(const item of row.attachments || []) {
              if(item.id!==event.attachmentId || !item.text || item.versionKey!==event.versionKey)continue;
              item.checkedAt=new Date(event.checkedAt).toISOString();changed=true;
            }
          }
          if(changed){state=Core.validateState(next);persist();}
        }
        else if (event.type === 'graphStatus') {
          const priorConnection=JSON.stringify([graphStatus.configured,graphStatus.connected,graphStatus.authRequired,graphStatus.requiresAdminConsent,graphStatus.clientId,graphStatus.tenant]);
          // Never copy the whole bridge event into state or local storage.
          ['configured', 'connected', 'busy', 'requiresAdminConsent', 'authRequired'].forEach(key => { if (typeof event[key] === 'boolean') graphStatus[key] = event[key]; });
          ['displayName', 'message', 'clientId', 'tenant'].forEach(key => { if (typeof event[key] === 'string') graphStatus[key] = event[key].slice(0, key === 'message' ? 1200 : 253); });
          if (typeof event.status === 'string') graphStatus.authRequired = ['authRequired', 'auth_required'].includes(event.status);
          if (typeof event.coverage === 'string') graphStatus.coverage = event.coverage === 'paused' ? 'partial' : ['partial', 'complete', 'running'].includes(event.coverage) ? event.coverage : '';
          if (Array.isArray(event.warnings)) graphStatus.warnings = event.warnings.filter(warning => typeof warning === 'string').slice(0, 20).map(warning => warning.slice(0, 2000));
          if (event.counts && typeof event.counts === 'object') {
            graphStatus.counts = {};
            ['teams', 'channels', 'assignments', 'messages', 'chats'].forEach(key => { if (Number.isSafeInteger(event.counts[key]) && event.counts[key] >= 0) graphStatus.counts[key] = event.counts[key]; });
          }
          statuses.teams = { busy: graphStatus.busy, message: graphStatus.message || graphStatusCopy() };
          const connectionChanged=priorConnection!==JSON.stringify([graphStatus.configured,graphStatus.connected,graphStatus.authRequired,graphStatus.requiresAdminConsent,graphStatus.clientId,graphStatus.tenant]);
          if(connectionChanged && ['settings','teams','ec','overview'].includes(page))render();else updateGraphProgress();
        }
        else if (event.type === 'graphBatch') {
          if (!window.CampusGraph) throw new Error('Teams 数据适配文件未能加载，请重新安装完整应用。');
          const normalized = window.CampusGraph.normalizeBatch(event.batch);
          if (!normalized.snapshots || !normalized.snapshots.length) throw new Error('Teams 数据批次无效，未记录同步进度。');
          let updated = state;
          for (const snapshot of normalized.snapshots) updated = Core.mergeSnapshot(updated, snapshot);
          state = updated;
          persist();
          // Native handles saveState and this acknowledgement in order and only
          // commits a resume checkpoint after successful persistence of all pages.
          if (typeof event.batchId === 'string' && event.batchId) {
            const acknowledgement = { batchId: event.batchId };
            const isCapWarning = warning => typeof warning === 'string' && /本地[^。]{0,40}上限/.test(warning);
            const capWarnings = Object.values(state.snapshots.teams || {}).flatMap(snapshot => snapshot.warnings || []).filter(isCapWarning);
            if (normalized.coverage && normalized.coverage.capped || capWarnings.length) {
              acknowledgement.partial = true;
              acknowledgement.warnings = [...new Set((normalized.warnings || []).filter(isCapWarning).concat(capWarnings))].slice(0, 10).map(warning => warning.slice(0, 1000));
              if (!acknowledgement.warnings.length) acknowledgement.warnings = ['已达到本地内容存储上限，其余内容请在 Teams 查看。'];
            }
            send('graphBatchProcessed', acknowledgement);
          }
          render();
        }
        else if (event.type === 'graphReset') {
          state = Core.resetTeamsData(state);
          graphStatus.connected = false; graphStatus.busy = false; graphStatus.displayName = ''; graphStatus.counts = {}; graphStatus.coverage = ''; graphStatus.message = ''; graphStatus.requiresAdminConsent = false; graphStatus.authRequired = false; graphStatus.warnings = [];
          statuses.teams = { busy: false, message: 'Teams 已退出，已清除本机 Teams 缓存。' };
          detailTaskId = null; closeDialog('detail-dialog'); lastReminderSignature = '';
          persist(); render();
        }
        else if (event.type === 'snapshot') {
          state = Core.mergeSnapshot(state, event.snapshot);
          persist(); render();
        } else if (event.type === 'status') {
          statuses[event.source || 'app'] = { busy: Boolean(event.busy), message: String(event.message || '') };
          updateStatus();
          if (!event.busy && event.message && (event.source === 'app' || event.source === 'teams')) toast(event.message);
          // Progress messages update the toolbar in place; settings forms stay put.
        } else if (event.type === 'import') applyImport(event.state);
        else if (event.type === 'pinTeamsPage' && event.page) {
          const url = Core.safeURL(event.page.url, 'teams');
          if (!url) { toast('当前页面不是可关注的 Teams 页面，请先在浏览器打开目标频道。'); return; }
          navigate('settings');
          openTeamsPageDialog(null, { url: url, label: String(event.page.label || 'Teams 页面').slice(0, 120), kind: ['auto', 'assignments', 'ec'].includes(event.page.kind) ? event.page.kind : 'auto' });
        }
        else if (event.type === 'notificationPermission') {
          notificationPermission = event.status || (event.granted ? 'authorized' : 'denied');
          const status = document.getElementById('notification-status');
          if (status) status.textContent = permissionCopy();
          if (event.granted) { lastReminderSignature = ''; syncReminders(); }
        }

      } catch (err) {
        if (event.type === 'snapshot' && event.snapshot && event.snapshot.coverage === 'browser') send('teamsAutoSnapshotFailed');
        if (event.type === 'graphBatch' && typeof event.batchId === 'string' && event.batchId) send('graphBatchFailed', { batchId: event.batchId });
        toast('数据暂时无法读取，已保留当前内容。' + (err && err.message ? ' ' + err.message : ''));
      }
    }
  };
  function restoreBrowserState() {
    try { const saved = localStorage.getItem(storageKey); if (saved) state = Core.validateState(JSON.parse(saved)); }
    catch (_) { toast('浏览器中的旧数据无法读取，可以从备份恢复。'); }
  }
  if (!native) {
    if (typeof fetch === 'function') {
      // The native app injects the same validated bundled file before core.js.
      // A hosted preview can read it too; file:// or missing files stay safely
      // unconfigured rather than inventing a school domain.
      fetch('SchoolConfig.json', { cache: 'no-store' }).then(response => {
        if (!response.ok) throw new Error('School configuration unavailable');
        return response.text();
      }).then(text => {
        if (text.length > 8192) throw new Error('School configuration too large');
        Core.configureSchools(JSON.parse(text));
      }).catch(() => {}).finally(() => { restoreBrowserState(); render(); });
    } else restoreBrowserState();
  }
  render();
  send('ready');
  send('requestGraphStatus');
  send('requestTeamsAutoStatus');
  setInterval(() => {
    document.getElementById('sidebar-clock').textContent = Core.clock();
    const clock = updateClock(); updateMenu(clock);
    const today = Core.today(), boundary = clock.phase + ':' + (clock.current && clock.current.id || '') + ':' + (clock.next && clock.next.id || '');
    const dialogOpen = ['task-dialog', 'detail-dialog', 'teams-page-dialog'].some(id => document.getElementById(id).open);
    if (!dialogOpen && (page === 'overview' || page === 'schedule') && (today !== lastRenderedDay || boundary !== lastClockBoundary)) {
      if (selectedDate === lastRenderedDay && today !== lastRenderedDay) selectedDate = today;
      lastRenderedDay = today; lastClockBoundary = boundary; render();
    }
  }, 1000);
})();
