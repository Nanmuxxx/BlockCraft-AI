// Business acceptance contracts, not expected model JSON. Names accept explicit
// synonyms; IDs, order, extra fields and extra valid modules are unconstrained.
const field = (key, names, type, required = true, options) => ({
  key, names, type, required, ...(options ? { options } : {}),
})
const entity = (key, names, fields, modules, sample, second, update) => ({
  key, names, fields, modules, scenario: { sample, second, update },
})
const moduleOf = (key, type, fields, name) => ({ key, type, fields, name })
const metric = (key, aggregation, field, name, values) => ({ key, type: 'metric', aggregation, field, name, values })
const crud = (prefix, keys, listKeys, formName, listName) => [
  moduleOf(`${prefix}-form`, 'form', keys, formName),
  moduleOf(`${prefix}-list`, 'list', listKeys, listName),
]
const unsupported = (capability, reason, fallback) => ({ capability, reason, fallback })

module.exports = [
  {
    id: 'club-registration', title: '社团报名',
    prompt: '帮我做一个摄影社招新报名 App：收集姓名、意向部门（宣传部、策划部、技术部）、联系方式和能否面试；我能录入报名、查看名单、修改联系方式、删除误报名，看到报名记录总数。后续希望按部门审核、同一手机号不能重复报名，并自动通知面试。',
    supported: ['手动报名录入', '名单查看、编辑、删除', '全部报名记录计数（非去重人数）'],
    pending: [
      unsupported('报名审核工作流', 'v1 没有审批动作与状态流转约束', '可另加单选状态手动维护，但不算自动审核'),
      unsupported('联系方式唯一约束', '字段没有 unique 规则', '由人检查重复报名'),
      unsupported('面试通知', '没有消息发送、定时任务或身份系统', '手动联系'),
    ],
    entities: [entity('applicants', ['报名者', '社团报名', '报名记录', '申请者', 'Applicants'], [
      field('name', ['姓名', '报名者姓名', '申请人姓名', 'Applicant name'], 'text'),
      field('department', ['意向部门', '报名部门', '部门', 'Department'], 'select', true, [['宣传部'], ['策划部'], ['技术部']]),
      field('contact', ['联系方式', '联系电话', '手机号', 'Contact'], 'text'),
      field('interview', ['可参加面试', '能否面试', '是否可以面试', 'Available for interview'], 'boolean', false),
    ], [
      ...crud('applicant', ['name', 'department', 'contact', 'interview'], ['name', 'department', 'contact', 'interview'], '招新报名表', '社团报名名单'),
      metric('application-count', 'count', null, '报名记录数', [2, 2, 1]),
    ],
    { name: '测试甲', department: '技术部', contact: 'TEST-CONTACT-A', interview: true },
    { name: '测试乙', department: '宣传部', contact: 'TEST-CONTACT-B', interview: false },
    { contact: 'TEST-CONTACT-UPDATED', interview: false })],
  },
  {
    id: 'fitness-plan', title: '健身计划',
    prompt: '我要一个健身计划 App：维护动作资料（动作名称、肌群、动作说明），手动安排训练日期、动作名称、目标组数和每组次数并标记完成；另记实际训练日期、动作名称、实际组数、每组次数和训练分钟，能修改和删除错误记录，统计累计和平均训练分钟。后续希望自动排课、训练倒计时、日历以及完成率。',
    supported: ['独立动作资料维护', '手动安排训练计划并编辑完成标记', '实际训练记录管理', '全部训练记录的分钟合计、均值'],
    pending: [
      unsupported('关联动作与计划', 'dataBinding 仅绑定积木和实体，没有外键、联动选择或 join', '各实体重复保存动作名称文本，由人保持一致'),
      unsupported('自动训练编排', '没有自动计划算法或工作流', '手动填写计划'),
      unsupported('训练计时器', '没有开始、暂停和倒计时状态', '手动填写训练分钟'),
      unsupported('训练日历', 'date 字段没有日历视图', '日期在列表展示'),
      unsupported('完成率', '没有条件聚合、分母或比值计算', '仅编辑完成布尔值，不展示伪完成率'),
    ],
    entities: [
      entity('exercises', ['动作资料', '动作库', '训练动作', 'Exercises'], [
        field('name', ['动作名称', '动作名', 'Exercise name'], 'text'),
        field('muscle', ['肌群', '目标肌群', 'Muscle group'], 'select', true, [['上肢'], ['下肢'], ['核心']]),
        field('instructions', ['动作说明', '动作要领', 'Instructions'], 'text', false),
      ], crud('exercise', ['name', 'muscle', 'instructions'], ['name', 'muscle', 'instructions'], '录入动作资料', '动作资料库'),
      { name: '深蹲', muscle: '下肢', instructions: '保持稳定' }, { name: '平板支撑', muscle: '核心', instructions: '自然呼吸' }, { instructions: '控制动作速度' }),
      entity('plans', ['训练计划', '健身计划', '计划安排', 'Training plans'], [
        field('date', ['计划日期', '训练日期', 'Planned date'], 'date'),
        field('exercise', ['动作名称', '计划动作', 'Exercise name'], 'text'),
        field('sets', ['目标组数', '计划组数', 'Target sets'], 'number'),
        field('reps', ['每组次数', '目标次数', 'Target reps'], 'number'),
        field('completed', ['是否完成', '完成标记', 'Completed'], 'boolean', false),
      ], crud('plan', ['date', 'exercise', 'sets', 'reps', 'completed'], ['date', 'exercise', 'sets', 'reps', 'completed'], '安排训练计划', '训练计划列表'),
      { date: '2026-10-18', exercise: '深蹲', sets: 3, reps: 12, completed: false }, { date: '2026-10-19', exercise: '平板支撑', sets: 2, reps: 1, completed: false }, { sets: 4, completed: true }),
      entity('workouts', ['训练记录', '实际训练', '健身记录', 'Workouts'], [
        field('date', ['训练日期', '实际日期', 'Workout date'], 'date'),
        field('exercise', ['动作名称', '训练动作', 'Exercise name'], 'text'),
        field('sets', ['实际组数', '完成组数', 'Actual sets'], 'number'),
        field('reps', ['每组次数', '实际次数', 'Actual reps'], 'number'),
        field('minutes', ['训练分钟', '训练时长', '训练时长（分钟）', 'Duration minutes'], 'number'),
      ], [
        ...crud('workout', ['date', 'exercise', 'sets', 'reps', 'minutes'], ['date', 'exercise', 'sets', 'reps', 'minutes'], '记录实际训练', '训练记录列表'),
        metric('workout-sum', 'sum', 'minutes', '累计训练分钟', [50, 60, 40]),
        metric('workout-average', 'average', 'minutes', '平均训练分钟', [25, 30, 40]),
      ], { date: '2026-10-18', exercise: '深蹲', sets: 3, reps: 12, minutes: 30 }, { date: '2026-10-19', exercise: '平板支撑', sets: 2, reps: 1, minutes: 20 }, { minutes: 40 }),
    ],
  },
  {
    id: 'reading-log', title: '阅读记录',
    prompt: '帮我做阅读记录 App：书架保存书名、作者和阅读状态（想读、在读、读完）；每天记录书名、阅读日期、阅读分钟与摘记，可以录入、查看、编辑或删除书目和阅读流水，统计累计及平均阅读分钟。希望将来阅读记录能关联书架，自动算阅读进度和连续阅读天数。',
    supported: ['独立书目和阅读流水维护', '手动更新书目阅读状态', '全部阅读记录的分钟合计、均值'],
    pending: [
      unsupported('关联书架与流水', '没有实体关系、外键和关联查询', '流水重复保存书名文本'),
      unsupported('自动阅读进度', '没有总页数与已读页数的公式计算', '手动更新阅读状态'),
      unsupported('连续阅读天数', 'count 统计记录条数，没有按日期去重或连续性计算', '展示日期与阅读分钟列表'),
    ],
    entities: [
      entity('books', ['书目', '书架', '图书', 'Books'], [
        field('title', ['书名', '图书名称', 'Book title'], 'text'),
        field('author', ['作者', '图书作者', 'Author'], 'text', false),
        field('status', ['阅读状态', '阅读进度状态', 'Reading status'], 'select', true, [['想读', '待读'], ['在读', '阅读中'], ['读完', '已读']]),
      ], crud('book', ['title', 'author', 'status'], ['title', 'author', 'status'], '添加书目', '我的书架'),
      { title: '乡土中国', author: '费孝通', status: '在读' }, { title: '测试书目', author: '测试作者', status: '想读' }, { status: '读完' }),
      entity('sessions', ['阅读流水', '每日阅读', '阅读记录', 'Reading sessions'], [
        field('title', ['书名', '阅读书名', 'Book title'], 'text'),
        field('date', ['阅读日期', '日期', 'Reading date'], 'date'),
        field('minutes', ['阅读分钟', '阅读时长', '阅读时长（分钟）', 'Minutes read'], 'number'),
        field('notes', ['摘记', '阅读笔记', '感想', 'Notes'], 'text', false),
      ], [
        ...crud('reading', ['title', 'date', 'minutes', 'notes'], ['title', 'date', 'minutes', 'notes'], '记录阅读', '每日阅读流水'),
        metric('reading-sum', 'sum', 'minutes', '累计阅读分钟', [45, 55, 40]),
        metric('reading-average', 'average', 'minutes', '平均阅读分钟', [22.5, 27.5, 40]),
      ], { title: '乡土中国', date: '2026-10-18', minutes: 30, notes: '第一章摘记' }, { title: '测试书目', date: '2026-10-19', minutes: 15, notes: '第二条' }, { minutes: 40, notes: '订正摘记' }),
    ],
  },
  {
    id: 'event-registration', title: '活动报名',
    prompt: '为校园讲座做活动报名 App：活动资料有活动名称、活动日期、地点和参考名额；报名记录有活动名称、参与者姓名、联系方式、报名票数和是否签到。能维护活动、录入报名、修改票数、编辑签到标记并删除误报名，统计报名记录数和累计报名票数。后续希望自动限制名额、候补、扫码签到并收款。',
    supported: ['独立活动资料与报名记录维护', '手动编辑签到布尔值', '报名记录计数与票数合计'],
    pending: [
      unsupported('活动关联与分活动统计', '无实体关系或条件聚合', '重复填写活动名称；统计全部报名记录'),
      unsupported('名额限制与候补', '没有容量约束或原子占位事务', '参考名额仅为数字资料，人工核对'),
      unsupported('扫码签到', '没有扫码、二维码或核销能力', '由人编辑是否签到'),
      unsupported('在线收款', '没有支付接口与订单事务', '线下处理'),
    ],
    entities: [
      entity('events', ['活动资料', '活动', '讲座', 'Events'], [
        field('title', ['活动名称', '讲座名称', 'Event title'], 'text'),
        field('date', ['活动日期', '讲座日期', 'Event date'], 'date'),
        field('venue', ['地点', '活动地点', 'Venue'], 'text'),
        field('capacity', ['参考名额', '活动名额', 'Capacity'], 'number', false),
      ], crud('event', ['title', 'date', 'venue', 'capacity'], ['title', 'date', 'venue', 'capacity'], '维护活动资料', '活动资料列表'),
      { title: '测试讲座甲', date: '2026-10-18', venue: '测试报告厅', capacity: 50 }, { title: '测试讲座乙', date: '2026-10-19', venue: '测试教室', capacity: 20 }, { venue: '测试新教室', capacity: 60 }),
      entity('registrations', ['活动报名', '报名记录', '讲座报名', 'Registrations'], [
        field('event', ['活动名称', '报名活动', 'Event title'], 'text'),
        field('name', ['参与者姓名', '报名人姓名', '姓名', 'Attendee name'], 'text'),
        field('contact', ['联系方式', '联系电话', 'Contact'], 'text'),
        field('tickets', ['报名票数', '票数', 'Tickets'], 'number'),
        field('checkedIn', ['是否签到', '签到标记', 'Checked in'], 'boolean', false),
      ], [
        ...crud('registration', ['event', 'name', 'contact', 'tickets', 'checkedIn'], ['event', 'name', 'contact', 'tickets', 'checkedIn'], '活动报名表', '活动报名名单'),
        metric('registration-count', 'count', null, '报名记录数', [2, 2, 1]),
        metric('ticket-sum', 'sum', 'tickets', '累计报名票数', [3, 4, 3]),
      ], { event: '测试讲座甲', name: '测试甲', contact: 'TEST-CONTACT-A', tickets: 2, checkedIn: false }, { event: '测试讲座乙', name: '测试乙', contact: 'TEST-CONTACT-B', tickets: 1, checkedIn: false }, { tickets: 3, checkedIn: true }),
    ],
  },
  {
    id: 'personal-tasks', title: '个人任务管理',
    prompt: '做一个个人任务管理 App：记录任务名称、截止日期、优先级（低、中、高）、任务状态（待办、进行中、已完成）、预计分钟和备注。我能添加任务、查看清单、编辑状态和截止日期、删除任务，查看任务记录总数。将来希望截止提醒、周期任务、看板拖拽和自动计算完成率。',
    supported: ['任务记录录入与列表维护', '手动编辑优先级、状态和截止日期', '全部任务记录计数（不等于待办数）'],
    pending: [
      unsupported('截止提醒与周期任务', '没有定时任务、推送或重复规则', '手动查看截止日期'),
      unsupported('看板拖拽与交互清单', '没有看板分组或逐项勾选行为', '在记录编辑中修改单选状态'),
      unsupported('完成率与待办数量', '没有条件聚合或比值计算', '只展示全部任务记录数'),
    ],
    entities: [entity('tasks', ['任务', '个人任务', '任务记录', 'Tasks'], [
      field('title', ['任务名称', '任务标题', 'Task title'], 'text'),
      field('due', ['截止日期', '到期日期', 'Due date'], 'date'),
      field('priority', ['优先级', '任务优先级', 'Priority'], 'select', true, [['低', '低优先级'], ['中', '中优先级'], ['高', '高优先级']]),
      field('status', ['任务状态', '状态', 'Task status'], 'select', true, [['待办', '未开始'], ['进行中', '处理中'], ['已完成', '完成']]),
      field('minutes', ['预计分钟', '预计时长', '预计时长（分钟）', 'Estimated minutes'], 'number', false),
      field('notes', ['备注', '任务备注', 'Notes'], 'text', false),
    ], [
      ...crud('task', ['title', 'due', 'priority', 'status', 'minutes', 'notes'], ['title', 'due', 'priority', 'status', 'minutes', 'notes'], '添加任务', '个人任务清单'),
      metric('task-count', 'count', null, '任务记录总数', [2, 2, 1]),
    ], { title: '完成课程作业', due: '2026-10-20', priority: '高', status: '待办', minutes: 60, notes: '测试备注' }, { title: '归还图书', due: '2026-10-21', priority: '中', status: '进行中', minutes: 15, notes: '测试备注乙' }, { status: '已完成', due: '2026-10-22' })],
  },
]
