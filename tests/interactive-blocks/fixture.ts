import { createClubRegistrationExample } from '../../src/model/appSpecExamples'
import type { ProjectState } from '../../src/model/appSpec'

export function interactiveFixture(): ProjectState {
  const state = createClubRegistrationExample()
  state.spec.name = '可交互报名管理'
  state.spec.entities[0].fields.push({ id: 'quantity', name: '数量', type: 'number', required: false }, { id: 'joined', name: '日期', type: 'date', required: false })
  state.spec.blocks.push(
    { id: 'search', name: '报名搜索', type: 'filter', fieldIds: ['applicant-name', 'department', 'available', 'quantity', 'joined'], targetBlockIds: ['applicant-list', 'applicant-total', 'groups'] },
    { id: 'groups', name: '部门统计', type: 'chart', chartType: 'bar', groupFieldId: 'department', aggregation: 'count', targetBlockIds: ['applicant-list', 'applicant-total'] },
    { id: 'details', name: '报名详情', type: 'details', fieldIds: ['applicant-name', 'department', 'quantity'], sourceBlockId: 'applicant-list' },
    { id: 'unfiltered', name: '原始记录总数', type: 'metric', aggregation: 'count' },
    { id: 'gallery', name: '活动图片', type: 'gallery', protocolVersion: 1, imageIds: ['fixture-png'], layout: 'grid', interaction: 'preview' },
  )
  for (const id of ['search', 'groups', 'details', 'unfiltered']) state.spec.relations.push({ id: 'binding-' + id, type: 'dataBinding', blockId: id, entityId: 'applicants' })
  state.records.applicants = [
    { id: 'row-a', values: { 'applicant-name': '小林', department: '技术部', available: true, quantity: 12, joined: '2026-10-24' } },
    { id: 'row-b', values: { 'applicant-name': '小王', department: '宣传部', available: false, quantity: 0 } },
    { id: 'row-c', values: { 'applicant-name': 'Alice', department: '技术部', available: false, quantity: -2 } },
    { id: 'row-d', values: { 'applicant-name': '小赵', department: '策划部', available: true } },
  ]
  state.assets = { 'fixture-png': { id: 'fixture-png', name: '四像素.png', altText: '四像素', mimeType: 'image/png', dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAE0lEQVR4nGP4z8DwHwwZGP6DAQBJyAn3FGMynQAAAABJRU5ErkJggg==' } }
  return state
}
