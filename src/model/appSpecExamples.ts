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
