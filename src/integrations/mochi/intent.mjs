/** Conservative supported-language gate, not a model-generated permission grant.
 * Unknown/ambiguous phrasing asks for clarification before paid egress. The Host
 * still independently validates targets, authorization, revision and every value.
 */
const blockEnd = '(?:积木)?(?=$|[，,。；;\\n！!？?])'
const reject = code => { throw Object.assign(new Error(code), { code, status: 422 }) }
export function resolvePlanIntent(input) {
  const raw = input.prompt.normalize('NFKC').trim()
  const forbidAddField = raw.includes('不要新增字段')
  const text = raw.replace(/不要新增字段/g, '')
  const permissions = new Set(), presentation = new Set()
  const addingField = /(?:新增|增加|添加|加上|加一个|加个)[^，,。；;\n]{0,36}字段/.test(text)
  if (addingField) { permissions.add('addField'); permissions.add('configureBlockFields') }
  if (/(?:隐藏|显示|恢复|展示|移除)[^，,。；;\n]{0,24}字段|(?:显示|展示)字段.*(?:改|调整)/.test(text)) permissions.add('configureBlockFields')
  if (new RegExp('(?:新增|增加|添加)[^，,。；;\\n]{0,18}(?:积木|表单|列表|图库|画廊|统计|指标)' + blockEnd).test(text.replace(/(?:新增|增加|添加)[^，,。；;\n]{0,36}字段/g, ''))) permissions.add('addBlock')
  if (new RegExp('(?:删除|移除)[^，,。；;\\n]{0,20}(?:积木|表单|列表|图库|画廊|统计|指标)' + blockEnd).test(text)) permissions.add('removeBlock')
  if (/(?:排序|顺序|移到|移至|移动到|排到|放到|挪到)/.test(text) && (!/字段/.test(text) || /积木/.test(text))) permissions.add('reorderBlocks')
  if (/背景/.test(text)) presentation.add('backgroundColor')
  if (/(?:文字颜色|字体颜色|文本颜色)/.test(text)) presentation.add('textColor')
  if (/(?:圆角|圆弧)/.test(text)) presentation.add('borderRadius')
  if (/(?:按钮(?:文案|文字|文本)?(?:改成|改为|设为|设置为)|按钮文案|提交文案)/.test(text)) presentation.add('buttonText')
  if (presentation.size && /(?:改|调整|设置|使用|设为|变成|换成)/.test(text)) permissions.add('configureBlockPresentation')
  if (input.block.type === 'gallery' && /(?:图片|图像|图库|画廊)/.test(text)
    && /(?:清空|改|调整|设置|配置|放进|换成|使用|显示|隐藏|恢复|移除图片)/.test(text)) permissions.add('configureGallery')
  if (input.block.type === 'metric' && /(?:合计|总和|求和|平均|计数|人数|数量统计)/.test(text)
    && /(?:改|调整|设置|使用|统计|计算)/.test(text)) permissions.add('configureMetric')
  // A negative/multi-choice instruction is not positive authority. Users can
  // express preservation positively (保留…) or split the request into one step.
  if (!permissions.size || /(?:不要|不许|禁止|别|不能|无需|不需要|或者|还是|随便|自动决定)/.test(text)) reject('INTENT_CLARIFICATION_REQUIRED')
  if (forbidAddField && permissions.has('addField')) reject('INTENT_CLARIFICATION_REQUIRED')
  if (permissions.has('addField') && !['form', 'list'].includes(input.block.type)) reject('INTENT_CLARIFICATION_REQUIRED')
  const selectedNoun = text.match(/(?:只|仅)(?:给|对|修改|调整)?(表单|列表|图库|画廊|统计积木|指标积木)/)?.[1]
  const targetTypes = { 表单: 'form', 列表: 'list', 图库: 'gallery', 画廊: 'gallery', 统计积木: 'metric', 指标积木: 'metric' }
  if (selectedNoun && targetTypes[selectedNoun] !== input.block.type) reject('INTENT_CLARIFICATION_REQUIRED')
  const removalNoun = text.match(new RegExp('(?:删除|移除)[^，,。；;\\n]{0,20}?(表单|列表|图库|画廊|统计|指标)' + blockEnd))?.[1]
  if (permissions.has('removeBlock') && removalNoun && ({ ...targetTypes, 统计: 'metric', 指标: 'metric' })[removalNoun] !== input.block.type) reject('INTENT_CLARIFICATION_REQUIRED')
  const blockTypes = new Set()
  for (const [type, noun] of [['form', '表单'], ['list', '列表'], ['gallery', '(?:图库|画廊)'], ['metric', '(?:统计|指标)']]) {
    if (new RegExp('(?:新增|增加|添加)[^，,。；;\\n]{0,18}' + noun + blockEnd).test(text)) blockTypes.add(type)
  }
  if (permissions.has('addBlock') && !blockTypes.size) reject('INTENT_CLARIFICATION_REQUIRED')
  const fieldType = /文本/.test(text) ? 'text' : /(?:数字|数值)/.test(text) ? 'number' : /日期/.test(text) ? 'date' : /(?:布尔|开关)/.test(text) ? 'boolean' : /(?:下拉|选项)/.test(text) ? 'select' : null
  return { permissions, presentation, addingField, blockTypes, fieldType }
}
export function assertPlanIntent(candidate, input) {
  const intent = resolvePlanIntent(input)
  const commands = candidate?.request?.commands
  if (!Array.isArray(commands)) reject('AI_INVALID_RESPONSE')
  for (const command of commands) {
    if (!intent.permissions.has(command.type)) reject('INTENT_SCOPE_VIOLATION')
    if (command.type === 'addBlock' && !intent.blockTypes.has(command.block?.type)) reject('INTENT_SCOPE_VIOLATION')
    if (command.type === 'addField' && (typeof command.field?.name !== 'string' || !input.prompt.normalize('NFKC').includes(command.field.name.normalize('NFKC')))) reject('INTENT_SCOPE_VIOLATION')
    if (command.type === 'addField' && intent.fieldType && command.field?.type !== intent.fieldType) reject('INTENT_SCOPE_VIOLATION')
    if (command.type === 'configureBlockPresentation' && Object.keys(command.presentation ?? {}).some(key => !intent.presentation.has(key))) reject('INTENT_SCOPE_VIOLATION')
    if (command.type === 'configureMetric') {
      const text = input.prompt.normalize('NFKC')
      // In “把报名人数改成数量合计”, 人数 names the old metric. Only
      // the requested target after the change verb grants aggregation authority.
      const target = text.split(/(?:改成|改为|调整为|设置为|设为|变成|换成)/)
      if (target.length > 2) reject('INTENT_SCOPE_VIOLATION')
      const modes = [['sum', /合计|总和|求和/], ['average', /平均/], ['count', /计数|人数|数量统计/]].filter(([, pattern]) => pattern.test(target.at(-1)))
      if (modes.length !== 1 || command.aggregation !== modes[0][0]) reject('INTENT_SCOPE_VIOLATION')
      // Retaining the current numeric field is safe; switching requires its name.
      if (command.aggregation !== 'count' && command.fieldId !== input.block.fieldId
        && !(input.entity?.fields ?? []).some(f => f.id === command.fieldId && text.includes(f.name.normalize('NFKC')))) reject('INTENT_SCOPE_VIOLATION')
    }
    if (command.type === 'configureGallery') {
      const text = input.prompt.normalize('NFKC')
      if (/(?:清空|隐藏)(?:当前)?(?:图库|画廊)?(?:的)?(?:全部|所有)?图片/.test(text) && command.imageIds.length) reject('INTENT_SCOPE_VIOLATION')
      if (/(?:恢复|显示)(?:当前)?(?:图库|画廊)?(?:的)?(?:全部|所有)?图片/.test(text)
        && (input.block.imageIds ?? []).some(id => !command.imageIds.includes(id))) reject('INTENT_SCOPE_VIOLATION')
    }
    if (command.type === 'configureBlockFields' && intent.addingField) {
      const added = commands.filter(c => c.type === 'addField').map(c => c.field.id)
      // Adding a field grants no authority to hide/reorder existing fields or
      // reveal other previously hidden fields. Explicit display edits use a separate request.
      if (JSON.stringify(command.fieldIds) !== JSON.stringify([...input.block.fieldIds, ...added])) reject('INTENT_SCOPE_VIOLATION')
    } else if (command.type === 'configureBlockFields') {
      const before = input.block.fieldIds, after = command.fieldIds
      if (!Array.isArray(before) || !Array.isArray(after)) reject('AI_INVALID_RESPONSE')
      const added = after.filter(id => !before.includes(id)), removed = before.filter(id => !after.includes(id))
      const text = input.prompt.normalize('NFKC')
      const named = id => (input.entity?.fields ?? []).some(f => f.id === id && (text.includes(f.name.normalize('NFKC')) || text.includes(f.id)))
      // An explicit field display request does not grant edits to unnamed fields.
      if ([...added, ...removed].some(id => !named(id))) reject('INTENT_SCOPE_VIOLATION')
      if (added.length && !/(?:显示|恢复|展示)/.test(text)) reject('INTENT_SCOPE_VIOLATION')
      if (removed.length && !/(?:隐藏|移除)/.test(text)) reject('INTENT_SCOPE_VIOLATION')
      if (JSON.stringify(before.filter(id => after.includes(id))) !== JSON.stringify(after.filter(id => before.includes(id)))) reject('INTENT_SCOPE_VIOLATION')
    }
  }
  // Field requests must actually add a field, not substitute some other edit.
  if (intent.addingField && commands.filter(c => c.type === 'addField').length !== 1) reject('INTENT_SCOPE_VIOLATION')
  return candidate
}
