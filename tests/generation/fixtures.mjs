// Hand-authored OFFLINE model-output contracts, never a generator or production templates.
const field = (id, name, type = 'text', options) => ({ id, name, type, required: true, ...(options ? { options } : {}) })
const entity = (id, name, fields) => ({ id, name, fields })
const list = (id, entityId, name, fieldIds) => ({ id, entityId, name, type: 'list', fieldIds })
const form = (id, entityId, name, fieldIds) => ({ id, entityId, name, type: 'form', fieldIds })
const metric = (id, entityId, name, aggregation, fieldId) => ({ id, entityId, name, type: 'metric', aggregation, ...(fieldId ? { fieldId } : {}) })
const evidence = (blockId, entityId, operation, fieldIds = []) => ({ blockId, entityId, operation, fieldIds })
function fixture(id, idea, goal, entities, blocks, claims, records, expectedMetrics = {}) {
  return {
    id, idea,
    spec: { version: 1, id, name: goal, entities,
      blocks: blocks.map(({ entityId: _entityId, ...block }) => block),
      relations: blocks.map(block => ({ id: `${block.id}-binding`, type: 'dataBinding', blockId: block.id, entityId: block.entityId })),
    },
    requirements: [{ id: `${id}-goal`, quote: idea, goal, primary: true }],
    assessments: [{ requirementId: `${id}-goal`, status: 'satisfied', explanation: goal,
      limitations: [], evidence: claims }],
    records, expectedMetrics,
  }
}

export const cases = [
  fixture('club-app', '管理社团报名：突出报名入口，录入姓名、意向部门和联系方式，查看并修改报名名单；不需要统计。', '报名录入与名单维护',
    [entity('applicants', '报名者', [field('applicant-name', '姓名'), field('department', '意向部门', 'select', ['宣传', '技术']), field('contact', '联系方式')])],
    [form('signup', 'applicants', '报名入口', ['applicant-name', 'department', 'contact']), list('roster', 'applicants', '报名名单', ['applicant-name', 'department', 'contact'])],
    [evidence('signup', 'applicants', 'create', ['applicant-name', 'department', 'contact']), evidence('roster', 'applicants', 'update', ['applicant-name', 'department', 'contact'])],
    { applicants: [{ 'applicant-name': '林同学', department: '技术', contact: '现场联系' }] }),
  fixture('fitness-log', '手动记录每次健身的日期、动作、训练分钟，维护历史并查看累计和平均训练分钟。', '训练流水及分钟统计',
    [entity('sessions', '训练流水', [field('trained-on', '训练日期', 'date'), field('movement', '动作'), field('minutes', '训练分钟', 'number')])],
    [list('session-list', 'sessions', '训练历史', ['trained-on', 'movement', 'minutes']), metric('total-minutes', 'sessions', '全部训练分钟合计', 'sum', 'minutes'), metric('average-minutes', 'sessions', '每条训练记录平均分钟', 'average', 'minutes')],
    [evidence('session-list', 'sessions', 'read', ['trained-on', 'movement', 'minutes']), evidence('total-minutes', 'sessions', 'sum', ['minutes']), evidence('average-minutes', 'sessions', 'average', ['minutes'])],
    { sessions: [{ 'trained-on': '2026-10-18', movement: '深蹲', minutes: 20 }, { 'trained-on': '2026-10-18', movement: '跑步', minutes: 40 }] },
    { 'total-minutes': 60, 'average-minutes': 30 }),
  fixture('study-log', '学习时长记录：记录每天学习的日期、科目、学习分钟和笔记，查看学习历史以及累计和平均学习时长。', '学习时长流水及统计',
    [entity('study-sessions', '学习记录', [field('study-date', '学习日期', 'date'), field('subject', '科目'), field('minutes', '学习分钟', 'number'), field('study-note', '学习笔记')])],
    [list('study-list', 'study-sessions', '学习历史', ['study-date', 'subject', 'minutes', 'study-note']), metric('study-total', 'study-sessions', '累计学习分钟', 'sum', 'minutes'), metric('study-average', 'study-sessions', '平均学习分钟', 'average', 'minutes')],
    [evidence('study-list', 'study-sessions', 'read', ['study-date', 'subject', 'minutes', 'study-note']), evidence('study-total', 'study-sessions', 'sum', ['minutes']), evidence('study-average', 'study-sessions', 'average', ['minutes'])],
    { 'study-sessions': [{ 'study-date': '2026-10-18', subject: '数学', minutes: 45, 'study-note': '复习函数' }, { 'study-date': '2026-10-19', subject: '英语', minutes: 30, 'study-note': '背单词' }] },
    { 'study-total': 75, 'study-average': 37.5 }),
  fixture('fitness-library', '健身时只需要维护动作资料和器械资料，两种资料独立管理。动作记名称、技术要点；器械记名称和安全说明。不要训练流水和统计。', '独立维护动作与器械资料',
    [entity('exercises', '动作资料', [field('exercise-name', '动作名称'), field('technique', '技术要点')]), entity('equipment', '器械资料', [field('equipment-name', '器械名称'), field('safety', '安全说明')])],
    [list('exercise-list', 'exercises', '动作资料', ['exercise-name', 'technique']), list('equipment-list', 'equipment', '器械资料', ['equipment-name', 'safety'])],
    [evidence('exercise-list', 'exercises', 'update', ['exercise-name', 'technique']), evidence('equipment-list', 'equipment', 'update', ['equipment-name', 'safety'])],
    { exercises: [{ 'exercise-name': '深蹲', technique: '保持稳定' }], equipment: [{ 'equipment-name': '杠铃', safety: '检查卡扣' }] }),
  fixture('money-app', '个人记账，收入和支出分开维护日期、金额和备注，各自显示全部记录金额合计，不需要余额或按月筛选。', '收入与支出分账及各自合计',
    [entity('income', '收入', [field('income-date', '日期', 'date'), field('income-amount', '收入金额', 'number'), field('income-note', '备注')]), entity('expenses', '支出', [field('expense-date', '日期', 'date'), field('expense-amount', '支出金额', 'number'), field('expense-note', '备注')])],
    [list('income-list', 'income', '收入流水', ['income-date', 'income-amount', 'income-note']), metric('income-total', 'income', '全部收入合计', 'sum', 'income-amount'), list('expense-list', 'expenses', '支出流水', ['expense-date', 'expense-amount', 'expense-note']), metric('expense-total', 'expenses', '全部支出合计', 'sum', 'expense-amount')],
    [evidence('income-list', 'income', 'read', ['income-date', 'income-amount', 'income-note']), evidence('income-total', 'income', 'sum', ['income-amount']), evidence('expense-list', 'expenses', 'read', ['expense-date', 'expense-amount', 'expense-note']), evidence('expense-total', 'expenses', 'sum', ['expense-amount'])],
    { income: [{ 'income-date': '2026-10-18', 'income-amount': 100, 'income-note': '兼职' }], expenses: [{ 'expense-date': '2026-10-18', 'expense-amount': 25, 'expense-note': '午餐' }] },
    { 'income-total': 100, 'expense-total': 25 }),
  fixture('lost-found', '校园失物招领：分别维护遗失登记和拾获登记，均记录物品描述、地点、日期和联系办法，只做人工查看编辑。', '遗失与拾获的独立人工登记',
    [entity('lost', '遗失登记', [field('lost-item', '物品描述'), field('lost-place', '遗失地点'), field('lost-date', '日期', 'date'), field('lost-contact', '联系办法')]), entity('found', '拾获登记', [field('found-item', '物品描述'), field('found-place', '拾获地点'), field('found-date', '日期', 'date'), field('found-contact', '联系办法')])],
    [list('lost-list', 'lost', '遗失登记', ['lost-item', 'lost-place', 'lost-date', 'lost-contact']), list('found-list', 'found', '拾获登记', ['found-item', 'found-place', 'found-date', 'found-contact'])],
    [evidence('lost-list', 'lost', 'read', ['lost-item', 'lost-place', 'lost-date', 'lost-contact']), evidence('found-list', 'found', 'read', ['found-item', 'found-place', 'found-date', 'found-contact'])],
    { lost: [{ 'lost-item': '钥匙', 'lost-place': '食堂', 'lost-date': '2026-10-18', 'lost-contact': '服务台' }], found: [{ 'found-item': '书包', 'found-place': '图书馆', 'found-date': '2026-10-18', 'found-contact': '服务台' }] }),
  fixture('book-log', '书籍阅读记录：维护书名、作者、读完日期和读后感，不需要统计或每天的阅读流水。', '按书维护阅读记录',
    [entity('books', '已读书籍', [field('book-title', '书名'), field('author', '作者'), field('finished-on', '读完日期', 'date'), field('reflection', '读后感')])],
    [list('book-list', 'books', '阅读记录', ['book-title', 'author', 'finished-on', 'reflection'])],
    [evidence('book-list', 'books', 'update', ['book-title', 'author', 'finished-on', 'reflection'])],
    { books: [{ 'book-title': '乡土中国', author: '费孝通', 'finished-on': '2026-10-18', reflection: '记录感想' }] }),
  // User supplied during this session; kept solely in the test corpus.
  fixture('movie-log', '制作记录看过的电影的软件', '记录并维护已看电影及观影笔记',
    [entity('movies', '已看电影', [field('movie-title', '电影名'), { ...field('watched-on', '观看日期', 'date'), required: false }, { ...field('movie-note', '观影笔记'), required: false }])],
    [list('movie-list', 'movies', '已看电影记录', ['movie-title', 'watched-on', 'movie-note'])],
    [evidence('movie-list', 'movies', 'create', ['movie-title', 'watched-on', 'movie-note'])],
    { movies: [{ 'movie-title': '千与千寻', 'watched-on': '2026-10-18', 'movie-note': '喜欢的场景' }] }),
]
