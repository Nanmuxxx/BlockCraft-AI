import type { AppSpec, ProjectState } from './appSpec'

export const clubRegistrationSpec: AppSpec = {
  version: 1, id: 'club-registration', name: '社团迎新报名',
  entities: [{ id: 'applicants', name: '报名者', fields: [
    { id: 'applicant-name', name: '姓名', type: 'text', required: true },
    { id: 'department', name: '意向部门', type: 'select', required: true, options: ['宣传部', '策划部', '技术部'] },
    { id: 'available', name: '可参加面试', type: 'boolean', required: false },
  ] }],
  blocks: [
    { id: 'registration-form', name: '报名表', type: 'form', fieldIds: ['applicant-name', 'department', 'available'] },
    { id: 'applicant-list', name: '报名名单', type: 'list', fieldIds: ['applicant-name', 'department'] },
    { id: 'applicant-total', name: '报名人数', type: 'metric', aggregation: 'count' },
  ],
  relations: [
    { id: 'registration-binding', type: 'dataBinding', blockId: 'registration-form', entityId: 'applicants' },
    { id: 'applicant-list-binding', type: 'dataBinding', blockId: 'applicant-list', entityId: 'applicants' },
    { id: 'applicant-total-binding', type: 'dataBinding', blockId: 'applicant-total', entityId: 'applicants' },
  ],
}

export const readingLogSpec: AppSpec = {
  version: 1, id: 'reading-log', name: '阅读记录',
  entities: [
    { id: 'books', name: '书目', fields: [
      { id: 'book-title', name: '书名', type: 'text', required: true },
      { id: 'book-status', name: '阅读状态', type: 'select', required: false, options: ['想读', '在读', '读完'] },
    ] },
    { id: 'reading-sessions', name: '每日阅读', fields: [
      { id: 'reading-date', name: '日期', type: 'date', required: true },
      { id: 'minutes', name: '阅读分钟', type: 'number', required: true },
      { id: 'notes', name: '摘记', type: 'text', required: false },
    ] },
  ],
  blocks: [
    { id: 'bookshelf', name: '我的书架', type: 'list', fieldIds: ['book-title', 'book-status'] },
    { id: 'reading-history', name: '阅读流水', type: 'list', fieldIds: ['reading-date', 'minutes', 'notes'] },
    { id: 'reading-form', name: '记录阅读', type: 'form', fieldIds: ['reading-date', 'minutes', 'notes'] },
    { id: 'reading-total', name: '累计分钟', type: 'metric', aggregation: 'sum', fieldId: 'minutes' },
  ],
  relations: [
    { id: 'bookshelf-binding', type: 'dataBinding', blockId: 'bookshelf', entityId: 'books' },
    { id: 'history-binding', type: 'dataBinding', blockId: 'reading-history', entityId: 'reading-sessions' },
    { id: 'reading-form-binding', type: 'dataBinding', blockId: 'reading-form', entityId: 'reading-sessions' },
    { id: 'reading-total-binding', type: 'dataBinding', blockId: 'reading-total', entityId: 'reading-sessions' },
  ],
}

export function createClubRegistrationExample(): ProjectState {
  return { revision: 0, spec: structuredClone(clubRegistrationSpec), records: {
    applicants: [{ id: 'applicant-001', values: { 'applicant-name': '小林', department: '技术部', available: true } }],
  }, blockPositions: {} }
}
export function createReadingLogExample(): ProjectState {
  return { revision: 0, spec: structuredClone(readingLogSpec), records: {
    books: [{ id: 'book-001', values: { 'book-title': '乡土中国', 'book-status': '在读' } }],
    'reading-sessions': [{ id: 'session-001', values: { 'reading-date': '2026-10-17', minutes: 30, notes: '阅读第一章' } }],
  }, blockPositions: {} }
}

export const learningLogSpec: AppSpec = {
  version: 1, id: 'learning-log', name: '学习记录',
  entities: [{ id: 'study-sessions', name: '学习记录', fields: [
    { id: 'study-subject', name: '科目', type: 'text', required: true },
    { id: 'study-date', name: '日期', type: 'date', required: true },
    { id: 'study-minutes', name: '学习时长（分钟）', type: 'number', required: true },
    { id: 'study-notes', name: '学习记录', type: 'text', required: false },
  ] }],
  blocks: [
    { id: 'study-form', name: '记录学习', type: 'form', fieldIds: ['study-subject', 'study-date', 'study-minutes', 'study-notes'] },
    { id: 'study-list', name: '学习记录', type: 'list', fieldIds: ['study-subject', 'study-date', 'study-minutes', 'study-notes'] },
    { id: 'study-total-minutes', name: '累计学习分钟', type: 'metric', aggregation: 'sum', fieldId: 'study-minutes' },
  ],
  relations: [
    { id: 'study-form-binding', type: 'dataBinding', blockId: 'study-form', entityId: 'study-sessions' },
    { id: 'study-list-binding', type: 'dataBinding', blockId: 'study-list', entityId: 'study-sessions' },
    { id: 'study-total-binding', type: 'dataBinding', blockId: 'study-total-minutes', entityId: 'study-sessions' },
  ],
}

function createLearningLogExample(): ProjectState {
  return { revision: 0, spec: structuredClone(learningLogSpec), records: {
    'study-sessions': [{ id: 'study-001', values: { 'study-subject': '数学', 'study-date': '2026-10-18', 'study-minutes': 45, 'study-notes': '复习函数与图像' } }],
  }, blockPositions: {} }
}

export const fitnessCheckinSpec: AppSpec = {
  version: 1, id: 'fitness-checkin', name: '健身打卡',
  entities: [{ id: 'workouts', name: '训练记录', fields: [
    { id: 'workout-date', name: '训练日期', type: 'date', required: true },
    { id: 'workout-name', name: '训练项目', type: 'text', required: true },
    { id: 'workout-minutes', name: '训练时长（分钟）', type: 'number', required: true },
    { id: 'workout-weight', name: '体重（kg）', type: 'number', required: false },
  ] }],
  blocks: [
    { id: 'workout-form', name: '新增训练', type: 'form', fieldIds: ['workout-date', 'workout-name', 'workout-minutes', 'workout-weight'] },
    { id: 'workout-list', name: '训练记录', type: 'list', fieldIds: ['workout-date', 'workout-name', 'workout-minutes', 'workout-weight'] },
    { id: 'workout-total-minutes', name: '累计训练分钟', type: 'metric', aggregation: 'sum', fieldId: 'workout-minutes' },
  ],
  relations: [
    { id: 'workout-form-binding', type: 'dataBinding', blockId: 'workout-form', entityId: 'workouts' },
    { id: 'workout-list-binding', type: 'dataBinding', blockId: 'workout-list', entityId: 'workouts' },
    { id: 'workout-total-binding', type: 'dataBinding', blockId: 'workout-total-minutes', entityId: 'workouts' },
  ],
}

export const expenseTrackerSpec: AppSpec = {
  version: 1, id: 'expense-tracker', name: '个人记账',
  entities: [{ id: 'transactions', name: '收支记录', fields: [
    { id: 'transaction-date', name: '日期', type: 'date', required: true },
    { id: 'transaction-title', name: '项目', type: 'text', required: true },
    { id: 'transaction-amount', name: '金额', type: 'number', required: true },
    { id: 'transaction-type', name: '类型', type: 'select', required: true, options: ['收入', '支出'] },
  ] }],
  blocks: [
    { id: 'transaction-form', name: '记一笔', type: 'form', fieldIds: ['transaction-date', 'transaction-title', 'transaction-amount', 'transaction-type'] },
    { id: 'transaction-list', name: '收支明细', type: 'list', fieldIds: ['transaction-date', 'transaction-title', 'transaction-amount', 'transaction-type'] },
    { id: 'transaction-total', name: '交易金额合计', type: 'metric', aggregation: 'sum', fieldId: 'transaction-amount' },
  ],
  relations: [
    { id: 'transaction-form-binding', type: 'dataBinding', blockId: 'transaction-form', entityId: 'transactions' },
    { id: 'transaction-list-binding', type: 'dataBinding', blockId: 'transaction-list', entityId: 'transactions' },
    { id: 'transaction-total-binding', type: 'dataBinding', blockId: 'transaction-total', entityId: 'transactions' },
  ],
}

export const taskManagerSpec: AppSpec = {
  version: 1, id: 'task-manager', name: '任务管理',
  entities: [{ id: 'tasks', name: '任务', fields: [
    { id: 'task-title', name: '任务名称', type: 'text', required: true },
    { id: 'task-priority', name: '优先级', type: 'select', required: true, options: ['高', '中', '低'] },
    { id: 'task-status', name: '状态', type: 'select', required: true, options: ['待处理', '进行中', '已完成'] },
    { id: 'task-due-date', name: '截止日期', type: 'date', required: false },
  ] }],
  blocks: [
    { id: 'task-form', name: '新增任务', type: 'form', fieldIds: ['task-title', 'task-priority', 'task-status', 'task-due-date'] },
    { id: 'task-list', name: '任务清单', type: 'list', fieldIds: ['task-title', 'task-priority', 'task-status', 'task-due-date'] },
  ],
  relations: [
    { id: 'task-form-binding', type: 'dataBinding', blockId: 'task-form', entityId: 'tasks' },
    { id: 'task-list-binding', type: 'dataBinding', blockId: 'task-list', entityId: 'tasks' },
  ],
}

export const habitTrackerSpec: AppSpec = {
  version: 1, id: 'habit-tracker', name: '习惯养成',
  entities: [{ id: 'habit-checkins', name: '打卡记录', fields: [
    { id: 'habit-name', name: '习惯', type: 'text', required: true },
    { id: 'habit-date', name: '日期', type: 'date', required: true },
    { id: 'habit-completed', name: '是否完成', type: 'boolean', required: true },
    { id: 'habit-note', name: '记录', type: 'text', required: false },
  ] }],
  blocks: [
    { id: 'habit-form', name: '今日打卡', type: 'form', fieldIds: ['habit-name', 'habit-date', 'habit-completed', 'habit-note'] },
    { id: 'habit-list', name: '打卡记录', type: 'list', fieldIds: ['habit-name', 'habit-date', 'habit-completed', 'habit-note'] },
    { id: 'habit-total', name: '打卡次数', type: 'metric', aggregation: 'count' },
  ],
  relations: [
    { id: 'habit-form-binding', type: 'dataBinding', blockId: 'habit-form', entityId: 'habit-checkins' },
    { id: 'habit-list-binding', type: 'dataBinding', blockId: 'habit-list', entityId: 'habit-checkins' },
    { id: 'habit-total-binding', type: 'dataBinding', blockId: 'habit-total', entityId: 'habit-checkins' },
  ],
}

export type DemoGalleryId = 'club-registration' | 'learning-log' | 'fitness-checkin' | 'expense-tracker' | 'task-manager' | 'habit-tracker'
export interface DemoGalleryItem {
  id: DemoGalleryId
  name: string
  description: string
  detail: string
  tone: 'apricot' | 'sage' | 'blue' | 'lilac'
  create: () => ProjectState
}

export const DEMO_GALLERY: DemoGalleryItem[] = [
  { id: 'club-registration', name: '社团报名', description: '填写报名信息，查看名单与人数。', detail: 'Form · List · Metric', tone: 'apricot', create: createClubRegistrationExample },
  { id: 'learning-log', name: '学习记录', description: '记录科目、学习时长和每日笔记。', detail: 'Form · List · Metric', tone: 'blue', create: createLearningLogExample },
  { id: 'fitness-checkin', name: '健身打卡', description: '保存训练日期、项目、时长与体重。', detail: 'Form · List · Metric', tone: 'sage', create: () => ({ revision: 0, spec: structuredClone(fitnessCheckinSpec), records: { workouts: [{ id: 'workout-001', values: { 'workout-date': '2026-10-18', 'workout-name': '力量训练', 'workout-minutes': 45, 'workout-weight': 62.5 } }] }, blockPositions: {} }) },
  { id: 'expense-tracker', name: '个人记账', description: '记录收入支出，查看交易金额合计。', detail: 'Form · List · Metric', tone: 'apricot', create: () => ({ revision: 0, spec: structuredClone(expenseTrackerSpec), records: { transactions: [{ id: 'transaction-001', values: { 'transaction-date': '2026-10-18', 'transaction-title': '午餐', 'transaction-amount': 28, 'transaction-type': '支出' } }, { id: 'transaction-002', values: { 'transaction-date': '2026-10-17', 'transaction-title': '稿费', 'transaction-amount': 500, 'transaction-type': '收入' } }] }, blockPositions: {} }) },
  { id: 'task-manager', name: '任务管理', description: '管理任务名称、优先级、状态和截止日期。', detail: 'Form · List', tone: 'lilac', create: createTaskManagerExample },
  { id: 'habit-tracker', name: '习惯养成', description: '按日期记录习惯完成情况与打卡笔记。', detail: 'Form · List · Metric', tone: 'sage', create: () => ({ revision: 0, spec: structuredClone(habitTrackerSpec), records: { 'habit-checkins': [{ id: 'habit-001', values: { 'habit-name': '早起喝水', 'habit-date': '2026-10-18', 'habit-completed': true, 'habit-note': '起床后完成' } }] }, blockPositions: {} }) },
]

function createTaskManagerExample(): ProjectState {
  return { revision: 0, spec: structuredClone(taskManagerSpec), records: { tasks: [
    { id: 'task-001', values: { 'task-title': '准备周会材料', 'task-priority': '高', 'task-status': '进行中', 'task-due-date': '2026-10-20' } },
    { id: 'task-002', values: { 'task-title': '整理阅读摘记', 'task-priority': '低', 'task-status': '待处理' } },
  ] }, blockPositions: {} }
}
