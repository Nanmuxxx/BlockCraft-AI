import { assertObjectSchema, type ObjectSchema } from '../../custom-block'

/** Only adapter-admitted manifest metadata is supplied here; never source code. */
export function configurationState(schema: unknown, readOnly: boolean) {
  let status: 'valid' | 'missing' | 'unavailable' = 'missing'
  let validated: ObjectSchema | undefined
  if (schema !== undefined) {
    try { assertObjectSchema(schema); validated = schema; status = 'valid' }
    catch { status = 'unavailable' }
  }
  const label = status === 'valid' ? '参数定义有效' : status === 'missing' ? '参数定义缺失' : '参数定义不可用'
  const message = status === 'valid' ? '参数修改将在宿主校验通过后保存。'
    : status === 'missing' ? '此版本的制品或元数据未找到，暂时无法编辑。'
      : '参数定义无效或无法可信验证，暂时无法编辑。'
  return { status, label, message, schema: validated, editable: status === 'valid' && !readOnly,
    writeLabel: readOnly ? '只读' : '可写', executionLabel: '当前不可执行' }
}
