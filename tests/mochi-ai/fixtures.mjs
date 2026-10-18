export function context() {
  return { appId: 'signup', instanceId: 'mochi-fixture', revision: 0, selectedBlockId: 'form', mode: 'blocks',
    blocks: [{ id: 'form', name: '报名表', type: 'form', fieldIds: ['name'] }],
    entities: [{ id: 'people', name: '参与者', fields: [{ id: 'name', name: '姓名', type: 'text' }] }],
    relations: [{ blockId: 'form', entityId: 'people' }] }
}
export function advice(text = '要不要加一个报名截止时间？') {
  return { message: '报名入口已经有了。加上截止时间，会更方便安排活动。', suggestions: [
    { text, reason: '帮助参与者判断是否还能报名，也方便组织者安排。', blockId: 'form', priority: 'medium', requiresUserAction: true, kind: 'design-change' } ] }
}
export const request = (kind = 'chat') => ({ version: 1, kind, context: context(), history: [], ...(kind === 'chat' ? { prompt: '下一步还可以优化什么？' } : { event: { type: 'structure-changed' } }) })
export const access = { sessionId: 'trusted-test-session', appId: 'signup' }
export const grant = time => ({ reference: 'OFFLINE TEST ONLY', maxCalls: 20, maxTotalTokens: 200_000, expiresAt: time + 3600_000, providerVerified: true, permissionsVerified: true })
export const envelope = (data = advice()) => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(data) } }] }), { headers: { 'Content-Type': 'application/json' } })
