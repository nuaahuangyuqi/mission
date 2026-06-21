import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { normalizeImportedPreview } from './import-preview.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const configuredDbFile = String(process.env.MISSION_DB_FILE || '').trim();
const dbFile = configuredDbFile || path.join(path.resolve(__dirname, '../data'), 'mission-demo.sqlite');
const dataDir = path.dirname(dbFile);

function nowText() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function encodeSvgDataUrl(svg) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const demoSources = [
  {
    id: 1,
    name: '侦测数据库镜像',
    type: 'database',
    format: 'SQLite / JSON',
    status: '在线',
    accessMode: 'sample',
    description: '汇聚蓝方侦察、防空、反无等结构化示范情报。',
    updatedAt: '2026-03-12 08:30',
  },
  {
    id: 2,
    name: '无人传感 API',
    type: 'api',
    format: 'REST / JSON',
    status: '在线',
    accessMode: 'sample',
    description: '模拟回传空域巡测、航迹片段与侦测范围。',
    updatedAt: '2026-03-12 08:45',
  },
  {
    id: 3,
    name: '遥感影像分发包',
    type: 'imagery',
    format: 'GeoTIFF / PNG',
    status: '待更新',
    accessMode: 'sample',
    description: '用于专题态势的虚拟影像覆盖层与区域判读。',
    updatedAt: '2026-03-11 18:20',
  },
  {
    id: 4,
    name: '态势简报文本集',
    type: 'text',
    format: 'TXT / Markdown',
    status: '在线',
    accessMode: 'sample',
    description: '用于实体识别、关系抽取与图谱构建的虚构文档。',
    updatedAt: '2026-03-12 07:55',
  },
  {
    id: 5,
    name: '区域气象网格',
    type: 'environment',
    format: 'CSV / JSON',
    status: '在线',
    accessMode: 'sample',
    description: '提供风场、云量、能见度等示范环境数据。',
    updatedAt: '2026-03-12 08:40',
  },
  {
    id: 6,
    name: '人工标注批次 A',
    type: 'manual',
    format: 'JSON',
    status: '已校核',
    accessMode: 'sample',
    description: '用于补充命令线、单位位置与关注点的人工编辑成果。',
    updatedAt: '2026-03-12 09:00',
  },
];

const demoIntelligence = [
  {
    id: 101,
    camp: 'blue',
    category: '侦察',
    name: '蓝方星幕巡测分队',
    role: '空域巡测',
    latitude: 30.289,
    longitude: 120.142,
    strength: 4,
    readiness: '持续运行',
    tags: ['无人侦测', '航迹感知', '示范区域'],
    sourceId: 2,
    notes: '用于演示动态侦测节点，不对应真实装备。',
    updatedAt: '2026-03-12 08:46',
  },
  {
    id: 102,
    camp: 'blue',
    category: '防空',
    name: '蓝方屏障警戒站',
    role: '空情预警',
    latitude: 30.305,
    longitude: 120.213,
    strength: 3,
    readiness: '值守',
    tags: ['预警', '警戒圈'],
    sourceId: 1,
    notes: '与探测范围图层关联，用于可视化演示。',
    updatedAt: '2026-03-12 08:47',
  },
  {
    id: 103,
    camp: 'blue',
    category: '反无',
    name: '蓝方风网干预组',
    role: '低空防护',
    latitude: 30.248,
    longitude: 120.246,
    strength: 2,
    readiness: '待机',
    tags: ['反无', '电子压制'],
    sourceId: 1,
    notes: '用于模拟低空反制示意。',
    updatedAt: '2026-03-12 08:48',
  },
  {
    id: 201,
    camp: 'red',
    category: '人员',
    name: '红方远望机动队',
    role: '地面机动',
    latitude: 30.338,
    longitude: 120.103,
    strength: 6,
    readiness: '集结',
    tags: ['人员', '机动'],
    sourceId: 4,
    notes: '虚构红方人员信息，用于演示管理与更新。',
    updatedAt: '2026-03-12 08:49',
  },
  {
    id: 202,
    camp: 'red',
    category: '装备',
    name: '红方山鹰运载车组',
    role: '装备支援',
    latitude: 30.357,
    longitude: 120.182,
    strength: 5,
    readiness: '机动',
    tags: ['装备', '运载'],
    sourceId: 4,
    notes: '虚构装备节点，用于图谱关联与态势展示。',
    updatedAt: '2026-03-12 08:50',
  },
  {
    id: 203,
    camp: 'red',
    category: '装备',
    name: '红方雾岚通信车',
    role: '通信保障',
    latitude: 30.258,
    longitude: 120.082,
    strength: 1,
    readiness: '待命',
    tags: ['通信', '保障'],
    sourceId: 4,
    notes: '用于演示装备状态与知识图谱节点关系。',
    updatedAt: '2026-03-12 08:51',
  },
];

const demoEnvironment = [
  {
    id: 301,
    kind: 'terrain',
    name: '青岚岛脊线',
    geometryType: 'polygon',
    geometry: [
      [120.12, 30.29],
      [120.16, 30.32],
      [120.21, 30.28],
      [120.17, 30.24],
    ],
    weather: '地形遮蔽明显',
    riskLevel: '中',
    updatedAt: '2026-03-12 08:10',
    notes: '虚构地形区，用于态势叠加。',
    sourceId: 5,
  },
  {
    id: 302,
    kind: 'weather',
    name: '雾带 A1',
    geometryType: 'circle',
    geometry: {
      center: [120.25, 30.26],
      radius: 9000,
    },
    weather: '能见度降低 / 风速 9m/s',
    riskLevel: '高',
    updatedAt: '2026-03-12 08:32',
    notes: '用于演示气象约束圈。',
    sourceId: 5,
  },
  {
    id: 303,
    kind: 'electromagnetic',
    name: '通信盲区 B3',
    geometryType: 'polygon',
    geometry: [
      [120.22, 30.22],
      [120.28, 30.23],
      [120.3, 30.18],
      [120.23, 30.17],
    ],
    weather: '链路不稳定',
    riskLevel: '中',
    updatedAt: '2026-03-12 08:36',
    notes: '用于演示电磁环境影响。',
    sourceId: 5,
  },
];

const demoExtractions = [
  {
    id: 1,
    sourceId: 4,
    title: '态势简报片段 01',
    text: '简报提到“红方远望机动队”与“山鹰运载车组”在青岚岛脊线附近汇合，受雾带 A1 影响机动节奏放缓。',
    summary: '红方远望机动队与山鹰运载车组在青岚岛脊线附近汇合，受到雾带 A1 影响。',
    entities: ['红方远望机动队', '红方山鹰运载车组', '青岚岛脊线', '雾带 A1'],
    relations: ['伴随', '位于', '受影响'],
    createdAt: '2026-03-12 07:56',
  },
  {
    id: 2,
    sourceId: 4,
    title: '态势简报片段 02',
    text: '蓝方屏障警戒站与星幕巡测分队形成空情覆盖，风网干预组在南侧低空走廊待机。',
    summary: '蓝方屏障警戒站、星幕巡测分队和风网干预组形成低空走廊监测协同。',
    entities: ['蓝方屏障警戒站', '蓝方星幕巡测分队', '蓝方风网干预组', '南侧低空走廊'],
    relations: ['协同', '覆盖', '部署'],
    createdAt: '2026-03-12 07:57',
  },
];

const demoSituationEntities = [
  {
    id: 's1',
    name: '蓝方巡测点 Alpha',
    type: 'unit',
    camp: 'blue',
    layerKey: 'units',
    color: '#7dd3fc',
    geometryType: 'point',
    coordinates: [120.142, 30.289],
    radius: null,
    annotation: '蓝方示范单位',
    visible: 1,
  },
  {
    id: 's2',
    name: '蓝方警戒圈',
    type: 'detection',
    camp: 'blue',
    layerKey: 'detection',
    color: '#38bdf8',
    geometryType: 'circle',
    coordinates: [120.213, 30.305],
    radius: 12000,
    annotation: '探测范围演示',
    visible: 1,
  },
  {
    id: 's3',
    name: '红方机动点 Beta',
    type: 'unit',
    camp: 'red',
    layerKey: 'units',
    color: '#f97316',
    geometryType: 'point',
    coordinates: [120.103, 30.338],
    radius: null,
    annotation: '红方示范单位',
    visible: 1,
  },
  {
    id: 's4',
    name: '示范命令线 01',
    type: 'order',
    camp: 'neutral',
    layerKey: 'orders',
    color: '#facc15',
    geometryType: 'polyline',
    coordinates: [
      [120.12, 30.33],
      [120.18, 30.29],
      [120.24, 30.25],
    ],
    radius: null,
    annotation: '作战命令走向演示',
    visible: 1,
  },
  {
    id: 's5',
    name: '虚构关注区',
    type: 'zone',
    camp: 'neutral',
    layerKey: 'symbols',
    color: '#a3e635',
    geometryType: 'polygon',
    coordinates: [
      [120.11, 30.21],
      [120.17, 30.24],
      [120.15, 30.18],
    ],
    radius: null,
    annotation: '用于军标图案融合展示',
    visible: 1,
  },
];

function roundCoordinate(value) {
  return Number(Number(value || 0).toFixed(3));
}

function buildSyntheticTimestamp(index) {
  const day = 12 + Math.floor(index / 48);
  const hour = 8 + (index % 10);
  const minute = (index * 7) % 60;
  return `2026-03-${String(Math.min(day, 28)).padStart(2, '0')} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function createSectorPolygon(longitude, latitude, lonSpan = 0.08, latSpan = 0.06) {
  return [
    [roundCoordinate(longitude - lonSpan), roundCoordinate(latitude - latSpan)],
    [roundCoordinate(longitude + lonSpan * 0.7), roundCoordinate(latitude - latSpan * 0.8)],
    [roundCoordinate(longitude + lonSpan), roundCoordinate(latitude + latSpan * 0.5)],
    [roundCoordinate(longitude - lonSpan * 0.6), roundCoordinate(latitude + latSpan)],
  ];
}

const syntheticOperationalSectors = {
  blue: [
    { key: 'blue-hailan', label: '海岚', areaName: '海岚前沿区', longitude: 119.92, latitude: 30.18 },
    { key: 'blue-yunlu', label: '云麓', areaName: '云麓北场', longitude: 120.46, latitude: 30.92 },
    { key: 'blue-lanwan', label: '岚湾', areaName: '岚湾航道', longitude: 120.74, latitude: 29.88 },
    { key: 'blue-qinglan', label: '青岚', areaName: '青岚要点', longitude: 120.18, latitude: 30.28 },
    { key: 'blue-beiyu', label: '北屿', areaName: '北屿警戒区', longitude: 119.35, latitude: 30.74 },
    { key: 'blue-nanlan', label: '南澜', areaName: '南澜机动区', longitude: 120.98, latitude: 30.46 },
  ],
  red: [
    { key: 'red-chichao', label: '赤潮', areaName: '赤潮突击轴', longitude: 121.58, latitude: 30.34 },
    { key: 'red-duanyue', label: '断岳', areaName: '断岳集结地', longitude: 122.18, latitude: 31.08 },
    { key: 'red-yesun', label: '夜隼', areaName: '夜隼低空带', longitude: 121.82, latitude: 31.56 },
    { key: 'red-wulin', label: '雾鳞', areaName: '雾鳞南场', longitude: 122.62, latitude: 30.62 },
    { key: 'red-cangyan', label: '苍岩', areaName: '苍岩港外海', longitude: 121.26, latitude: 31.26 },
    { key: 'red-xuanfeng', label: '玄锋', areaName: '玄锋机动区', longitude: 122.84, latitude: 31.84 },
  ],
};

const syntheticUnitTemplates = [
  { key: 'tank', name: '主战坦克连', category: '主战单位', role: '地面突击', tags: ['主战', '装甲'], sourceIds: [1, 6], strength: 6, readiness: ['机动', '待命', '训练'] },
  { key: 'mech', name: '机械化步兵连', category: '主战单位', role: '伴随夺控', tags: ['主战', '机步'], sourceIds: [1, 6], strength: 5, readiness: ['机动', '集结', '值守'] },
  { key: 'amphib', name: '两栖突击群', category: '主战单位', role: '滩岸突击', tags: ['主战', '两栖'], sourceIds: [4, 6], strength: 5, readiness: ['机动', '装载', '待命'] },
  { key: 'destroyer', name: '驱逐舰支队', category: '主战单位', role: '远海警戒', tags: ['主战', '海上'], sourceIds: [1, 4], strength: 7, readiness: ['巡航', '值守', '机动'] },
  { key: 'fighter', name: '歼击机编队', category: '主战单位', role: '空域压制', tags: ['主战', '空中'], sourceIds: [2, 4], strength: 6, readiness: ['值班', '升空待命', '轮换'] },
  { key: 'artillery', name: '自行火炮营', category: '火力支援', role: '远程压制', tags: ['火力', '炮兵'], sourceIds: [1, 6], strength: 4, readiness: ['待机', '校射', '机动'] },
  { key: 'airdef', name: '防空警戒连', category: '防空', role: '要点防护', tags: ['防空', '拦截'], sourceIds: [1, 2], strength: 4, readiness: ['值守', '跟踪', '待机'] },
  { key: 'recon', name: '无人侦察分队', category: '侦察', role: '前沿巡察', tags: ['侦察', '无人'], sourceIds: [2, 4], strength: 3, readiness: ['持续运行', '跟踪', '待命'] },
  { key: 'ew', name: '电子对抗组', category: '电子战', role: '电磁压制', tags: ['电子战', '干扰'], sourceIds: [1, 5], strength: 3, readiness: ['待机', '压制', '轮值'] },
  { key: 'supply', name: '综合补给队', category: '保障', role: '持续补给', tags: ['后勤', '保障'], sourceIds: [4, 6], strength: 2, readiness: ['补给', '机动', '待命'] },
];

function generateSyntheticIntelligence() {
  const records = [];
  let nextId = 1001;

  for (const [camp, sectors] of Object.entries(syntheticOperationalSectors)) {
    const campLabel = camp === 'blue' ? '蓝方' : '红方';
    sectors.forEach((sector, sectorIndex) => {
      syntheticUnitTemplates.forEach((template, templateIndex) => {
        const longitudeOffset = ((templateIndex % 5) - 2) * 0.026 + (sectorIndex % 2 === 0 ? 0.004 : -0.004);
        const latitudeOffset = (Math.floor(templateIndex / 5) - 0.5) * 0.032 + (camp === 'blue' ? 0.003 : -0.003);
        const readiness = template.readiness[(sectorIndex + templateIndex) % template.readiness.length];
        records.push({
          id: nextId,
          camp,
          category: template.category,
          name: `${campLabel}${sector.label}${template.name}${String(templateIndex + 1).padStart(2, '0')}`,
          role: template.role,
          latitude: roundCoordinate(sector.latitude + latitudeOffset),
          longitude: roundCoordinate(sector.longitude + longitudeOffset),
          strength: Math.min(9, template.strength + ((sectorIndex + templateIndex) % 3)),
          readiness,
          tags: [...template.tags, sector.key],
          sourceId: template.sourceIds[(sectorIndex + templateIndex) % template.sourceIds.length],
          notes: `${campLabel}${sector.areaName}的虚构${template.name}信息，用于数据源扩容、知识图谱和态势演示。`,
          updatedAt: buildSyntheticTimestamp(nextId - 1000),
        });
        nextId += 1;
      });
    });
  }

  return records;
}

function generateSyntheticEnvironment() {
  const records = [];
  let nextId = 401;
  const allSectors = [...syntheticOperationalSectors.blue, ...syntheticOperationalSectors.red];

  allSectors.forEach((sector, index) => {
    records.push({
      id: nextId,
      kind: 'weather',
      name: `${sector.areaName}气象扰动区`,
      geometryType: 'circle',
      geometry: {
        center: [roundCoordinate(sector.longitude), roundCoordinate(sector.latitude)],
        radius: 14000 + ((index % 3) * 2500),
      },
      weather: ['强侧风 / 中能见度', '低云 / 中低能见度', '阵雨 / 机动受限'][index % 3],
      riskLevel: index % 3 === 0 ? '高' : '中',
      updatedAt: buildSyntheticTimestamp(200 + index),
      notes: `围绕${sector.areaName}生成的虚构气象圈，用于表现主战单位受天气影响的关联关系。`,
      sourceId: 5,
    });
    nextId += 1;
  });

  allSectors.slice(0, 6).forEach((sector, index) => {
    const kind = index % 2 === 0 ? 'terrain' : 'electromagnetic';
    records.push({
      id: nextId,
      kind,
      name: kind === 'terrain' ? `${sector.areaName}地形遮蔽区` : `${sector.areaName}电磁压制区`,
      geometryType: 'polygon',
      geometry: createSectorPolygon(sector.longitude, sector.latitude, 0.085 + (index * 0.004), 0.055 + (index * 0.003)),
      weather: kind === 'terrain' ? '高差明显 / 观察受限' : '链路抖动 / 频段拥塞',
      riskLevel: kind === 'terrain' ? '中' : '高',
      updatedAt: buildSyntheticTimestamp(260 + index),
      notes: kind === 'terrain'
        ? `围绕${sector.areaName}生成的虚构地形区，用于增强环境关联节点。`
        : `围绕${sector.areaName}生成的虚构电磁区，用于增强环境约束关系。`,
      sourceId: 5,
    });
    nextId += 1;
  });

  return records;
}

function generateSyntheticExtractions(intelligenceRecords, environmentRecords) {
  const blueMain = intelligenceRecords.filter((item) => item.camp === 'blue' && item.category === '主战单位');
  const redMain = intelligenceRecords.filter((item) => item.camp === 'red' && item.category === '主战单位');
  const supportUnits = intelligenceRecords.filter((item) => item.category !== '主战单位');
  const records = [];
  let nextId = 1001;

  for (let index = 0; index < 24; index += 1) {
    const blueUnit = blueMain[index % blueMain.length];
    const redUnit = redMain[(index * 2) % redMain.length];
    const supportUnit = supportUnits[(index * 3) % supportUnits.length];
    const environment = environmentRecords[index % environmentRecords.length];
    const text = index % 2 === 0
      ? `${blueUnit.name} 在 ${environment.name} 北缘保持 ${blueUnit.readiness}，与 ${supportUnit.name} 形成协同支撑；系统持续关注 ${redUnit.name} 的 ${redUnit.role} 动向。`
      : `${redUnit.name} 进入 ${environment.name} 邻近区域后，${blueUnit.name} 与 ${supportUnit.name} 调整部署节奏，并评估其对位接触概率。`;

    records.push({
      id: nextId,
      sourceId: 4,
      title: `自动简报片段 ${index + 1}`,
      text,
      summary: text,
      entities: [blueUnit.name, supportUnit.name, redUnit.name, environment.name],
      relations: ['协同', '受环境影响', '对位关注'],
      createdAt: buildSyntheticTimestamp(index + 16),
    });
    nextId += 1;
  }

  return records;
}

const generatedDemoIntelligence = generateSyntheticIntelligence();
const generatedDemoEnvironment = generateSyntheticEnvironment();
const generatedDemoExtractions = generateSyntheticExtractions(generatedDemoIntelligence, generatedDemoEnvironment);

demoIntelligence.push(...generatedDemoIntelligence);
demoEnvironment.push(...generatedDemoEnvironment);
demoExtractions.push(...generatedDemoExtractions);

const demoSourceContents = {
  1: {
    previewType: 'table',
    payload: {
      columns: ['单位', '类别', '状态', '定位', '来源'],
      rows: demoIntelligence
        .filter((item) => item.category === '主战单位')
        .slice(0, 8)
        .map((item) => [
          item.name,
          item.category,
          item.readiness,
          `${Number(item.longitude).toFixed(3)} / ${Number(item.latitude).toFixed(3)}`,
          demoSources.find((source) => source.id === item.sourceId)?.name || '示范源',
        ]),
    },
  },
  2: {
    previewType: 'json',
    payload: {
      endpoint: '/mock/sensors/feed',
      lastFetch: '2026-03-13 09:20',
      sample: {
        tracks: [
          { id: 'T-01', altitude: 2200, speed: 165, heading: 72 },
          { id: 'T-02', altitude: 800, speed: 92, heading: 134 },
        ],
        coverage: ['北向巡测走廊', '南侧低空走廊'],
        status: '正常',
        inventory: {
          totalUnits: demoIntelligence.length,
          blueUnits: demoIntelligence.filter((item) => item.camp === 'blue').length,
          redUnits: demoIntelligence.filter((item) => item.camp === 'red').length,
          mainBattleUnits: demoIntelligence.filter((item) => item.category === '主战单位').length,
        },
      },
    },
  },
  3: {
    previewType: 'image',
    payload: {
      title: '虚构遥感快视图',
      description: '用于学习演示的伪彩色遥感影像，不对应真实地区。',
      imageUrl: encodeSvgDataUrl(`
        <svg xmlns="http://www.w3.org/2000/svg" width="720" height="420" viewBox="0 0 720 420">
          <defs>
            <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stop-color="#0f172a" />
              <stop offset="100%" stop-color="#334155" />
            </linearGradient>
          </defs>
          <rect width="720" height="420" fill="url(#bg)"/>
          <ellipse cx="220" cy="160" rx="160" ry="90" fill="#86efac" fill-opacity="0.28"/>
          <ellipse cx="480" cy="240" rx="190" ry="100" fill="#38bdf8" fill-opacity="0.24"/>
          <path d="M80 320 C 180 250, 220 250, 320 320 S 500 390, 640 280" fill="none" stroke="#facc15" stroke-width="6" stroke-dasharray="10 8"/>
          <circle cx="370" cy="180" r="48" fill="#f97316" fill-opacity="0.38" stroke="#fdba74" stroke-width="4"/>
          <text x="42" y="52" font-size="28" fill="#f8fafc" font-family="Segoe UI, Microsoft YaHei">遥感影像演示图层</text>
          <text x="42" y="90" font-size="18" fill="#cbd5e1" font-family="Segoe UI, Microsoft YaHei">伪彩色区块 / 热点目标 / 机动走廊</text>
        </svg>
      `),
    },
  },
  4: {
    previewType: 'text',
    payload: {
      title: '虚构态势简报',
      content: `当前示例库已注入 ${demoIntelligence.length} 条单位数据、${demoEnvironment.length} 条环境记录与 ${demoExtractions.length} 条简报文本；其中包含红蓝双方主战坦克连、驱逐舰支队、歼击机编队、防空警戒连、电子对抗组与综合补给队等虚拟主战/支援单位信息，可用于知识图谱关联演示。`,
    },
  },
  5: {
    previewType: 'table',
    payload: {
      columns: ['区域', '风速', '云量', '能见度', '风险'],
      rows: demoEnvironment.slice(0, 8).map((item) => [
        item.name,
        item.kind === 'weather' ? '7-11m/s' : '4-6m/s',
        item.kind === 'terrain' ? '低' : '中',
        /高/.test(item.riskLevel) ? '低' : '中',
        item.riskLevel,
      ]),
    },
  },
  6: {
    previewType: 'json',
    payload: {
      batch: 'Manual-A',
      author: '示范标注员',
      objects: ['命令线 01', '蓝方巡测点 Alpha', '虚构关注区'],
      status: '已校核',
    },
  },
};

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function serialize(value) {
  return JSON.stringify(value);
}

function deserialize(value, fallback = null) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function ensureColumn(db, table, name, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((item) => item.name);
  if (!columns.includes(name)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  }
}

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0];
    const yi = polygon[i][1];
    const xj = polygon[j][0];
    const yj = polygon[j][1];
    const intersect = yi > point[1] !== yj > point[1]
      && point[0] < ((xj - xi) * (point[1] - yi)) / ((yj - yi) || 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function haversineDistanceKm(pointA, pointB) {
  const toRad = (value) => (value * Math.PI) / 180;
  const earthRadius = 6371;
  const dLat = toRad(pointB[1] - pointA[1]);
  const dLon = toRad(pointB[0] - pointA[0]);
  const lat1 = toRad(pointA[1]);
  const lat2 = toRad(pointB[1]);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const value = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  return earthRadius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function clipText(text = '', maxLength = 220) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

function uniqueList(values = []) {
  return [...new Set(values.map((item) => String(item || '').trim()).filter(Boolean))];
}

function extractEntityCandidates(text = '') {
  const candidates = [];
  const patterns = [
    /[“"《]([^”"》]{2,24})[”"》]/g,
    /(?:蓝方|红方|中立)?[\u4e00-\u9fa5A-Za-z0-9-]{1,20}(?:分队|编队|机动队|车组|警戒站|干预组|巡测分队|支队|走廊|脊线|高地|岛|区|线|点|网|阵地|平台|站|组|队|营|连|旅|舰|船|机|车|库|海域|节点)/g,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value = String(match[1] || match[0] || '').trim();
      if (value.length >= 2) {
        candidates.push(value);
      }
    }
  }

  return uniqueList(candidates);
}

function inferExtractionRelations(text = '') {
  const rules = [
    { label: '协同', pattern: /协同|配合|联动|联合|协作/ },
    { label: '部署', pattern: /部署|驻留|驻守|待机|集结|位于/ },
    { label: '受影响', pattern: /影响|受.*影响|干扰|受限/ },
    { label: '监测', pattern: /监测|监控|侦测|预警|覆盖|巡测/ },
    { label: '汇合', pattern: /汇合|会合|连接|接入/ },
    { label: '对位关注', pattern: /对位|关注|跟踪|接触|锁定/ },
  ];

  const matched = rules.filter((item) => item.pattern.test(text)).map((item) => item.label);
  return matched.length ? matched : ['关联'];
}

function buildExtractionSummary(text = '', fallback = '提取到关键内容') {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return fallback;
  }

  const fragments = normalized
    .split(/[。！？!?；;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
  return clipText((fragments.slice(0, 2).join('；') || normalized), 140);
}

function getKnownExtractionNames(db) {
  const names = [
    ...db.prepare('SELECT name FROM intelligence').all().map((item) => item.name),
    ...db.prepare('SELECT name FROM environment').all().map((item) => item.name),
    ...db.prepare('SELECT name FROM sources').all().map((item) => item.name),
  ];
  return uniqueList(names).sort((left, right) => right.length - left.length);
}

function buildImportedExtractionDrafts(db, sourceName, drafts = []) {
  const knownNames = getKnownExtractionNames(db);

  return drafts
    .map((draft) => {
      const text = String(draft?.text || '').replace(/\s+/g, ' ').trim();
      if (!text) return null;

      const entities = uniqueList([
        ...knownNames.filter((name) => text.includes(name)),
        ...extractEntityCandidates(text),
      ]).slice(0, 8);

      return {
        title: draft?.title || sourceName,
        text,
        summary: buildExtractionSummary(draft?.summary || text, `${sourceName} 关键内容`),
        entities,
        relations: inferExtractionRelations(text).slice(0, 4),
        sourceType: String(draft?.sourceType || 'resource-extraction').trim() || 'resource-extraction',
        sourceName: String(draft?.sourceName || sourceName).trim() || sourceName,
        fileName: String(draft?.fileName || '').trim(),
        extractedAt: String(draft?.extractedAt || '').trim(),
        evidenceMeta: draft?.evidenceMeta && typeof draft.evidenceMeta === 'object'
          ? draft.evidenceMeta
          : {},
      };
    })
    .filter(Boolean);
}

async function normalizeSourcePreview(type, body) {
  const fileName = body.fileName || '';
  const description = body.description || '';
  const textContent = (body.textContent || '').trim();
  const endpointUrl = (body.endpointUrl || '').trim();
  const imageDataUrl = body.imageDataUrl || '';
  const officePreview = await normalizeImportedPreview(type, body);

  if (officePreview) {
    return officePreview;
  }

  if (type === 'database') {
    const parsed = deserialize(textContent, null);
    if (Array.isArray(parsed) && parsed.length) {
      const columns = Object.keys(parsed[0]);
      const rows = parsed.map((item) => columns.map((column) => String(item[column] ?? '')));
      return {
        previewType: 'table',
        payload: { columns, rows, fileName, description },
        extractionDrafts: [],
      };
    }

    if (textContent.includes(',')) {
      const lines = textContent.split(/\r?\n/).filter(Boolean);
      const columns = (lines[0] || '').split(',').map((item) => item.trim());
      const rows = lines.slice(1).map((line) => line.split(',').map((item) => item.trim()));
      return {
        previewType: 'table',
        payload: { columns, rows, fileName, description },
        extractionDrafts: [],
      };
    }

    return {
      previewType: 'text',
      payload: {
        title: fileName || '数据库载入说明',
        content: textContent || '未提供数据库快照内容，可通过 JSON / CSV 文本作为演示数据导入。',
      },
      extractionDrafts: [],
    };
  }

  if (type === 'api') {
    return {
      previewType: 'json',
      payload: {
        endpoint: endpointUrl || '/custom/api',
        description,
        sample: deserialize(textContent, { raw: textContent || '未提供接口样本' }),
      },
      extractionDrafts: textContent
        ? [{
            title: fileName || body.name || 'API 样例',
            text: textContent,
            summary: buildExtractionSummary(textContent, '已导入 API 样例内容'),
            sourceType: 'api-sample',
            sourceName: body.name || fileName || 'API 样例',
            fileName,
          }]
        : [],
    };
  }

  if (type === 'imagery') {
    return {
      previewType: 'image',
      payload: {
        title: fileName || body.name || '遥感影像导入',
        description: description || '本影像为本地导入的学习演示图层。',
        imageUrl: imageDataUrl || demoSourceContents[3].payload.imageUrl,
      },
      extractionDrafts: [],
    };
  }

  if (type === 'text') {
    return {
      previewType: 'text',
      payload: {
        title: fileName || body.name || '文本文件导入',
        content: textContent || '未提供文本内容。',
      },
      extractionDrafts: textContent
        ? [{
            title: fileName || body.name || '文本文件',
            text: textContent,
            summary: buildExtractionSummary(textContent, '已导入文本内容'),
            sourceType: 'text-snippet',
            sourceName: body.name || fileName || '文本文件',
            fileName,
          }]
        : [],
    };
  }

  return {
    previewType: 'json',
    payload: deserialize(textContent, { raw: textContent || '未提供可解析内容' }),
    extractionDrafts: [],
  };
}

function syncDemoGeography(db) {
  const updateIntel = db.prepare('UPDATE intelligence SET latitude = ?, longitude = ?, tags = ?, updated_at = ? WHERE id = ?');
  for (const item of demoIntelligence) {
    const current = db.prepare('SELECT longitude FROM intelligence WHERE id = ?').get(item.id);
    if (current && Number(current.longitude) > 140) {
      updateIntel.run(item.latitude, item.longitude, serialize(item.tags), item.updatedAt, item.id);
    }
  }

  const updateEnvironment = db.prepare('UPDATE environment SET geometry = ?, updated_at = ? WHERE id = ?');
  for (const item of demoEnvironment) {
    const current = db.prepare('SELECT geometry FROM environment WHERE id = ?').get(item.id);
    const geometry = deserialize(current?.geometry, null);
    const samplePoint = Array.isArray(geometry) ? geometry[0] : geometry?.center;
    if (samplePoint && Number(samplePoint[0]) > 140) {
      updateEnvironment.run(serialize(item.geometry), item.updatedAt, item.id);
    }
  }

  const updateSituation = db.prepare('UPDATE situation_entities SET coordinates = ?, radius = ? WHERE id = ?');
  for (const item of demoSituationEntities) {
    const current = db.prepare('SELECT coordinates FROM situation_entities WHERE id = ?').get(item.id);
    const coordinates = deserialize(current?.coordinates, null);
    const samplePoint = Array.isArray(coordinates?.[0]) ? coordinates[0] : coordinates;
    if (samplePoint && Number(samplePoint[0]) > 140) {
      updateSituation.run(serialize(item.coordinates), item.radius, item.id);
    }
  }

  const preview = db.prepare('SELECT payload FROM source_contents WHERE source_id = 1').get();
  if (preview && String(preview.payload).includes('148.35 / 18.62')) {
    db.prepare('UPDATE source_contents SET payload = ?, created_at = ? WHERE source_id = 1').run(
      serialize(demoSourceContents[1].payload),
      nowText(),
    );
  }
}

export function createDatabase() {
  ensureDir(dataDir);
  const db = new DatabaseSync(dbFile);

  db.exec(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS sources (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      format TEXT NOT NULL,
      status TEXT NOT NULL,
      description TEXT,
      updated_at TEXT NOT NULL,
      preview_type TEXT DEFAULT 'json',
      access_mode TEXT DEFAULT 'sample',
      task_id INTEGER
    );

    CREATE TABLE IF NOT EXISTS source_contents (
      source_id INTEGER PRIMARY KEY,
      preview_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (source_id) REFERENCES sources(id)
    );

    CREATE TABLE IF NOT EXISTS intelligence (
      id INTEGER PRIMARY KEY,
      camp TEXT NOT NULL,
      category TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      strength INTEGER NOT NULL,
      readiness TEXT NOT NULL,
      tags TEXT NOT NULL,
      source_id INTEGER NOT NULL,
      notes TEXT,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (source_id) REFERENCES sources(id)
    );

    CREATE TABLE IF NOT EXISTS environment (
      id INTEGER PRIMARY KEY,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      geometry_type TEXT NOT NULL,
      geometry TEXT NOT NULL,
      weather TEXT NOT NULL,
      risk_level TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      notes TEXT,
      source_id INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS extractions (
      id INTEGER PRIMARY KEY,
      source_id INTEGER,
      title TEXT DEFAULT '',
      text_content TEXT NOT NULL,
      summary TEXT DEFAULT '',
      entities TEXT NOT NULL,
      relations TEXT NOT NULL,
      created_at TEXT DEFAULT '',
      source_type TEXT NOT NULL DEFAULT 'resource-extraction',
      source_name TEXT NOT NULL DEFAULT '',
      file_name TEXT NOT NULL DEFAULT '',
      task_id INTEGER,
      evidence_meta TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY (source_id) REFERENCES sources(id)
    );

    CREATE TABLE IF NOT EXISTS import_batches (
      id INTEGER PRIMARY KEY,
      batch_key TEXT NOT NULL UNIQUE,
      task_id INTEGER,
      created_by_user_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      total_count INTEGER NOT NULL DEFAULT 0,
      succeeded_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS import_batch_items (
      id INTEGER PRIMARY KEY,
      batch_id INTEGER NOT NULL,
      item_index INTEGER NOT NULL DEFAULT 0,
      task_id INTEGER,
      source_name TEXT NOT NULL DEFAULT '',
      source_type TEXT NOT NULL DEFAULT '',
      file_name TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      attempt_count INTEGER NOT NULL DEFAULT 0,
      failure_reason TEXT NOT NULL DEFAULT '',
      source_id INTEGER,
      request_payload TEXT NOT NULL DEFAULT '{}',
      result_payload TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (batch_id) REFERENCES import_batches(id),
      FOREIGN KEY (source_id) REFERENCES sources(id)
    );

    CREATE TABLE IF NOT EXISTS graph_nodes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      camp TEXT NOT NULL,
      score INTEGER NOT NULL,
      summary TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS graph_edges (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      target TEXT NOT NULL,
      relation TEXT NOT NULL,
      confidence REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS situation_entities (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      camp TEXT NOT NULL,
      layer_key TEXT NOT NULL,
      color TEXT NOT NULL,
      geometry_type TEXT NOT NULL,
      coordinates TEXT NOT NULL,
      radius REAL,
      annotation TEXT,
      visible INTEGER NOT NULL DEFAULT 1,
      meta TEXT DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      module_key TEXT NOT NULL DEFAULT 'planning',
      planning_template_id TEXT NOT NULL DEFAULT 'fire-strike-task',
      planning_assessment_name TEXT NOT NULL DEFAULT '',
      planning_stage_key TEXT NOT NULL DEFAULT 'library',
      planning_task_definition TEXT NOT NULL DEFAULT '{}',
      planning_bindings TEXT NOT NULL DEFAULT '{}',
      planning_algorithm_inputs TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'draft',
      description TEXT NOT NULL DEFAULT '',
      owner_user_id INTEGER NOT NULL,
      shared_context TEXT NOT NULL DEFAULT '{}',
      latest_run_id INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS task_runs (
      id INTEGER PRIMARY KEY,
      task_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'succeeded',
      summary TEXT NOT NULL DEFAULT '{}',
      error_code TEXT NOT NULL DEFAULT '',
      error_message TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    );

    CREATE TABLE IF NOT EXISTS task_results (
      id INTEGER PRIMARY KEY,
      task_id INTEGER NOT NULL,
      run_id INTEGER NOT NULL UNIQUE,
      result_payload TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id),
      FOREIGN KEY (run_id) REFERENCES task_runs(id)
    );

    CREATE TABLE IF NOT EXISTS planning_realtime_artifacts (
      id INTEGER PRIMARY KEY,
      owner_user_id INTEGER NOT NULL,
      task_id INTEGER NOT NULL,
      task_name TEXT NOT NULL DEFAULT '',
      display_name TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      algorithm_id TEXT NOT NULL DEFAULT '',
      algorithm_name TEXT NOT NULL DEFAULT '',
      step_id TEXT NOT NULL DEFAULT '',
      step_name TEXT NOT NULL DEFAULT '',
      binding_id TEXT NOT NULL DEFAULT '',
      binding_name TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'succeeded',
      input_artifact_ids TEXT NOT NULL DEFAULT '[]',
      result_payload TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    );

    CREATE TABLE IF NOT EXISTS task_attachments (
      id INTEGER PRIMARY KEY,
      task_id INTEGER NOT NULL,
      algorithm_id TEXT NOT NULL DEFAULT '',
      file_id TEXT NOT NULL DEFAULT '',
      file_name TEXT NOT NULL DEFAULT '',
      file_payload TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    );

    CREATE TABLE IF NOT EXISTS algorithm_call_logs (
      id INTEGER PRIMARY KEY,
      module_key TEXT NOT NULL DEFAULT '',
      assessment_name TEXT NOT NULL DEFAULT '',
      task_id INTEGER,
      task_run_id INTEGER,
      algorithm_key TEXT NOT NULL DEFAULT '',
      algorithm_name TEXT NOT NULL DEFAULT '',
      engine_key TEXT NOT NULL DEFAULT '',
      engine_source TEXT NOT NULL DEFAULT '',
      engine_runtime TEXT NOT NULL DEFAULT '',
      engine_version TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'succeeded',
      http_status INTEGER,
      duration_ms INTEGER,
      request_id TEXT NOT NULL DEFAULT '',
      error_code TEXT NOT NULL DEFAULT '',
      error_message TEXT NOT NULL DEFAULT '',
      request_payload TEXT NOT NULL DEFAULT '',
      response_payload TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT ''
    );
  `);

  ensureColumn(db, 'sources', 'preview_type', "preview_type TEXT DEFAULT 'json'");
  ensureColumn(db, 'sources', 'access_mode', "access_mode TEXT DEFAULT 'sample'");
  ensureColumn(db, 'sources', 'task_id', 'task_id INTEGER');
  ensureColumn(db, 'intelligence', 'updated_at', "updated_at TEXT DEFAULT ''");
  ensureColumn(db, 'environment', 'source_id', "source_id INTEGER DEFAULT 1");
  ensureColumn(db, 'situation_entities', 'meta', "meta TEXT DEFAULT '{}'");
  ensureColumn(db, 'extractions', 'source_id', 'source_id INTEGER');
  ensureColumn(db, 'extractions', 'title', "title TEXT DEFAULT ''");
  ensureColumn(db, 'extractions', 'summary', "summary TEXT DEFAULT ''");
  ensureColumn(db, 'extractions', 'created_at', "created_at TEXT DEFAULT ''");
  ensureColumn(db, 'extractions', 'source_type', "source_type TEXT NOT NULL DEFAULT 'resource-extraction'");
  ensureColumn(db, 'extractions', 'source_name', "source_name TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'extractions', 'file_name', "file_name TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'extractions', 'task_id', 'task_id INTEGER');
  ensureColumn(db, 'extractions', 'evidence_meta', "evidence_meta TEXT NOT NULL DEFAULT '{}'");
  ensureColumn(db, 'tasks', 'planning_template_id', "planning_template_id TEXT NOT NULL DEFAULT 'fire-strike-task'");
  ensureColumn(db, 'tasks', 'planning_assessment_name', "planning_assessment_name TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'tasks', 'planning_stage_key', "planning_stage_key TEXT NOT NULL DEFAULT 'library'");
  ensureColumn(db, 'tasks', 'planning_task_definition', "planning_task_definition TEXT NOT NULL DEFAULT '{}'");
  ensureColumn(db, 'tasks', 'planning_bindings', "planning_bindings TEXT NOT NULL DEFAULT '{}'");
  ensureColumn(db, 'tasks', 'planning_algorithm_inputs', "planning_algorithm_inputs TEXT NOT NULL DEFAULT '{}'");
  ensureColumn(db, 'tasks', 'status', "status TEXT NOT NULL DEFAULT 'draft'");
  ensureColumn(db, 'tasks', 'description', "description TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'tasks', 'module_key', "module_key TEXT NOT NULL DEFAULT 'planning'");
  ensureColumn(db, 'tasks', 'owner_user_id', 'owner_user_id INTEGER NOT NULL DEFAULT 1');
  ensureColumn(db, 'tasks', 'shared_context', "shared_context TEXT NOT NULL DEFAULT '{}'");
  ensureColumn(db, 'tasks', 'latest_run_id', 'latest_run_id INTEGER');
  ensureColumn(db, 'tasks', 'created_at', "created_at TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'tasks', 'updated_at', "updated_at TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'task_runs', 'status', "status TEXT NOT NULL DEFAULT 'succeeded'");
  ensureColumn(db, 'task_runs', 'summary', "summary TEXT NOT NULL DEFAULT '{}'");
  ensureColumn(db, 'task_runs', 'error_code', "error_code TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'task_runs', 'error_message', "error_message TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'task_runs', 'created_at', "created_at TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'planning_realtime_artifacts', 'owner_user_id', 'owner_user_id INTEGER NOT NULL DEFAULT 1');
  ensureColumn(db, 'planning_realtime_artifacts', 'task_id', 'task_id INTEGER NOT NULL DEFAULT 1');
  ensureColumn(db, 'planning_realtime_artifacts', 'task_name', "task_name TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'planning_realtime_artifacts', 'display_name', "display_name TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'planning_realtime_artifacts', 'description', "description TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'planning_realtime_artifacts', 'algorithm_id', "algorithm_id TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'planning_realtime_artifacts', 'algorithm_name', "algorithm_name TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'planning_realtime_artifacts', 'step_id', "step_id TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'planning_realtime_artifacts', 'step_name', "step_name TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'planning_realtime_artifacts', 'binding_id', "binding_id TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'planning_realtime_artifacts', 'binding_name', "binding_name TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'planning_realtime_artifacts', 'status', "status TEXT NOT NULL DEFAULT 'succeeded'");
  ensureColumn(db, 'planning_realtime_artifacts', 'input_artifact_ids', "input_artifact_ids TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, 'planning_realtime_artifacts', 'result_payload', "result_payload TEXT NOT NULL DEFAULT '{}'");
  ensureColumn(db, 'planning_realtime_artifacts', 'created_at', "created_at TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'planning_realtime_artifacts', 'updated_at', "updated_at TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'task_attachments', 'algorithm_id', "algorithm_id TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'task_attachments', 'file_id', "file_id TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'task_attachments', 'file_name', "file_name TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'task_attachments', 'file_payload', "file_payload TEXT NOT NULL DEFAULT '{}'");
  ensureColumn(db, 'task_attachments', 'created_at', "created_at TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'algorithm_call_logs', 'module_key', "module_key TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'algorithm_call_logs', 'assessment_name', "assessment_name TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'algorithm_call_logs', 'task_id', 'task_id INTEGER');
  ensureColumn(db, 'algorithm_call_logs', 'task_run_id', 'task_run_id INTEGER');
  ensureColumn(db, 'algorithm_call_logs', 'algorithm_key', "algorithm_key TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'algorithm_call_logs', 'algorithm_name', "algorithm_name TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'algorithm_call_logs', 'engine_key', "engine_key TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'algorithm_call_logs', 'engine_source', "engine_source TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'algorithm_call_logs', 'engine_runtime', "engine_runtime TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'algorithm_call_logs', 'engine_version', "engine_version TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'algorithm_call_logs', 'status', "status TEXT NOT NULL DEFAULT 'succeeded'");
  ensureColumn(db, 'algorithm_call_logs', 'http_status', 'http_status INTEGER');
  ensureColumn(db, 'algorithm_call_logs', 'duration_ms', 'duration_ms INTEGER');
  ensureColumn(db, 'algorithm_call_logs', 'request_id', "request_id TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'algorithm_call_logs', 'error_code', "error_code TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'algorithm_call_logs', 'error_message', "error_message TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'algorithm_call_logs', 'request_payload', "request_payload TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'algorithm_call_logs', 'response_payload', "response_payload TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'algorithm_call_logs', 'created_at', "created_at TEXT NOT NULL DEFAULT ''");
  db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_owner_updated ON tasks(owner_user_id, updated_at DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_status_updated ON tasks(status, updated_at DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_sources_task_updated ON sources(task_id, updated_at DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_extractions_source_created ON extractions(source_id, created_at DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_extractions_task_created ON extractions(task_id, created_at DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_task_runs_task_created ON task_runs(task_id, created_at DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_task_results_task_created ON task_results(task_id, created_at DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_task_results_run ON task_results(run_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_planning_realtime_owner_updated ON planning_realtime_artifacts(owner_user_id, updated_at DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_planning_realtime_owner_task_updated ON planning_realtime_artifacts(owner_user_id, task_id, updated_at DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_planning_realtime_owner_algorithm_updated ON planning_realtime_artifacts(owner_user_id, algorithm_id, updated_at DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_task_attachments_task_created ON task_attachments(task_id, created_at DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_task_attachments_task_algorithm ON task_attachments(task_id, algorithm_id)');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_task_attachments_task_algorithm_file ON task_attachments(task_id, algorithm_id, file_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_import_batches_updated ON import_batches(updated_at DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_import_batches_task_updated ON import_batches(task_id, updated_at DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_import_batch_items_batch_index ON import_batch_items(batch_id, item_index)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_import_batch_items_status_updated ON import_batch_items(status, updated_at DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_import_batch_items_task_updated ON import_batch_items(task_id, updated_at DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_algorithm_call_logs_module_created ON algorithm_call_logs(module_key, created_at DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_algorithm_call_logs_status_created ON algorithm_call_logs(status, created_at DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_algorithm_call_logs_task_run ON algorithm_call_logs(task_run_id)');
  db.prepare("UPDATE environment SET source_id = 1 WHERE source_id IS NULL").run();

  {
    const upsert = db.prepare('INSERT OR IGNORE INTO sources (id, name, type, format, status, description, updated_at, preview_type, access_mode) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const item of demoSources) {
      const previewType = demoSourceContents[item.id]?.previewType || 'json';
      upsert.run(item.id, item.name, item.type, item.format, item.status, item.description, item.updatedAt, previewType, item.accessMode);
    }
  }

  const insertContent = db.prepare('INSERT OR IGNORE INTO source_contents (source_id, preview_type, payload, created_at) VALUES (?, ?, ?, ?)');
  for (const [sourceId, content] of Object.entries(demoSourceContents)) {
    insertContent.run(Number(sourceId), content.previewType, serialize(content.payload), nowText());
  }

  {
    const upsert = db.prepare('INSERT OR IGNORE INTO intelligence (id, camp, category, name, role, latitude, longitude, strength, readiness, tags, source_id, notes, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const item of demoIntelligence) {
      upsert.run(item.id, item.camp, item.category, item.name, item.role, item.latitude, item.longitude, item.strength, item.readiness, serialize(item.tags), item.sourceId, item.notes, item.updatedAt);
    }
  }

  {
    const upsert = db.prepare('INSERT OR IGNORE INTO environment (id, kind, name, geometry_type, geometry, weather, risk_level, updated_at, notes, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const item of demoEnvironment) {
      upsert.run(item.id, item.kind, item.name, item.geometryType, serialize(item.geometry), item.weather, item.riskLevel, item.updatedAt, item.notes, item.sourceId || 1);
    }
  }

  {
    const upsert = db.prepare('INSERT OR IGNORE INTO extractions (id, source_id, title, text_content, summary, entities, relations, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    for (const item of demoExtractions) {
      upsert.run(
        item.id,
        item.sourceId || null,
        item.title || '',
        item.text,
        item.summary || item.text,
        serialize(item.entities),
        serialize(item.relations),
        item.createdAt || nowText(),
      );
    }
  }

  if (db.prepare('SELECT COUNT(*) AS count FROM situation_entities').get().count === 0) {
    const insert = db.prepare('INSERT INTO situation_entities (id, name, type, camp, layer_key, color, geometry_type, coordinates, radius, annotation, visible, meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const item of demoSituationEntities) {
      insert.run(item.id, item.name, item.type, item.camp, item.layerKey, item.color, item.geometryType, serialize(item.coordinates), item.radius, item.annotation, item.visible, serialize(item.meta || {}));
    }
  }

  syncDemoGeography(db);

  return db;
}

export function mapSource(row) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    format: row.format,
    status: row.status,
    description: row.description,
    updatedAt: row.updated_at,
    previewType: row.preview_type,
    accessMode: row.access_mode,
    taskId: row.task_id ?? null,
  };
}

export function mapSourcePreview(row) {
  return {
    sourceId: row.source_id,
    previewType: row.preview_type,
    payload: deserialize(row.payload, {}),
    createdAt: row.created_at,
  };
}

export function mapIntelligence(row) {
  return {
    id: row.id,
    camp: row.camp,
    category: row.category,
    name: row.name,
    role: row.role,
    latitude: row.latitude,
    longitude: row.longitude,
    strength: row.strength,
    readiness: row.readiness,
    tags: deserialize(row.tags, []),
    sourceId: row.source_id,
    notes: row.notes,
    updatedAt: row.updated_at,
  };
}

export function mapEnvironment(row) {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    geometryType: row.geometry_type,
    geometry: deserialize(row.geometry, {}),
    weather: row.weather,
    riskLevel: row.risk_level,
    updatedAt: row.updated_at,
    notes: row.notes,
    sourceId: row.source_id ?? 1,
  };
}

export function mapExtraction(row) {
  return {
    id: row.id,
    sourceId: row.source_id ?? null,
    title: row.title || '',
    text: row.text_content,
    summary: row.summary || '',
    entities: deserialize(row.entities, []),
    relations: deserialize(row.relations, []),
    createdAt: row.created_at || '',
    sourceType: row.source_type || 'resource-extraction',
    sourceName: row.source_name || '',
    fileName: row.file_name || '',
    taskId: row.task_id ?? null,
    evidenceMeta: deserialize(row.evidence_meta, {}),
  };
}

export function mapImportBatch(row) {
  return {
    id: row.id,
    batchKey: row.batch_key,
    taskId: row.task_id ?? null,
    createdByUserId: row.created_by_user_id,
    status: row.status || 'running',
    totalCount: Number(row.total_count || 0),
    succeededCount: Number(row.succeeded_count || 0),
    failedCount: Number(row.failed_count || 0),
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
  };
}

export function mapImportBatchItem(row) {
  return {
    id: row.id,
    batchId: row.batch_id,
    itemIndex: Number(row.item_index || 0),
    taskId: row.task_id ?? null,
    sourceName: row.source_name || '',
    sourceType: row.source_type || '',
    fileName: row.file_name || '',
    status: row.status || 'pending',
    attemptCount: Number(row.attempt_count || 0),
    failureReason: row.failure_reason || '',
    sourceId: row.source_id ?? null,
    requestPayload: deserialize(row.request_payload, {}),
    resultPayload: deserialize(row.result_payload, {}),
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
  };
}

export function mapSituationEntity(row) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    camp: row.camp,
    layerKey: row.layer_key,
    color: row.color,
    geometryType: row.geometry_type,
    coordinates: deserialize(row.coordinates, []),
    radius: row.radius,
    annotation: row.annotation,
    visible: Boolean(row.visible),
    meta: deserialize(row.meta, {}),
  };
}

export function mapTask(row) {
  return {
    id: row.id,
    name: row.name,
    moduleKey: row.module_key || 'planning',
    planningTemplateId: row.planning_template_id || 'fire-strike-task',
    planningAssessmentName: row.planning_assessment_name || '',
    planningStageKey: row.planning_stage_key || 'library',
    planningTaskDefinition: deserialize(row.planning_task_definition, {}),
    planningBindings: deserialize(row.planning_bindings, {}),
    planningAlgorithmInputs: deserialize(row.planning_algorithm_inputs, {}),
    status: row.status || 'draft',
    description: row.description || '',
    ownerUserId: row.owner_user_id,
    sharedContext: deserialize(row.shared_context, {}),
    latestRunId: row.latest_run_id ?? null,
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
  };
}

export function mapTaskRun(row) {
  return {
    id: row.id,
    taskId: row.task_id,
    status: row.status || 'succeeded',
    summary: deserialize(row.summary, {}),
    errorCode: row.error_code || '',
    errorMessage: row.error_message || '',
    createdAt: row.created_at || '',
  };
}

export function mapTaskResult(row) {
  return {
    id: row.id,
    taskId: row.task_id,
    runId: row.run_id,
    resultPayload: deserialize(row.result_payload, {}),
    createdAt: row.created_at || '',
  };
}

export function mapPlanningRealtimeArtifact(row) {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    taskId: row.task_id,
    taskName: row.task_name || '',
    displayName: row.display_name || '',
    description: row.description || '',
    algorithmId: row.algorithm_id || '',
    algorithmName: row.algorithm_name || '',
    stepId: row.step_id || '',
    stepName: row.step_name || '',
    bindingId: row.binding_id || '',
    bindingName: row.binding_name || '',
    status: row.status || 'succeeded',
    inputArtifactIds: deserialize(row.input_artifact_ids, []),
    resultPayload: deserialize(row.result_payload, {}),
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
  };
}

export function createSituationId() {
  return `s${Date.now().toString(36)}`;
}

export function createIntegerId(db, table, fallbackStart) {
  const result = db.prepare(`SELECT MAX(id) AS maxId FROM ${table}`).get();
  return Math.max(Number(result.maxId || 0) + 1, fallbackStart);
}

export async function createImportedSource(db, body, options = {}) {
  const id = createIntegerId(db, 'sources', 1001);
  const normalized = await normalizeSourcePreview(body.type, body);
  const updatedAt = nowText();
  const sourceName = body.name || `导入源-${id}`;
  const taskId = Number.isInteger(Number(options.taskId)) && Number(options.taskId) > 0
    ? Number(options.taskId)
    : null;
  const importBatchKey = String(options.importBatchKey || '').trim();
  const createdByUserId = Number.isInteger(Number(options.createdByUserId))
    ? Number(options.createdByUserId)
    : null;
  const extractionDrafts = buildImportedExtractionDrafts(db, sourceName, normalized.extractionDrafts || []);

  db.exec('BEGIN');
  try {
    db.prepare('INSERT INTO sources (id, name, type, format, status, description, updated_at, preview_type, access_mode, task_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      id,
      sourceName,
      body.type || 'text',
      body.format || '自定义',
      '在线',
      body.description || '用户导入的演示数据源。',
      updatedAt,
      normalized.previewType,
      'imported',
      taskId,
    );

    db.prepare('INSERT OR REPLACE INTO source_contents (source_id, preview_type, payload, created_at) VALUES (?, ?, ?, ?)').run(
      id,
      normalized.previewType,
      serialize(normalized.payload),
      updatedAt,
    );

    if (extractionDrafts.length) {
      let nextExtractionId = createIntegerId(db, 'extractions', 2001);
      const insertExtraction = db.prepare(
        `
          INSERT OR REPLACE INTO extractions (
            id, source_id, title, text_content, summary, entities, relations, created_at,
            source_type, source_name, file_name, task_id, evidence_meta
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      );

      for (const item of extractionDrafts) {
        insertExtraction.run(
          nextExtractionId,
          id,
          item.title || sourceName,
          item.text,
          item.summary || buildExtractionSummary(item.text, `${sourceName} 关键内容`),
          serialize(item.entities || []),
          serialize(item.relations || ['关联']),
          item.extractedAt || updatedAt,
          item.sourceType || 'resource-extraction',
          item.sourceName || sourceName,
          item.fileName || body.fileName || '',
          taskId,
          serialize({
            importBatchKey,
            createdByUserId,
            ...(item.evidenceMeta || {}),
          }),
        );
        nextExtractionId += 1;
      }
    }

    const result = {
      source: db.prepare('SELECT * FROM sources WHERE id = ?').get(id),
      preview: db.prepare('SELECT * FROM source_contents WHERE source_id = ?').get(id),
      extractions: db.prepare('SELECT * FROM extractions WHERE source_id = ? ORDER BY id').all(id),
    };
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function resolveGraphStrategy(mode = 'balanced') {
  const normalizedMode = ['compact', 'mining'].includes(mode) ? mode : 'balanced';
  const presets = {
    balanced: {
      mode: 'balanced',
      sameCampDistanceKm: 80,
      localSupportDistanceKm: 35,
      opposingDistanceKm: 120,
      maxSameCampLinks: 2,
      maxOpposingLinks: 1,
      maxEnvironmentLinks: 1,
      maxTextLinks: 1,
      maxSourceMentionLinks: 2,
      maxSourceSimilarityLinks: 1,
      keepAllSourceLinks: false,
    },
    compact: {
      mode: 'compact',
      sameCampDistanceKm: 55,
      localSupportDistanceKm: 24,
      opposingDistanceKm: 85,
      maxSameCampLinks: 1,
      maxOpposingLinks: 1,
      maxEnvironmentLinks: 1,
      maxTextLinks: 1,
      maxSourceMentionLinks: 1,
      maxSourceSimilarityLinks: 1,
      keepAllSourceLinks: false,
    },
    mining: {
      mode: 'mining',
      sameCampDistanceKm: 100,
      localSupportDistanceKm: 42,
      opposingDistanceKm: 150,
      maxSameCampLinks: 3,
      maxOpposingLinks: 1,
      maxEnvironmentLinks: 2,
      maxTextLinks: 2,
      maxSourceMentionLinks: 3,
      maxSourceSimilarityLinks: 2,
      keepAllSourceLinks: true,
    },
  };

  return presets[normalizedMode];
}

function findSharedOperationalTag(tagsA = [], tagsB = []) {
  return tagsA.find((tag) => /^(blue|red)-/.test(tag) && tagsB.includes(tag)) || '';
}

function sortGraphCandidates(candidates = []) {
  return [...candidates].sort((left, right) => {
    if (right.confidence !== left.confidence) {
      return right.confidence - left.confidence;
    }
    if ((left.distanceKm ?? Number.POSITIVE_INFINITY) !== (right.distanceKm ?? Number.POSITIVE_INFINITY)) {
      return (left.distanceKm ?? Number.POSITIVE_INFINITY) - (right.distanceKm ?? Number.POSITIVE_INFINITY);
    }
    return String(left.target).localeCompare(String(right.target));
  });
}

function appendCandidate(candidateMap, key, candidate) {
  const list = candidateMap.get(key) || [];
  list.push(candidate);
  candidateMap.set(key, list);
}

function normalizeGraphText(text = '') {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function buildCharacterGrams(text = '', gramSize = 2) {
  const normalized = normalizeGraphText(text);
  const grams = new Set();

  if (!normalized) {
    return grams;
  }

  if (normalized.length <= gramSize) {
    grams.add(normalized);
    return grams;
  }

  for (let index = 0; index <= normalized.length - gramSize; index += 1) {
    grams.add(normalized.slice(index, index + gramSize));
  }

  return grams;
}

function calculateSetSimilarity(setA, setB) {
  if (!setA.size || !setB.size) {
    return 0;
  }

  let shared = 0;
  const [left, right] = setA.size <= setB.size ? [setA, setB] : [setB, setA];
  for (const item of left) {
    if (right.has(item)) {
      shared += 1;
    }
  }

  return shared / (setA.size + setB.size - shared || 1);
}

function buildSourceExtractionProfiles(sources, extractions) {
  const profiles = new Map();
  for (const source of sources) {
    profiles.set(Number(source.id), {
      source,
      textParts: [],
      entities: new Set(),
      relations: new Set(),
      extractionCount: 0,
    });
  }

  for (const sample of extractions) {
    const sourceId = Number(sample.sourceId);
    if (!profiles.has(sourceId)) continue;

    const profile = profiles.get(sourceId);
    profile.extractionCount += 1;
    if (sample.title) profile.textParts.push(sample.title);
    if (sample.summary) profile.textParts.push(sample.summary);
    if (sample.text) profile.textParts.push(sample.text);
    for (const entity of sample.entities || []) {
      profile.entities.add(entity);
    }
    for (const relation of sample.relations || []) {
      profile.relations.add(relation);
    }
  }

  return [...profiles.values()].map((profile) => {
    const joinedText = uniqueList(profile.textParts).join('\n');
    return {
      ...profile,
      text: joinedText,
      grams: buildCharacterGrams(joinedText, 2),
    };
  }).filter((profile) => profile.text || profile.entities.size);
}

function shouldKeepSourceLink(item, strategy, kind = 'intel') {
  if (kind === 'env') return true;
  if (strategy.keepAllSourceLinks) return true;
  if (Number(item.id) < 1000) return true;
  if (item.category === '主战单位') return true;
  return Number(item.strength || 0) >= 6;
}

export function buildKnowledgeGraph(db, options = {}) {
  const strategy = resolveGraphStrategy(options.mode);
  const sources = db.prepare('SELECT * FROM sources ORDER BY id').all().map(mapSource);
  const sourceIdSet = new Set(sources.map((item) => Number(item.id)));
  const intelligence = db.prepare('SELECT * FROM intelligence ORDER BY id').all().map(mapIntelligence);
  const environment = db.prepare('SELECT * FROM environment ORDER BY id').all().map(mapEnvironment);
  const extractions = db.prepare('SELECT * FROM extractions ORDER BY id').all().map(mapExtraction);

  const nodes = [];
  const edges = [];
  const nodeIndex = new Map();
  const edgeKeys = new Set();

  function addNode(node) {
    if (nodeIndex.has(node.id)) return;
    nodeIndex.set(node.id, node);
    nodes.push(node);
  }

  function addEdge(source, target, relation, confidence) {
    if (source === target) return;
    const [left, right] = [source, target].sort();
    const key = `${left}|${right}|${relation}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({ id: `e${edgeKeys.size}`, source, target, relation, confidence });
  }

  for (const item of sources) {
    addNode({
      id: `src-${item.id}`,
      name: item.name,
      type: '数据源',
      camp: 'neutral',
      score: item.accessMode === 'imported' ? 72 : 62,
      summary: [item.format, item.status, item.description ? clipText(item.description, 24) : ''].filter(Boolean).join(' · '),
    });
  }

  for (const item of intelligence) {
    addNode({
      id: `intel-${item.id}`,
      name: item.name,
      type: `${item.camp === 'blue' ? '蓝方' : '红方'}-${item.category}`,
      camp: item.camp,
      score: Math.min(96, 48 + item.strength * 8),
      summary: `${item.role} · ${item.readiness}`,
    });
    if (shouldKeepSourceLink(item, strategy, 'intel')) {
      addEdge(`intel-${item.id}`, `src-${item.sourceId}`, '采集自', item.category === '主战单位' ? 0.9 : 0.82);
    }
  }

  for (const item of environment) {
    const risk = String(item.riskLevel || '').trim();
    const riskScore = risk === '高' || /^high$/i.test(risk)
      ? 82
      : risk === '中' || /^medium$/i.test(risk)
        ? 72
        : 64;

    addNode({
      id: `env-${item.id}`,
      name: item.name,
      type: `环境-${item.kind}`,
      camp: 'neutral',
      score: riskScore,
      summary: `${item.geometryType} · ${item.weather}`,
    });
    if (sourceIdSet.has(Number(item.sourceId))) {
      addEdge(`env-${item.id}`, `src-${item.sourceId}`, '采集自', 0.84);
    }
  }

  for (const current of intelligence) {
    const currentNodeId = `intel-${current.id}`;
    const sameCampCandidates = [];
    const opposingCandidates = [];

    for (const compare of intelligence) {
      if (current.id === compare.id) continue;

      const compareNodeId = `intel-${compare.id}`;
      const sharedTags = current.tags.filter((tag) => compare.tags.includes(tag));
      const sharedOperationalTag = findSharedOperationalTag(current.tags, compare.tags);
      const distanceKm = haversineDistanceKm([current.longitude, current.latitude], [compare.longitude, compare.latitude]);

      if (current.camp === compare.camp) {
        const sameCategory = current.category === compare.category;
        const withinLocalSupport = distanceKm <= strategy.localSupportDistanceKm;
        const withinSameCampWindow = distanceKm <= strategy.sameCampDistanceKm;
        if (sameCategory || sharedOperationalTag || (sharedTags.length > 0 && withinSameCampWindow) || withinLocalSupport) {
          sameCampCandidates.push({
            source: currentNodeId,
            target: compareNodeId,
            relation: sameCategory ? '同类协同' : sharedOperationalTag ? '同区协同' : '同阵营关联',
            confidence: Math.min(
              0.93,
              0.58
              + (sameCategory ? 0.12 : 0)
              + (sharedOperationalTag ? 0.12 : 0)
              + (Math.min(sharedTags.length, 3) * 0.05)
              + Math.max(0, (strategy.sameCampDistanceKm - distanceKm) / strategy.sameCampDistanceKm) * 0.12,
            ),
            distanceKm,
          });
        }
      } else if (distanceKm <= strategy.opposingDistanceKm) {
        const mainBattleBonus = current.category === '主战单位' && compare.category === '主战单位' ? 0.06 : 0;
        opposingCandidates.push({
          source: currentNodeId,
          target: compareNodeId,
          relation: '对位关注',
          confidence: Math.min(
            0.89,
            0.6 + mainBattleBonus + Math.max(0, (strategy.opposingDistanceKm - distanceKm) / strategy.opposingDistanceKm) * 0.2,
          ),
          distanceKm,
        });
      }
    }

    sortGraphCandidates(sameCampCandidates)
      .slice(0, strategy.maxSameCampLinks)
      .forEach((candidate) => addEdge(candidate.source, candidate.target, candidate.relation, candidate.confidence));

    sortGraphCandidates(opposingCandidates)
      .slice(0, strategy.maxOpposingLinks)
      .forEach((candidate) => addEdge(candidate.source, candidate.target, candidate.relation, candidate.confidence));
  }

  for (const intel of intelligence) {
    const point = [intel.longitude, intel.latitude];
    const envCandidates = [];
    for (const item of environment) {
      const envNodeId = `env-${item.id}`;
      const intelNodeId = `intel-${intel.id}`;
      if (item.geometryType === 'circle') {
        const distanceKm = haversineDistanceKm(point, item.geometry.center);
        if (distanceKm * 1000 <= item.geometry.radius * 1.1) {
          envCandidates.push({
            source: intelNodeId,
            target: envNodeId,
            relation: '受环境影响',
            confidence: Math.min(0.86, 0.68 + Math.max(0, ((item.geometry.radius / 1000) - distanceKm) / Math.max(item.geometry.radius / 1000, 1)) * 0.16),
            distanceKm,
          });
        }
      }
      if (item.geometryType === 'polygon' && pointInPolygon(point, item.geometry)) {
        envCandidates.push({
          source: intelNodeId,
          target: envNodeId,
          relation: '位于环境区',
          confidence: 0.82,
          distanceKm: 0,
        });
      }
    }

    sortGraphCandidates(envCandidates)
      .slice(0, strategy.maxEnvironmentLinks)
      .forEach((candidate) => addEdge(candidate.source, candidate.target, candidate.relation, candidate.confidence));
  }

  const sourceProfiles = buildSourceExtractionProfiles(sources, extractions);
  const sourceMentionStats = new Map();
  const sourceSimilarityCandidates = new Map();
  const namedNodes = [...nodes].filter((node) => node.type !== '数据源');
  const textCandidatesByNode = new Map();
  const textPairStats = new Map();

  for (const sample of extractions) {
    const sourceNodeId = sample.sourceId ? `src-${sample.sourceId}` : '';
    const matched = namedNodes.filter((node) => sample.text.includes(node.name) || sample.entities.includes(node.name));

    if (sourceNodeId && nodeIndex.has(sourceNodeId)) {
      for (const node of matched) {
        const mentionKey = `${sourceNodeId}|${node.id}`;
        const current = sourceMentionStats.get(mentionKey) || {
          source: sourceNodeId,
          target: node.id,
          count: 0,
          strongMatches: 0,
        };
        current.count += 1;
        if (sample.entities.includes(node.name)) {
          current.strongMatches += 1;
        }
        sourceMentionStats.set(mentionKey, current);
      }
    }

    for (let index = 0; index < matched.length; index += 1) {
      for (let compareIndex = index + 1; compareIndex < matched.length; compareIndex += 1) {
        const left = matched[index].id < matched[compareIndex].id ? matched[index] : matched[compareIndex];
        const right = left.id === matched[index].id ? matched[compareIndex] : matched[index];
        const pairKey = `${left.id}|${right.id}`;
        const current = textPairStats.get(pairKey) || {
          source: left.id,
          target: right.id,
          count: 0,
          relationCount: 0,
        };
        current.count += 1;
        current.relationCount = Math.max(current.relationCount, sample.relations.length);
        textPairStats.set(pairKey, current);
      }
    }
  }

  for (const pair of textPairStats.values()) {
    const candidate = {
      source: pair.source,
      target: pair.target,
      relation: strategy.mode === 'mining' ? '语义共现' : '文本共现',
      confidence: Math.min(0.88, 0.58 + (pair.count * 0.1) + (Math.min(pair.relationCount, 3) * 0.03)),
      distanceKm: Number.POSITIVE_INFINITY,
    };
    appendCandidate(textCandidatesByNode, pair.source, candidate);
    appendCandidate(textCandidatesByNode, pair.target, candidate);
  }

  for (const mention of sourceMentionStats.values()) {
    appendCandidate(sourceSimilarityCandidates, mention.source, {
      source: mention.source,
      target: mention.target,
      relation: strategy.mode === 'mining' ? '文本提及' : '文档提及',
      confidence: Math.min(0.9, 0.64 + (mention.count * 0.08) + (mention.strongMatches * 0.05)),
      distanceKm: Number.POSITIVE_INFINITY,
    });
  }

  for (let index = 0; index < sourceProfiles.length; index += 1) {
    for (let compareIndex = index + 1; compareIndex < sourceProfiles.length; compareIndex += 1) {
      const current = sourceProfiles[index];
      const compare = sourceProfiles[compareIndex];
      const textSimilarity = calculateSetSimilarity(current.grams, compare.grams);
      const entitySimilarity = calculateSetSimilarity(current.entities, compare.entities);
      const relationSimilarity = calculateSetSimilarity(current.relations, compare.relations);
      const isNearDuplicate = current.text && compare.text && (
        current.text.includes(compare.text)
        || compare.text.includes(current.text)
      );

      const shouldLink = isNearDuplicate
        || textSimilarity >= 0.48
        || (textSimilarity >= 0.3 && entitySimilarity >= 0.28)
        || (entitySimilarity >= 0.45 && relationSimilarity >= 0.34);
      if (!shouldLink) continue;

      const sourceId = `src-${current.source.id}`;
      const targetId = `src-${compare.source.id}`;
      const confidence = Math.min(
        0.96,
        0.52
        + (isNearDuplicate ? 0.18 : 0)
        + (textSimilarity * 0.34)
        + (entitySimilarity * 0.24)
        + (relationSimilarity * 0.12)
        + (current.source.type === compare.source.type ? 0.04 : 0),
      );
      const relation = confidence >= 0.86 ? '内容高度相似' : strategy.mode === 'mining' ? '语义近似' : '内容相似';
      const candidate = {
        source: sourceId,
        target: targetId,
        relation,
        confidence,
        distanceKm: Number.POSITIVE_INFINITY,
      };
      appendCandidate(sourceSimilarityCandidates, sourceId, candidate);
      appendCandidate(sourceSimilarityCandidates, targetId, candidate);
    }
  }

  for (const [nodeId, candidates] of textCandidatesByNode.entries()) {
    sortGraphCandidates(candidates)
      .slice(0, strategy.maxTextLinks)
      .forEach((candidate) => addEdge(candidate.source, candidate.target, candidate.relation, candidate.confidence));
  }

  for (const [nodeId, candidates] of sourceSimilarityCandidates.entries()) {
    const limit = nodeId.startsWith('src-') && candidates.some((item) => item.target.startsWith('src-'))
      ? strategy.maxSourceSimilarityLinks + strategy.maxSourceMentionLinks
      : strategy.maxSourceMentionLinks;
    sortGraphCandidates(candidates)
      .slice(0, limit)
      .forEach((candidate) => addEdge(candidate.source, candidate.target, candidate.relation, candidate.confidence));
  }

  return { nodes, edges };
}

export function filterKnowledgeGraph(graph, query) {
  const keyword = normalizeGraphText(query);
  if (!keyword) return graph;

  const matchedNodes = graph.nodes.filter((node) => normalizeGraphText(`${node.name} ${node.summary} ${node.type}`).includes(keyword));
  const matchedIds = new Set(matchedNodes.map((node) => node.id));
  const relatedEdges = graph.edges.filter((edge) => matchedIds.has(edge.source) || matchedIds.has(edge.target));
  for (const edge of relatedEdges) {
    matchedIds.add(edge.source);
    matchedIds.add(edge.target);
  }

  return {
    nodes: graph.nodes.filter((node) => matchedIds.has(node.id)),
    edges: relatedEdges,
  };
}

export { dbFile, nowText, normalizeSourcePreview };
