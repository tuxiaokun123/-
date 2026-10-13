// 六路采集器数据模拟器：循环向 MQTT 服务器发送 6 个通道的模拟数据
// 用来在没有真实设备时测试小程序看板。
//
// 数据格式（JSON 一帧全量，每通道带 V/I 双值）：
//   {"dev":"vc6_001","ch":[{"n":1,"v":220.50,"i":0.52},{"n":2,"v":219.80,"i":1.83},...]}
//     n = 通道号 1~6
//     v = 电压，单位伏特（直接发小数）
//     i = 电流，单位安培（直接发小数）
//
// 用法（在自己电脑上）：
//   1. 安装 Node.js：https://nodejs.org
//   2. 在本文件夹打开命令行，执行：npm install mqtt
//   3. 运行：node simulate.js
//   4. 小程序里点"点击连接"，即可看到 6 个通道的电压/电流每 2 秒跳动
//   5. 按 Ctrl+C 停止
//
// 注意：
//   - TOPIC 必须和小程序 pages/index/index.ts 里的 TOPIC 完全一致
//   - 服务器列表要和小程序里的 BROKER_LIST 保持一致
const mqtt = require('mqtt')

// 和小程序 index.ts 里的 BROKER_LIST 对应（小程序用 wxs://，普通程序用 wss://）
const BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
]
const TOPIC = 'vc6_collector_001'

// 6 个通道：n=通道号，v=电压基准值，i=电流基准值（发送时 ±2% 波动）
const channels = [
  { n: 1, v: 220.1, i: 0.52 },   // 通道1：220V / 0.52A
  { n: 2, v: 219.8, i: 1.83 },   // 通道2：220V / 1.83A
  { n: 3, v: 220.5, i: 4.76 },   // 通道3：220V / 4.76A
  { n: 4, v: 218.9, i: 0.35 },   // 通道4：219V / 0.35A
  { n: 5, v: 220.3, i: 2.31 },   // 通道5：220V / 2.31A
  { n: 6, v: 219.6, i: 8.75 },   // 通道6：220V / 8.75A
]

const shortName = (u) => u.split('//')[1].split(':')[0]

// 在基准值上下 ±2% 内随机晃动，模拟真实读数
const jitter = (base) => +(base * (0.98 + Math.random() * 0.04)).toFixed(2)

for (const url of BROKERS) {
  const client = mqtt.connect(url, {
    clientId: 'sim_' + Date.now() + '_' + Math.floor(Math.random() * 10000),
    clean: true,
    connectTimeout: 8000,
    keepalive: 30,
  })
  let timer = null
  let round = 0

  client.on('connect', () => {
    console.log(`[${shortName(url)}] 已连接，开始每 2 秒发一轮数据`)
    if (timer) return   // 断线重连时不重复开定时器
    const sendRound = () => {
      round++
      const frame = {
        dev: 'vc6_collector_001',
        ch: channels.map(c => ({ n: c.n, v: jitter(c.v), i: jitter(c.i) })),
      }
      const msg = JSON.stringify(frame)
      client.publish(TOPIC, msg, { retain: true }) // retain：新连上的订阅者立刻能收到
      console.log(`[${shortName(url)}] 第${round}帧 ${msg}`)
    }
    sendRound()
    timer = setInterval(sendRound, 2000)
  })

  client.on('error', (e) => {
    console.log(`[${shortName(url)}] 出错：`, e.message)
  })

  client.on('close', () => {
    console.log(`[${shortName(url)}] 连接断开，自动重连中……`)
  })
}

console.log('模拟器已启动，按 Ctrl+C 停止')
