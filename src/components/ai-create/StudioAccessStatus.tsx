export type StudioStatus = {
  configured: boolean; authenticated: boolean; unavailable?: string | null; singleBoot?: boolean; expiresAt?: number | null
  budget?: { account?: string; calls: number; maxCalls: number | null; capCny: number; reservedCny: number; estimatedCny?: number | null; currentRuntimeEstimatedCny?: number; remainingCalls?: number | null; remainingCny?: number; halted: boolean }
}

export function StudioAccessStatus({ studio }: { studio: StudioStatus }) {
  const budget = studio.budget
  if (budget?.account) return <p role="status">{studio.configured ? '● AI 创作已解锁' : '● AI 创作暂时不可用'} · 已调用 {budget.calls} 次 · 已计费 ¥{budget.reservedCny.toFixed(4)} · 剩余 ¥{(budget.remainingCny ?? 0).toFixed(4)}<small>
    {budget.account === 'agent-test' ? `内部测试共用 ¥${budget.capCny} / ${budget.maxCalls} 次` : `所有 AI 功能共用 ¥${budget.capCny}，调用次数不限`}。请求前预留费用，返回有效用量后结算；用量不明按预留上限计费。余额不足以预留本次请求时暂停，重启不会恢复额度。请求不会自动重试。
    {budget.halted && '账本校验异常，AI 调用已安全暂停。'}
  </small></p>
  const cumulative = budget && Number.isSafeInteger(budget.remainingCalls)
  const cost = budget ? cumulative ? `累计保守计费 ¥${budget.reservedCny.toFixed(4)}`
    : typeof budget.estimatedCny === 'number' ? `估算 ¥${budget.estimatedCny.toFixed(4)}`
    : `本轮估算 ¥${(budget.currentRuntimeEstimatedCny || 0).toFixed(4)}，历史费用待核对` : ''
  return <p role="status">{studio.configured ? '● AI 创作已解锁' : '● AI 创作暂时不可用'}{budget && ` · 已用 ${budget.calls}/${budget.maxCalls} 次 · ${cost}${cumulative ? ` · 剩余 ${budget.remainingCalls} 次` : ''}`}<small>
    {budget ? `共用累计上限 ${budget.maxCalls} 次 / ¥${budget.capCny}` : '本测试空间有累计次数和费用上限'}；任一额度用尽即停止，请求不会自动重试。价格快照到期、价格变更或无法复核时安全暂停。
    {cumulative ? '历史调用与保守费用已计入，容器重启不会恢复额度。' : <>旧账本和历史调用保留，本轮额度独立计算。{studio.singleBoot && '容器重启后 AI 授权会锁定，额度不会恢复。'}</>}
    {budget?.halted && '当前预算已安全暂停。'}
  </small></p>
}
