export const unitTypeGroups = [
  {
    key: 'ground',
    label: '地面单位',
    items: [
      { key: 'tank', label: '坦克', code: 'TK', role: '装甲突击' },
      { key: 'infantry', label: '士兵', code: 'IN', role: '步兵分队' },
      { key: 'artillery', label: '火炮', code: 'AR', role: '火力支援' },
      { key: 'apc', label: '装甲车', code: 'AP', role: '伴随机动' },
      { key: 'missile', label: '导弹车', code: 'MS', role: '远程打击' },
      { key: 'engineer', label: '工兵', code: 'EN', role: '工程保障' },
      { key: 'command', label: '指挥车', code: 'CM', role: '节点指挥' },
      { key: 'radar', label: '雷达车', code: 'RD', role: '感知探测' },
      { key: 'transport', label: '运输车', code: 'TR', role: '机动输送' },
      { key: 'medic', label: '医疗车', code: 'MD', role: '医疗救护' },
    ],
  },
  {
    key: 'air',
    label: '空中单位',
    items: [
      { key: 'helicopter', label: '直升机', code: 'HE', role: '低空机动' },
      { key: 'attackHelicopter', label: '武装直升机', code: 'AH', role: '对地压制' },
      { key: 'transportAircraft', label: '运输机', code: 'TA', role: '空中投送' },
      { key: 'fighter', label: '战斗机', code: 'FG', role: '空优巡航' },
      { key: 'bomber', label: '轰炸机', code: 'BM', role: '纵深打击' },
      { key: 'uav', label: '无人机', code: 'UV', role: '侦察监视' },
      { key: 'awacs', label: '预警机', code: 'AW', role: '空情引导' },
      { key: 'airDefense', label: '防空单元', code: 'AD', role: '区域防护' },
      { key: 'ewAircraft', label: '电子战机', code: 'EW', role: '电磁干扰' },
      { key: 'refueler', label: '加油机', code: 'RF', role: '空中支援' },
    ],
  },
  {
    key: 'sea',
    label: '海上单位',
    items: [
      { key: 'destroyer', label: '驱逐舰', code: 'DD', role: '海上护航' },
      { key: 'frigate', label: '护卫舰', code: 'FF', role: '编队警戒' },
      { key: 'corvette', label: '轻护舰', code: 'CV', role: '近海巡控' },
      { key: 'carrier', label: '航空母舰', code: 'CA', role: '舰载平台' },
      { key: 'submarine', label: '潜艇', code: 'SB', role: '水下伏击' },
      { key: 'amphibious', label: '两栖舰', code: 'AM', role: '立体输送' },
      { key: 'patrolBoat', label: '巡逻艇', code: 'PB', role: '近岸巡逻' },
      { key: 'mineCounter', label: '扫雷舰', code: 'MC', role: '航道清障' },
      { key: 'supportShip', label: '补给舰', code: 'SS', role: '海上补给' },
      { key: 'coastBattery', label: '岸防单元', code: 'CB', role: '岸岸封控' },
    ],
  },
];

export const allUnitTypes = unitTypeGroups.flatMap((group) => group.items.map((item) => ({ ...item, group: group.key, groupLabel: group.label })));

export const unitTypeMap = Object.fromEntries(allUnitTypes.map((item) => [item.key, item]));

export const commandStyles = [
  { key: 'assault', label: '突击箭头', arrow: 'solid' },
  { key: 'support', label: '支援箭头', arrow: 'split' },
  { key: 'advance', label: '推进箭头', arrow: 'long' },
  { key: 'encircle', label: '包围箭头', arrow: 'double' },
  { key: 'feint', label: '佯动箭头', arrow: 'hollow' },
  { key: 'secure', label: '警戒箭头', arrow: 'barb' },
  { key: 'block', label: '阻断箭头', arrow: 'block' },
  { key: 'recon', label: '侦察箭头', arrow: 'needle' },
  { key: 'transfer', label: '转移箭头', arrow: 'wing' },
  { key: 'retreat', label: '撤回箭头', arrow: 'tail' },
];

export const commandStyleMap = Object.fromEntries(commandStyles.map((item) => [item.key, item]));

export const detectionSensorTypes = [
  {
    key: 'radar',
    label: '雷达探测圈',
    shortLabel: '雷达',
    code: 'RAD',
    color: '#38bdf8',
    description: '实体包络清晰，适合表现连续搜索与宽域覆盖。',
  },
  {
    key: 'infrared',
    label: '红外探测圈',
    shortLabel: '红外',
    code: 'IR',
    color: '#fb7185',
    description: '热迹捕捉明显，适合表现被动告警与热源跟踪。',
  },
  {
    key: 'electroOptical',
    label: '光电探测圈',
    shortLabel: '光电',
    code: 'EO',
    color: '#facc15',
    description: '视轴指向感更强，适合表现精瞄观测与窄角搜索。',
  },
  {
    key: 'acoustic',
    label: '声学探测圈',
    shortLabel: '声学',
    code: 'AC',
    color: '#c084fc',
    description: '柔性包络更明显，适合表现低空/低速目标被动监听。',
  },
];

export const detectionSensorTypeMap = Object.fromEntries(detectionSensorTypes.map((item) => [item.key, item]));

export const zoneShapes = [
  { key: 'rectangle', label: '矩形区域' },
  { key: 'polygon', label: '多边形区域' },
];
